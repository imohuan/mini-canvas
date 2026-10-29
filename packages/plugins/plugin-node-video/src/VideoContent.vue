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
import { RenderEvents, useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import { captureFrame } from './videoTransform'
import {
  FrameCache,
  grabFrameBlobFromElement,
  grabTierFrames,
  type FrameResourcePort,
  type TierFrame,
} from './videoThumbCanvas'
import { frameRefParamFor, makeFrameRef } from './videoThumbKey'
import {
  readVideoThumbTiers,
  resolveVideoThumbTier,
  videoThumbTargetFor,
  videoThumbTierKeys,
  type VideoThumbTierConfig,
} from './videoThumbTier'
import { framingStyle, isCroppedRect, type Rect } from './videoCrop'
import { readClipRange } from './videoClip'
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
import { endOverlay, isCropping } from './videoSession'
import { readVideoSourceFields, resolveVideoSrc } from './videoRefs'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
/** 默认主题的统一空状态（按名取；极简宿主没装主题时回落本组件的一行灰字） */
const NodeEmptyState = useUiComponent('nodeEmptyState')

const { ctx, flow, visibleNodes } = useCanvasRender()

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
/** 鼠标是否停在卡片上：卡内播放控件只在此时显形（不常驻遮画面） */
const hovering = ref(false)

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
/**
 * 定格那一帧的**三个档位**（第 1 档 = 当前时刻的原始尺寸截图，2/3 档 = 它的缩略图）。
 *
 * 用户口径：从视频切回帧图时要"直接生成 3 个档次的图片"，三档必须是**同一时刻的同一画面**
 * （否则缩放时画面会跳到别的时刻）—— 所以是**一次抓帧、缩出三档**（见 grabTierFrames），
 * 而不是三个档位各自去 seek 一次。
 */
const frameTiers = ref<Map<number, TierFrame>>(new Map())
/**
 * "生成这份帧图时用的配置指纹"（尺寸 + 质量）。
 *
 * 用来判断"用户改过配置之后，手上这份还能不能继续用"：改了就丢掉重做。
 * 不带这个判断的话，改完"最大宽高"画面会一直停在按旧尺寸缩出来的那张。
 */
const frozenCfgKey = ref('')

/** 当前配置的指纹（尺寸 + 质量）——变了就必须重新生成 */
function tierCfgKey(): string {
  const c = tierCfg.value
  return c.tier2Width + 'x' + c.tier2Height + '/' + c.tier3Width + 'x' + c.tier3Height + '/q' + Math.round(c.quality * 100)
}
/** 离开时的播放位置：下次再点播放从这里接着放 */
const resumeTime = ref(0)
/** 定格操作的代次：用户又悬停回来（要求播放）时 +1，用来作废还在进行中的那次定格 */
const freezeEpoch = ref(0)

/** 帧图缓存（按 源+档位+取帧时刻 缓存；命中即取，不多次解码） */
const frameCache = new FrameCache()
/** 当前该显示的帧图（生成是异步的，没好之前先显示已有的那张） */
const tierFrame = ref<TierFrame | null>(null)



/**
 * 现在画静帧还是 video 元素。
 *
 * 规则（用户口径）：**要播 + 鼠标还在节点上** 才显示 video；其余一律显示静帧 ——
 * - 鼠标悬停上来 → 自动播放（不需要先点按钮）；
 * - 鼠标移开 → 暂停、定格成"当前这一帧"的图片（video 元素直接隐藏掉）；
 * - 播放中途缩放画布、或鼠标离开 → 同样回到静帧。
 *
 * ★ 那个 `frameTiers.size > 0` 是**必要的时序保护**：抓帧需要 video 元素还在 DOM 里。
 * 如果鼠标一移开就立刻卸载 video，抓帧只能抓到空 —— 所以"还没定格过"时让 video 多留一会儿
 * （此时它已暂停、画面是静止的，用户看不出区别），抓完再切。
 *
 * 全屏是独立的另一个 UI（用户口径），有自己的 video 元素，所以这里不涉及它。
 */
/**
 * 显隐状态机（用户口径 2026-10-17，三条硬规则）：
 * ① 触发显示：鼠标落在节点上 → 立刻挂 video 并自动播放；
 * ② 延迟关闭：video 开始播放 500ms 后才把帧图藏掉（黑帧由帧图盖住）；
 * ③ 保持显示：鼠标不离开，video 元素**永不消失**——暂停、拖进度条、seek 都不回图片，
 *    回图片只由「鼠标真正离开节点」触发（那时先定格抓帧、抓完再撤 video）。
 */
const posterHideTimer: { value: number | null } = { value: null }
/** true = 帧图还盖着；video 首次 play 后 500ms 翻 false */
const posterCovering = ref(true)
function schedulePosterHide(): void {
  if (posterHideTimer.value !== null) window.clearTimeout(posterHideTimer.value)
  posterHideTimer.value = window.setTimeout(() => {
    posterHideTimer.value = null
    posterCovering.value = false
  }, 500)
}
const keepPosterOverVideo = computed(() => posterCovering.value)
const showPoster = computed(() => !videoRequested.value || (!hovering.value && frameTiers.value.size > 0))

/**
 * 取帧时刻：第 0 帧常是黑场 / 片头，取第 1 秒更有代表性；
 * 比 1 秒还短的片子退到 0（否则取不到帧）。
 */
const frameAt = computed(() => {
  const d = duration.value
  return d > 0 && d <= 1 ? 0 : Math.min(1, d > 0 ? d * 0.1 : 1)
})

/**
 * 当前该显示的帧图地址：**定格那一帧优先**（用户停在哪就显示哪一帧的画面），
 * 否则用"默认时刻"的档位帧图（还没生成好时为空，模板里会先不渲染）。
 *
 * 三档都是从**同一张定格帧**缩出来的，所以这里换档只是换分辨率，画面不跳。
 */
const posterDisplaySrc = computed(
  () => frameTiers.value.get(tier.value)?.url || tierFrame.value?.url || '',
)

/**
 * 按当前档位取（或生成）"默认时刻"的帧图 —— 只在**没定格过**时兜底（首次显示、换视频后）。
 *
 * 提前 return 的两种情况（都保持"不生成"）：
 * - 已经定格过（frameTiers 有货）：用定格帧，不再生成别的时刻的图，免得画面跳；
 * - 正在裁剪 / 源尺寸未知 / 正在播放：等下一次 watch。
 *
 * ★ **只在节点进入可视区时才生成**：抓帧要起临时 video 解码，一块画布上几十个视频节点
 * 同时排队的代价是"打开画布要等十几秒才看到画面"（2026-10-15 实测：32 个视频节点时
 * 默认帧图 10 秒才出来）。可视区外的节点先留空，等滚进来再生成。
 */

/**
 * 帧图解析错峰门闩（2026-10-15 卡死修复）：组件挂载后 2 秒才允许帧图解析。
 * 几十个视频节点同时挂载时全部并发解析帧图（解码/抓帧/资源请求），多核打满、
 * 页面长时间无响应（用户实测「打开画布就卡死」）。挂载后错峰自然把请求摊开。
 */
const frameGateOpen = ref(false)
onMounted(() => {
  // 2000ms 只挡"重活"（起解码器抓帧）—— 纯缓存读取（资源库探测 / 内存命中）不解码、
  // 不占 CPU，不在这 2 秒里干等，否则刷新后节点白屏 2-3 秒才出图（2026-10-17 用户实测）。
  setTimeout(() => { frameGateOpen.value = true }, 2000)
})

watch(
  // ★ 尺寸/质量也要进依赖：改"最大宽高"时档位不变，只盯档位就不会重跑
  // （2026-10-15 用户实测："重新设置了最大宽高……依然使用的是之前的图片"）。
  [
    tier,
    videoUrl,
    frameGateOpen,
    () => videoWidth.value,
    () => videoHeight.value,
    cropping,
    showPoster,
    () => tierCfg.value.tier2Width,
    () => tierCfg.value.tier2Height,
    () => tierCfg.value.tier3Width,
    () => tierCfg.value.tier3Height,
    () => tierCfg.value.quality,
  ],
  () => {
    const src = videoUrl.value
    if (!src || cropping.value || !showPoster.value) return
    /**
     * 已经定格过 → 只有在**配置没变**的情况下才直接沿用。
     *
     * 改过尺寸/质量（folded 进 `tierCfgKey`）就必须丢掉旧定格重做 ——
     * 否则用户改了"最大宽高"，画面会一直停在按旧尺寸缩出来的那张
     * （2026-10-15 用户实测：「重新设置了最大宽高……它依然使用的是之前的图片」）。
     */
    if (frameTiers.value.size > 0) {
      if (frozenCfgKey.value === tierCfgKey()) return
      releaseFrameTiers()
    }
    if (videoWidth.value <= 0 || videoHeight.value <= 0) return
    // 可视区闸门（外扩一屏，滚动时不用等）
    const inView = visibleNodes(800).some((r) => r.id === props.id)
    if (!inView) return
    const wantTier = tier.value
    const at = frameAt.value
    const frameW = videoWidth.value
    const frameH = videoHeight.value
    const box = videoThumbTargetFor(wantTier, tierCfg.value, { width: frameW, height: frameH })
    // 名字里带**尺寸**：用户改"最大宽高"后名字跟着变，才会重新生成（只带档位会命中旧图）
    const ref = makeFrameRef('vid', src, frameRefParamFor(wantTier, at, box.width, box.height, tierCfg.value.quality))
    // 内存缓存的键用同一份身份（ref），于是改尺寸后内存那一级也一起失效
    const variant = ref ?? wantTier + '@' + at.toFixed(2)
    // 固定引用名（源 + 档位 + 时刻）→ **资源库命中就零解码**：
    // 第二次打开画布、换设备打开、刷新之后，都直接取已存的那张，
    // 不再为每个视频节点重跑一次"起解码器 + seek"（那正是"节点一多每次卡几秒"的根）。
    const resources = frameResources()
    // 轻路先行：还没过门闩时也允许"纯读缓存"。缓存键先按当前档位算一份；
    // 门闩后重跑时键一致 → 命中内存直接复用，不会重复生成。
    const cacheOnly = !frameGateOpen.value
    void frameCache
      .resolveOrCreate({
        src,
        variant,
        ...(ref ? { ref } : {}),
        ...(resources ? { resources } : {}),
        ...(cacheOnly ? { cacheOnly: true } : {}),
        make: async () => {
          // cacheOnly 模式下不应走到 make（门闩内才允许解码重活），保险直接拒绝
          if (cacheOnly) return null
          // 元素在（正在播/刚暂停）就从它身上直接抓，零额外解码
          const el = videoRef.value
          if (el && el.videoWidth) {
            const fast = await grabFrameBlobFromElement(el, {
              box: videoThumbTargetFor(wantTier, tierCfg.value, { width: frameW, height: frameH }),
              tier: wantTier,
              cropRect: cropRect.value ?? null,
              quality: tierCfg.value.quality,
            })
            if (fast) return fast
          }
          // 元素不在（常态：还没播过）→ 起一次解码拿这一帧（每个源每种档位只做一次，
          // 做完就进资源库，之后永远命中）
          const slow = await grabTierFrames(src, {
            at,
            boxes: [
              { tier: wantTier, box: videoThumbTargetFor(wantTier, tierCfg.value, { width: frameW, height: frameH }) },
            ],
            cropRect: cropRect.value ?? null,
            frameWidth: frameW,
            frameHeight: frameH,
            quality: tierCfg.value.quality,
            grab: captureFrame,
          })
          const frame = slow?.tiers.get(wantTier)
          if (!frame) return null
          const blob = await fetch(frame.url)
            .then((r) => r.blob())
            .catch(() => null)
          URL.revokeObjectURL(frame.url)
          return blob
        },
      })
      .then((made) => {
        if (tier.value !== wantTier || videoUrl.value !== src) return
        if (made && frameTiers.value.size === 0) {
          tierFrame.value = made
          frozenCfgKey.value = tierCfgKey()
        }
      })
  },
  { immediate: true },
)

/** 释放定格帧的三个档位（objectURL 不释放会一直占着内存） */
function releaseFrameTiers(): void {
  for (const frame of frameTiers.value.values()) {
    try {
      URL.revokeObjectURL(frame.url)
    } catch {
      /* 环境不支持 → 忽略 */
    }
  }
  frameTiers.value = new Map()
}

/**
 * 资源库端口（ctx 上的 'resources'）：帧图存这儿，换会话/换设备才有得复用。
 * 取不到（极简宿主 / 单测桩）→ undefined，退回"只放内存"，功能照常、换会话重算一遍。
 */
function frameResources(): FrameResourcePort | undefined {
  const port = ctx?.get<FrameResourcePort | undefined>('resources')
  return port && typeof port.put === 'function' && typeof port.resolve === 'function' ? port : undefined
}

/**
 * 定格：暂停 → 抓住**当前这一帧** → 一次缩出三个档位 → 收掉 video 元素。
 *
 * 顺序不能反：**先抓帧再卸 video** —— 卸掉之后 videoRef 就没了，抓不到最后看到的画面。
 * 抓帧用同源资源 + 普通 video 元素，canvas 不会被标记为 tainted。
 *
 * ★ 为什么用 `freezeEpoch` 而不是看 `videoRequested` 来判断"要不要丢弃这次定格"：
 * `videoRequested` 要到抓帧**结束之后**才置 false（在那之前 video 元素必须留着给抓帧用），
 * 所以抓帧期间它一直是 true —— 拿它当取消判据会把每一次定格都自己丢掉
 * （2026-10-15 实测踩到：鼠标移开后视频暂停了，但画面一直是 video、永不切帧图）。
 */
async function freezeFrame(): Promise<void> {
  if (typeof document === 'undefined') return
  const v = videoRef.value
  if (!v || !v.videoWidth || !v.videoHeight) return
  const epoch = freezeEpoch.value
  const at = Number.isFinite(v.currentTime) ? v.currentTime : 0
  const frameW = v.videoWidth
  const frameH = v.videoHeight
  if (!v.paused) v.pause()
  resumeTime.value = at
  const src = videoUrl.value
  const boxes = [
    { tier: 1, box: videoThumbTargetFor(1, tierCfg.value, { width: frameW, height: frameH }) },
    { tier: 2, box: videoThumbTargetFor(2, tierCfg.value, { width: frameW, height: frameH }) },
    { tier: 3, box: videoThumbTargetFor(3, tierCfg.value, { width: frameW, height: frameH }) },
  ]
  /**
   * 定格这一帧的**三个档位**都走"先查资源库、没有才抓"的路（见 FrameCache.resolveOrCreate）。
   *
   * 两个好处：
   * - **同一时刻再次定格是零成本的**（名字里带档位与时刻，命中即取）；
   * - 常态下**连抓帧都不需要** —— 打开画布时先把视频静音 seek 到默认时刻、抓一帧存库，
   *   之后一直命中，于是"节点一多就每次卡几秒"的那件事根本不会发生。
   * *
   * 抓取一律**从眼前这个 video 元素直接抓**（零额外解码、零等待）：
   * 另起一个 video 去 seek 在几十个视频节点的画布上会卡在解码器排队里
   * （2026-10-15 实测：暂停了但画面迟迟切不过去）。抓不到才退回"另起解码"那条慢路。
   */
  const wanted = [1, 2, 3] as const
  const results = await Promise.all(
    wanted.map(async (wantTier) => {
      const wantBox = boxes.find((b) => b.tier === wantTier)?.box ?? { width: frameW, height: frameH }
      // 名字带**尺寸**：改了"最大宽高"后名字跟着变，才会重新抓一份（否则命中旧图）
      const ref = makeFrameRef(
        'vid',
        src,
        frameRefParamFor(wantTier, at, wantBox.width, wantBox.height, tierCfg.value.quality),
      )
      const resources = frameResources()
      return await frameCache.resolveOrCreate({
        src,
        // 内存键与资源库名字同一份身份 → 改尺寸时两级缓存一起失效
        variant: ref ?? wantTier + '@' + at.toFixed(2),
        ...(ref ? { ref } : {}),
        ...(resources ? { resources } : {}),
        make: async () => {
          const fromEl = await grabFrameBlobFromElement(v, {
            box: videoThumbTargetFor(wantTier, tierCfg.value, { width: frameW, height: frameH }),
            tier: wantTier,
            cropRect: cropRect.value ?? null,
            quality: tierCfg.value.quality,
          })
          if (fromEl) return fromEl
          const slow = await grabTierFrames(src, {
            at,
            boxes: [{ tier: wantTier, box: videoThumbTargetFor(wantTier, tierCfg.value, { width: frameW, height: frameH }) }],
            cropRect: cropRect.value ?? null,
            frameWidth: frameW,
            frameHeight: frameH,
            quality: tierCfg.value.quality,
            grab: captureFrame,
          })
          const frame = slow?.tiers.get(wantTier)
          if (!frame) return null
          // 慢路出的是 objectURL：这里只要字节（地址由资源库/内存缓存管）
          const blob = await fetch(frame.url).then((r) => r.blob()).catch(() => null)
          URL.revokeObjectURL(frame.url)
          return blob
        },
      })
    }),
  )// 期间用户又悬停回来播放 / 换了源 → 丢弃这次定格（不然会把旧画面挂上去）
  if (epoch !== freezeEpoch.value || videoUrl.value !== src) return
  const tiers = new Map<number, TierFrame>()
  results.forEach((frame, i) => {
    if (frame) tiers.set(wanted[i], frame)
  })
  if (tiers.size === 0) return
  releaseFrameTiers()
  frameTiers.value = tiers
  // 记下"这份是用哪套配置生成的" —— 用户改尺寸后据此判定要重做
  frozenCfgKey.value = tierCfgKey()
  tierFrame.value = null
}

/**
 * 停止播放并回到静帧。**只在真的需要时**抓帧（否则每次进出节点都白抓一次）。
 *
 * 触发点：鼠标离开节点、点画布空白、播放按钮暂停。
 */
function stopAndRestorePoster(): void {
  if (!videoRequested.value) return
  const epochAtLeave = freezeEpoch.value
  const v = videoRef.value
  if (v) {
    if (!v.paused) v.pause()
    if (Number.isFinite(v.currentTime)) resumeTime.value = v.currentTime
  }
  // 以前定格过就直接切（用户看到的就是他停在哪）；没有才现抓一帧，
  // 且**抓完再切** —— 顺序反了 video 元素已经卸载，抓不到画面。
  if (frameTiers.value.size > 0) {
    videoRequested.value = false
    endedLatch.value = false
    return
  } void freezeFrame().then(() => {
    // 定格期间用户又 hover 回来（freezeEpoch 已变）→ 不要把 videoRequested 复位，
    // 否则会把刚要求播放的 video 元素卸掉，第二轮播放就此卡死（画面停回帧图、
    // 时间不动 —— 2026-10-16 真机复现的第二轮播放卡住）
    if (epochAtLeave !== freezeEpoch.value) return
    videoRequested.value = false
    endedLatch.value = false
  })
}

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
/** 左右分开显示（参考 liblib 控件）：进度条左边已播、右边总长 */
const playedTimeLabel = computed(() => formatTime(playedInClip.value))
const totalTimeLabel = computed(() => formatTime(playableLength.value))
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
  return framingStyle(cropRect.value, videoWidth.value, videoHeight.value)
})
const isFramed = computed(() => !cropping.value && Object.keys(videoStyle.value).length > 0)

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
    await v.play().catch(() => { })
  } else {
    v.pause()
    // 单击暂停：画面**停在当前帧**（用户口径 2026-10-16：点画面=播放/暂停）。
    // 不再立刻回帧图 —— 那会让"暂停"看起来像"消失"；只有鼠标真正离开节点
    // （onCardLeave → stopAndRestorePoster）才定格回帧图。
  }
}

