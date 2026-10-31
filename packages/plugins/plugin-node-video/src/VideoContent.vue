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
import { RenderEvents, useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import { captureFrame } from './videoTransform'
import type { FrameResourcePort } from './videoThumbCanvas'
import {
  readVideoThumbTiers,
  resolveVideoThumbTier,
  videoThumbTargetFor,
  videoThumbTierKeys,
  type VideoThumbTierConfig,
} from './videoThumbTier'
import { framingStyle, isCroppedRect, type Rect } from './videoCrop'
import { unifiedThumbOf } from './videoThumbUnified'
import { clipBoundaryAction, readClipRange } from './videoClip'
import { formatTime } from './videoNodeData'
import VideoPlayerBar from './VideoPlayerBar.vue'
import { videoCardSizePatch, followedVideoCardSizePatch, missingVideoCardSizePatch, type CardSizePatch } from './videoFit'
import { Play, Pause, Volume2, VolumeX, Camera, Maximize2 } from 'lucide-vue-next'
import { openPreview } from './mediaPreviewBus'

/** 正有限数才算有值（与 videoFit 内同口径） */
function positiveNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
import { createVideoOps } from './videoOps'
import { endOverlay, isClipping, isCropping } from './videoSession'
import {
  clearClipPrefs,
  clearDraftRange,
  publishDuration,
  publishPlayhead,
  readClipPrefs,
  readDraftRange,
  resetDuration,
  resetPlayhead,
} from './videoClipStore'
import { readVideoSourceFields, resolveVideoSrc } from './videoRefs'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
/** 默认主题的统一空状态（按名取；极简宿主没装主题时回落本组件的一行灰字） */
const NodeEmptyState = useUiComponent('nodeEmptyState')

const { ctx, flow } = useCanvasRender()

const videoRef = ref<HTMLVideoElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const captureMenuRef = ref<HTMLElement | null>(null)
const playing = ref(false)
/**
 * video 元素是否已经"真的有画面"（readyState >= HAVE_CURRENT_DATA，即当前播放位置
 * 已经解码出第一帧）。hover 自动播放时用它压住切换：帧图叠在 video 上继续显示，
 * 直到这一位翻真才撤掉 —— 否则 video 挂上到首帧解码完成之间会闪出一片黑。
 * （loadeddata 在 seek 后也会再发，任何时刻画面在，它就跟着翻真；离开时随 videoRequested 一起复位。）
 */
const currentTime = ref(0)
const duration = ref(0)
/** 播完一轮的闩锁：一轮里"到段尾暂停"只执行一次，防 seek/暂停残余的 timeupdate 重复触发 */
const endedLatch = ref(false)
const broken = ref(false)
const captureBusy = ref(false)

/**
 * 播放地址：**优先按 resourceId 现取**（本地临时 objectURL / 云端资源路由），
 * 迁移期没有可用引用时才用旧 `videoUrl` 兜底。
 *
 * 初值取旧地址：SSR / 首帧不能等异步 resolve；有引用时解析回来再替换。
 * 解析结果只留在本组件内存里，不写回 data。
 */
const sourceFields = computed(() => readVideoSourceFields(props.data))
const resolvedUrl = ref(sourceFields.value.legacyUrl)
let resolveToken = 0

async function refreshResolvedUrl(): Promise<void> {
  const token = ++resolveToken
  resolvedUrl.value = sourceFields.value.legacyUrl
  const url = await resolveVideoSrc(ctx, props.data)
  if (token !== resolveToken) return
  resolvedUrl.value = url || sourceFields.value.legacyUrl
}

watch(() => [sourceFields.value.resourceId, sourceFields.value.legacyUrl], refreshResolvedUrl, {
  immediate: true,
})

const videoUrl = computed(() => resolvedUrl.value)
const videoWidth = computed(() => (typeof props.data?.videoWidth === 'number' ? props.data.videoWidth : 0))
const videoHeight = computed(() => (typeof props.data?.videoHeight === 'number' ? props.data.videoHeight : 0))
const cropRect = computed<Rect | undefined>(() => {
  const r = props.data?.cropRect as Rect | undefined
  return isCroppedRect(r) ? r : undefined
})
const cropping = computed(() => isCropping(props.id))
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

// ==================== 帧图（海报）与分档显示 ====================
/**
 * 视频节点默认显示**帧图**（一张静态图），点播放才真正挂 `<video>` 加载视频字节。
 *
 * 为什么要这样（用户口径）：一屏几十个视频节点、每个都带 `<video preload="metadata">`，
 * 光"读元数据"就是几十次网络请求 + 解码器初始化 —— 这是画布卡顿的大头之一。
 * 换成帧图后，未播放的节点只解码一张几十 KB 的 webp。
 *
 * 帧图由**本插件自己抓**（见 videoThumbCanvas.ts）：起一个临时 video → seek 到某一刻 →
 * 按档位缩放画进画布。三档都是帧图（1 对 3），因为"不播放时不加载视频"——
 * 第 1 档（原生尺寸那一帧）也必须是一张图，这是与图片节点最大的差别（图片第 1 档是原图本身）。
 */
const TIER_PREFIX = 'video'
const tierCfg = ref<VideoThumbTierConfig>(readVideoThumbTiers(TIER_PREFIX, ctx))
const tierSettingOff = ctx
  ?.get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } }>('settings')
  ?.onChange((key) => {
    if (!videoThumbTierKeys(TIER_PREFIX).includes(key)) return
    tierCfg.value = readVideoThumbTiers(TIER_PREFIX, ctx)
  })

