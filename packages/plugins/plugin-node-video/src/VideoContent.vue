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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RenderEvents, useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
// 加载态视觉已随节点壳搬进 plugin-theme-canvas（同一份实现直接复用，不再走 ui 目录）
import { NodeLoadingState } from '@mini-canvas/plugin-theme-canvas'
import { framingStyle, isCroppedRect, type Rect } from './videoCrop'
import { readClipRange } from './videoClip'
import VideoPlayerBar from './VideoPlayerBar.vue'
import { Maximize2 } from 'lucide-vue-next'
import { openPreview } from './mediaPreviewBus'

/** 正有限数才算有值（与 videoFit 内同口径） */
function positiveNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
import { createVideoOps } from './videoOps'
import { isVideoCardBusy } from './videoNodeData'
import { endOverlay, isClipping, isCropping } from './videoSession'
import {
  clearClipPrefs,
  clearDraftRange,
  readDraftRange,
  resetDuration,
  resetPlayhead,
} from './videoClipStore'
import { useVideoSource } from './video-content/useVideoSource'
import { useVideoPlayback } from './video-content/useVideoPlayback'
import { useVideoFrameThumb } from './video-content/useVideoFrameThumb'
import { useVideoAudioMenu } from './video-content/useVideoAudioMenu'
import { useVideoCapture } from './video-content/useVideoCapture'
import { useVideoCardSize } from './video-content/useVideoCardSize'
import { readVideoMeta } from './videoTransform'
import { videoCardSizePatch } from './videoFit'
import VideoCaptureMenu from './video-content/VideoCaptureMenu.vue'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
/** 默认主题的统一空状态（按名取；极简宿主没装主题时回落本组件的一行灰字） */
const NodeEmptyState = useUiComponent('nodeEmptyState')
const Button = useUiComponent('Button')

const { ctx, flow, interaction } = useCanvasRender()

const videoRef = ref<HTMLVideoElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const broken = ref(false)

/** 播放地址：优先按 resourceId 现取，迁移期没有可用引用时才用旧 videoUrl 兜底。 */
const { sourceFields, videoUrl, videoWidth, videoHeight } = useVideoSource(ctx, () => props.data)
const cropRect = computed<Rect | undefined>(() => {
  const r = props.data?.cropRect as Rect | undefined
  return isCroppedRect(r) ? r : undefined
})
const cropping = computed(() => isCropping(props.id))
/** 当前播放范围（缺省 = 整段；剪辑会话里优先用面板正在拖的草稿区间） */
const clipRange = computed(() => {
  if (isClipping(props.id)) {
    const draft = readDraftRange(props.id)
    if (draft && draft.end > draft.start) return draft
  }
  return readClipRange(props.data)
})
/** 鼠标是否停在卡片上 */
const hovering = ref(false)
/**
 * 本节点是否被**单独选中**（多选时为 false）。
 *
 * 用户口径 2026-10-31：「只有 hover 能触发播放和控件显示，选中（单选）时效果要和 hover 一致」。
 * 复用渲染层的判定，与图片/文本节点的操作栏同源 —— 多选时不进入这个状态，
 * 否则框选三个视频就会三个一起播。
 */
const soleSelected = useSoleNodeSelected(props.id)
/**
 * 「激活态」：鼠标悬停 **或** 单选选中，两者完全等价。
 *
 * 这是视频节点唯一的"该不该播、该不该露控件"判据 —— 下面所有显隐与播放
 * 都只看它，不再各自判断 hover，避免两条路径慢慢走偏。
 */
const active = computed(() => hovering.value || soleSelected.value)
/**
 * 卡片上盖着加载 / 失败态（runState 在跑或失败）。
 *
 * 用户口径 2026-11-08：加载态盖着时**不要**再触发悬停播放 —— 用户看不到画面，也不该解码。
 * 只拦播放入口（自动播 / 播放按钮 / 双击全屏），悬停与选中照常记录，关掉加载态就恢复正常。
 */
const busy = computed(() => isVideoCardBusy(props.data))

