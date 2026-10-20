<script setup lang="ts">
/**
 * UiContent —— 可视化节点的内容区：把 Agent 写的 HTML 用 iframe 画出来。
 *
 * ## 为什么必须有「遮罩 + 双击进入」（2026-10-12 用户实测）
 *
 * iframe 是**独立文档**，它会把鼠标事件全吃掉（pointerdown / wheel 都不会冒泡给宿主）。
 * 于是：
 *   · 想拖节点 —— 按住卡片往里拖，pointerdown 落在 iframe 里，VueFlow 收不到 → 拖不动；
 *   · 想缩画布 —— 滚轮落在 iframe 里，滚的是生成的内容，画布纹丝不动 → 像"节点自己在滚"。
 * 两件事一个根因。
 *
 * 做法（用户提的方案）：默认盖一层**透明遮罩**，事件落在遮罩上、照常冒泡到 VueFlow，
 * 于是拖拽 / 缩放 / 点选全都正常；**双击**摘掉遮罩进入交互态，里面那个界面才吃得到点击；
 * 一旦不再聚焦（点画布别处 / 选中别的节点 / 按 Esc），遮罩自动恢复。
 *
 * ## 安全边界（这个组件唯一需要小心的地方）
 *
 * iframe 的 `sandbox="allow-scripts"` **故意不给 allow-same-origin**：
 * 少了这一条，生成物就拿到宿主页面的源，等于把 localStorage（里面是整张画布）、cookie、
 * 以及宿主的 DOM 全交出去。给了沙箱之后它是不透明源，只能画自己那一格。
 *
 * ## 数据怎么进去
 *
 * srcdoc 是一份**完整的文档文本**（见 uiData.ts 的 buildSrcdoc）：数据在文档里的小脚本里
 * 就位，生成物一执行就能读到。不用 postMessage —— 那要两边握手、还得处理「界面还没监听就发了」
 * 的时序，而这里只需要单向注一次。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasRender, type CanvasRenderContext } from '@mini-canvas/canvas-render'
import { buildPalette, buildSrcdoc, normalizeUpstream, toCloneableState, type PaletteToken, type UpstreamItem } from './uiData'
import { THEME_COLOR_TOKENS } from '@mini-canvas/canvas-render'
import { normalizeManualValues } from './uiValues'
import { currentCanvasId, readUiConfig, resolveBaseUrl } from './uiConfig'
import {
  RASTER_TIER_PREFIX,
  rasterScaleFor,
  rasterTierKeys,
  readRasterTiers,
  resolveRasterTier,
  type RasterTierConfig,
} from './rasterTier'
import { fetchBackendOrigin } from './uiOrigin'
import { buildDebugDoc } from './uiDebug'
import {
  UI_DEBUG_INVITE_KEY,
  buildSdkScriptBody,
  appendSdkScript,
  readInvite,
  readCredential,
  writeCredential,
  clearCredential,
} from './debugSession'
import { emitUiDebugEvent } from './debugEventBus'
import { createHostProxy, errText, isSavePayload, type SavePayload } from './hostFetch'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, flow } = useCanvasRender()

/**
 * 本插件的配置（后台地址 / 允不允许联网）。
 *
 * 后台地址要现算成**绝对**地址：生成页面在 srcdoc 里，相对路径解析不出来。
 */
const pluginConfig = readUiConfig(ctx.tryGet('settings') as { get(k: string): unknown } | undefined)

/**
 * 渲染清晰度：**按画布缩放自动分三档**（与图片插件 thumbTier 同一套做法）。
 *
 * 每档的阈值和倍数都在设置面板里配（「可视化节点/渲染清晰度」）：
 *   一档（缩放 >= 二档阈值） 倍数 tier1Scale，默认 1
 *   二档（三档阈值 <= 缩放 < 二档阈值） 倍数 tier2Scale，默认 2
 *   三档（缩放 < 三档阈值） 倍数 tier3Scale，默认 4
 *
 * 为什么档位是「渲染期计算」而不是写进节点：它跟着缩放走；写进节点等于每次缩放
 * 都改画布数据、还占撤销栈。
 */
const settingsSvc = ctx.tryGet<{ get(k: string): unknown; onChange?(cb: (k: string, v: unknown) => void): { dispose(): void } }>('settings')

/**
 * 每次现读一遍设置。
 *
 * readRasterTiers 要的是 **ctx 本身**（它内部自己 ctx.get('settings') 再 .get(key)）——
 * 之前我把 settings 对象包成 { get } 传进去，结果它拿不到 settings，永远读默认值，
 * 面板里改成 8 倍也不生效（用户 2026-10-17 截图实测）。
 * 这里再套一层：ctx 不完整（测试夹具）时直接回默认，不抛错。
 */
const readCfg = (): RasterTierConfig => {
  const safeCtx = typeof ctx?.get === 'function' ? ctx : ({ get: () => undefined } as never)
  return readRasterTiers(RASTER_TIER_PREFIX, safeCtx)
}
const rasterCfg = ref<RasterTierConfig>(readCfg())
const rasterSettingOff = settingsSvc?.onChange?.((key) => {
  if (!rasterTierKeys(RASTER_TIER_PREFIX).includes(key)) return
  rasterCfg.value = readCfg()
})
onBeforeUnmount(() => rasterSettingOff?.dispose())

// flow 可能缺席（极简渲染上下文 / 测试夹具）：拿不到当 1，退回一档。
const zoom = computed(() => (flow as CanvasRenderContext['flow'] | undefined)?.viewport?.value?.zoom ?? 1)
/** 画布最小缩放：作为兜底传进档位判定，保证"缩到最小"能进第三档 */
const canvasMinZoom = computed(() => settingsSvc?.get('minZoom'))
const rasterTier = computed(() => resolveRasterTier(zoom.value, rasterCfg.value, canvasMinZoom.value))

/**
 * 当前档位对应的倍数。
 *
 * 注意它**只跟缩放档位走，不跟缩放连续变化** —— 区间内缩放时倍数不变，
 * 所以画面不会一直重排、不会闪。
 */
const rasterScale = computed(() => rasterScaleFor(rasterTier.value, rasterCfg.value))

/**
 * iframe 的渲染倍数样式 —— **四个属性全部从同一个倍数 N 算出来**，不写死。
 *
 *   width/height: N × 100%
 *   transform:    scale(1 / N)
 *   zoom:         N
 *   transform-origin: top left
 *
 * 为什么这四项要一起算：盒子撑成 N 倍 → 浏览器按 N 倍像素重画；
 * zoom=N 让排版宽度回到原来的宽度（布局不变）；scale(1/N) 把屏幕尺寸缩回原来的大小。
 * 缺一项就会变形（变小 / 溢出 / 挤出屏幕），所以只能成套出现。
 *
 * ⚠️ **N 小于 1 也必须生成样式**（2026-10-17 用户报「1/2、1/4、1/8 和 1 倍都没样式」）：
 * 之前写成 `if (!(n > 1)) return undefined`，把 N ≤ 1 全跳过了 —— 缩小档（省性能）
 * 和 1 倍一样什么都不做，面板里选了也看不出变化。只有 N 恰好等于 1 才是"完全不动"。
 *
 * 缩小档的算式示例（N = 0.5）：width 50%｜zoom 0.5｜transform scale(2)
 * 盒子只有一半宽 → 按半分辨率绘制 → 再放大 2 倍回屏幕尺寸：省性能、略糊。
 */
const frameStyle = computed(() => {
  const n = rasterScale.value
  // 只有 1 倍（默认）才完全不写样式；小于 1 和大于 1 都要生成
  if (!Number.isFinite(n) || Math.abs(n - 1) < 1e-6) return undefined
  return {
    width: n * 100 + '%',
    height: n * 100 + '%',
    transform: 'scale(' + 1 / n + ')',
    zoom: String(n),
    transformOrigin: 'top left',
  }
})