const zoom = computed(() => Math.max((flow.viewport.value?.zoom ?? 1) || 1, 0.01))
/**
 * 
 * /**
 * 画布最小缩放（设置里的「最小缩放」）作为兜底：缩到最小必定进第三档 ——
 * 否则用户把第三档阈值配得比它小就永远只有两档（用户实测踩过这个坑）。
 */
const canvasMinZoom = computed(() => ctx?.get<{ get(k: string): unknown }>('settings')?.get('minZoom'))
const tier = computed(() => resolveVideoThumbTier(zoom.value, tierCfg.value, canvasMinZoom.value))

/**
 * 用户要求播放（点播放按钮 / 悬停自动播 / 进全屏）。
 *
 * 它**不单独决定**画面显示什么 —— 画面由 `showPoster` 综合"是否要播 + 鼠标在不在节点上"算。
 * 之前这里是个"一旦置真就再也不回落"的开关，于是出现两个毛病（2026-10-15 用户实测报的）：
 * ① 播放中缩放画布，节点仍挂着 video 在播；② 鼠标移开后 element 还留着。
 */
const videoRequested = ref(false)
/** 离开时的播放位置：下次再点播放从这里接着放 */
const resumeTime = ref(0)

/**
 * 统一缩略图（用户 2026-10-30）：一个视频只有一张图，和左侧栏 / 底栏卡片 /
 * 标签 / 标签下拉菜单共用同一份 —— 先查资源库持久缓存，没有才生成一次。
 *
 * 它取代了原来"每个节点自己抓一档帧图"的初始预览路径：那条路每个节点都要
 * 起一次视频解码，节点一多就慢、还容易抓到黑帧。
 */
const unifiedThumb = ref<string>('')
/** 统一缩略图的加载态：还没拿到地址时显示占位（避免白屏） */
const thumbLoading = ref(true)
watch(
  [
    videoUrl,
    () => videoWidth.value,
    () => videoHeight.value,
    // 档位随画布缩放变化（第 1/2/3 档），改了要重新取对应分辨率的图
    tier,
    // 三档配置（尺寸/质量）变了要重新生成 —— 老规则的"名字带尺寸与质量"就在防这个
    () => tierCfg.value.tier2Width,
    () => tierCfg.value.tier2Height,
    () => tierCfg.value.tier3Width,
    () => tierCfg.value.tier3Height,
    () => tierCfg.value.quality,
  ],
  async () => {
    const src = videoUrl.value
    if (!src) { unifiedThumb.value = ''; thumbLoading.value = false; return }
    thumbLoading.value = true
    try {
      /**
       * 直接调本插件的统一实现（不走 ctx.get('video') —— 那是自己，绕一圈没意义）。
       * 资源库端口从 ctx 拿：跨会话命中靠的就是它。
       *
       * ★ 裁框**不参与**（用户 2026-10-31）：缩略图是全站共用的那一张，永远是整幅原片。
       * 节点上看起来是裁过的那块，由下面的 posterStyle 用 CSS 取景实现 ——
       * 跟播放时的 video 走同一套几何，两边画面一致。
       */
      const wantTier = tier.value
      const box = videoThumbTargetFor(wantTier, tierCfg.value, {
        width: videoWidth.value,
        height: videoHeight.value,
      })
      const url = await unifiedThumbOf(src, frameResources(), {
        tier: wantTier,
        width: box.width,
        height: box.height,
        quality: tierCfg.value.quality,
        frameWidth: videoWidth.value,
        frameHeight: videoHeight.value,
      })
      unifiedThumb.value = url ?? ''
    } catch {
      unifiedThumb.value = ''
    } finally {
      thumbLoading.value = false
    }
  },
  { immediate: true },
)



/**
 * 现在画静帧还是 video 元素。
 *
 * 规则（用户口径 2026-10-30 简化后）：**要播 + 鼠标还在节点上** 才显示 video；
 * 其余一律显示那张常驻的统一缩略图。
 * - 鼠标悬停上来 → 从头自动播放（不需要先点按钮）；
 * - 鼠标移开 → 暂停、直接露出预览图（不再抓帧，零等待）；
 * - 播放中途缩放画布 → 同样回到静帧。
 *
 * 预览图是资源库里的持久缩略图（全站共用一张），所以移开立刻就有图可显示，
 * 不需要再"让 video 多留一会儿等抓帧"。
 */
/**
 * 显隐状态机（用户口径 2026-10-17，三条硬规则）：
 * ① 触发显示：鼠标落在节点上 → 立刻挂 video 并自动播放；
 * ② 延迟关闭：video 开始播放 500ms 后才把帧图藏掉（黑帧由帧图盖住）；
 * ③ 保持显示：鼠标不离开，video 元素**永不消失**——暂停、拖进度条、seek 都不回图片，
 *    回图片只由「鼠标真正离开节点」触发。
 */
const posterHideTimer: { value: number | null } = { value: null }
/** true = 帧图还盖着；video 首次 play 后 500ms 翻 false */
const posterCovering = ref(true)
/**
 * video 元素**是否真的解出了画面**（readyState >= HAVE_CURRENT_DATA）。
 *
 * 为什么必须有这一位（用户 2026-10-30 报「悬停时全黑 / 全白，要等 1-3 秒」）：
 * 从前是"play 事件后固定 500ms 撤帧图"。但 play 事件只表示"开始播放"，
 * 这时解码器常常还没吐出第一帧 —— 帧图一撤，露出来的就是 video 元素的**黑底**。
 * 网络慢时黑屏能持续一两秒，用户看到的就是"全黑 → 突然有画面"。
 * 现在改成"看到真实画面才撤"，黑帧根本没有露脸的机会。
 */