const playback = useVideoPlayback({
  nodeId: props.id,
  data: () => props.data,
  active: () => active.value,
  cropping: () => cropping.value,
  broken,
  videoUrl: () => videoUrl.value,
  clipRange: () => clipRange.value,
  videoRef,
  hovering,
  blocked: () => busy.value,
  onMeta: (v) => onVideoMeta(v),
})
const {
  playing, currentTime, duration, videoRequested, resumeTime, videoHasFrame,
  keepPosterOverVideo, showPoster, activeVideo, onPlayButton, onCardEnter, onCardLeave,
  playableLength, playedInClip, onLoadedMetadata, onTimeUpdate, onBarSeek,
  onVideoError, onVideoPlay, setPlaying, onVideoReady, dispose: disposePlayback,
} = playback

/** 帧图与分档：未播放时只显示这张统一缩略图 */
const { thumbLoading, posterDisplaySrc, prefetchPoster, dispose: disposeFrameThumb } = useVideoFrameThumb({
  ctx,
  viewport: flow.viewport,
  videoUrl,
  videoWidth,
  videoHeight,
})

const muted = ref(false)
const volume = ref(1)
const playbackRate = ref(1)
const {
  captureBusy,
  captureMenuOpen,
  captureMenuRef,
  onCaptureMenuPick,
  dispose: disposeCapture,
} = useVideoCapture({
  nodeId: () => props.id,
  ctx,
  videoUrl,
  videoRef,
  currentTime,
  duration,
  clipRange: () => clipRange.value,
})
const {
  volumeOpen,
  rateMenuOpen,
  volumeEffectiveMuted,
  delayedClose,
  cancelDelayedClose,
  openExclusive,
  onRateToggle,
  onRatePick,
  onMuteToggle,
  onBarVolume,
  dispose: disposeAudioMenu,
} = useVideoAudioMenu({
  volume,
  muted,
  playbackRate,
  videoRef,
  captureMenuOpen,
})

/** 读写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘） */
const ops = createVideoOps(ctx)

/** 裁剪中显示完整画面；平时按裁框取景（这是"裁剪"在视觉上落地的唯一一处） */
const videoStyle = computed<Record<string, string>>(() => {
  if (cropping.value) return {}
  // 卡片尺寸一起传：取景块按**裁框自己的宽高比**铺满卡片。
  // 只按「原宽÷框宽、原高÷框高」放大会在卡片比例与裁框不一致时把画面拉扁
  // （用户 2026-10-30 实测报的「缩略图没有裁剪」）。没有卡片尺寸时退回旧算法。
  const cardW = positiveNum(props.data?.cardWidth) ?? 0
  const cardH = positiveNum(props.data?.cardHeight) ?? 0
  return framingStyle(cropRect.value, videoWidth.value, videoHeight.value, cardW, cardH)
})
const isFramed = computed(() => !cropping.value && Object.keys(videoStyle.value).length > 0)

/**
 * 预览图的显示方式。
 *
 * 预览图现在是**整幅原片**（用户 2026-10-31：默认缩略图不携带裁剪），
 * 所以它和 video 一样要按裁框做 CSS 取景 —— 两边复用**同一套** videoStyle。
 *
 * 从前的做法是"生成时就裁好、显示端不再取景"，代价是每换一种裁法就多存一张图，
 * 而左侧栏 / 底栏拿不到裁框、必然对不上。现在一张图走天下。
 */
const posterStyle = computed<Record<string, string>>(() => videoStyle.value)

/** 卡片尺寸兜底：挂载补缺、换源重算、元数据到手补宽高 */
const { mountSize, onMeta: onVideoMeta, sizeSettled, syncCardSize } = useVideoCardSize({
  nodeId: () => props.id,
  data: () => props.data,
  ops,
  sourceFields,
  onSourceChanged: () => { broken.value = false },
  // 拖动中先别改卡片尺寸：节点会在指针下跳一下（用户实测「拖不动、要平移缩放才恢复」）
  dragging: () =>
    interaction.activity.value.nodeDragging && interaction.activity.value.nodeDragId === props.id,
})

onMounted(() => {
  mountSize()
  prefetchPoster()
  void ensureCardSize()
})

/**
 * 卡片尺寸还没对上画面比例时，**主动读一次视频元数据**。
 *
 * 用户 2026-11-11 实测：从资源面板拖入视频，卡片先按默认 480×320 画，上下留黑边；
 * 只有悬停播放（那时才挂 video 元素、拿到 loadedmetadata）或平移缩放才恢复。
 * 视频节点不允许手动 resize，尺寸本就该由画面比例决定 —— 所以不等交互，
 * 地址一有就量一次；量到就写回宽高与卡片尺寸（派生写入，不进撤销栈）。
 *
 * 读不到（跨域 / 编码不支持）就什么都不做：绝不猜一个尺寸。
 */
