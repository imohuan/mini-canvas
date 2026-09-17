<script setup lang="ts">
/**
 * VideoContent —— video 节点的内容段：播放视频 + 承载裁剪覆盖层 + 全屏查看。
 *
 * 职责边界：
 * - 端口/标题由 BaseNode 壳负责，这里不碰；
 * - 播放 UI 自己画（不用浏览器原生 controls）—— 原生控件样式随浏览器变、大小不跟画布缩放，
 *   而且无法把"只播剪辑那一段"的意图表达出来（对齐 v1 VideoNode 的做法）；
 * - **裁剪浮层不在这里**：它由 overlay 段（VideoFrameOverlay）画在卡片外面。
 *   本组件住在 .v2-content-clip（overflow:hidden）里，浮层挂这儿会被卡片边界裁掉
 *   —— 用户实测报的"裁剪区域被节点切掉"就是这个原因；
 * - 剪辑底栏是 bottom-toolbar 段的另一个组件，与本组件是兄弟 —— 两者只通过 videoSession 与节点 data 通信。
 *
 * 裁剪是**取景式**的（见 videoCrop 的说明）：裁过的节点把视频按框放大并偏移，框外被卡片裁掉。
 * 于是"整幅 / 裁剪后"是同一个 video 元素的两套 CSS，不必转码、不必重建播放器。
 * 这也意味着**裁剪中必须显示完整画面**（否则用户看不到自己框外的内容没法调框）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RenderEvents, useCanvasRender } from '@mini-canvas/canvas-render'
import { framingStyle, isCroppedRect, type Rect } from './videoCrop'
import { readClipRange } from './videoClip'
import { formatTime } from './videoNodeData'
import { followedVideoCardSizePatch, missingVideoCardSizePatch, type CardSizePatch } from './videoFit'
import { createVideoOps, displaySizeOf } from './videoOps'
import { endOverlay, isCropping } from './videoSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

const videoRef = ref<HTMLVideoElement | null>(null)
const fullscreenRef = ref<HTMLVideoElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const fullscreenOpen = ref(false)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const broken = ref(false)
const captureBusy = ref(false)

const videoUrl = computed(() => (typeof props.data?.videoUrl === 'string' ? props.data.videoUrl : ''))
const videoWidth = computed(() => (typeof props.data?.videoWidth === 'number' ? props.data.videoWidth : 0))
const videoHeight = computed(() => (typeof props.data?.videoHeight === 'number' ? props.data.videoHeight : 0))
const cropRect = computed<Rect | undefined>(() => {
  const r = props.data?.cropRect as Rect | undefined
  return isCroppedRect(r) ? r : undefined
})
const cropping = computed(() => isCropping(props.id))
const fullscreenActive = computed(() => fullscreenOpen.value)

/** 读写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘） */
const ops = createVideoOps(ctx)

/** 剪辑范围（缺省 = 整段；脏数据已被收敛） */
const clipRange = computed(() => readClipRange(props.data))
const clipped = computed(() => props.data?.clipStart !== undefined || props.data?.clipEnd !== undefined)
/** 可播放时长：剪辑过就只算那一段 */
const playableLength = computed(() => {
  const r = clipRange.value
  const len = r.end - r.start
  return len > 0 ? len : duration.value
})
/** 进度按"剪辑段内已播多久"显示（用户看到的就该是自己剪出来的那段时间轴） */
const playedInClip = computed(() => Math.max(0, Math.min(currentTime.value - clipRange.value.start, playableLength.value)))
const progressPct = computed(() => (playableLength.value > 0 ? (playedInClip.value / playableLength.value) * 100 : 0))
const timeLabel = computed(() => `${formatTime(playedInClip.value)} / ${formatTime(playableLength.value)}`)

/** 裁剪中显示完整画面；平时按裁框取景（这是"裁剪"在视觉上落地的唯一一处） */
const videoStyle = computed<Record<string, string>>(() => {
  if (cropping.value) return {}
  return framingStyle(cropRect.value, videoWidth.value, videoHeight.value)
})
const isFramed = computed(() => !cropping.value && Object.keys(videoStyle.value).length > 0)