const videoHasFrame = ref(false)
function schedulePosterHide(): void {
  if (posterHideTimer.value !== null) window.clearTimeout(posterHideTimer.value)
  posterHideTimer.value = window.setTimeout(() => {
    posterHideTimer.value = null
    posterCovering.value = false
  }, 500)
}
/**
 * 帧图是否盖在 video 上。
 *
 * 两个条件都要满足才撤：① 已经过了 500ms 的"防抖窗口"（避免刚挂上就闪）；
 * ② video 真的解出了画面。少 ② 就是黑屏，少 ① 就是切换抖动。
 */
const keepPosterOverVideo = computed(() => posterCovering.value || !videoHasFrame.value)
/**
 * 剪辑会话期间绝不能卸载 video 元素：底部剪辑条的播放头跟的就是这个元素的
 * currentTime，元素一卸（回帧图）播放头就永远停住。所以三处「回帧图」的口
 * （showPoster 的显隐计算、onCardLeave 的定格复位、endOverlay 的会话清理）
 * 都要先看 isClipping —— 剪辑中一律保持 video 挂载。
 */
const showPoster = computed(
  () => !videoRequested.value || (!active.value && !isClipping(props.id)),
)

/**
 * 当前该显示的预览图地址。
 *
 * 用户 2026-10-30 统一后：**只有一张**统一缩略图（资源库持久化、全站复用）。
 * 定格帧已移除 —— 移开鼠标不再重新截图，直接回到这张常驻的图。
 */
const posterDisplaySrc = computed(() => unifiedThumb.value)

/**
 * 资源库端口（ctx 上的 'resources'）：帧图存这儿，换会话/换设备才有得复用。
 * 取不到（极简宿主 / 单测桩）→ undefined，退回"只放内存"，功能照常、换会话重算一遍。
 */
function frameResources(): FrameResourcePort | undefined {
  const port = ctx?.get<FrameResourcePort | undefined>('resources')
  return port && typeof port.put === 'function' && typeof port.resolve === 'function' ? port : undefined
}

/**
 * 停止播放并回到常驻预览图（**不再抓帧**，用户 2026-10-30）。
 *
 * 触发点：鼠标离开节点、点画布空白、播放按钮暂停。
 * 预览图是资源库里那张统一缩略图，已经常驻 DOM —— 这里只负责停播 + 卸载 video，
 * 移开瞬间就是一张现成的图，没有解码、没有空窗。
 */
function stopPlayback(): void {
  if (!videoRequested.value) return
  // 剪辑会话中离开节点：video 必须留着（播放头还指着它），只记下时间
  if (isClipping(props.id)) {
    const v = videoRef.value
    if (v && Number.isFinite(v.currentTime)) resumeTime.value = v.currentTime
    return
  }
  const v = videoRef.value
  if (v && !v.paused) v.pause()
  if (v && Number.isFinite(v.currentTime)) resumeTime.value = v.currentTime
  videoRequested.value = false
  endedLatch.value = false
  // 元素要卸了：这一位跟着复位，下次悬停重新等真实画面
  videoHasFrame.value = false
}

/** 读写句柄：读 nodeStore、写 graph（唯一写入口 → 进历史 + 落盘） */
const ops = createVideoOps(ctx)

/**
 * 当前播放范围（缺省 = 整段；脏数据已被收敛）。
 *
 * 剪辑会话里优先用面板正在拖的**草稿区间**：用户拖完还没点确认就点播放，
 * 逻辑必须跟着新选区走 —— 否则"播到段尾停 / 区间循环"用的还是上一次确认的范围。
 * 退出剪辑后草稿清掉，自然退回节点 data。
 */
const clipRange = computed(() => {
  if (isClipping(props.id)) {
    const draft = readDraftRange(props.id)
    if (draft && draft.end > draft.start) return draft
  }
  return readClipRange(props.data)
})
const clipped = computed(() => props.data?.clipStart !== undefined || props.data?.clipEnd !== undefined)
/**
 * 播放条显示的时间轴 = **整段原片**，不是剪辑出来的那一段（用户口径 2026-10-31）。
 *
 * 为什么改：剪辑条只是"从哪一秒开始、到哪一秒结束"的选区，节点承载的仍是整段视频。
 * 从前把段长当总时长传下去，一拖端点，播放条上的 0:02 就跟着变 —— 看起来像在改视频本身。
 * 现在进度条始终按 duration 画，剪辑只体现为"播到 end 就停/回 start 循环"。
 */
const playableLength = computed(() => {
  if (duration.value > 0) return duration.value
  // 元数据还没到手（首帧 / SSR）时先信节点 data 里记的总时长，播放条上就不会出现 0:00
  const fallback = Number(props.data?.videoDuration)
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
})
/** 进度条上的当前位置 = 视频当前时间（整段坐标系） */
const playedInClip = computed(() => Math.max(0, Math.min(currentTime.value, playableLength.value)))
const progressPct = computed(() => (playableLength.value > 0 ? (playedInClip.value / playableLength.value) * 100 : 0))
/** 左右分开显示（参考 liblib 控件）：进度条左边已播、右边总长 */
const playedTimeLabel = computed(() => formatTime(playedInClip.value))
const totalTimeLabel = computed(() => formatTime(playableLength.value))

/**
 * 剪辑选区的末尾一变，就重新武装段尾判定。
 *
 * 为什么监听「末尾」而不是把判断塞进剪辑面板：内容区自己在播，任何一次末尾变化
 * （拖端点、改起点让末尾跟着变、换节点）都必须让它重新开始看「有没有播过段尾」，
 * 否则上一轮留下的闩锁会把之后所有循环都吞掉（用户 2026-10-31 实测报的越界播放）。
 */