/**
 * 生成页面该连的地址：**优先用节点上存的后台自报地址**。
 *
 * 为什么不是直接用配置/同源：dev 下前端在 5288、后台在 8865，同源地址不是后台；
 * 而经 vite 代理的跨源写请求会被预检拦死（实测）。生成时问过后台、把它报的地址存进了节点，
 * 这里读它即可 —— 生产（同源托管）与 dev 两条路都成立。
 */
const baseUrl = computed(() => {
  const stored = props.data?.uiBackendOrigin
  if (typeof stored === 'string' && stored) return stored.replace(/\/+$/, '')
  return discoveredOrigin.value || resolveBaseUrl(pluginConfig, typeof location !== 'undefined' ? location.href : undefined)
})

/**
 * 自己问一次后台的地址。
 *
 * 为什么需要：界面可能是 **Agent 经 MCP** 直接写进来的（那条路不经过前端，没人往节点上写
 * uiBackendOrigin）。而 dev 下前端源不是后台源，回落同源会让页面里的写接口失败。
 */
const discoveredOrigin = ref('')
void (async () => {
  const seen = props.data?.uiBackendOrigin
  if (typeof seen === 'string' && seen) return
  const cfg0 = resolveBaseUrl(pluginConfig, typeof location !== 'undefined' ? location.href : undefined)
  const got = await fetchBackendOrigin(cfg0)
  if (got) discoveredOrigin.value = got.replace(/\/+$/, '')
})()

const canvasId = currentCanvasId(typeof location !== 'undefined' ? location.href : undefined)

/**
 * 宿主代发器。
 *
 * 每次请求现建一个：后台地址是 computed（可能先空后到）、管理令牌也可能刚在设置里填上，
 * 建对象时把两者冻住就会「填了令牌还要刷新」。创建本身不花钱。
 */
function hostProxy() {
  return createHostProxy({ baseUrl: baseUrl.value, canvasId, nodeId: props.id })
}

/** 生成的 HTML（空 = 还没画，显示空态而不是一个白框） */
const html = computed(() => (typeof props.data?.uiHtml === 'string' ? (props.data.uiHtml as string) : ''))
const hasHtml = computed(() => html.value.trim().length > 0)

/** 声明的输入参数 + 手工值 */
// 参数就是键值那一份（没有单独的声明清单了，见 UI_DATA_KEYS.inputs 的说明）
const manual = computed(() => normalizeManualValues(props.data?.uiInputs))

/**
 * 上游素材：**从连线上现算**。
 *
 * ## 为什么不读节点 data 里那份（踩过的坑）
 *
 * 原来只读 `data.uiUpstream` —— 那是「前端自己调模型生成」那条路写进去的。可 Agent 是经
 * **MCP** 写的，它只写 uiHtml，不会顺手写素材；于是节点上真连着图/视频，页面里
 * `window.__CANVAS_UPSTREAM__` 却是 `[]`（2026-10-12 实测）。
 * 现在两边都认：data 里有就用它（那是生成当时的快照），否则**现算**——只要边在，素材就在。
 */
const NODE_KIND_FIELDS: Array<[string, string]> = [
  ['imageUrl', 'image'],
  ['videoUrl', 'video'],
  ['audioUrl', 'audio'],
  ['panoUrl', 'image'],
]

/**
 * 节点类型 → 媒体 kind（只有 resourceId 时靠它认类型）。
 *
 * 新节点（视频截图 / 云端生成 / 图片插件新写入）只有 resourceId，没有 imageUrl 那类地址；
 * 不按类型认就会把它们当空素材，页面里的 __CANVAS_UPSTREAM__ 少一张图。
 */
const TYPE_KINDS: Record<string, string> = { image: 'image', video: 'video', audio: 'audio' }

const upstream = computed<UpstreamItem[]>(() => {
  const stored = normalizeUpstream(props.data?.uiUpstream)
  if (stored.length > 0) return stored
  // 真实 doc 的节点一定带 id（要拿它标出这条素材来自哪个节点），
  // 所以这里把 id 也声明上；类型写窄了会在用 n.id 时被 tsc 拦住。
  const doc = ctx.tryGet<{
    getNode(id: string): { id?: string; type?: string; data?: Record<string, unknown> } | undefined
    getEdges(): Array<{ source: string; target: string }>
  }>('doc')
  if (!doc) return []
  const raw: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const e of doc.getEdges()) {
    if (e.target !== props.id || seen.has(e.source)) continue
    const n = doc.getNode(e.source)
    if (!n) continue
    seen.add(e.source)
    const d = (n.data ?? {}) as Record<string, unknown>
    const hit = NODE_KIND_FIELDS.find(([f]) => typeof d[f] === 'string' && d[f])
    const url = hit ? (d[hit[0]] as string) : undefined
    const refKind = hit ? hit[1] : (n.type && TYPE_KINDS[n.type]) || undefined
    const resourceId = typeof d.resourceId === 'string' && d.resourceId ? d.resourceId : undefined
    const text = typeof d.text === 'string' ? d.text : undefined
    // 既没地址、也没引用、也没文字 = 空素材（例如还没生成的图片节点），别塞给生成物当噪音
    if (!url && !resourceId && !text) continue
    raw.push({
      id: n.id,
      kind: refKind ?? (n.type ?? 'other'),
      ...(typeof d.label === 'string' ? { name: d.label } : {}),
      ...(url ? { url } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(text ? { value: text } : {}),
    })
  }
  return normalizeUpstream(raw)
})

/** 画布主题色板（亮/暗两套）——只提供，用不用由生成的界面自己决定 */
const palette = computed(() =>
  buildPalette(THEME_COLOR_TOKENS as readonly PaletteToken[], ctx.tryGet('settings') as { get(k: string): unknown } | undefined),
)

/** 注入给生成页面的数据 */
const inputValues = computed(() => normalizeManualValues(manual.value))

/** 深浅色：跟着画布主题走（生成物可以用它做深浅分支） */
const theme = ref<'light' | 'dark'>('light')
function syncTheme(): void {
  if (typeof document === 'undefined') return
  theme.value = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}
syncTheme()
let observer: MutationObserver | null = null
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  observer = new MutationObserver(syncTheme)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}
onBeforeUnmount(() => observer?.disconnect())

/**
 * srcdoc 的**重建触发条件**（只留"必须重建"的那几样）。
 *
 * ## 为什么要盯着这个（2026-10-13 用户实测暴露）
 *
 * 原来 srcdoc 把「上游素材 / 输入参数」也算进依赖，于是
 * 「连一根线 → srcdoc 字符串变了 → Vue 换掉 iframe 的 srcdoc 属性 → **整个文档重建**」。
 * 代价很实在：用户正在界面上输的东西**全丢**、页面脚本从头再跑（动画/轮询重来）。
 * 而上游变化**非常常见**（连线、上游重新生成都会触发）。
 *
 * 所以现在分两类：
 *   · **必须重建**：界面代码（uiHtml）、深浅色、后台地址、画布 id —— 这些要么在文档里，要么影响整页；
 *   · **不再重建**：上游素材、输入参数 → 挂载时给一份**初值**，之后变了发**消息**（见 pushDataToFrame）。
 *
 * 为什么初值还照旧注入：老界面是靠"文档里有 __CANVAS_UPSTREAM__"拿数据的，
 * 去掉它会让老界面**彻底读不到**。给初值 + 发消息，新老都活。
 */