/** 当前该用哪个 video 元素（全屏时是搬到全屏层那个） */
function activeVideo(): HTMLVideoElement | null {
  return fullscreenOpen.value ? fullscreenRef.value ?? videoRef.value : videoRef.value
}

// ==================== 播放控制 ====================

/** 播放：起点不在剪辑段内时先跳到段首（否则会播到裁剪掉的画面） */
async function togglePlay(): Promise<void> {
  const v = activeVideo()
  if (!v || !videoUrl.value) return
  if (v.paused) {
    const { start, end } = clipRange.value
    if (v.currentTime < start || (end > start && v.currentTime >= end)) v.currentTime = start
    await v.play().catch(() => {})
  } else {
    v.pause()
  }
}

function onLoadedMetadata(e: Event): void {
  const v = e.target as HTMLVideoElement
  duration.value = Number.isFinite(v.duration) ? v.duration : duration.value
  broken.value = false
  // 起点在剪辑段之前时先对齐到段首（换过剪辑范围后重新加载也适用）
  const { start } = clipRange.value
  if (start > 0 && v.currentTime < start) v.currentTime = start
}

function onTimeUpdate(e: Event): void {
  const v = e.target as HTMLVideoElement
  currentTime.value = v.currentTime
  playing.value = !v.paused
  const { start, end } = clipRange.value
  // 播到剪辑段末尾：停了，并把画面停在结尾（不要让用户看到被剪掉的画面）
  if (end > start && v.currentTime >= end) {
    v.pause()
    v.currentTime = end
    currentTime.value = end
  }
}

/** 拖动进度条：值按"段内偏移"给，落回真实时间要加回段首 */
function onSeek(e: Event): void {
  const v = activeVideo()
  if (!v) return
  const offset = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(offset)) return
  const target = clipRange.value.start + offset
  v.currentTime = Math.min(Math.max(target, 0), duration.value || target)
  currentTime.value = v.currentTime
}

function onVideoError(): void {
  // 会话级 objectURL 刷新后必然失效，如实标出来（不写进 data —— 那是会话事实，不是节点属性）
  broken.value = true
  playing.value = false
}

// ==================== 截图 ====================

/** 截图走命令：命令里统一处理"图片插件没装"等边界，也供快捷键/菜单复用同一条路径 */
async function onCaptureFrame(): Promise<void> {
  if (captureBusy.value || !videoUrl.value) return
  captureBusy.value = true
  try {
    const at = activeVideo()?.currentTime ?? currentTime.value
    await captureFrameNode(at)
  } finally {
    captureBusy.value = false
  }
}

async function captureFrameNode(at: number): Promise<void> {
  const command = ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
  command.execute('video.captureFrame', { nodeId: props.id, at })
}

// ==================== 全屏 ====================

function openFullscreen(): void {
  if (!videoUrl.value || fullscreenOpen.value) return
  fullscreenOpen.value = true
  void nextTick(() => {
    const from = videoRef.value
    const to = fullscreenRef.value
    if (!from || !to) return
    to.currentTime = from.currentTime
    if (!from.paused) void to.play().catch(() => {})
    from.pause()
  })
}

function closeFullscreen(): void {
  if (!fullscreenOpen.value) return
  const from = fullscreenRef.value
  const to = videoRef.value
  if (from && to) {
    to.currentTime = from.currentTime
    if (!from.paused) void to.play().catch(() => {})
  }
  from?.pause()
  fullscreenOpen.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (fullscreenOpen.value) closeFullscreen()
}

// ==================== 卡片尺寸兜底 ====================

/**
 * 两张兜底牌（与图片节点同一套规矩）：
 * 1. 挂载时 —— 卡片尺寸缺失（旧数据 / 后台或 MCP 建的节点）按视频补算一次；
 * 2. 视频尺寸变了（别的插件/后台换了视频）—— 按新视频重算。
 * 两者都只在"确实该改"时写回；必须幂等（算出来等于当前就不写），否则会自己触发自己成死循环。
 * 挂载时推迟到 nextTick：让写入落在挂载完成之后（挂载窗口内的写入会被丢掉，图片节点实测过）。
 */