watch(
  () => clipRange.value.end,
  () => {
    endedLatch.value = false
  },
)
/** 静音开关（liblib 控件里的喇叭按钮；默认有声，点一下静音） */
const muted = ref(false)
/** 音量（0~1）：hover 喇叭弹出竖向滑块可调；音量为 0 视同静音 */
const volume = ref(1)
const volumeEffectiveMuted = computed(() => muted.value || volume.value <= 0)
const volumeOpen = ref(false)
/** 倍速（共用条引入的能力，节点此前没有）：档位与菜单显隐由本组件持有 */
const playbackRate = ref(1)
const rateMenuOpen = ref(false)
/** 倍速档位清单（与 VideoPlayerBar 菜单一致；挑档写回 video） */
const RATE_VALUES = [0.5, 1, 1.5, 2, 3] as const
let volumeDragging = false
/** 悬浮层延迟关闭（音量滑块/截帧菜单通用）：给鼠标从按钮移进面板留时间，不至于半路就收走 */
function delayedClose(kind: 'volume' | 'capture'): void {
  if (kind === 'volume') {
    if (volumeCloseTimer !== null) window.clearTimeout(volumeCloseTimer)
    volumeCloseTimer = window.setTimeout(() => { volumeOpen.value = false; volumeCloseTimer = null }, 350)
  } else {
    if (captureCloseTimer !== null) window.clearTimeout(captureCloseTimer)
    captureCloseTimer = window.setTimeout(() => { captureMenuOpen.value = false; captureCloseTimer = null }, 350)
  }
}
function cancelDelayedClose(kind: 'volume' | 'capture'): void {
  if (kind === 'volume') {
    if (volumeCloseTimer !== null) { window.clearTimeout(volumeCloseTimer); volumeCloseTimer = null }
  } else {
    if (captureCloseTimer !== null) { window.clearTimeout(captureCloseTimer); captureCloseTimer = null }
  }
}
let volumeCloseTimer: number | null = null
let captureCloseTimer: number | null = null
/** 两组下拉互斥：开一组就立刻收另一组（用户口径：同时只能有一个下拉） */
function openExclusive(kind: 'volume' | 'capture'): void {
  if (kind === 'volume') {
    captureMenuOpen.value = false
    volumeOpen.value = true
  } else {
    volumeOpen.value = false
    captureMenuOpen.value = true
  }
}
/** 竖向音量轨道：按住/划过都设值（pointer capture 保证拖出轨道也不丢） */
function setVolumeFromEvent(e: PointerEvent): void {
  const track = e.currentTarget as HTMLElement
  const r = track.getBoundingClientRect()
  const pct = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  volume.value = Math.round(pct * 100) / 100
  if (volume.value > 0) muted.value = false
}
function onVolumeTrackDown(e: PointerEvent): void {
  volumeDragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  setVolumeFromEvent(e)
}
function onVolumeTrackMove(e: PointerEvent): void {
  if (volumeDragging) setVolumeFromEvent(e)
}
function onVolumeTrackUp(): void {
  volumeDragging = false
}
/** 截帧菜单展开态：当前帧 / 首帧 / 尾帧 */
const captureMenuOpen = ref(false)

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

/** 当前该用的 video 元素（全屏预览由 MediaViewer 自己管，不在这份状态里） */
function activeVideo(): HTMLVideoElement | null {
  return videoRef.value
}// ==================== 播放控制 ====================

/** 播放：起点不在剪辑段内时先跳到段首（否则会播到裁剪掉的画面） */
async function togglePlay(): Promise<void> {
  const v = activeVideo()
  if (!v || !videoUrl.value) return
  if (v.paused) {
    const { start, end } = clipRange.value
    // 优先级：正在剪辑段外 → 回到段首；否则若上次离开时停在某处 → 从那儿接着放；
    // 都没有（首次播放）→ 从 0 开始（而不是浏览器默认的"接着上次"这种不可控行为）
    if (v.currentTime < start || (end > start && v.currentTime >= end)) {
      v.currentTime = start
    } else if (resumeTime.value > 0 && v.currentTime <= 0.01) {
      v.currentTime = Math.min(resumeTime.value, end > start ? end : Number.POSITIVE_INFINITY)
    }
    /**
     * 每次「从暂停开始播」都重新武装段尾判定（用户实测 2026-10-31）。
     *
     * 不这么做的话：上一轮停在段尾让闩锁留成 true，改完选区再按播放，
     * 段尾判断整段失效 —— 视频一路播到片尾，看起来就是「循环没生效 / 播到区域外」。
     * onTimeUpdate 里还有一道「回到选区内部自动解锁」的兜底，这里只是把正常路径写明确。
     */
    endedLatch.value = false
    // 自动播放可能被浏览器策略拦下（无用户手势时不许有声播放）—— 降级为静音播
    // 一把；真实用户点过一次页面后通常不会再进这条路。播放态由事件驱动同步。
    await v.play().catch(() => {
      v.muted = true
      return v.play().catch(() => { })
    })
  } else {
    v.pause()
    // 暂停：画面**停在当前帧**（用户 2026-10-31：播放/暂停只由左下角按钮触发）。
    // 不立刻回预览图 —— 那会让"暂停"看起来像"消失"；只有激活态消失
    // （鼠标离开且未选中 → leaveActive → stopPlayback）才回预览图。
  }
}