const srcdoc = computed(() => {
  if (!hasHtml.value) return ''
  const seed = frameSeed.value
  return buildSrcdoc(html.value, seed.inputs, seed.upstream, {
    theme: theme.value,
    nodeId: props.id,
    baseUrl: baseUrl.value,
    canvasId,
    // 允许联网 = 生成的界面可以调画布接口（这个节点的价值所在）。
    // 关掉它就是「纯展示」，连不上任何地方 —— 见 uiData.buildCsp 的说明。
    allowNetwork: pluginConfig.netEnabled,
    palette: palette.value,
  })
})

/**
 * iframe 的 key：换了 HTML 要**重挂**（改 srcdoc 属性在部分浏览器里不会重跑脚本，
 * 表现就是「重新生成后界面纹丝不动」）。
 */
const gen = ref(0)
watch(html, () => { gen.value += 1 })
/**
 * 调试态切换（首次同意 / 换会话）也要**重挂**（用户口径 2026-10-16 真机复现）：
 * frameDoc 在 activeDebug 翻转时追加了 SDK 脚本，但只改 srcdoc 属性浏览器**不会重跑脚本**
 * —— 表现就是「点了同意调试，SDK 还是连不上」（真机自动化测试抓到：srcdoc 里 SDK 在、
 * session 是新的，可 iframe 里的脚本从未执行，后台 debugSse 一直没人拨）。
 * frameDoc 只在「界面重建级」的变化（html / 主题 / 调试态）时才变 —— 上游与参数走
 * postMessage 不经过它，这里重挂不会误伤用户正在输入的内容。
 */
/**
 * 文档里注入的那份「上游素材 / 输入参数」的**初值**。
 *
 * 为什么不是直接绑 upstream / inputValues：那样这两个一变，srcdoc 就变、iframe 就重挂
 * （用户正在输的东西全丢）。这里把它们**冻结在"挂载那一刻"**：
 *   · 新挂载 → 用当时的真值写进文档（老界面靠这个读数据）；
 *   · 之后变了 → 走消息（见 pushDataToFrame），文档里的初值不动。
 */
const frameSeed = ref({ inputs: inputValues.value, upstream: upstream.value })

// 重挂（换 HTML）时把初值刷成最新 —— 否则新文档里注入的还是上一次挂载时的旧数据，
// 而"数据变了"那条消息是在页面还没建好时发的，会丢。
watch(gen, () => {
  frameSeed.value = { inputs: inputValues.value, upstream: upstream.value }
})

/**
 * 把**这个节点的全部数据**发给页面（**不重挂**）。
 *
 * 发三样，都是"这个节点的 data 上、页面要读的东西"：
 *   upstream  连进来的素材
 *   inputs    节点参数
 *   state     界面自己交上来的那份（笔迹等）
 *
 * 为什么合成一条（用户 2026-10-13 定的）：这三样**根本是同一个道理** ——
 * 都是节点 data 的字段、都要送到页面里、页面拿到的动作都是"有数据了，照着重画"。
 * 以前我把 state 拆成单独一条（pushStateToFrame），害得界面要写两个监听，纯属自找麻烦。
 */
function pushDataToFrame(): void {
  const win = iframeEl.value?.contentWindow
  if (!win) return
  try {
    win.postMessage(
      {
        __canvasUiCmd: 1,
        type: 'data',
        upstream: toCloneableState(upstream.value),
        inputs: toCloneableState(inputValues.value),
      },
      '*',
    )
  } catch {
    // 文档还没建好：页面自己会发 ready 报到，那时再补一次
  }
}

// 上游素材 / 输入参数变了 → 发消息（**不碰 srcdoc**，所以页面不重启）
watch([upstream, inputValues], () => pushDataToFrame())

// ======================================================================
// 调试连接（用户 2026-10-15 定的流程：邀请 → 用户确认唯一标签页 → 注入 SDK）
// ======================================================================
//
// 状态机（全部在前端，后台只存邀请标记与记住被选中的 session）：
//   无标记 + 无凭据          → 平时，什么都不做
//   data 有邀请标记          → 每个标签页都弹确认框
//     用户点「同意」         → 本标签页写 sessionStorage 凭据 + 回执后台 + 清标记
//                              （其他标签页看到标记消失，自动收起自己的框）
//   有凭据 + 本节点          → 调试态：srcdoc 追加 SDK 脚本连后台 + 拦截刷新
//   刷新后凭据还在           → 调试态自动恢复（SDK 的指数退避重连接住断线）
//   清标记（disconnected）    → 清凭据，回到平时
//
// 为什么状态机放组件里：邀请标记在**节点 data** 上（props.data 就是它，经 SSE 同步
// 天然多标签页广播）；凭据在 **sessionStorage** 上（每标签页一份）。组件同时看得到
// 这两样，别的地方都看不到全貌。

/** 本标签页正在调试的会话号（空 = 没在调试）——与凭据同步存在 */
const debugSession = ref('')

/** 邀请标记（从节点 data 读出来；没有 = undefined） */
const pendingInvite = computed(() => readInvite(props.data))

/** sessionStorage 的安全访问：SSR / 隐私模式里可能不存在或抛错 —— 一律按「没凭据」降级 */
function safeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
  } catch {
    return undefined
  }
}

/** 读凭据的环境安全版（storage 不在 = 没凭据） */
function loadCred() {
  const st = safeStorage()
  return st ? readCredential(st) : undefined
}

/** 是否该弹确认框：有邀请、且本标签页还不是那个被选中的（凭据对不上这个邀请） */
const showDebugPrompt = computed(() => {
  const inv = pendingInvite.value
  if (!inv) return false
  const cred = loadCred()
  // 凭据就是为这次会话写的 → 我就是被选中的那个，不弹（正在调试中）
  if (cred && cred.session === inv.session && cred.nodeId === props.id && cred.canvasId === canvasId) return false
  return true
})

/** 调试态 = 本标签页持有对得上当前节点的凭据（它存在与清理由 accept / disconnect 写） */
const activeDebug = computed(() => {
  // debugSession（响应式）参与依赖：点「同意」那一刻它被置位，frameDoc 立刻重算、
  // iframe 重挂时带上 SDK。sessionStorage 本身不是响应式的，光靠它 computed 不会动。
  void debugSession.value
  const cred = loadCred()
  // 只认**当前邀请**或**后台仍记着的会话**的凭据：旧调试的残留凭据不再让组件停在调试态
  // （2026-10-17 真机抓到：connect 后节点重挂不弹确认框，就是这个旧凭据在作怪）。
  if (!cred || cred.nodeId !== props.id || cred.canvasId !== canvasId) return false
  const inv = readInvite(props.data)
  if (inv) return cred.session === inv.session
  return debugSession.value === cred.session
})

/** 用户在确认框点「同意」：写凭据 → 回执后台 → 清节点上的邀请标记 */
/**
 * 画布把视线带到本节点（选中 + 居中）。用户口径 2026-10-17：**弹确认框时**就聚焦，
 * 不要等到点「同意」—— 用户第一眼就该看到被调试的是哪个节点。
 */
function focusThisNode(): void {
  try {
    ctx.tryGet<{ set(ids: Iterable<string>): void }>('selection')?.set([props.id])
    // 用 auto-layout 的聚焦命令（等效快捷键 F）：它按节点 bounds 计算**合适的缩放**
    // （keepZoom:false），节点小就放大、超界就缩小 —— 与用户手动按 F 同一套行为。
    // 之前自拼 setCenter(…, 当前zoom) 只平移不缩放，节点小时依旧看不清（用户 2026-10-17 指出）。
    const cmd = ctx.tryGet<{ execute(id: string): unknown }>('command')
    if (cmd && typeof cmd.execute === 'function') {
      // 带动画的视口过渡（auto-layout 内部 animateViewport），约 0.8s 到位
      cmd.execute('auto-layout:focus-selected')
    } else {
      console.log('[ui-debug] command 服务不可用，cmd =', typeof cmd)
    }
  } catch (err) {
    console.log('[ui-debug] 聚焦异常:', (err as Error)?.message ?? err)
  }
}
// 邀请标记一出现就聚焦（pendingInvite 从无到有的那一次）
watch(pendingInvite, (inv, old) => {
  if (inv && !old) {
    console.log('[ui-debug] 邀请出现，聚焦节点 ' + props.id)
    focusThisNode()
  }
})