function syncCardSize(patch: CardSizePatch | null): void {
  if (!patch) return
  const current = ops.read(props.id) ?? props.data
  ops.write(
    props.id,
    { ...current, cardWidth: patch.cardWidth, cardHeight: patch.cardHeight },
    patch.size,
  )
}

onMounted(() => {
  void nextTick(() => syncCardSize(missingVideoCardSizePatch(props.data, ops.fitLimits?.())))
  window.addEventListener('keydown', onKeydown)
})

watch(
  () => props.data?.videoUrl,
  () => {
    broken.value = false
    syncCardSize(followedVideoCardSizePatch(props.data, ops.fitLimits?.()))
  },
)

// 点画布空白退出裁剪（与图片节点一致：宿主已把"点空白"归一成内核事件，不必自己监听 document）
const paneClickSub = ctx.on(RenderEvents.PaneClick, () => {
  if (cropping.value) endOverlay(props.id)
})

// 双击画面 = 进全屏（与 v1 同手势；裁剪中不接管，免得抢了裁剪框的双击）
function onStageDblClick(e: MouseEvent): void {
  if (cropping.value) return
  e.stopPropagation()
  openFullscreen()
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  paneClickSub.dispose()
  endOverlay(props.id)
})

/** 卡片上显示的元信息（裁剪中显示原画面尺寸 —— 那时调的是整幅画面） */
const stageLabel = computed(() => {
  const d = displaySizeOf(props.data)
  const w = cropping.value ? videoWidth.value : d.width
  const h = cropping.value ? videoHeight.value : d.height
  return w > 0 && h > 0 ? `${w}×${h}` : ''
})
</script>

<template>
  <div class="video-node">
    <div
      ref="stageRef"
      class="video-stage"
      :class="{ 'is-framed': isFramed, 'is-cropping': cropping }"
      @dblclick="onStageDblClick"
    >
      <template v-if="videoUrl && !broken">
        <video
          ref="videoRef"
          class="video-media"
          :style="videoStyle"
          :src="videoUrl"
          playsinline
          preload="metadata"
          @loadedmetadata="onLoadedMetadata"
          @timeupdate="onTimeUpdate"
          @play="playing = true"
          @pause="playing = false"
          @error="onVideoError"
        />

        <!-- 裁剪覆盖层：挂在这里因为本组件就是"内容区"这个坐标盒子。 -->
      </template>

      <div v-else-if="broken" class="video-empty is-broken">视频已失效（会话级链接刷新后不可恢复）</div>
      <div v-else class="video-empty is-void">（无视频）</div>
    </div>

    <!-- 播放控件：本地态的显隐规则是"有视频且不在裁剪中"。
         三个 VueFlow 保留类名把画布手势挡在外面：nodrag 不拖节点、nopan 不拖画布、nowheel 不缩放画布。 -->
    <div v-if="videoUrl && !broken && !cropping" class="video-controls nodrag nopan nowheel" @dblclick.stop>
      <button class="vc-btn" type="button" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停' : '播放'" @click.stop="togglePlay">
        <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7,4 19,12 7,20" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      </button>

      <span class="vc-time">{{ timeLabel }}</span>

      <label class="vc-progress" title="拖动调整进度">
        <input
          type="range"
          min="0"
          :max="playableLength"
          step="0.01"
          :value="playedInClip"
          aria-label="播放进度"
          @input="onSeek"
        />
        <span class="vc-progress-fill" :style="{ width: progressPct + '%' }" />
      </label>

      <button class="vc-btn" type="button" title="截取当前帧" aria-label="截取当前帧" :disabled="captureBusy" @click.stop="onCaptureFrame">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </button>
      <button class="vc-btn" type="button" title="全屏播放" aria-label="全屏播放" @click.stop="openFullscreen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
    </div>

    <!-- 右上角元信息（裁剪时显示原画面尺寸） -->
    <div v-if="stageLabel && !cropping" class="video-badge">{{ stageLabel }}</div>
  </div>

  <!-- 全屏层：刻意纯黑无装饰，Esc / 双击 / 点背景退出。 -->
  <Teleport to="body">
    <div v-if="fullscreenActive" class="video-fullscreen" @click.self="closeFullscreen">
      <video
        ref="fullscreenRef"
        class="video-fullscreen-media"
        :style="videoStyle"
        :src="videoUrl"
        playsinline
        autoplay
        @loadedmetadata="onLoadedMetadata"
        @timeupdate="onTimeUpdate"
        @play="playing = true"
        @pause="playing = false"
      />
      <div class="video-fullscreen-controls nodrag nopan nowheel" @click.stop>
        <button class="vc-btn is-on-dark" type="button" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停' : '播放'" @click.stop="togglePlay">
          <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7,4 19,12 7,20" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        </button>
        <span class="vc-time is-on-dark">{{ timeLabel }}</span>
        <label class="vc-progress">
          <input type="range" min="0" :max="playableLength" step="0.01" :value="playedInClip" aria-label="播放进度" @input="onSeek" />
          <span class="vc-progress-fill" :style="{ width: progressPct + '%' }" />
        </label>
        <button class="vc-btn is-on-dark" type="button" title="退出全屏" aria-label="退出全屏" @click.stop="closeFullscreen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 数值照 docs/design/ui-style-guide.md：四档灰阶、圆角 8/6、交互目标 32px、
   动效 150-240ms 且带 prefers-reduced-motion 降级。播放区以黑底呈现。 */