/**
 * 播放按钮：帧图态下**先挂上 `<video>`（这一步才真正开始加载视频字节）**，等它挂好再播。
 *
 * 这正是用户要的"只有点击播放的时候才真正加载视频"：点之前页面里没有任何视频请求，
 * 点之后才发出 —— 而不是"先加载好等着被点"。
 */
async function onPlayButton(restart = false): Promise<void> {
  if (!videoRequested.value) {
    videoRequested.value = true
    currentTime.value = clipRange.value.start
    if (restart) resumeTime.value = 0
    await nextTick()
  }
  await togglePlay()
}

/**
 * 激活态成立 → 自动开始播放（用户口径：不用先点按钮）。
 *
 * 与播放按钮走同一条路（先挂 video 元素、再 play），所以"点播"与"自动播"行为一致。
 * 已经播着就什么都不做（鼠标在卡内移动会反复触发 enter/leave，不能每次都重播）。
 */
async function enterActive(): Promise<void> {
  if (posterHideTimer.value !== null) { window.clearTimeout(posterHideTimer.value); posterHideTimer.value = null }
  // 重新把帧图盖上，等这次 play 后再延迟关闭
  posterCovering.value = true
  if (cropping.value || broken.value || !videoUrl.value) return
  // 已经播着 → 只重排帧图延迟关闭，不打断播放
  if (videoRequested.value && playing.value) { schedulePosterHide(); return }
  /**
   * 每次都从头播（用户 2026-10-30 口径）。
   *
   * 旧行为是"从上次停下的位置接着播"，但配合定格帧会让人以为预览图变了；
   * 现在定格功能已经移除，统一从头开始更符合直觉。
   */
  resumeTime.value = 0
  await onPlayButton(true)
}

/**
 * 激活态消失 → 暂停并回到常驻预览图。
 *
 * 用户 2026-10-30：**不再抓定格帧**。以前每次离开都要现场解码一帧，
 * 慢、会闪白、还可能截到黑场；现在预览图是资源库里那张统一缩略图，
 * 移开就是直接露出来（零等待）。
 */
function leaveActive(): void {
  if (posterHideTimer.value !== null) { window.clearTimeout(posterHideTimer.value); posterHideTimer.value = null }
  posterCovering.value = true
  stopPlayback()
}

/**
 * 同步「激活态 → 播放/停播」。
 *
 * 为什么用 watch 而不是在 enter/leave 里各写一遍：激活态有两个来源
 * （鼠标悬停、单选选中），任何一方变化都要走**同一条**处理路径。
 * 各写一遍迟早会漂移 —— 比如"选中进入不播、取消选中才停"这种半截行为。
 */
watch(active, (on) => {
  if (on) void enterActive()
  else leaveActive()
})

/** 悬停进入：只翻标志位，真正的播放交给上面那个 watch */
function onCardEnter(): void {
  hovering.value = true
}

/** 悬停离开：同上，停播交给 watch */
function onCardLeave(): void {
  hovering.value = false
}

function onLoadedMetadata(e: Event): void {
  const v = e.target as HTMLVideoElement
  duration.value = Number.isFinite(v.duration) ? v.duration : duration.value
  broken.value = false
  // 兜底：卡片尺寸缺失（后台没写 videoWidth/Height 的视频，如 MCP/上传加的）时，
  // 用 `<video>` 量到的真实宽高补一次 —— 宽高与卡片尺寸要一起写，否则按比例算卡片那步无从下手，
  // 卡片会停在 4:3（9:16 竖视频被塞成横的，与图片节点同一个毛病）。
  const w = v.videoWidth
  const h = v.videoHeight
  const hasCard = positiveNum(props.data?.cardWidth) !== null && positiveNum(props.data?.cardHeight) !== null
  if (w > 0 && h > 0 && !hasCard) {
    const patch = videoCardSizePatch(w, h, ops.fitLimits?.())
    if (patch) ops.write(props.id, { ...(ops.read(props.id) ?? props.data), videoWidth: w, videoHeight: h }, patch.size)
  }
  // 起点在剪辑段之前时先对齐到段首（换过剪辑范围后重新加载也适用）
  const { start } = clipRange.value
  if (start > 0 && v.currentTime < start) v.currentTime = start
  // 视频时长到手 = 胶片条可以开工了（剪辑面板 watch 这个标记）
  publishDuration(props.id, duration.value)
/**
   * 恢复"上次停在哪"。
   *
   * 为什么必须在这里做（而不是只在 togglePlay 里）：每次离开节点定格后 video 元素会被卸载，
   * 下次悬停上来是**新元素**（currentTime 从 0 开始）。只靠 togglePlay 里那句判断来不及 ——
   * 那时元数据可能还没就绪、currentTime 还没设成 resumeTime 就被 play 覆盖掉。
   * 于是用户会遇到"我明明停在第 5 秒，回来却从头播"。
   */
  if (resumeTime.value > 0 && v.currentTime <= 0.01) {
    const { end } = clipRange.value
    const max = end > start ? end : v.duration
    v.currentTime = Number.isFinite(max) ? Math.min(resumeTime.value, max) : resumeTime.value
  }
}