async function ensureCardSize(): Promise<void> {
  const url = videoUrl.value
  if (!url || sizeSettled(url) || busy.value) return
  const meta = await readVideoMeta(url).catch(() => null)
  // 读的过程中地址被换掉了 → 这次结果作废（换源 watch 会自己再跑一次）
  if (url !== videoUrl.value) return
  if (!meta || !(meta.width > 0) || !(meta.height > 0)) return
  // 真实宽高属于**测量结果**：走运行态写入（落盘、不进撤销栈），和挂载兜底同一口径
  const current = ops.read(props.id) ?? props.data
  ops.writeRuntime?.(props.id, {
    ...current,
    videoWidth: meta.width,
    videoHeight: meta.height,
    ...(Number.isFinite(meta.duration) ? { videoDuration: meta.duration } : {}),
  })
  syncCardSize(videoCardSizePatch(meta.width, meta.height, ops.fitLimits?.()))
}

// 地址一到就量一次（拖入/换源都会走这里；尺寸已对齐时是空操作）
watch(videoUrl, () => { void ensureCardSize() })

/**
 * 点画布空白：只负责退出裁剪。
 *
 * 这里不再停播（用户 2026-10-31）：停播只由"激活态消失"驱动
 * （鼠标离开且未单选 → leaveActive）。再多一条"点空白就停"的路，
 * 两条判据各走各的，行为就看谁先触发 —— 用户看到的就是随机。
 */
const paneClickSub = ctx.on(RenderEvents.PaneClick, () => {
  if (cropping.value) endOverlay(props.id)
})

// 双击画面 = 进全屏（与 v1 同手势；裁剪中不接管，免得抢了裁剪框的双击）
function onStageDblClick(e: MouseEvent): void {
  if (cropping.value) return
  // 加载 / 失败态盖着时不进全屏：那会绕过覆盖层直接开始播
  if (busy.value) return
  e.stopPropagation()
  // 全屏改用全局预览组件（用户口径 2026-10-17：不要自己实现预览，
  // 生成历史 / 底栏素材卡都是主题注册的 MediaViewer）——把当前视频交给总线，
  // 由 overlay 槽的 VideoFullscreenOverlay 渲染；本节点内先暂停，预览层自己播
  if (videoRef.value) videoRef.value.pause()
  openPreview({
    name: (typeof props.data?.videoName === 'string' && props.data.videoName) || '视频预览',
    kind: 'video',
    url: videoUrl.value,
  })
}

onBeforeUnmount(() => {
  disposeFrameThumb()
  disposeAudioMenu()
  disposeCapture()
  disposePlayback()
  paneClickSub.dispose()
  endOverlay(props.id)
  resetPlayhead(props.id)
  clearClipPrefs(props.id)
  clearDraftRange(props.id)
  // 时长也是模块级共享态（剪辑面板读它铺胶片格）：不清就跟着 nodeId 一直留着
  resetDuration(props.id)
})

// 视频地址一变：旧源的帧图全部作废（释放 objectURL）、回到"未播放"态
watch(videoUrl, (prev) => {
  if (prev) {
    // 旧源的缩略图缓存不必手工清：统一服务的缓存键带源哈希，换视频就是换键，
    // 旧条目留着也不会被误命中（且它存的是资源库地址，不占解码器）。
  }
  videoRequested.value = false
  resumeTime.value = 0
})

</script>