.video-node {
  position: relative;
  width: 100%;
  height: 100%;
  background: #050505;
  overflow: hidden;
}

/* 舞台：裁剪覆盖层与"按框取景"的定位基准 */
.video-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.video-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #050505;
  /* 卡片选中/拖动时不让浏览器原生手势打断 */
  user-select: none;
}

/* 裁过的画面：由 croppedVideoStyle 给出放大比例与偏移，位置相对舞台左上角，
   框外部分被 .video-stage 的 overflow:hidden 裁掉 —— 这就是"裁剪"的视觉实现。 */
.video-stage.is-framed .video-media {
  position: absolute;
  max-width: none;
  max-height: none;
  object-fit: fill;
}

/* —— 播放控件：压在画面底部，半透明黑底保证任何画面上都读得清 —— */
.video-controls {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 10px;
  background: rgba(17, 24, 39, 0.72);
}

.vc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  /* 交互目标 ≥32px（§5 第 4 条） */
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.vc-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}
.vc-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.vc-btn:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}
.vc-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.vc-btn svg {
  width: 16px;
  height: 16px;
}

.vc-time {
  flex: none;
  min-width: 74px;
  color: rgba(255, 255, 255, 0.92);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

/* 进度条：轨道 4px + 已播填充；input 透明覆盖在上面接手势（自绘才能跟画布缩放匹配） */
.vc-progress {
  position: relative;
  flex: 1;
  min-width: 60px;
  height: 16px;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.vc-progress::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 6px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35);
}
.vc-progress-fill {
  position: absolute;
  left: 0;
  top: 6px;
  height: 4px;
  border-radius: 999px;
  background: #0891b2;
  pointer-events: none;
}
.vc-progress input {
  position: absolute;
  inset: 0;
  width: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

/* 右上角元信息小标签（灰阶、发丝边，不抢画面） */
.video-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 8;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.66);
  color: rgba(255, 255, 255, 0.85);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.video-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 8px;
  color: rgba(255, 255, 255, 0.55);
  /* 中文正文最低 12px（§2.3） */
  font-size: 12px;
  text-align: center;
}
.video-empty.is-broken {
  color: #fbbf24;
}

/* —— 全屏层 —— */
.video-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}
.video-fullscreen-media {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.video-fullscreen :deep(.video-media),
.video-fullscreen-media[style] {
  position: absolute;
  max-width: none;
  max-height: none;
  object-fit: fill;
}
.video-fullscreen-controls {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(760px, calc(100vw - 64px));
  padding: 8px 12px;
  border-radius: 16px;
  background: rgba(17, 24, 39, 0.78);
}

@media (prefers-reduced-motion: reduce) {
  .vc-btn {
    transition: none !important;
  }
  .vc-btn:active:not(:disabled) {
    transform: none;
  }
}
</style>