function onTimeUpdate(e: Event): void {
  const v = e.target as HTMLVideoElement
  // 只认当前活跃元素的事件：视频元素重新实例化后，旧元素的残余 timeupdate
 // （暂停/seek 也会发）不能再来写时间 —— 两个时间源交替写 currentTime 就是进度条闪烁
  if (v !== activeVideo()) return
  currentTime.value = v.currentTime
  publishPlayhead(props.id, v.currentTime)
  playing.value = !v.paused
  const { start, end } = clipRange.value
  /**
   * 回到选区内部 → 重新武装「播到段尾」的判定（用户实测 2026-10-31 报的「开着循环还播到区域外」）。
   *
   * 这条**必须写在段尾判断之前**。endedLatch 是一轮只停一次的闩锁，但从前只有两种情况会清它：
   * ① 整段元素卸载（stopPlayback），② 循环自己跳回段首。
   * 于是这些路径会让闩锁一直卡在 true，段尾判断整段失效，视频顺顺当当播到片尾：
   * - 上一轮播到段尾停下（闩锁 = true），用户把选区往后拖 / 改起点，再按播放；
   * - 同一轮里中途打开「区间循环」；
   * - 拖剪辑端点时预览 seek 回到选区里。
   * 判据用「确实在选区内部」而不是「小于 end」：停在段尾那一刻 currentTime == end，
   * 不能在这一帧把自己解锁，否则 timeupdate 会反复停下。
   */
  if (endedLatch.value && v.currentTime < end - 0.001) endedLatch.value = false
  /**
   * 越界处理统一交给纯函数（videoClip.clipBoundaryAction），组件只负责执行动作。
   *
   * 两条边界都要管，这是用户截图里「开了循环还能播到区域外」的根因：
   * - 拖到段尾之后：循环开就回段首接着播，循环关就停在段尾；
   * - 拖到段首之前：正在播就拉回段首（暂停中允许停在原处预览）。
   * 判断**不受 endedLatch 限制**：从暂停状态拖到段外再点播放时，闩锁可能还是上一轮的 true，
   * 只靠「一轮停一次」的判断会漏掉，视频就会继续往外播。
   */
  const action = clipBoundaryAction({
    current: v.currentTime,
    start,
    end,
    loop: readClipPrefs(props.id).loop,
  })
  if (action === 'continue') {
    if (endedLatch.value && v.currentTime < end - 0.001) endedLatch.value = false
    return
  }
  if (action === 'clamp-start') {
    if (v.paused) return
    v.currentTime = start
    currentTime.value = start
    return
  }
  endedLatch.value = true
  if (action === 'rewind') {
    endedLatch.value = false
    v.currentTime = start
    currentTime.value = start
    void v.play().catch(() => {})
  } else {
    v.pause()
    v.currentTime = end
    currentTime.value = end
    resumeTime.value = start
  }
}

/** 拖动进度条：现在是整段原片的时间轴，值直接就是真实时间 */
function onSeek(e: Event): void {
  const v = activeVideo()
  if (!v) return
  const target = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(target)) return
  v.currentTime = Math.min(Math.max(target, 0), duration.value || target)
  currentTime.value = v.currentTime
}

/** 共用条回传数值版 seek（值 = 整段原片里的真实秒数，与 onSeek 同语义） */
function onBarSeek(seconds: number): void {
  const v = activeVideo()
  if (!v || !Number.isFinite(seconds)) return
  v.currentTime = Math.min(Math.max(seconds, 0), duration.value || seconds)
  currentTime.value = v.currentTime
}

/** 共用条：挑倍速档位（写回 video；菜单由模板里的 rateMenuOpen 管） */
function onRatePick(value: number): void {
  if (!(RATE_VALUES as readonly number[]).includes(value)) return
  playbackRate.value = value
  rateMenuOpen.value = false
  const v = activeVideo()
  if (v) v.playbackRate = value
}

/** 共用条回传数值版音量（>0 解除静音；与旧竖滑杆同语义） */
function onBarVolume(value: number): void {
  if (!Number.isFinite(value)) return
  volume.value = Math.min(1, Math.max(0, value))
  if (volume.value > 0) muted.value = false
  const v = activeVideo()
  if (v) v.volume = volume.value
}

function onVideoError(): void {
  // 只有"源本身坏了"（解码器不认/格式错，code=4）才标记失效；
  // 网络抖动（code=2 网络 / code=3 解码中断）——尤其是快速拖拽缩放时元素被反复卸载重挂
  // 打断加载——不标记：标记了 stage 就整个空掉（v-if videoUrl && !broken），
  // 用户看到白板，hover 重挂后才恢复（2026-10-17 用户实测）
  const code = videoRef.value?.error?.code ?? 0
  if (code === 4) {
    broken.value = true
    playing.value = false
    return
  }
  // 网络类错误：稍后让 video 重新加载一次（直接调 load()）
  const v = videoRef.value
  if (v && videoUrl.value) {
    window.setTimeout(() => { try { v.load() } catch { /* 元素已卸载则忽略 */ } }, 400)
  }
  playing.value = false
}

/** 视频开始播放：500ms 后撤帧图（规则②）。seek 后 play 会再触发 → 重排定时器，幂等 */
function onVideoPlay(): void {
  playing.value = true
  schedulePosterHide()
}

/**
 * video 解出可绘制画面（loadeddata / canplay / seeked 都会发）。
 *
 * 这就是"可以撤帧图"的真实信号 —— 见 keepPosterOverVideo 的说明。
 * 用事件而不是轮询 readyState：事件由浏览器在解码完成那一刻发出，最省事也最准。
 */