<template>
  <!--
    @pointerleave 做两件事：收起播放控件 + **停止播放并回到帧图**。
    用户口径（原话）：「我播放之后已经离开了这个 UI，它就暂停在这一帧，
    并且依然显示着这个视频元素，而没有切换成帧图片预览」—— 离开就应该不再占着视频。
    @pointerenter 则相反：悬停上来就自动播放（用户口径：不用先点按钮）。
  -->
  <div class="video-node" @pointerenter="onCardEnter" @pointerleave="onCardLeave">
    <!-- 底部渐变衬底：只给"悬停时露出的播放控件"当背景。
         没有视频（或视频失效、正在裁剪）时不渲染；鼠标离开卡片时淡出 ——
         空节点必须保持卡片本身的底色，否则底部会挂着一条没来由的灰带（用户实测报的）。 -->
    <div v-if="videoUrl && !broken && !cropping" class="vc-scrim" :class="{ 'is-hidden': !active }"
      aria-hidden="true"></div>
    <div ref="stageRef" class="video-stage"
      :class="{ 'is-framed': isFramed, 'is-cropping': cropping, 'has-media': Boolean(videoUrl) && !broken }"
      @dblclick="onStageDblClick">
      <template v-if="videoUrl && !broken">
        <!--
          帧图态（默认）：只画一张静态帧图 —— 页面里没有指向视频字节的 video 元素，
          点播放才挂上它（见 onPlayButton / videoRequested）。
          帧图三档（第 1 档 = 原生尺寸那一帧）由本插件现抓（videoThumbCanvas），只放内存。

          帧图与 video 元素共用同一套几何（.video-media 类 + 同一套 style），
          裁剪取景（按原视频像素宽高算的百分比）对两者都成立 —— 所以下面这个 class 与 style 是同一套。
          （注释里刻意不写标签字面量：SSR 会把注释一起渲染出来，断言"页面里没有 video"时会误判。）

          帧图还没生成好时不渲染 img：留空由 stage 的底色顶着，**不挂 video**
          （挂了就违背"点播放才加载视频"）。生成通常在几十毫秒内完成。
        -->
        <!-- 帧图与 video 是"叠放"：鼠标进节点 → video 立刻挂载并自动播放，
             首次 play 后 500ms 才把帧图藏掉（延迟关闭）；之后只要鼠标不离开，
             video 永不消失（暂停/拖进度条都保持视频画面）。 -->
        <!-- 预览图**一旦有了就常驻 DOM**（用户 2026-10-30）：v-if 只负责"有没有图"，
             v-show 负责"盖不盖住视频"。鼠标移开时元素还在，只是重新显示出来 ——
             没有 blob 重建空窗，不会白屏一闪。 -->
        <img v-if="posterDisplaySrc" v-show="keepPosterOverVideo" class="video-media is-poster"
          :class="{ 'is-cropping': cropping }" :style="posterStyle" :src="posterDisplaySrc"
          alt="视频帧" draggable="false" />
        <!--
          加载态（用户 2026-10-30 要求）：缩略图还没拿到时不能只留一块空底色 ——
          用户分不清"在加载"和"坏了"。统一用默认主题的加载件（流光 + 文字），
          与底栏任务进度、全屏视频加载同一只，不再各画一套转圈。
          **帧图已经有了就不显示**：那时候屏幕上有真画面，再盖一层是噪音。
        -->
        <NodeLoadingState
          v-if="thumbLoading && !posterDisplaySrc && showPoster"
          surface="media"
          label="加载中"
          message="加载预览…"
        />
        <!-- 独立 v-if：video 只看"请求播放"，与帧图在不在无关 -->
        <video v-if="!showPoster" ref="videoRef" class="video-media" :class="{ 'has-frame': videoHasFrame }"
          :style="videoStyle" :src="videoUrl"
          playsinline preload="metadata" @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate"
          :muted="volumeEffectiveMuted" :volume="volume"
          @loadeddata="onVideoReady" @canplay="onVideoReady" @seeked="onVideoReady"
          @play="onVideoPlay" @pause="setPlaying(false)" @error="onVideoError"
        />

      </template>

      <NodeEmptyState
        v-else-if="broken && NodeEmptyState"
        text="视频已失效"
        description="会话级链接刷新后不可恢复，请重新上传"
        tone="danger"
      />
      <div v-else-if="broken" class="video-empty is-broken">视频已失效（会话级链接刷新后不可恢复）</div>
      <NodeEmptyState v-else-if="NodeEmptyState" text="（无视频）" description="上传一段视频，或把视频节点连进来" />
      <div v-else class="video-empty is-void">（无视频）</div>
    </div>

    <!-- 播放控件：本地态的显隐规则是"有视频且不在裁剪中"，再叠加卡片 hover（不常驻，免得遮画面）。
         三个 VueFlow 保留类名把画布手势挡在外面：nodrag 不拖节点、nopan 不拖画布、nowheel 不缩放画布。 -->
    <div v-if="videoUrl && !broken && !cropping" class="video-controls nodrag nopan nowheel"
      :class="{ 'is-hidden': !active }" @dblclick.stop>
      <!-- 控件条 = 共用组件 VideoPlayerBar（视觉标准在节点这一侧，2026-10-29 用户拍板）。
           节点形态的差异只有截图按钮（插槽传入，含三帧菜单）——其余与全屏预览完全一致。 -->
      <VideoPlayerBar
        :playing="playing"
        :current-time="playedInClip"
        :duration="playableLength"
        :rate="playbackRate"
        :rate-menu-open="rateMenuOpen"
        :muted="volumeEffectiveMuted"
        :volume="volume"
        :volume-menu-open="volumeOpen"
        :capture-busy="captureBusy"
        @play="onPlayButton"
        @seek="onBarSeek"
        @rate-toggle="onRateToggle"
        @rate-pick="onRatePick"
        @mute-toggle="onMuteToggle"
        @volume="onBarVolume"
        @volume-open="cancelDelayedClose('volume'); openExclusive('volume')"
        @volume-close="delayedClose('volume')"
      >
        <template #capture>
          <div ref="captureMenuRef" class="vc-capture">
            <VideoCaptureMenu
              :busy="captureBusy"
              :open="captureMenuOpen"
              @enter="cancelDelayedClose('capture'); openExclusive('capture')"
              @menu-enter="cancelDelayedClose('capture')"
              @menu-leave="delayedClose('capture')"
              @leave="delayedClose('capture')"
              @pick="onCaptureMenuPick"
            />
          </div>
        </template>
        <!-- 全屏按钮放进条内尾部：整条底栏铺满宽度，图标仍在最右侧（与拆分前一致） -->
        <template #end>
          <Button class="vc-btn" variant="ghost" size="icon-xs" type="button" title="全屏播放" aria-label="全屏播放"
            @click.stop="openPreview({ name: (typeof props.data?.videoName === 'string' && props.data.videoName) || '视频预览', kind: 'video', url: videoUrl })">
            <Maximize2 class="vc-ico" :size="15" aria-hidden="true" />
          </Button>
        </template>
      </VideoPlayerBar>
    </div>

  </div>

