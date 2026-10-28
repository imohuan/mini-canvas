<script setup lang="ts">
/**
 * VideoPlayerBar —— 视频播放控件条（**唯一来源**：视觉/交互以视频节点底栏为标准）。
 *
 * 为什么要抽（用户口径 2026-10-29）：节点底栏与全屏预览的控制条是同一件事的两份实现
 * （VideoContent 的 .video-controls、VideoPreview 的 .vpv-bar），图标、观感都在漂移。
 * 本组件把"标准长相"钉死：**无胶囊底、贴底、渐变衬底、26px 圆钮、白字** —— 全是
 * 节点那套的原始数值；全屏预览复刻它，只把截图按钮换成循环按钮。
 *
 * 分工：宿主持有 video 元素与全部状态（playing/current/duration/音量/倍速），
 * 本组件只画"当前是什么样、用户点了什么"。两条宿主的特殊行为（节点的剪辑段循环、
 * 全屏的自动播放）不被组件吃掉。
 */
import { computed } from 'vue'
import { Play, Pause, Volume2, VolumeX } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    /** 是否正在播放（图标随之切换） */
    playing?: boolean
    /** 已播时长（秒；节点的剪辑段语义由宿主换算好再传） */
    currentTime?: number
    /** 总时长（秒；节点传剪辑段长度，全屏传整段） */
    duration?: number
    /** 倍速档位（1 = 1x） */
    rate?: number
    /** 倍速菜单显隐（宿主管互斥，这里只画） */
    rateMenuOpen?: boolean
    /** 静音（volume<=0 时宿主也应传 true，喇叭图标一致） */
    muted?: boolean
    /** 音量 0..1 */
    volume?: number
    /** 音量竖杆显隐（显隐手势在宿主：节点要延迟收起等细节） */
    volumeMenuOpen?: boolean
    /** 循环开关：给值才显示这个按钮（全屏预览开；节点不给 —— 那里是截图按钮） */
    loop?: boolean
    /** 截图按钮禁用（正在截帧；只有 showCapture 时有意义） */
    captureBusy?: boolean
  }>(),
  {
    playing: false,
    currentTime: 0,
    duration: 0,
    rate: 1,
    rateMenuOpen: false,
    muted: false,
    volume: 1,
    volumeMenuOpen: false,
    loop: undefined,
    captureBusy: false,
  },
)

const emit = defineEmits<{
  (e: 'play'): void
  (e: 'seek', seconds: number): void
  (e: 'rateToggle'): void
  (e: 'ratePick', value: number): void
  (e: 'loopToggle'): void
  (e: 'muteToggle'): void
  (e: 'volume', value: number): void
  (e: 'volumeOpen'): void
  (e: 'volumeClose'): void
  (e: 'capture'): void
}>()

const RATES = [0.5, 1, 1.5, 2, 3] as const

function pad(v: number): string {
  return v < 10 ? '0' + v : String(v)
}
/** 秒 → m:ss（超过一小时 h:mm:ss）；与 videoNodeData.formatTime 同口径 */
function formatTime(s: number): string {
  const total = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec)
}
const timeLabel = computed(() => formatTime(props.currentTime) + ' / ' + formatTime(props.duration))
const rateLabel = computed(() => String(props.rate) + 'x')
/** 喇叭：静音/有声 两态（volume<=0 宿主应传 muted=true，这里不再重复判） */
const volumeIcon = computed(() => (props.muted ? VolumeX : Volume2))
const progressPct = computed(() =>
  props.duration > 0 ? Math.min(100, Math.max(0, (props.currentTime / props.duration) * 100)) : 0,
)
</script>