function onVideoReady(): void {
  const v = videoRef.value
  // HAVE_CURRENT_DATA(2)：当前位置已经有帧可画。低于它说明还没解出来。
  if (v && v.readyState >= 2) videoHasFrame.value = true
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

/** 首帧/尾帧的取值：优先剪辑段的边界（用户剪过就该剪这段的首尾），没剪就整段首尾 */
async function captureFrameAt(at: number): Promise<void> {
  if (captureBusy.value || !videoUrl.value) return
  captureBusy.value = true
  try {
    await captureFrameNode(at)
  } finally {
    captureBusy.value = false
  }
}

/** 截帧菜单：当前帧（停在哪截哪）/ 首帧（剪辑段起点）/ 尾帧（剪辑段终点） */
function onCaptureMenuPick(kind: 'current' | 'first' | 'last'): void {
  captureMenuOpen.value = false
  if (kind === 'current') { void onCaptureFrame(); return }
  const { start, end } = clipRange.value
  void captureFrameAt(kind === 'first' ? start : end > start ? end : duration.value)
}
function onCaptureMenuOutside(e: PointerEvent): void {
  if (!captureMenuOpen.value) return
  const host = captureMenuRef.value
  if (host && !host.contains(e.target as Node)) captureMenuOpen.value = false
}
watch(captureMenuOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onCaptureMenuOutside, true)
  else document.removeEventListener('pointerdown', onCaptureMenuOutside, true)
})

async function captureFrameNode(at: number): Promise<void> {
  const command = ctx.get('command')
  command.execute('video:capture-frame', { nodeId: props.id, at })
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
  // 只写正式尺寸 size；卡片镜像由 nodeStore 自动补齐
  ops.write(props.id, current, patch.size)
}

onMounted(() => {
  void nextTick(() => syncCardSize(missingVideoCardSizePatch(props.data, ops.fitLimits?.())))
  // 缓存里的 objectURL 不是挂载时创建的 → 必须显式 fetch + decode，
  // 否则"点播放 → video 出现"会出现几帧空白（对帧图同样适用）
  if (typeof fetch === 'function') {
    void nextTick(() => {
      const url = posterDisplaySrc.value
      if (url) fetch(url, { cache: 'force-cache' }).catch(() => { })
    })
  }
})

watch(
    // 引用变了也要重新取图（只盯旧地址会漏掉“同一地址换了资源”的场景）
    () => sourceFields.value.resourceId + '|' + sourceFields.value.legacyUrl,
  () => {
    broken.value = false
    syncCardSize(followedVideoCardSizePatch(props.data, ops.fitLimits?.()))
  },
)
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
  tierSettingOff?.dispose()
  if (volumeCloseTimer !== null) window.clearTimeout(volumeCloseTimer)
  if (captureCloseTimer !== null) window.clearTimeout(captureCloseTimer)
  if (posterHideTimer.value !== null) window.clearTimeout(posterHideTimer.value)
  document.removeEventListener('pointerdown', onCaptureMenuOutside, true)
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
    <div ref="stageRef" class="video-stage" :class="{ 'is-framed': isFramed, 'is-cropping': cropping }"
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
          用户分不清"在加载"和"坏了"。这里给一个轻微的呼吸占位 + 转圈。
          **帧图已经有了就不显示**：那时候屏幕上有真画面，再叠一层转圈是噪音。
        -->
        <div v-if="thumbLoading && !posterDisplaySrc && showPoster" class="video-loading" aria-live="polite">
          <span class="video-loading-spinner" aria-hidden="true"></span>
          <span class="video-loading-text">加载预览…</span>
        </div>
        <!-- 独立 v-if：video 只看"请求播放"，与帧图在不在无关 -->
        <video v-if="!showPoster" ref="videoRef" class="video-media" :class="{ 'has-frame': videoHasFrame }"
          :style="videoStyle" :src="videoUrl"
          playsinline preload="metadata" @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate"
          :muted="volumeEffectiveMuted" :volume="volume"
          @loadeddata="onVideoReady" @canplay="onVideoReady" @seeked="onVideoReady"
          @play="onVideoPlay" @pause="playing = false" @error="onVideoError"
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
        @rate-toggle="rateMenuOpen = !rateMenuOpen"
        @rate-pick="onRatePick"
        @mute-toggle="muted = !muted"
        @volume="onBarVolume"
        @volume-open="cancelDelayedClose('volume'); openExclusive('volume')"
        @volume-close="delayedClose('volume')"
      >
        <template #capture>
          <div ref="captureMenuRef" class="vc-capture">
            <button class="vc-btn" type="button" title="截取画面" aria-label="截取画面" :disabled="captureBusy"
              :aria-expanded="captureMenuOpen" :aria-haspopup="'menu'"
              @mouseenter="cancelDelayedClose('capture'); openExclusive('capture')"
              @mouseleave="captureMenuOpen && delayedClose('capture')">
              <Camera class="vc-ico" :size="15" aria-hidden="true" />
            </button>
            <!-- 截帧菜单（liblib 同款三项）：向上弹出 -->
            <div v-if="captureMenuOpen" class="vc-capture-menu nodrag nopan nowheel" role="menu"
              @mouseenter="cancelDelayedClose('capture')" @mouseleave="delayedClose('capture')">
              <button class="vc-capture-item" type="button" role="menuitem" @click.stop="onCaptureMenuPick('current')">截取当前帧</button>
              <button class="vc-capture-item" type="button" role="menuitem" @click.stop="onCaptureMenuPick('first')">截取首帧</button>
              <button class="vc-capture-item" type="button" role="menuitem" @click.stop="onCaptureMenuPick('last')">截取尾帧</button>
            </div>
          </div>
        </template>
        <!-- 全屏按钮放进条内尾部：整条底栏铺满宽度，图标仍在最右侧（与拆分前一致） -->
        <template #end>
          <button class="vc-btn" type="button" title="全屏播放" aria-label="全屏播放"
            @click.stop="openPreview({ name: (typeof props.data?.videoName === 'string' && props.data.videoName) || '视频预览', kind: 'video', url: videoUrl })">
            <Maximize2 class="vc-ico" :size="15" aria-hidden="true" />
          </button>
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
/* —— 播放控件：压在画面底部，无背景 —— 只留图标/文字/进度条本身，
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
/* —— 音量组：hover 喇叭向上弹出竖向滑块（liblib 同款） —— */
.vc-volume {
  position: relative;
  display: flex;
  flex: none;
}
.vc-volume-pop {
  position: absolute;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  z-index: 12;
  width: 34px;
  padding: 8px 0 10px;
  border-radius: 8px;
  background: rgba(17, 17, 17, 0.92); /* 主题色白名单: 叠在视频画面上的音量弹层，与主题无关 */
  border: 1px solid rgba(255, 255, 255, 0.08); /* 主题色白名单: 同上 */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); /* 主题色白名单: 同上 */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.vc-volume-value {
  color: rgba(255, 255, 255, 0.95); /* 主题色白名单: 视频覆盖层上的恒浅色文字 */
  font-size: 11px;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
}
.vc-volume-track {
  position: relative;
  width: 4px;
  height: 76px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28); /* 主题色白名单: 视频覆盖层里的音量轨道 */
  cursor: pointer;
  /* 扩大命中区：轨道细但手能点中 */
  touch-action: none;
}
.vc-volume-track::before {
  content: '';
  position: absolute;
  inset: 0 -10px;
}
.vc-volume-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 999px;
  background: #fff; /* 主题色白名单: 视频覆盖层上的音量填充，恒白 */
}
.vc-volume-thumb {
  position: absolute;
  left: 50%;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: #fff; /* 主题色白名单: 视频覆盖层上的音量圆点，恒白 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); /* 主题色白名单: 同上 */
  pointer-events: none;
}
.vc-capture-menu {
  position: absolute;
  right: 0;
  bottom: 30px;
  z-index: 12;
  min-width: 118px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(17, 17, 17, 0.92); /* 主题色白名单: 叠在视频画面上的截图菜单，与主题无关 */
  border: 1px solid rgba(255, 255, 255, 0.08); /* 主题色白名单: 同上 */
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); /* 主题色白名单: 同上 */
  display: flex;
  flex-direction: column;
}
.vc-capture-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.92); /* 主题色白名单: 视频覆盖层上的菜单文字 */
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.vc-capture-item:hover {
  background: rgba(255, 255, 255, 0.12); /* 主题色白名单: 视频覆盖层菜单 hover 底 */
}
.video-controls.is-hidden {
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
}