/**
 * 播放按钮：帧图态下**先挂上 `<video>`（这一步才真正开始加载视频字节）**，等它挂好再播。
 *
 * 这正是用户要的"只有点击播放的时候才真正加载视频"：点之前页面里没有任何视频请求，
 * 点之后才发出 —— 而不是"先加载好等着被点"。
 */
async function onPlayButton(): Promise<void> {
  if (!videoRequested.value) {
    videoRequested.value = true
    currentTime.value = clipRange.value.start
    await nextTick()
  }
  await togglePlay()
}

/**
 * 
 *  * 悬停到节点上 → 自动开始播放（用户口径：不用先点按钮）。
 *
 * 与播放按钮走同一条路（先挂 video 元素、再 play），所以"点播"与"悬停播"行为一致。
 * 已经播着就什么都不做（鼠标在卡内移动会反复触发 enter/leave，不能每次都重播）。
 */
async function onCardEnter(): Promise<void> {
  hovering.value = true
  // 作废还在进行中的定格 + 清掉挂着的帧图隐藏定时器（规则①：进来就播）
  freezeEpoch.value += 1
  if (posterHideTimer.value !== null) { window.clearTimeout(posterHideTimer.value); posterHideTimer.value = null }
  // 重新把帧图盖上（上次离开定格时它已撤掉），等这次 play 后再延迟关闭
  posterCovering.value = true
  if (cropping.value || broken.value || !videoUrl.value) return
  // 已经播着 → 只重排帧图延迟关闭，不打断播放
  if (videoRequested.value && playing.value) { schedulePosterHide(); return }
  await onPlayButton()
}

