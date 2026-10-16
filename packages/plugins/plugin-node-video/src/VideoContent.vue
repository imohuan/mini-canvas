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
import { videoCardSizePatch, followedVideoCardSizePatch, missingVideoCardSizePatch, type CardSizePatch } from './videoFit'

/** 正有限数才算有值（与 videoFit 内同口径） */
function positiveNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}
import { createVideoOps } from './videoOps'
import { endOverlay, isCropping } from './videoSession'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, flow, visibleNodes } = useCanvasRender()

const videoRef = ref<HTMLVideoElement | null>(null)
const fullscreenRef = ref<HTMLVideoElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const fullscreenOpen = ref(false)
const playing = ref(false)
/**
 * video 元素是否已经"真的有画面"（readyState >= HAVE_CURRENT_DATA，即当前播放位置
 * 已经解码出第一帧）。hover 自动播放时用它压住切换：帧图叠在 video 上继续显示，
 * 直到这一位翻真才撤掉 —— 否则 video 挂上到首帧解码完成之间会闪出一片黑。
 * （loadeddata 在 seek 后也会再发，任何时刻画面在，它就跟着翻真；离开时随 videoRequested 一起复位。）
 */
const videoHasFrame = ref(false)
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
const showPoster = computed(() => !videoRequested.value || (!hovering.value && frameTiers.value.size > 0))
/** 帧图要不要还叠着：video 还没画出第一帧时必须顶住，撤早了就是黑屏闪烁 */
const keepPosterOverVideo = computed(() => showPoster.value || !videoHasFrame.value)

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
  setTimeout(() => { frameGateOpen.value = true }, 2000)
})