<template>
  <!-- 外观契约：与 VideoContent 旧版 .video-controls 逐条同源（无底、贴底、26px 圆钮） -->
  <div class="vcb-bar" @click.stop @mousedown.stop @dblclick.stop>
    <button class="vcb-btn" type="button" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停' : '播放'"
      @click.stop="emit('play')">
      <Pause v-if="playing" class="vcb-ico" aria-hidden="true" />
      <Play v-else class="vcb-ico" aria-hidden="true" />
    </button>

    <span class="vcb-time">{{ timeLabel }}</span>

    <!-- 进度条：轨道 3px + 已播填充 + 圆点；透明 input 盖在上面接手势（节点旧版同一套） -->
    <label class="vcb-progress" title="拖动调整进度">
      <input type="range" min="0" :max="duration || 0" step="0.01" :value="currentTime" aria-label="播放进度"
        @input="emit('seek', Number(($event.target as HTMLInputElement).value))" />
      <span class="vcb-progress-fill" :style="{ width: progressPct + '%' }" />
      <span v-if="duration > 0" class="vcb-progress-thumb" :style="{ left: progressPct + '%' }" />
    </label>

    <!-- 倍速：点按钮弹小菜单，当前档高亮（两条宿主共用） -->
    <div class="vcb-rate">
      <button class="vcb-btn vcb-rate-btn" type="button" :class="{ 'is-on': rate !== 1 }"
        :title="'播放速度 ' + rateLabel" :aria-label="'播放速度 ' + rateLabel" :aria-expanded="rateMenuOpen"
        @click.stop="emit('rateToggle')">
        <span class="vcb-rate-label">{{ rateLabel }}</span>
      </button>
      <div v-if="rateMenuOpen" class="vcb-menu" role="menu" aria-label="播放速度">
        <button v-for="r in RATES" :key="r" class="vcb-menu-item" :class="{ 'is-active': rate === r }" type="button"
          role="menuitemradio" :aria-checked="rate === r" @click.stop="emit('ratePick', r)">
          {{ r }}x
        </button>
      </div>
    </div>

    <!-- 截图：只在节点形态出现（宿主传 slot；全屏传 loop 不传它） -->
    <slot name="capture" />

    <!-- 循环：只在全屏形态出现（loop 给值 = 显示；节点不传） -->
    <button v-if="loop !== undefined" class="vcb-btn" type="button" :class="{ 'is-on': loop }"
      :title="loop ? '循环播放：开' : '循环播放：关'" :aria-label="'循环播放'" :aria-pressed="loop"
      @click.stop="emit('loopToggle')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
      </svg>
    </button>

    <!-- 音量：喇叭 + 向上弹的竖直滑杆（数值/显隐都在宿主） -->
    <div class="vcb-volume" @mouseenter="emit('volumeOpen')" @mouseleave="emit('volumeClose')"
      @vcb-volume-drag="(e: Event) => emit('volume', (e as CustomEvent<number>).detail)">
      <button class="vcb-btn" type="button" :title="muted ? '取消静音' : '静音'"
        :aria-label="muted ? '取消静音' : '静音'" @click.stop="emit('muteToggle')">
        <component :is="volumeIcon" class="vcb-ico" aria-hidden="true" />
      </button>
      <div v-if="volumeMenuOpen" class="vcb-volume-pop">
        <span class="vcb-volume-value">{{ Math.round(volume * 100) }}</span>
        <div class="vcb-volume-track" role="slider" :aria-label="'音量 ' + Math.round(volume * 100) + '%'"
          :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="Math.round(volume * 100)" tabindex="0"
          @pointerdown.stop="onVolumeTrackDown" @pointermove="onVolumeTrackMove" @pointerup="onVolumeTrackUp"
          @keydown.down.stop.prevent="emit('volume', Math.max(0, Math.round((volume - 0.05) * 100) / 100))"
          @keydown.up.stop.prevent="emit('volume', Math.min(1, Math.round((volume + 0.05) * 100) / 100))">
          <span class="vcb-volume-fill" :style="{ height: Math.round((muted ? 0 : volume) * 100) + '%' }" />
          <span class="vcb-volume-thumb" :style="{ bottom: 'calc(' + Math.round((muted ? 0 : volume) * 100) + '% - 6px)' }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============================================================================
   视觉标准 = **视频节点底栏**（VideoContent 旧版 .video-controls 那套，2026-10-29
   用户拍板"以节点的 UI 为标准"）。数值逐条照抄，不重新发明：
   · 无胶囊底 —— 控件直接浮在画面上，靠渐变衬底保证可读（衬底由宿主画，见 VideoContent）
   · 26px 圆形按钮 / 15px 图标 / 12px 时间文字 / 3px 轨道 + 白色填充与圆点
   · 恒浅色前景 —— 控件压在视频画面上，与主题无关（与旧版同一条主题色白名单理由）
   ============================================================================ */