/**
 * 鼠标离开节点 → 暂停并定格成当前这一帧（用户口径：video 元素直接隐藏掉）。
 */
function onCardLeave(): void {
  hovering.value = false
  // 离开 = 唯一允许 video 消失的时机（规则③）：取消挂着的定时器、帧图顶上，
  // 由 stopAndRestorePoster 定格抓帧后撤 video
  if (posterHideTimer.value !== null) { window.clearTimeout(posterHideTimer.value); posterHideTimer.value = null }
  posterCovering.value = true
  stopAndRestorePoster()
}

/**
 * 单击画面任意处 = 播放/暂停（2026-10-16 用户口径：整块节点区域都能点，不只左下角按钮）。
 * 250ms 延迟缓冲：双击全屏会先来两次 click，等一下确认没有第二击再执行单击动作，
 * 否则双击全屏前会先误触发一次暂停。
 */
let stageClickTimer: number | null = null
function onStageClick(): void {
  if (cropping.value || broken.value || !videoUrl.value) return
  if (stageClickTimer !== null) window.clearTimeout(stageClickTimer)
  stageClickTimer = window.setTimeout(() => {
    stageClickTimer = null
    void onPlayButton()
  }, 250)
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
  if (start > 0 && v.currentTime < start) v.currentTime = start/**
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
  playing.value = !v.paused
  const { start, end } = clipRange.value
  // 播到剪辑段末尾：停了，并把画面停在结尾（不要让用户看到被剪掉的画面）。
  // endedLatch：一轮只停一次 —— seek/暂停期间 timeupdate 还会来，没有闩锁的话
  // "暂停→拉回末尾"会被重复触发，第二轮开始时进度条在段尾和当前进度之间来回跳
  if (end > start && !endedLatch.value && v.currentTime >= end) {
    endedLatch.value = true
    v.pause()
    v.currentTime = end
    currentTime.value = end
    resumeTime.value = start
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

/** 共用条回传数值版 seek（值 = 剪辑段内偏移，与 onSeek 同语义） */
function onBarSeek(offset: number): void {
  const v = activeVideo()
  if (!v || !Number.isFinite(offset)) return
  const target = clipRange.value.start + offset
  v.currentTime = Math.min(Math.max(target, 0), duration.value || target)
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
// 点画布空白退出裁剪（与图片节点一致：宿主已把"点空白"归一成内核事件，不必自己监听 document）
const paneClickSub = ctx.on(RenderEvents.PaneClick, () => {
  if (cropping.value) endOverlay(props.id)
  // 点空白 = 用户视线离开了这个节点 → 停止播放并回到帧图（同 pointerleave 的理由）
  stopAndRestorePoster()
})

// 双击画面 = 进全屏（与 v1 同手势；裁剪中不接管，免得抢了裁剪框的双击）
function onStageDblClick(e: MouseEvent): void {
  if (cropping.value) return
  e.stopPropagation()
  // 双击优先于单击：取消还没执行的单击播放/暂停
  if (stageClickTimer !== null) {
    window.clearTimeout(stageClickTimer)
    stageClickTimer = null
  }
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
  // 帧图的 objectURL 全还回去（不还就是内存泄漏，从界面上看不出来）
  frameCache.dispose()
  if (stageClickTimer !== null) window.clearTimeout(stageClickTimer)
  if (volumeCloseTimer !== null) window.clearTimeout(volumeCloseTimer)
  if (captureCloseTimer !== null) window.clearTimeout(captureCloseTimer)
  if (posterHideTimer.value !== null) window.clearTimeout(posterHideTimer.value)
  document.removeEventListener('pointerdown', onCaptureMenuOutside, true)
  releaseFrameTiers()
  paneClickSub.dispose()
  endOverlay(props.id)
})

// 视频地址一变：旧源的帧图全部作废（释放 objectURL）、回到"未播放"态
watch(videoUrl, (prev) => {
  if (prev) frameCache.clearSource(prev)
  tierFrame.value = null
  videoRequested.value = false
  resumeTime.value = 0
  releaseFrameTiers()
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
    <div v-if="videoUrl && !broken && !cropping" class="vc-scrim" :class="{ 'is-hidden': !hovering }"
      aria-hidden="true"></div>
    <div ref="stageRef" class="video-stage" :class="{ 'is-framed': isFramed, 'is-cropping': cropping }"
      @click="onStageClick" @dblclick="onStageDblClick">
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
        <img v-if="keepPosterOverVideo && posterDisplaySrc" class="video-media is-poster"
          :class="{ 'is-framed': isFramed, 'is-cropping': cropping }" :style="videoStyle" :src="posterDisplaySrc"
          alt="视频帧" draggable="false" />
        <!-- 独立 v-if：video 只看"请求播放"，与帧图在不在无关 -->
        <video v-if="!showPoster" ref="videoRef" class="video-media" :style="videoStyle" :src="videoUrl"
          playsinline preload="metadata" @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate"
          :muted="volumeEffectiveMuted" :volume="volume"
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
      :class="{ 'is-hidden': !hovering }" @dblclick.stop>
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
  background: #050505; /* 主题色白名单: 视频信箱黑边随画面内容恒定，与主题无关 */
  /* 卡片选中/拖动时不让浏览器原生手势打断 */
  user-select: none;
}

/* 帧图（未播放时的画面）：与 <video> 完全同一套几何。
   为什么用 cover 而不是 contain 一个 letterbox 里的小图：卡片尺寸本来就是按视频比例
   算出来的（videoFit），所以 cover 与 contain 结果几乎一致，而 cover 不会在 1px 边框
   造成的比例偏差下留出两条黑边（图片节点那条"横屏宽几像素/竖屏高几像素"的教训）。 */
.video-media.is-poster {
  object-fit: cover;
  /* 与 video 短暂共存时压在上面（hover 自动播放要等首帧解码完才撤帧图，防止闪黑） */
  z-index: 1;
  -webkit-user-drag: none;
}

/* 裁过的画面：由 croppedVideoStyle 给出放大比例与偏移，位置相对舞台左上角，
   框外部分被 .video-stage 的 overflow:hidden 裁掉 —— 这就是"裁剪"的视觉实现。 */
.video-stage.is-framed .video-media {
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