async function acceptDebugInvite(): Promise<void> {
  const inv = pendingInvite.value
  if (!inv) return
  console.log('[ui-debug] accept clicked, inv.session=' + inv.session)
  const st = safeStorage()
  if (!st) return
  writeCredential(st, {
    session: inv.session,
    nodeId: props.id,
    canvasId,
    at: Date.now(),
  })
  debugSession.value = inv.session
  emitUiDebugEvent({ nodeId: props.id, kind: 'connected' })
  console.log('[ui-debug] debugSession set to ' + debugSession.value)
  // 回执后台（失败不拦调试：后台只是记个名字，eval 找的是 hello 里报的 session）
  try {
    const res = await fetch(baseUrl.value + '/api/node-ui/debug-accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: inv.session, nodeId: props.id, canvasId }),
    })
    console.log('[ui-debug] 回执后台: status=' + res.status, 'baseUrl=' + baseUrl.value)
  } catch (err) {
    console.log('[ui-debug] 回执后台失败:', (err as Error)?.message ?? err, 'baseUrl=' + baseUrl.value)
    /* 后台不在也没关系：SDK 连不上 ws 时会自己重试 */
  }
  // 清邀请标记（节点 data 合并写空）：其他标签页看到标记消失，自动收起确认框。
  // 为什么前端清而不是后台在回执里清：回执只来自被选中的标签页，让它顺手把标记
  // 清掉，语义正好是「这个邀请已被某人认领」。writeUiHtml 在后台有写锁，安全。
  try {
    const doc = ctx.tryGet<{
      updateNodeRuntime(id: string, patch: { data: Record<string, unknown> }): void
    }>('doc')
    doc?.updateNodeRuntime(props.id, { data: { [UI_DEBUG_INVITE_KEY]: null } })
  } catch {
    /* 节点可能刚被删：无妨，凭据已写，刷新恢复逻辑靠 sessionStorage */
  }
}

/** 用户点「拒绝」：不写凭据。框的显隐跟着邀请标记走，标记在框就在（别催用户） */
function dismissDebugInvite(): void {
  /* 故意空：什么都不做，框随标记存在。用户想关掉只能让 Agent disconnect */
}

/**
 * srcdoc 在调试态追加 SDK 连接脚本（不改 buildSrcdoc —— 平时零成本）。
 * WebSocket 地址：后台地址的 http(s) 换成 ws(s)。SDK 自己带指数退避重连，
 * 所以刷新后只要凭据还在，重挂的 iframe 会自动重连，不需要宿主做任何事。
 */
const frameDoc = computed(() => {
  const base = srcdoc.value
  // 依赖 debugSession（session id 字符串）：第二次 connect/换会话时 id 必变，
  // computed 立即重算并把**新 session** 注入 SDK（真机验证 2026-10-16 抓到：
  // 依赖 activeDebug 布尔时 true→true 不触发重算，iframe 里残留旧 session，
  // SDK 轮询 404、eval 全部超时）。
  void debugSession.value
  if (!base || !activeDebug.value) return base
  const cred = readCredential(sessionStorage)
  if (!cred) {
    console.log('[ui-debug] 调试态但没有凭据，SDK 不注入')
    return base
  }
  console.log('[ui-debug] 注入 SDK: session=' + cred.session, 'baseUrl=' + baseUrl.value)
  return appendSdkScript(base, buildSdkScriptBody({
    baseUrl: baseUrl.value,
    session: cred.session,
    canvasId,
    nodeId: props.id,
  }))
})
/**
 * 调试态切换（首次同意 / 换会话）也要**重挂**（用户口径 2026-10-16 真机复现）：
 * frameDoc 在 activeDebug 翻转时追加了 SDK 脚本，但只改 srcdoc 属性浏览器**不会重跑脚本**
 * —— 表现就是「点了同意调试，SDK 还是连不上」（真机自动化测试抓到：srcdoc 里 SDK 在、
 * session 是新的，可 iframe 里的脚本从未执行，后台 debugSse 一直没人拨）。
 * frameDoc 只在「界面重建级」的变化（html / 主题 / 调试态）时才变 —— 上游与参数走
 * postMessage 不经过它，这里重挂不会误伤用户正在输入的内容。
 */
watch(frameDoc, () => { gen.value += 1 })

/**
 * 拦截刷新（调试态专用）：beforeunload 在调试会话存在时弹浏览器原生确认。
 * 为什么用原生弹窗而不是自制：刷新是浏览器动作，宿主拦不住也没资格美化它 ——
 * 原生确认是唯一可靠的「用户明确说了要刷新」凭证。
 */
function onDebugBeforeUnload(e: BeforeUnloadEvent): void {
  if (!activeDebug.value) return
  e.preventDefault()
  // Chrome 要求 returnValue 有值才弹框
  e.returnValue = ''
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', onDebugBeforeUnload)
}

// 组件卸载 = 节点删除或画布关闭：清凭据（调试会话没意义了），摘掉监听
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onDebugBeforeUnload)
  if (activeDebug.value) {
    const st = safeStorage()
    if (st) clearCredential(st)
  }
})


/**
 * 页面就绪 → 送状态（刷新恢复靠这条）。
 *
 * ⚠️ 这里**只发一次**，不再定时重发（2026-10-13 改）：
 * 原来靠 load 事件里连发四次来赌「页面已经监听了」，真机取证的结论是那四次
 * **一条都没进去**（数据在、画面空）。因为消息早于 iframe 文档建好监听就发出去了，
 * 发多少次都只是提高概率，不解决「宿主不知道页面什么时候开始听」。
 * 现在由页面自己发 type:'ready' 报到（见 uiData.buildUiBridge），宿主收到才回 ——
 * 报到发得出来，就证明它已经能收消息，重发链整条删掉。
 */
function onFrameLoad(): void {
  // 补一次最新数据：文档里注入的是"挂载那一刻"的初值，
  // 而这期间上游/状态可能已经变了（那时页面还没建好，消息发不出去）。
  // 只发这一条 —— 它把上游、参数、状态**一次全给**（见 pushDataToFrame）。
  pushDataToFrame()
}

/**
 * 交互闸门：true = 已进入交互态（遮罩撤掉，里面的界面吃得到点击）。
 *
 * 为什么默认 false：iframe 会吃掉鼠标事件，遮罩不盖住的话节点拖不动、画布也缩不了
 * （见文件头）。只有用户**明确双击**才让它接管。
 */
const interactive = ref(false)

/**
 * 收生成页面「往外报」的两件事（见 uiData.buildUiBridge 的说明）。
 *
 * 两条路各走各的，这是整个设计的要点：
 *   · **状态**（笔迹 / 参数）→ `doc.updateNode`（**进历史**）→ 撤销退的是一笔，不是一张图；
 *   · **产物**（图 / 视频 / 音频的地址）→ `doc.updateNodeRuntime`（**不进历史**）→ 下游拿到，
 *     且不会把图片字节复制进撤销栈（那会让磁盘和内存一起爆）。
 *
 * 必须校验 `ev.source`：只认本节点这个 iframe 发来的消息。
 * 不校验的话，页面里任何一段脚本都能伪造一条消息往节点里写东西。
 *
 * **ready 报到**（2026-10-13 新增）：页面脚本一跑起来就发一条，宿主这时才把状态送回去。
 * 这是刷新后恢复笔迹的关键 —— 由页面说「我已经在听了」，宿主不再猜时机（见 buildUiBridge）。
 */