.vcb-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  /* 32px 行高：按钮 26px 与文字 12px 都在其中垂直居中（与旧版同一条） */
  height: 32px;
  padding: 0 6px;
}
.vcb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: color-mix(in srgb, var(--ui-tip-ink, #fff) 88%, transparent);
  cursor: pointer;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.18s ease, background 0.18s ease;
}
.vcb-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.18); /* 主题色白名单: 视频覆盖层按钮 hover 底（旧版同款） */
}
.vcb-btn:active:not(:disabled) { transform: scale(0.97); }
.vcb-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.vcb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.vcb-btn.is-on { background: rgba(255, 255, 255, 0.22); /* 主题色白名单: 同上 */ }
.vcb-btn svg { width: 15px; height: 15px; }
.vcb-ico { width: 15px; height: 15px; stroke-width: 1.75; }
.vcb-time {
  flex: none;
  min-width: 34px;
  line-height: 26px;
  color: color-mix(in srgb, var(--ui-tip-ink, #fff) 92%, transparent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
/* 进度条：轨道 3px + 已播填充 + 圆点；input 透明覆盖接手势（旧版同一套几何） */
.vcb-progress {
  position: relative;
  flex: 1;
  min-width: 60px;
  height: 22px;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.vcb-progress::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 9.5px;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35); /* 主题色白名单: 视频覆盖层进度轨道 */
}
.vcb-progress-fill {
  position: absolute;
  left: 0;
  top: 9.5px;
  height: 3px;
  border-radius: 999px;
  background: #fff; /* 主题色白名单: 视频覆盖层进度填充 */
  pointer-events: none;
}
.vcb-progress input { position: absolute; inset: 0; width: 100%; margin: 0; opacity: 0; cursor: pointer; }
.vcb-progress-thumb {
  position: absolute;
  top: 5.5px;
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  border-radius: 50%;
  background: #fff; /* 主题色白名单: 同上 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); /* 主题色白名单: 同上 */
  pointer-events: none;
}
.vcb-rate { position: relative; display: flex; flex: none; }
.vcb-rate-btn { width: auto; min-width: 26px; padding: 0 4px; border-radius: 999px; }
.vcb-rate-label { font-size: 12px; line-height: 26px; font-variant-numeric: tabular-nums; }
.vcb-menu {
  position: absolute;
  right: 0;
  bottom: 30px;
  z-index: 12;
  min-width: 76px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(17, 17, 17, 0.92); /* 主题色白名单: 叠在画面上的菜单（旧版截图菜单同款） */
  border: 1px solid rgba(255, 255, 255, 0.08); /* 主题色白名单: 同上 */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); /* 主题色白名单: 同上 */
  display: flex;
  flex-direction: column;
}
.vcb-menu-item {
  padding: 6px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.92); /* 主题色白名单: 同上 */
  font-size: 12px;
  text-align: center;
  cursor: pointer;
  white-space: nowrap;
}
.vcb-menu-item:hover { background: rgba(255, 255, 255, 0.12); /* 主题色白名单: 同上 */ }
.vcb-menu-item.is-active { background: rgba(255, 255, 255, 0.22); /* 主题色白名单: 同上 */ }
.vcb-volume { position: relative; display: flex; flex: none; }
.vcb-volume-pop {
  position: absolute;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  z-index: 12;
  width: 34px;
  padding: 8px 0 10px;
  border-radius: 8px;
  background: rgba(17, 17, 17, 0.92); /* 主题色白名单: 同上 */
  border: 1px solid rgba(255, 255, 255, 0.08); /* 主题色白名单: 同上 */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); /* 主题色白名单: 同上 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.vcb-volume-value { color: rgba(255, 255, 255, 0.95); /* 主题色白名单: 同上 */ font-size: 11px; line-height: 14px; font-variant-numeric: tabular-nums; }
.vcb-volume-track {
  position: relative;
  width: 4px;
  height: 76px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28); /* 主题色白名单: 同上 */
  cursor: pointer;
  touch-action: none;
}
.vcb-volume-track::before { content: ''; position: absolute; inset: 0 -10px; }
.vcb-volume-fill { position: absolute; left: 0; right: 0; bottom: 0; border-radius: 999px; background: #fff; /* 主题色白名单: 同上 */ }
.vcb-volume-thumb {
  position: absolute;
  left: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: #fff; /* 主题色白名单: 同上 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); /* 主题色白名单: 同上 */
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .vcb-btn { transition: none !important; }
  .vcb-btn:active:not(:disabled) { transform: none; }
}
</style>

<script lang="ts">
// 竖向音量轨道的拖拽（pointer capture 保证拖出轨道也不丢值）——纯 DOM，放普通 script 段
let volumeDragging = false
function setVolumeFromEvent(e: PointerEvent, set: (v: number) => void): void {
  const track = e.currentTarget as HTMLElement
  const r = track.getBoundingClientRect()
  const pct = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  set(Math.round(pct * 100) / 100)
}
function onVolumeTrackDown(e: PointerEvent): void {
  volumeDragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  setVolumeFromEvent(e, (v) => void 0)
}
function onVolumeTrackMove(e: PointerEvent): void {
  if (volumeDragging) setVolumeFromEvent(e, (v) => void 0)
}
function onVolumeTrackUp(): void {
  volumeDragging = false
}
</script>