</template>
<style scoped>
/* 数值照 docs/design/ui-style-guide.md：四档灰阶、圆角 8/6、交互目标 32px、
   动效 150-240ms 且带 prefers-reduced-motion 降级。播放区以黑底呈现。 */
.video-node {
  position: relative;
  width: 100%;
  height: 100%;
  /* 不铺底色：空卡片让壳的内容裁剪层（--card-content-surface，亮 #eee / 暗 #1f1f1f）透出来，
     与图片节点完全同源 —— 上一版用 --canvas-node-surface 反而比图片节点浅了一档（用户实测对比出来）。
     有视频时画面由 .video-media 自己铺满（含黑边），也不依赖这层底色。 */
  overflow: hidden;
}

/* 舞台：裁剪覆盖层与"按框取景"的定位基准 */
.video-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
/**
 * 有视频、但帧图还没到手（或抓帧失败正在重试）时，舞台先铺近黑底：
 * 以前这里完全透明，露出卡片亮色表面，用户看到的就是「一块白」，
 * 与「视频真的是白场画面」分不清。近黑底和播放时的信箱黑边同色，
 * 画面一到（img / video）就被盖住。
 *
 * ★ 只对「有视频」的舞台生效：空节点 / 失效节点必须保持卡片自己的底色
 *   （用户 2026-10-30 报过空节点底部挂灰带、纯黑块的问题）。
 */
.video-stage.has-media {
  background: #050505; /* 主题色白名单: 视频信箱黑边随画面内容恒定 */
}

.video-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* 主题色白名单: 视频信箱黑边随画面内容恒定，与主题无关。
     ★ 只在"真的解出了画面"之后才铺黑：没画面时铺黑，卡片上就是一块纯黑 ——
     用户 2026-10-30 报的「全黑状态」有一半是这个底色造成的。 */
  background: transparent;
  /* 卡片选中/拖动时不让浏览器原生手势打断 */
  user-select: none;
}
.video-media.has-frame {
  background: #050505; /* 主题色白名单: 有画面时的信箱黑边 */
}