function onBridgeMessage(ev: MessageEvent): void {
  const win = iframeEl.value?.contentWindow
  if (!win || ev.source !== win) return
  const m = ev.data as
    | ({
        __canvasUi?: unknown
        type?: unknown
        state?: unknown
        url?: unknown
        text?: unknown
        reqId?: unknown
        payload?: unknown
        name?: unknown
        runId?: unknown
        args?: unknown
        wait?: unknown
        subscribe?: unknown
        methods?: unknown
      } & Record<string, unknown>)
    | null
  if (!m || m.__canvasUi !== 1) return
  // 报到：页面已就绪 → 把存下来的状态送过去（刷新恢复）。同步返回，不走下面的 doc 写入。
  if (m.type === 'ready') {
    pushDataToFrame()
    return
  }
  // 代发：沙箱页不再自己请求后台，全部交给宿主（同源 + 管理令牌）。
  // reqId 原样带回，页面按它结算自己的 pending promise。
  if (m.type === 'save' || m.type === 'task' || m.type === 'task-cancel') {
    if (typeof m.reqId !== 'string' || !m.reqId) return
    void handleProxyRequest(win, m.reqId, m)
    return
  }
  const doc = ctx.tryGet<{
    updateNode(id: string, patch: { data: Record<string, unknown> }): void
    updateNodeRuntime(id: string, patch: { data: Record<string, unknown> }): void
  }>('doc')
  if (!doc) return
  try {
    if (m.type === 'state') {
      // 页面交上来的东西 = **这个节点的参数**（用户 2026-10-13 口径：state 就是参数）。
      //
      // 所以它直接并进 uiInputs（参数），**不再另开一个 uiState 字段** ——
      // 以前那个字段让"状态"和"参数"变成两套要分别解释、分别推送的东西，
      // 而它们本来就是同一个道理（都是节点 data 上、要送进页面、拿到就重绘）。
      //
      // 并进 uiInputs 也顺手解决了：新挂载时页面读 __CANVAS_INPUTS__ 就能看到自己上次交的笔迹，
      // 不用再等一条单独的"恢复"消息。
      const prev = (props.data?.uiInputs ?? {}) as Record<string, unknown>
      const patch = m.state && typeof m.state === 'object' ? (m.state as Record<string, unknown>) : { value: m.state }
      // 值没变就不写（2026-10-16 用户实测修复：页面 img.onload → publish → setInputs →
      // 写节点 → onChange 回推 → applyInputs → showResult 新时间戳 → onload → publish
      // …… 无限循环，同一张 jpg 刷出几百个请求）。逐键对比，**URL 类的值去掉
      // ?v= 版本号再比**（iframe 每次上报都会带新时间戳，裸比永远"变了"），全等就跳过。
      const stripV = (v: unknown) => (typeof v === 'string' ? v.split('?v=')[0] : v)
      const changed = Object.keys(patch).some((k) => JSON.stringify(stripV(prev[k])) !== JSON.stringify(stripV(patch[k])))
      if (changed) doc.updateNode(props.id, { data: { uiInputs: { ...prev, ...patch } } })
    } else if (m.type === 'output' && typeof m.url === 'string' && m.url) {
      // 产物不进历史：它每次都覆盖同一个槽位地址，存进撤销栈只是白占内存。
      //
      // ★ 地址必须带一个**版本号**：槽位的地址是固定的（文件也只有一个），
      //   但下游节点（图片对比 / 图片生成）拿到的是同一个 url 字符串，
      //   字符串没变它们就不会重新请求 —— 表现为「里面画了、下游还是旧图」。
      //   加 ?v= 之后：文件仍是一份，地址变了，下游自然会重新取。
      const bust = m.url.indexOf('?') >= 0 ? '&v=' : '?v='
      const versioned = m.url + bust + Date.now()
      // ★ 产物按**类型**写对应的媒体字段（2026-10-13 修正）。
      //   底栏/图片对比这些下游收上游素材时，是**按字段名**认类型的：
      //     imageUrl → 图片 / videoUrl → 视频 / audioUrl → 音频 / text → 文本
      //   以前不管什么都写 imageUrl —— 音频的 .mp3 装在 imageUrl 里，
      //   下游就把它当图片读（裂图），正是用户 Agent 复盘里踩的坑。
      //
      //   文本那一支以前**漏了**（四支只写了三支），于是界面里 `save('正文', 'note.txt')`
      //   会把正文写进 imageUrl —— 与脚本侧 ctx.save 的映射不一致（同一条规矩写两遍必漂）。
      const ext = (m.url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? '').toLowerCase()
      const field =
        ext === 'mp4' || ext === 'webm' || ext === 'mov' ? 'videoUrl'
        : ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'm4a' ? 'audioUrl'
        : ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'csv' ? 'text'
        : 'imageUrl'
      // 文本给的是**正文**（下游 data.text 的约定就是内容），媒体给的是地址。
      //
      // 文本这一支**只认正文**：拿不到正文（页面交的是 Blob/字节）就只留 uiOutputUrl，
      // 不把地址塞进 data.text —— 那是「把 URL 当文本内容」，下游会照着念一串网址，
      // 比空着更糟（空着至少下游知道没东西）。
      const patch: Record<string, unknown> = { uiOutputUrl: m.url }
      if (field === 'text') {
        if (typeof m.text === 'string') patch.text = m.text
      } else {
        patch[field] = versioned
      }
      // 地址与节点现值"去版本号后"相同 ⇒ 只是同一份产物又一次上报（循环末梢），
      // 不写节点 —— 写了就会触发 onChange 再推回页面，形成刷新风暴
      // （2026-10-16 用户实测：一张 jpg 刷出几百个请求）。
      const cur = (props.data?.[field] as string | undefined) ?? ''
      if (field !== 'text' && cur.split('?')[0] === m.url.split('?')[0]) return
      doc.updateNodeRuntime(props.id, { data: patch })
    }
  } catch {
    // 节点可能已被删掉：静默跳过（不该因为一次上报把页面搞崩）
  }
}

/** 给沙箱页回一条代发结果（reqId 必须原样带回） */
function replyProxy(win: Window, msg: Record<string, unknown>): void {
  try {
    win.postMessage({ __canvasUi: 1, ...msg }, '*')
  } catch {
    /* iframe 可能已经重挂：这条回包没人收了 */
  }
}

/**
 * 处理一条代发请求：save / task / task-cancel。
 *
 * 所有错误都变成 `ok:false + error` 回给页面，让它自己的 promise 能 reject；
 * 403 的原文照实带回去（用户填错令牌时能看到后台到底说了什么）。
 */
async function handleProxyRequest(win: Window, reqId: string, m: Record<string, unknown>): Promise<void> {
  const proxy = hostProxy()
  // save 的失败也必须回 save-result：页面侧按类型读 url，混成 task-result 会让协议表失真
  // （虽然两边都靠 reqId 结算，功能暂时不坏，但下一个人会照着协议写错）。
  const failType = m.type === 'save' ? 'save-result' : 'task-result'
  try {
    if (m.type === 'save') {
      const payload = m.payload
      if (!isSavePayload(payload)) {
        throw new Error('save 的 payload 必须是 Blob / Uint8Array / ArrayBuffer')
      }
      const { url } = await proxy.save(payload as SavePayload, typeof m.name === 'string' ? m.name : 'out.png')
      replyProxy(win, { type: 'save-result', reqId, ok: true, url })
      return
    }
    if (m.type === 'task') {
      const subscribe = m.subscribe === true
      const result = await proxy.task(
        {
          name: String(m.name ?? ''),
          methods: String(m.methods ?? ''),
          args: Array.isArray(m.args) ? m.args : [],
          wait: m.wait === true,
          events: subscribe,
        },
        (event) => replyProxy(win, { type: 'task-event', reqId, event }),
      )
      replyProxy(win, { type: 'task-result', reqId, ...result })
      return
    }
    const runId = typeof m.runId === 'string' ? m.runId : ''
    if (!runId) throw new Error('缺少 runId')
    const result = await proxy.cancel(runId)
    replyProxy(win, { type: 'task-result', reqId, ...result })
  } catch (err) {
    replyProxy(win, { type: failType, reqId, ok: false, error: errText(err) })
  }
}

