import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCanvasRender, useSoleNodeSelected } from '@plume-canvas/canvas-render'
import { MIN_CLIP_DURATION } from '../videoClip'
import { isClipPending, isClipping } from '../videoSession'
import { publishDraftRange, readDuration } from '../videoClipStore'
import { useClipSettings } from './useClipSettings'
import { useClipRange } from './useClipRange'
import { useClipTimeline } from './useClipTimeline'
import { useClipPlayback } from './useClipPlayback'
import { useClipDrag } from './useClipDrag'
import { useClipActions } from './useClipActions'
import { useClipKeyboard } from './useClipKeyboard'

export interface ClipPanelOptions {
  nodeId: string
  data: () => Record<string, unknown>
}

/**
 * 剪辑面板的编排：把偏好、范围、时间轴、拖拽、播放、键盘与命令按原顺序接起来。
 */
export function useClipPanel(options: ClipPanelOptions) {
  const { nodeId, data } = options
  const { ctx } = useCanvasRender()

  const selected = useSoleNodeSelected(nodeId)
  const visible = computed(() => selected.value && isClipping(nodeId))

  const hasVideo = computed(() => {
    const resourceId = typeof data()?.resourceId === 'string' ? data().resourceId : ''
    const legacy = typeof data()?.videoUrl === 'string' ? data().videoUrl : ''
    return resourceId !== '' || legacy !== ''
  })

  /** 后台切段中：确认按钮禁用（真正的进度显示在新建的占位节点上）。 */
  const pending = computed(() => isClipPending(nodeId))

  /** 视频总时长：等内容区 loadedmetadata 上报；没上报过退回节点里的 videoDuration */
  const duration = computed(() => {
    const live = readDuration(nodeId)
    if (live > 0) return live
    const fallback = Number(data()?.videoDuration)
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  })

  const minClip = computed(() => {
    const settings = ctx.tryGet('settings')
    const raw = settings?.get('videoMinClipDuration')
    const n = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : MIN_CLIP_DURATION
    return duration.value > 0 ? Math.min(n, duration.value) : n
  })

  const { prefs, effectiveRadius } = useClipSettings({ ctx, nodeId })
  /** 入口根节点：胶片/量尺在子组件里，按它查找 DOM（不依赖跨组件 ref 的挂载时序） */
  const panelEl = ref<HTMLElement | null>(null)
  const { range, startPct, endPct, lengthLabel, commit, setInPoint, setOutPoint } = useClipRange({
    nodeId,
    data,
    duration,
    minClip,
  })
  const {
    atLeft,
    atRight,
    labelBelow,
    captionLeftPx,
    playheadPct,
    frames,
    frameIndices,
  } = useClipTimeline({
    ctx,
    nodeId,
    data,
    duration,
    range,
    startPct,
    endPct,
    lengthLabel,
    rootEl: panelEl,
  })

  /**
   * 把当前区间同步给内容区（它据此判断「播到段尾停 / 区间循环」）。
   *
   * 面板与内容区是兄弟组件，只共享会话态：拖拽改的是草稿，节点 data 还没落，
   * 内容区要是只读 data，就永远按上一次确认的范围播（用户实测报的循环没效果）。
   */
  watch(range, (r) => publishDraftRange(nodeId, { start: r.start, end: r.end }), { immediate: true })

  const { contentVideo, previewAtBoundary, togglePlay, currentPreviewEdge } = useClipPlayback({
    nodeId,
    duration,
    range,
  })

  /** 拖动整段/端点时按入口根节点找胶片；子组件已渲染，查到的就是当前胶片 */
  const dragFilmEl = (): HTMLElement | null =>
    (panelEl.value?.querySelector('.vclip-film') as HTMLElement | null) ?? null

  const { isDragging, snapLength, onHandleDown, onDragUp } = useClipDrag({
    duration,
    minClip,
    range,
    prefs,
    effectiveRadius,
    filmEl: dragFilmEl,
    commit,
    contentVideo,
    previewAtBoundary,
    currentPreviewEdge,
  })

  onBeforeUnmount(onDragUp)

  const { toggleSnap, toggleLoop, onConfirm, onCancel } = useClipActions({
    ctx,
    nodeId,
    pending,
    range,
    duration,
    minClip,
    prefs,
    commit,
    snapLength,
  })

  /** 配置展开区 */
  const configOpen = ref(false)

  const onKeyDown = useClipKeyboard({
    visible,
    configOpen,
    range,
    duration,
    minClip,
    commit,
    setInPoint,
    setOutPoint,
    togglePlay,
    onCancel,
    onConfirm,
  })

  /**
   * 键盘监听挂在 window 上：剪辑会话里用户点过画面/画布，焦点多半不在这一条上。
   * 只在会话可见时收键（visible 为假时 onKeyDown 自己就会返回），不打扰其它界面。
   */
  onMounted(() => window.addEventListener('keydown', onKeyDown, true))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown, true))

  return {
    panelEl,
    visible,
    hasVideo,
    pending,
    prefs,
    range,
    startPct,
    endPct,
    lengthLabel,
    atLeft,
    atRight,
    labelBelow,
    captionLeftPx,
    playheadPct,
    duration,
    frames,
    frameIndices,
    isDragging,
    configOpen,
    onHandleDown,
    toggleSnap,
    toggleLoop,
    onConfirm,
    onCancel,
  }
}