/* 预览图（未播放时的画面）：与 <video> 完全同一套几何。
   ★ 必须 contain：卡片比例与画面比例差一点时，cover 会把多出去的那一边直接切掉，
   用户看到的就是「缩略图没有裁好」。正常比例下两者结果几乎一致，
   差别只在比例不匹配时 —— 那种情况宁可留极窄的底色，也不能丢掉画面内容。 */
.video-media.is-poster {
  object-fit: contain;
  /* 与 video 短暂共存时压在上面（hover 自动播放要等首帧解码完才撤帧图，防止闪黑） */
  z-index: 1;
  -webkit-user-drag: none;
}

/* 裁过的画面：由 framingStyle 给出放大比例与偏移，位置相对舞台左上角，
   框外部分被 .video-stage 的 overflow:hidden 裁掉 —— 这就是"裁剪"的视觉实现。
   ★ 视频与预览图**都要**套（用户 2026-10-31）：预览图是整幅原片，
   不套取景就会把裁掉的区域又显示出来。 */
.video-stage.is-framed video.video-media,
.video-stage.is-framed img.video-media {
  position: absolute;
  max-width: none;
  max-height: none;
  object-fit: fill;
}
/* —— 播放控件容器：压在画面底部，无背景 —— 只留图标/文字/进度条本身，
   用轻投影保证亮画面上也读得清；整体贴底更紧凑。
   平时透明收起（鼠标离开卡片即藏），hover 卡片才淡入。 */
.video-controls {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 8px;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 4px;
  /* 32px 行高：按钮 26px 与文字 12px 都在其中垂直居中，时间文字与播放按钮严格同轴 */
  height: 32px;
  padding: 0 6px;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
/* liblib 同款底部渐变衬底：压住画面下半部，控件文字不再依赖投影 */
.vc-scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 56px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0)); /* 主题色白名单: 视频画面上的衬底，随画面恒定，与主题无关 */
  /* 与播放控件同一节奏淡入淡出：鼠标离开就一起走，不在画面上留一块灰底 */
  opacity: 1;
  transition: opacity 0.18s ease;
  pointer-events: none;
}
.vc-scrim.is-hidden {
  opacity: 0;
}
/* 衬底挂在节点层（贴满底边，不再被控件条的左右边距截短） */
.video-node > .vc-scrim {
  z-index: 8;
}
.vc-capture {
  position: relative;
  display: flex;
  flex: none;
}
.video-controls.is-hidden {
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
}

.vc-btn {
  flex: none;
  width: 26px;
  height: 26px;
  /* 控件叠在视频画面上（不是面板底色），用恒浅色前景保证任何画面上都读得清 */
  color: color-mix(in srgb, var(--ui-tip-ink, #fff) 88%, transparent);
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.18s ease;
}
.vc-btn:hover:not(:disabled) {
  /* 参考图 2：hover 出圆形浅底（参考 liblib 播放钮的白圈），白图标压上去依然清晰 */
  background: rgba(255, 255, 255, 0.18); /* 主题色白名单: 视频覆盖层按钮 hover 底 */
}
.vc-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.vc-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.vc-btn:disabled {
  opacity: 0.4;
}
.vc-btn svg {
  width: 15px;
  height: 15px;
  /* 渐变衬底已保证可读性，图标不再单独投影 */
}
.vc-btn .vc-ico {
  /* lucide 线宽对齐 liblib 的细线观感 */
  stroke-width: 1.75;
}

/* 空态 / 失效态：站在灰底上，所以用节点文字色而不是白字（图片节点同一套） */
.video-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 8px;
  color: var(--canvas-node-text-muted, #9ca3af);
  /* 中文正文最低 12px（§2.3） */
  font-size: 12px;
  text-align: center;
}
.video-empty.is-broken {
  color: var(--ui-warn, #b45309);
}

@media (prefers-reduced-motion: reduce) {
  .vc-btn {
    transition: none !important;
  }
  .vc-btn:active:not(:disabled) {
    transform: none;
  }
  /* 卡内控制条的 hover 淡入也去掉动效（直接显隐，不位移） */
  .video-controls {
    transition: none !important;
  }
  /* 底部衬底的淡入淡出同样去掉（直接显隐） */
  .vc-scrim {
    transition: none !important;
  }
  .video-controls.is-hidden {
    transform: none;
  }
}
</style>