const iframeEl = ref<HTMLIFrameElement | null>(null)

// 注：这里曾有一版「反向缩放」（缩小画布时把 iframe 按屏幕像素重渲染，文字不糊）。
// 2026-10-12 用户决定删掉，理由两条，都成立：
//   1. 它不是用户想要的效果；
//   2. 用户在设置面板里拨那个开关**根本没生效**（我当时的验证是手改 settings 造的假象），
//      而实测「开着和关着画面完全一样」—— 留着就是个骗人的开关。
// 需要时从 git 历史里找回（counterScale.ts + UiContent 的对应那段）。
// 调试窗口用到的窗口形状。**不能写 Window**：与 DOM lib 的 Window 接口撞名，
// 会把 addEventListener / postMessage 的签名搅乱（实测 typecheck 报
// 「EventListener 只接受 1 个参数」）。所以这里只声明本文件真用到的那几个方法。
interface DebugWindow {
  document: { open(): void; write(s: string): void; close(): void; title: string }
  postMessage(msg: unknown, target: string): void
  addEventListener(t: string, fn: () => void): void
  close(): void
}

/** 当前开着的调试窗口（空 = 没开） */
const debugWin = ref<DebugWindow | null>(null)

/**
 * 打开**调试窗口**：把这份界面复制进一个普通窗口，让它能被调试。
 *
 * ## 为什么不是「直接调试画布上那个 iframe」
 *
 * 那个 iframe 故意**不给** allow-same-origin（沙箱是唯一的安全边界，见文件头），
 * 于是父页面读不到它、DevTools 也点不进去 —— 这是**设计使然**，不是 bug。
 * 所以调试走「另开一份副本」：副本是同源的普通页面，
 * 控制台 / 断点 / 单步 / 读变量全都回来；而画布上那个节点一行代码都不改。
 *
 * ## 副本与节点的关系
 *
 * 副本是**另一份运行实例**，不是节点那个 iframe 的镜子。所以：
 *   · 在副本里点的效果不会自动出现在画布上（要写回得走下面的桥）；
 *   · 副本里报上来的「产物」由宿主落进节点（与沙箱那条链同一条），
 *     于是「在副本里调 CanvasUI.save，画布上那个节点真的出图」成立。
 *
 * ## 为什么用 window.open 而不是新开一个同源 iframe
 *
 * 同源 iframe 也能读，但它仍然**长在画布页面里** —— 层级、事件、遮挡全是问题，
 * 而且 DevTools 的 Sources 面板里它是折叠的一帧，打断点远不如独立窗口顺手。
 * 独立窗口就是「正常写 UI」时那个调试环境，用户的学习成本为零。
 */
function openDebug(): void {
  if (!hasHtml.value) return
  const win = window.open('', 'mc-ui-debug-' + props.id, 'width=960,height=720') as unknown as DebugWindow | null
  if (!win) {
    // 被浏览器拦了（弹窗拦截）：说清楚该怎么办，别让用户以为按钮坏了
    window.alert('调试窗口被浏览器拦住了。请允许这个站点弹窗，然后再点一次「调试」。')
    return
  }
  const doc = buildDebugDoc({
    html: html.value,
    nodeId: props.id,
    canvasId,
    baseUrl: baseUrl.value,
    theme: theme.value,
    upstream: upstream.value,
    inputs: inputValues.value,
    palette: palette.value,
  })

  win.document.open()
  win.document.write(doc)
  win.document.close()
  // 标题写清楚「这是副本 + 是哪个节点」：调试时一眼知道自己改的不是画布上那个
  win.document.title = '调试 · 可视化节点 ' + props.id + '（副本，不影响画布）'

  // 记住这个窗口：它报上来的「产物 / 参数」由本组件落进节点
  debugWin.value = win
  win.addEventListener('pagehide', () => {
    if (debugWin.value === win) debugWin.value = null
  })
}

/**
 * 收调试副本「往外报」的两件事（参数 / 产物）。
 *
 * 为什么必须校验 ev.source：消息是广播的，不认来源的话页面里任何一段脚本
 * 都能伪造一条消息往节点里写东西（与沙箱那条链同一套理由）。
 */
function onDebugMessage(ev: MessageEvent): void {
  const win = debugWin.value
  if (!win || ev.source !== win) return
  const m = ev.data as
    | ({
        __canvasUiDebug?: unknown
        type?: unknown
        reqId?: unknown
        payload?: unknown
        bytes?: unknown
        name?: unknown
        text?: unknown
        args?: unknown
        methods?: unknown
        wait?: unknown
        subscribe?: unknown
        runId?: unknown
      } & Record<string, unknown>)
    | null
  if (!m || m.__canvasUiDebug !== 1) return
  try {
    // 副本是同源普通页面，直接调宿主代发器（不再自己拼 URL / 不再裸 fetch）。
    // 这里回包带 reqId：副本的 save 现在按 reqId 结算。
    if (m.type === 'save' && typeof m.reqId === 'string') {
      const payload = m.payload
      if (!isSavePayload(payload)) {
        replyDebug(win, { __canvasUiDebugResult: 1, reqId: m.reqId, ok: false, error: '副本没有交出字节' })
        return
      }
      const name = typeof m.name === 'string' ? m.name : 'out.png'
      const text = typeof m.text === 'string' ? m.text : undefined
      void hostProxy()
        .save(payload as SavePayload, name)
        .then(({ url }) => {
          applyOutput(url, name, text)
          replyDebug(win, { __canvasUiDebugResult: 1, reqId: m.reqId, ok: true, url })
        })
        .catch((err) =>
          replyDebug(win, { __canvasUiDebugResult: 1, reqId: m.reqId, ok: false, error: errText(err) }),
        )
      return
    }
    // 副本的 task / cancel 也交给宿主：统一令牌、统一错误话术。
    if ((m.type === 'task' || m.type === 'task-cancel') && typeof m.reqId === 'string') {
      const reqId = m.reqId
      const finish = (msg: Record<string, unknown>): void =>
        replyDebug(win, { __canvasUiDebugResult: 1, reqId, ...msg })
      if (m.type === 'task-cancel') {
        const runId = typeof m.runId === 'string' ? m.runId : ''
        void hostProxy()
          .cancel(runId)
          .then((r) => finish(r))
          .catch((err) => finish({ ok: false, error: errText(err) }))
        return
      }
      void hostProxy()
        .task(
          {
            name: String(m.name ?? ''),
            methods: String(m.methods ?? ''),
            args: Array.isArray(m.args) ? m.args : [],
            wait: m.wait === true,
            events: m.subscribe === true,
          },
          (event) => replyDebug(win, { __canvasUiDebugResult: 1, type: 'task-event', reqId, event }),
        )
        .then((r) => finish(r))
        .catch((err) => finish({ ok: false, error: errText(err) }))
      return
    }
    if (m.type === 'state') {
      // 与沙箱那条链同一套口径：界面交上来的就是**这个节点的参数**
      const st = ev.data as { state?: unknown }
      const patch = st.state && typeof st.state === 'object' ? (st.state as Record<string, unknown>) : { value: st.state }
      const prev = (props.data?.uiInputs ?? {}) as Record<string, unknown>
      ctx
        .tryGet<{ updateNode(id: string, p: { data: Record<string, unknown> }): void }>('doc')
        ?.updateNode(props.id, { data: { uiInputs: { ...prev, ...patch } } })
    }
  } catch {
    // 节点可能已被删掉：静默跳过（不该因为一次上报把调试搞崩）
  }
}