watch(
  // ★ 尺寸/质量也要进依赖：改"最大宽高"时档位不变，只盯档位就不会重跑
  // （2026-10-15 用户实测："重新设置了最大宽高……依然使用的是之前的图片"）。
  [
    tier,
    videoUrl,
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
    if (!src || cropping.value || !showPoster.value || !frameGateOpen.value) return
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
    void frameCache
      .resolveOrCreate({
        src,
        variant,
        ...(ref ? { ref } : {}),
        ...(resources ? { resources } : {}),
        make: async () => {
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
  if (fullscreenOpen.value || !videoRequested.value) return
  const v = videoRef.value
  if (v) {
    if (!v.paused) v.pause()
    if (Number.isFinite(v.currentTime)) resumeTime.value = v.currentTime
  }
  // 以前定格过就直接切（用户看到的就是他停在哪）；没有才现抓一帧，
  // 且**抓完再切** —— 顺序反了 video 元素已经卸载，抓不到画面。
  if (frameTiers.value.size > 0) {
    videoRequested.value = false
    return
  } void freezeFrame().then(() => {
    videoRequested.value = false
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
    // 暂停即离开：把画面切回帧图（用户口径是"离开就不再显示视频元素"）
    stopAndRestorePoster()
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
    videoHasFrame.value = false
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
  // 作废还在进行中的定格（用户已经回到节点上，要的是播放）
  freezeEpoch.value += 1
  if (cropping.value || broken.value || !videoUrl.value) return
  if (videoRequested.value && playing.value) return
  await onPlayButton()
}

/**
 * 鼠标离开节点 → 暂停并定格成当前这一帧（用户口径：video 元素直接隐藏掉）。
 */
function onCardLeave(): void {
  hovering.value = false
  stopAndRestorePoster()
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

/** video 当前位置解码出第一帧了（loadeddata / seeked / loadedmetadata 就绪时都会走到） */
function onVideoHasData(): void {
  const v = videoRef.value
  if (v && v.readyState >= 2) videoHasFrame.value = true
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
  const command = ctx.get('command')
  command.execute('video.captureFrame', { nodeId: props.id, at })
}

// ==================== 全屏 ====================

/**
 * 全屏控制条：播放中默认隐藏，鼠标进底部热区才显示，离开 1 秒后收起。
 * 暂停时常显 —— 画面不动时藏起来只会让人找不到按钮。
 */
const fsControlsVisible = ref(false)
let fsHideTimer: ReturnType<typeof setTimeout> | null = null
/** 底部热区高度：够宽就不用瞄准，也不至于吃掉画面中部 */
const FS_HOTZONE = 140

const fsControlsShown = computed(() => !playing.value || fsControlsVisible.value)

function showFsControls(): void {
  if (fsHideTimer) {
    clearTimeout(fsHideTimer)
    fsHideTimer = null
  }
  fsControlsVisible.value = true
}

/** 离开热区后延时 1 秒收起（缓冲够长，鼠标从热区划到按钮上不会闪没） */
function scheduleFsHide(): void {
  if (fsHideTimer) clearTimeout(fsHideTimer)
  fsHideTimer = setTimeout(() => {
    fsHideTimer = null
    fsControlsVisible.value = false
  }, 1000)
}

function clearFsHideTimer(): void {
  if (fsHideTimer) {
    clearTimeout(fsHideTimer)
    fsHideTimer = null
  }
}

function onFsPointerMove(e: MouseEvent): void {
  if (window.innerHeight - e.clientY <= FS_HOTZONE) showFsControls()
  else scheduleFsHide()
}

function openFullscreen(): void {
  if (!videoUrl.value || fullscreenOpen.value) return
  // 全屏播放当然要真视频：先挂 `<video>`（帧图态下这一步才开始加载视频字节）
  videoRequested.value = true
  fullscreenOpen.value = true
  // 刚进来先亮一下，让人知道有控制条；播放中随后自动收起
  showFsControls()
  scheduleFsHide()
  void nextTick(() => {
    const from = videoRef.value
    const to = fullscreenRef.value
    if (!from || !to) return
    to.currentTime = from.currentTime
    if (!from.paused) void to.play().catch(() => { })
    from.pause()
  })
}

function closeFullscreen(): void {
  if (!fullscreenOpen.value) return
  clearFsHideTimer()
  fsControlsVisible.value = false
  const from = fullscreenRef.value
  const to = videoRef.value
  if (from && to) {
    to.currentTime = from.currentTime
    if (!from.paused) void to.play().catch(() => { })
  }
  from?.pause()
  fullscreenOpen.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (fullscreenOpen.value) closeFullscreen()
}// ==================== 卡片尺寸兜底 ====================

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
  window.addEventListener('keydown', onKeydown)
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
  () => props.data?.videoUrl,
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
  openFullscreen()
}

onBeforeUnmount(() => {
  tierSettingOff?.dispose()
  // 帧图的 objectURL 全还回去（不还就是内存泄漏，从界面上看不出来）
  frameCache.dispose()
  releaseFrameTiers()
  window.removeEventListener('keydown', onKeydown)
  clearFsHideTimer()
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
        <img v-if="keepPosterOverVideo && posterDisplaySrc" class="video-media is-poster"
          :class="{ 'is-framed': isFramed, 'is-cropping': cropping }" :style="videoStyle" :src="posterDisplaySrc"
          alt="视频帧" draggable="false" />
        <video v-else-if="!showPoster" ref="videoRef" class="video-media" :style="videoStyle" :src="videoUrl"
          playsinline preload="metadata" @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate"
          @play="playing = true" @pause="playing = false" @error="onVideoError"
          @loadeddata="onVideoHasData" @seeked="onVideoHasData" />

      </template>

      <div v-else-if="broken" class="video-empty is-broken">视频已失效（会话级链接刷新后不可恢复）</div>
      <div v-else class="video-empty is-void">（无视频）</div>
    </div>

    <!-- 播放控件：本地态的显隐规则是"有视频且不在裁剪中"，再叠加卡片 hover（不常驻，免得遮画面）。
         三个 VueFlow 保留类名把画布手势挡在外面：nodrag 不拖节点、nopan 不拖画布、nowheel 不缩放画布。 -->
    <div v-if="videoUrl && !broken && !cropping" class="video-controls nodrag nopan nowheel"
      :class="{ 'is-hidden': !hovering }" @dblclick.stop>
      <button class="vc-btn" type="button" :title="playing ? '暂停' : '播放'" :aria-label="playing ? '暂停' : '播放'"
        @click.stop="onPlayButton">
        <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="7,4 19,12 7,20" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      </button>

      <span class="vc-time">{{ timeLabel }}</span>

      <label class="vc-progress" title="拖动调整进度">
        <input type="range" min="0" :max="playableLength" step="0.01" :value="playedInClip" aria-label="播放进度"
          @input="onSeek" />
        <span class="vc-progress-fill" :style="{ width: progressPct + '%' }" />
      </label>

      <button class="vc-btn" type="button" title="截取当前帧" aria-label="截取当前帧" :disabled="captureBusy"
        @click.stop="onCaptureFrame">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      </button>
      <button class="vc-btn" type="button" title="全屏播放" aria-label="全屏播放" @click.stop="openFullscreen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
    </div>

  </div>

  <!-- 全屏层：刻意纯黑无装饰，Esc / 双击 / 点背景退出。 -->
  <Teleport to="body">
    <div v-if="fullscreenActive" class="video-fullscreen" @click.self="closeFullscreen" @mousemove="onFsPointerMove"
      @mouseleave="scheduleFsHide" @dblclick.self="closeFullscreen">
      <video ref="fullscreenRef" class="video-fullscreen-media" :style="videoStyle" :src="videoUrl" playsinline autoplay
        @loadedmetadata="onLoadedMetadata" @timeupdate="onTimeUpdate" @play="playing = true" @pause="playing = false" />
      <div class="video-fullscreen-controls nodrag nopan nowheel" :class="{ 'is-hidden': !fsControlsShown }" @click.stop
        @mouseenter="showFsControls">
        <button class="vc-btn is-on-dark" type="button" :title="playing ? '暂停' : '播放'"
          :aria-label="playing ? '暂停' : '播放'" @click.stop="togglePlay">
          <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="7,4 19,12 7,20" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        </button>
        <span class="vc-time is-on-dark">{{ timeLabel }}</span>
        <label class="vc-progress">
          <input type="range" min="0" :max="playableLength" step="0.01" :value="playedInClip" aria-label="播放进度"
            @input="onSeek" />
          <span class="vc-progress-fill" :style="{ width: progressPct + '%' }" />
        </label>
        <button class="vc-btn is-on-dark" type="button" title="退出全屏" aria-label="退出全屏" @click.stop="closeFullscreen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
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
  bottom: 2px;
  z-index: 9;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: opacity 0.18s ease, transform 0.18s ease;
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
  border-radius: 6px;
  background: transparent;
  /* 控件叠在视频画面上（不是面板底色），用恒浅色前景保证任何画面上都读得清 */
  color: color-mix(in srgb, var(--ui-tip-ink, #fff) 88%, transparent);
  cursor: pointer;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.18s ease;
}
.vc-btn:hover:not(:disabled) {
  color: var(--ui-tip-ink, #fff);
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
  /* 图标压在画面上，投影取恒深色档才能把图标从任何底色里分出来 */
  filter: drop-shadow(0 1px 2px var(--ui-tip, rgba(0, 0, 0, 0.65)));
}

.vc-time {
  flex: none;
  min-width: 74px;
  color: color-mix(in srgb, var(--ui-tip-ink, #fff) 92%, transparent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  text-shadow: 0 1px 2px var(--ui-tip, rgba(0, 0, 0, 0.65));
}

/* 进度条：轨道 3px + 已播填充；input 透明覆盖在上面接手势（自绘才能跟画布缩放匹配） */
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
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-tip-ink, #fff) 35%, transparent);
}
.vc-progress-fill {
  position: absolute;
  left: 0;
  top: 6px;
  height: 3px;
  border-radius: 999px;
  /* 已播填充 = 画布强调色（用户改品牌色时进度条一起变） */
  background: var(--ui-accent, #22d3ee);
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

/* —— 全屏层 —— */
.video-fullscreen {
  position: fixed;
  inset: 0;
  /* z-index 走画布层叠带变量（--layer-modal） */
  z-index: var(--layer-modal, 100000);
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000; /* 主题色白名单: 全屏播放层刻意纯黑无装饰 */
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
/* —— 全屏控制条：与卡内控制条同一套观感（无背景、贴底紧凑）。
      播放中默认藏起来，鼠标进底部热区才淡入；is-hidden 只管透明度和一点位移，
      隐藏时 pointer-events:none，免得挡住画面上的点击。 */
.video-fullscreen-controls {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  width: min(760px, calc(100vw - 64px));
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.video-fullscreen-controls.is-hidden {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
  pointer-events: none;
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
  .video-controls.is-hidden {
    transform: none;
  }
  /* 淡入淡出去掉（直接显隐），位移也去掉 —— 只留"出现/消失"这件事本身 */
  .video-fullscreen-controls {
    transition: none !important;
  }
  .video-fullscreen-controls.is-hidden {
    transform: translateX(-50%);
  }
}
</style>