.vc-btn {
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
  /* 控件叠在视频画面上（不是面板底色），用恒浅色前景保证任何画面上都读得清 */
  color: color-mix(in srgb, var(--ui-tip-ink, #fff) 88%, transparent);
  cursor: pointer;
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
  cursor: not-allowed;
}.vc-btn svg {
  width: 15px;
  height: 15px;
  /* 渐变衬底已保证可读性，图标不再单独投影 */
}
.vc-btn .vc-ico {
  /* lucide 线宽对齐 liblib 的细线观感 */
  stroke-width: 1.75;
}

.vc-time {
  flex: none;
  min-width: 74px;
  /* 26px = 按钮高：文字基线随行盒垂直居中，与两侧按钮同一条中轴线 */
  line-height: 26px;
  color: color-mix(in srgb, var(--ui-tip-ink, #fff) 92%, transparent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  text-shadow: none;
}
/* liblib 布局：已播时间贴进度条左、总时长贴右，各占固定窄宽 */
.vc-time-current,
.vc-time-total {
  min-width: 34px;
}

/* 进度条：轨道 3px + 已播填充；input 透明覆盖在上面接手势（自绘才能跟画布缩放匹配） */
.vc-progress {
  position: relative;
  flex: 1;
  min-width: 60px;
  /* 拖拽热区：视觉是 3px 细条，命中区加高到 22px（透明方块垫在下面），细条上好拖 */
  height: 22px;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.vc-progress::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  /* 轨道压在热区垂直中心：(22-3)/2 = 9.5px（用固定值，别用 50% —— 相对定位盒的高度解析有差异） */
  top: 9.5px;
  height: 3px;
  border-radius: 999px;
  /* 不走主题色：liblib 的轨道是恒白低透明 */
  background: rgba(255, 255, 255, 0.35); /* 主题色白名单: 视频覆盖层进度轨道 */
}
.vc-progress-fill {
  position: absolute;
  left: 0;
  top: 9.5px;
  height: 3px;
  border-radius: 999px;
  /* 不走主题色：已播填充恒白（liblib 同款） */
  background: #fff; /* 主题色白名单: 视频覆盖层进度填充，恒白 */
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
/* 进度圆球（liblib 同款）：白色圆点骑在填充末端，压在原生 input 之下、轨道之上 */
.vc-progress-thumb {
  position: absolute;
  top: 5.5px;
  width: 11px;
  height: 11px;
  margin-left: -5.5px;
  border-radius: 50%;
  background: #fff; /* 主题色白名单: 视频覆盖层进度圆点，恒白 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45); /* 主题色白名单: 同上 */
  pointer-events: none;
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
/*
 * 加载态（用户 2026-10-30 要求）：缩略图还没拿到时的占位。
 *
 * 站在卡片自己的底色上（不是黑底），所以用节点文字色 —— 与空态同一套。
 * 转圈用边框做，不需要额外图标；prefers-reduced-motion 下停转（只看文字）。
 */
.video-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--canvas-node-text-muted, #9ca3af);
  font-size: 12px;
  pointer-events: none;
}
.video-loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: video-loading-spin 800ms linear infinite;
}
@keyframes video-loading-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .video-loading-spinner { animation: none; }
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