/** 给副本回一句「产物我收了 / 没收」 */
function replyDebug(win: DebugWindow, msg: unknown): void {
  try {
    win.postMessage(msg, '*')
  } catch {
    /* 窗口可能已经关了 */
  }
}

/** 按产物名字认类型，写进节点（产物不进历史，且带版本号让下游重新取） */
function applyOutput(url: string, name: string, text?: string): string {
  const ext = (name.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? '').toLowerCase()
  const field =
    ext === 'mp4' || ext === 'webm' || ext === 'mov' ? 'videoUrl'
    : ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'm4a' ? 'audioUrl'
    : ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'csv' ? 'text'
    : 'imageUrl'
  const bust = url.indexOf('?') >= 0 ? '&v=' : '?v='
  const patch: Record<string, unknown> = { uiOutputUrl: url }
  if (field === 'text') {
    if (text !== undefined) patch.text = text
  } else {
    patch[field] = url + bust + Date.now()
  }
  ctx
    .tryGet<{ updateNodeRuntime(id: string, p: { data: Record<string, unknown> }): void }>('doc')
    ?.updateNodeRuntime(props.id, { data: patch })
  return url
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', onDebugMessage)
}

/**
 * iframe 内 SDK 的调试动作上报（__uiDebugEvt）→ 调试事件总线。
 * 标题右侧的「调试」标签（DebugBadge）据此实时反映：收到指令 / 已执行 / 出错。
 * （用户口径 2026-10-16：否则用户根本不知道调试通道有没有在工作。）
 */
function onDebugSdkEvent(ev: MessageEvent): void {
  // 只认本节点这个 iframe：__uiDebugEvt 会清凭据、摘刷新拦截，不能听别人的。
  const win = iframeEl.value?.contentWindow
  if (!win || ev.source !== win) return
  const m = ev.data as { __uiDebugEvt?: { kind?: unknown; detail?: unknown } } | null
  if (!m || !m.__uiDebugEvt || typeof m.__uiDebugEvt.kind !== 'string') return
  // disconnected：SDK 收到后台 stop。清凭据 + 摘刷新拦截（用户口径 2026-10-17：
  // 「断开链接的时候，把你的调试关闭掉，还有把你的拦截也关闭掉」）。
  if (m.__uiDebugEvt.kind === 'disconnected') {
    console.log('[ui-debug] 后台断开：清凭据 + 摘刷新拦截')
    const st2 = safeStorage()
    if (st2) clearCredential(st2)
    debugSession.value = ''
    emitUiDebugEvent({ nodeId: props.id, kind: 'disconnected' })
    return
  }
  emitUiDebugEvent({
    nodeId: props.id,
    kind: m.__uiDebugEvt.kind as 'eval' | 'result' | 'error' | 'disconnected',
    ...(typeof m.__uiDebugEvt.detail === 'string' ? { detail: m.__uiDebugEvt.detail } : {}),
  })
}
if (typeof window !== 'undefined') {
  window.addEventListener('message', onDebugSdkEvent)
}

/**
 * 调试 SDK 的代发请求（__uiDebugCmd）。
 *
 * SDK 住在沙箱 iframe 里，自己发请求就是 `Origin: null`，还会把管理令牌暴露给生成物。
 * 所以上行回包、下行轮询都交给宿主；回包按 reqId 对上，body 原样交回 SDK。
 *
 * 来源校验是硬要求：只认**本节点这个 iframe**，别的窗口伪造一条就能冒充调试回包。
 */
function onDebugProxyMessage(ev: MessageEvent): void {
  const win = iframeEl.value?.contentWindow
  if (!win || ev.source !== win) return
  const m = ev.data as { __uiDebugCmd?: unknown; kind?: unknown; reqId?: unknown; session?: unknown; body?: unknown } | null
  if (!m || m.__uiDebugCmd !== 1 || typeof m.reqId !== 'string' || !m.reqId) return

  const reply = (msg: Record<string, unknown>): void => {
    try {
      win.postMessage({ __uiDebugReply: 1, reqId: m.reqId, ...msg }, '*')
    } catch {
      /* iframe 已重挂 */
    }
  }

  const proxy = hostProxy()
  if (m.kind === 'poll') {
    const session = typeof m.session === 'string' ? m.session : ''
    void proxy
      .debugPoll(session)
      .then((body) => reply({ ok: true, body }))
      .catch((err) => reply({ ok: false, error: errText(err) }))
    return
  }
  if (m.kind === 'result') {
    void proxy
      .debugResult(m.body)
      .then((body) => reply({ ok: true, body }))
      .catch((err) => reply({ ok: false, error: errText(err) }))
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('message', onDebugProxyMessage)
}

function enterInteractive(): void {
  if (!hasHtml.value) return
  interactive.value = true
}

/** 退出交互态（遮罩回来，节点恢复可拖） */
function exitInteractive(): void {
  interactive.value = false
}

/**
 * 什么时候自动退出交互态。
 *
 * 用户口径：「当我在操作画布、相当于这个页面失去聚焦的时候，就恢复这个遮罩」。
 * 落到实现上有三件事，都得管 —— 只做其中一件都会留下"点不回去"的死角：
 *   ① 点画布别处（pointerdown 落在本组件之外）→ 不再聚焦；
 *   ② 选中态变了（点选别的节点 / 点空白清空选择）→ 这个节点不再是"当前"；
 *   ③ 按 Esc → 明确的退出意图。
 */
const rootEl = ref<HTMLElement | null>(null)

/** ① 全局 pointerdown：点在组件之外就退出 */
function onGlobalPointerDown(e: PointerEvent): void {
  if (!interactive.value) return
  const el = rootEl.value
  if (el && e.target instanceof Node && el.contains(e.target)) return
  exitInteractive()
}

/** ③ Esc：明确退出 */
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && interactive.value) exitInteractive()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', onGlobalPointerDown, true)
  window.addEventListener('keydown', onKeyDown, true)
  // 生成页面「往外报」的消息（状态 / 产物）从这里进来
  window.addEventListener('message', onBridgeMessage)
}

/** ② 选中态变化：本节点不再被选中就退出 */
const selection = ctx.tryGet<{ ids?: Iterable<string>; onChange?(cb: () => void): () => void }>('selection')
const isSelected = ref(false)
function syncSelected(): void {
  const ids = selection?.ids ? [...selection.ids] : []
  const now = ids.includes(props.id)
  // 从选中变成没选中 → 退出交互态（用户去点别的地方了）
  if (isSelected.value && !now) exitInteractive()
  isSelected.value = now
}
syncSelected()
let selectionOff: (() => void) | null = null
if (selection?.onChange) selectionOff = selection.onChange(syncSelected)

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointerdown', onGlobalPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('message', onBridgeMessage)
  }
  selectionOff?.()
})

// 节点被卸载：把开着的调试窗口也关掉。
// 不关的话它成了孤儿 —— 界面还在跑、还在往一个已消失的节点报产物，
// 而用户看着那个窗口会以为画布上还有个节点在（2026-10-15）。
onBeforeUnmount(() => {
  window.removeEventListener('message', onDebugMessage)
  window.removeEventListener('message', onDebugProxyMessage)
  debugWin.value?.close()
  debugWin.value = null
})


/** 空态提示：只说一件事 —— 让 Agent 来画 */
const hint = computed(() => {
  if (!ctx.tryGet('doc')) return '画布尚未就绪'
  return '让 Agent 帮你画（在对话里说明要画什么）'
})
</script>

<template>
  <div ref="rootEl" class="ui-node" :class="{ 'is-interactive': interactive }">
    <template v-if="hasHtml">
      <!-- 沙箱 iframe（不授予同源权限，见文件头） -->
      <iframe
        ref="iframeEl"
        :key="gen"
        class="ui-frame"
        :style="frameStyle"
        :srcdoc="frameDoc"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        loading="lazy"
        :title="'可视化节点 ' + props.id"
        @load="onFrameLoad"
      />
      <!--
        交互遮罩：平时盖在 iframe 上，把鼠标事件让回画布。
        双击摘掉它，里面的界面才开始吃点击；失去聚焦时自动盖回来。

        ⚠️ **不要**给这一层加 nodrag / nopan —— 那两个类的意思正好是"这一层不参与拖拽/平移"，
        而遮罩盖满整张卡，等于把整个节点的拖拽彻底禁掉（2026-10-12 用户实测「依然无法拖拽」的根因）。
        它必须是**普通的一层**：pointerdown 落上去后正常冒泡，VueFlow 才知道用户要拖这个节点。
      -->
      <div
        v-if="!interactive"
        class="ui-gate"
        title="双击进入交互（点击界面里的按钮等）"
        @dblclick.stop="enterInteractive"
      >
        <span class="ui-gate-badge">双击交互</span>
        <!--
          调试入口：把这份界面复制进一个**普通窗口**（同源），
          于是 DevTools 能点进去、能读变量、能打断点。

          ⚠️ 它**不碰**画布上那个沙箱 iframe —— 沙箱边界原样不动
          原样不动。副本点坏了大不了重开，节点上那份不受影响。
          2026-10-15 用户报「无法操作、无法调试」，根因就是沙箱本身（见 uiDebug.ts 文件头）。
        -->
        <button
          type="button"
          class="ui-gate-debug"
          title="在新窗口里调试这份界面（可读变量 / 打断点）"
          @mousedown.stop
          @dblclick.stop
          @click.stop="openDebug"
        >
          调试
        </button>

      </div>

      <!--
        调试确认框：Agent 发起连接后，每个打开这张画布的标签页都会看到它。
        只有一个会被点中 —— 点中的那个写凭据进调试态；其他标签页看到邀请标记
        被清掉（节点数据同步），这个框自动消失。
        样式走 ui-style-guide：浮层材质、radius-panel、主按钮青底白字。
      -->
      <div v-if="showDebugPrompt" class="debug-prompt" role="dialog" aria-modal="true" aria-label="调试连接确认">
        <div class="debug-prompt-card">
          <div class="debug-prompt-title">调试连接请求</div>
          <p class="debug-prompt-text">
            Agent 想连接这个节点的界面进行调试。本画布开了多个标签页，
            请只在<strong>你想用来调试的这个标签页</strong>点同意。同意后：
            该节点会与后台建立调试连接，并阻止意外刷新（刷新前会再确认）。
          </p>
          <div class="debug-prompt-actions">
            <button type="button" class="debug-btn-ghost" @click.stop="dismissDebugInvite">先不连</button>
            <button type="button" class="debug-btn-primary" @click.stop="acceptDebugInvite">同意调试</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 空态：还没画 -->
    <div v-else class="ui-empty">
      <div class="ui-empty-title">可视化</div>
      <div class="ui-empty-hint">{{ hint }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 内容铺满整张卡；卡片边框由外壳（BaseNode 的 .v2-card）画，本组件不画框 */
.ui-node {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--canvas-node-surface, #fff);
}
.ui-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  /*
   * 清晰度倍数（1/2/4/8）由**内联 style** 给：盒子放大 N 倍 + scale(1/N) + zoom N。
   * 见上方 frameStyle 与插件配置「渲染清晰度倍数」。
   *
   * 这里只留 1 倍时的兜底尺寸。注意它**只由配置决定、与画布缩放无关**：
   * 缩放过程中这个 iframe 一个像素都不会变，不会闪。
   */
}

/* 交互遮罩：透明、盖满，负责"把事件让回画布" */
.ui-gate {
  position: absolute;
  inset: 0;
  z-index: 2;
  /* 透明但要"摸得到"：pointer-events 必须是 auto，否则事件又落回 iframe 了 */
  background: transparent;
  cursor: default;
}
/* 提示角标：只在鼠标停到节点上时淡淡地露一下，不打扰看内容 */
.ui-gate-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--fill-subtle, rgba(0, 0, 0, 0.04));
  color: var(--text-faint, #9ca3af);
  font-size: 11px;
  line-height: 18px;
  opacity: 0;
  transition: opacity 160ms ease;
  pointer-events: none;
}
.ui-gate:hover .ui-gate-badge {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .ui-gate-badge {
    transition: none;
  }
}

/* 交互态：给一圈内描边，让用户知道"现在点进去的是里面那个界面" */
.ui-node.is-interactive {
  box-shadow: inset 0 0 0 2px var(--ui-accent, #0891b2);
}

.ui-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  text-align: center;
}
.ui-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--canvas-node-text-title, #6b7280);
}
.ui-empty-hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--canvas-node-text-faint, #9ca3af);
}

/*
 * 调试按钮：开一份同源副本，让这份界面能被 DevTools 调试。
 *
 * 为什么放在遮罩层上、且只 hover 才露出来：遮罩平时是透明的（要把事件让回画布），
 * 常驻一个按钮会挡视线；而「调试」是个低频动作，藏起来不影响日常使用。
 *
 * 为什么用 <button> 而不是 <span>：键盘要能 Tab 到它、回车要能触发
 * （a11y 硬性规则，见 docs/design/ui-style-guide.md）。
 */
.ui-gate-debug {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 10px;
  border: 0;
  border-radius: 999px;
  background: var(--fill-subtle, rgba(0, 0, 0, 0.04));
  color: var(--text-faint, #9ca3af);
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 160ms ease;
}

/* ==================== 调试确认框（ui-style-guide：浮层材质 + 主按钮唯一实心）==================== */
.debug-prompt {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ui-overlay-scrim, rgba(0, 0, 0, 0.32));
  border-radius: inherit;
}
.debug-prompt-card {
  width: calc(100% - 32px);
  max-width: 340px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--line-hair, rgba(0, 0, 0, 0.08));
  background: var(--ui-surface-glass, rgba(255, 255, 255, 0.92));
  backdrop-filter: blur(20px);
  box-shadow: var(--ui-shadow-panel, 0 20px 40px rgba(0, 0, 0, 0.08));
}
.debug-prompt-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-strong, #111827);
  margin-bottom: 8px;
}
.debug-prompt-text {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-body, #374151);
}
.debug-prompt-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.debug-btn-ghost {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--line-hair, rgba(0, 0, 0, 0.08));
  background: transparent;
  color: var(--text-muted, #6b7280);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.debug-btn-ghost:hover {
  background: var(--fill-hover, rgba(0, 0, 0, 0.05));
}
.debug-btn-primary {
  padding: 6px 14px;
  border-radius: 8px;
  border: 0;
  background: var(--ui-accent, #0891b2);
  color: var(--ui-accent-contrast, #fff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.debug-btn-primary:hover {
  background: var(--ui-accent-hover, #0e7490);
}
@media (prefers-reduced-motion: reduce) {
  .debug-prompt-card {
    transition: none;
  }
}
.ui-gate:hover .ui-gate-debug,
.ui-gate-debug:focus-visible {
  opacity: 1;
}
.ui-gate-debug:hover {
  color: var(--text-muted, #6b7280);
}
@media (prefers-reduced-motion: reduce) {
  .ui-gate-debug {
    transition: none;
  }
}


</style>

