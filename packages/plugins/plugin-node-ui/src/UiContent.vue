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
import { useCanvasRender, useUiComponent } from '@plume-canvas/canvas-render'
import { buildPalette, buildSrcdoc, normalizeUpstream, type PaletteToken, type UpstreamItem } from './uiData'
import { THEME_COLOR_TOKENS } from '@plume-canvas/canvas-render'
import { normalizeManualValues } from './uiValues'
import { currentCanvasId, readUiConfig, resolveBaseUrl } from './uiConfig'
import { fetchBackendOrigin } from './uiOrigin'
import { useUiFrame } from './ui-content/useUiFrame'
import { useUiProxy } from './ui-content/useUiProxy'
import { useUiOutput } from './ui-content/useUiOutput'
import { useUiBridge } from './ui-content/useUiBridge'
import { useUiDebugWindow } from './ui-content/useUiDebugWindow'
import UiDebugPrompt from './ui-content/UiDebugPrompt.vue'
import UiInteractionGate from './ui-content/UiInteractionGate.vue'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx, flow } = useCanvasRender()
/** 统一空状态（默认主题提供；极简宿主回落本组件原来的「标题 + 提示」两行） */
const NodeEmptyState = useUiComponent('nodeEmptyState')

/**
 * 本插件的配置（后台地址 / 允不允许联网）。
 *
 * 后台地址要现算成**绝对**地址：生成页面在 srcdoc 里，相对路径解析不出来。
 */
const pluginConfig = readUiConfig(ctx.tryGet('settings') as { get(k: string): unknown } | undefined)

const { iframeEl, frameStyle } = useUiFrame({ ctx, flow })

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

const { handleProxyRequest, handleDebugProxyRequest } = useUiProxy({
  baseUrl: () => baseUrl.value,
  canvasId,
  nodeId: props.id,
})

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
const { frameSeed, pushDataToFrame, onBridgeMessage } = useUiBridge({
  iframeEl,
  html,
  gen,
  upstream,
  inputValues,
  nodeData: () => props.data,
  nodeId: props.id,
  doc: () =>
    ctx.tryGet<{
      updateNode(id: string, patch: { data: Record<string, unknown> }): void
      updateNodeRuntime(id: string, patch: { data: Record<string, unknown> }): void
    }>('doc'),
  handleProxyRequest: (win, reqId, m) => void handleProxyRequest(win, reqId, m),
})

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

const {
  showDebugPrompt,
  frameDoc,
  openDebug,
  onDebugMessage,
  onDebugSdkEvent,
  acceptDebugInvite,
  dismissDebugInvite,
  dispose: disposeDebugWindow,
} = useUiDebugWindow({
  ctx,
  nodeId: props.id,
  data: props.data,
  canvasId,
  baseUrl: () => baseUrl.value,
  hasHtml: () => hasHtml.value,
  html: () => html.value,
  inputValues: () => inputValues.value,
  upstream,
  srcdoc: () => srcdoc.value,
  debugSession,
  gen,
  updateNodeForDebug: (prev, patch) => {
    ctx
      .tryGet<{ updateNode(id: string, p: { data: Record<string, unknown> }): void }>('doc')
      ?.updateNode(props.id, { data: { uiInputs: { ...prev, ...patch } } })
  },
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

const { isOwnResourceUrl, applyOutput } = useUiOutput({
  nodeId: props.id,
  canvasId,
  baseUrl: () => baseUrl.value,
  updateNodeRuntime: (id, data) => {
    ctx
      .tryGet<{ updateNodeRuntime(id: string, p: { data: Record<string, unknown> }): void }>('doc')
      ?.updateNodeRuntime(id, { data })
  },
})

if (typeof window !== 'undefined') {
  window.addEventListener('message', onDebugMessageFromWindow)
}
/** 调试页消息：来源校验在 hook 内，副作用通过参数接上 */
function onDebugMessageFromWindow(ev: MessageEvent): void {
  onDebugMessage(ev, {
    proxy: (win, reqId, m) => void handleProxyRequest(win, reqId, m),
    applyOutput,
    isOwnResourceUrl,
  })
}
/** iframe 内 SDK 的调试事件：监听保持为具名函数，卸载时必须能摘掉 */
function onDebugSdkEventMessage(ev: MessageEvent): void {
  onDebugSdkEvent(ev, iframeEl.value?.contentWindow ?? null)
}
if (typeof window !== 'undefined') {
  window.addEventListener('message', onDebugSdkEventMessage)
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

  handleDebugProxyRequest(win, m.reqId, m)
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
  window.removeEventListener('message', onDebugMessageFromWindow)
  window.removeEventListener('message', onDebugProxyMessage)
  // SDK 事件监听（connected / eval / result / error / disconnected）也要摘：
  // 它是挂在 window 上的模块级回调，节点卸载后仍会收到所有 iframe 的 message ——
  // 每开过一个可视化节点就多留一个（画布上节点一多，消息分发越来越慢）。
  window.removeEventListener('message', onDebugSdkEventMessage)
  disposeDebugWindow()
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
      <UiInteractionGate
        v-if="!interactive"
        @enter="enterInteractive"
        @debug="openDebug"
      />

      <!--
        调试确认框：Agent 发起连接后，每个打开这张画布的标签页都会看到它。
        只有一个会被点中 —— 点中的那个写凭据进调试态；其他标签页看到邀请标记
        被清掉（节点数据同步），这个框自动消失。
        样式走 ui-style-guide：浮层材质、radius-panel、主按钮青底白字。
      -->
      <UiDebugPrompt
        v-if="showDebugPrompt"
        @dismiss="dismissDebugInvite"
        @accept="acceptDebugInvite"
      />
    </template>

    <!-- 空态：只给"还没画"的节点（v-if="!hasHtml" 必须写！
         2026-10-27 用户截图：节点里已经画了「点我」，空态还盖在上面 —— 根因就是少了这条与
         iframe 分支互斥的判断。有内容时必须只画 iframe + 遮罩，空态一律不出现。 -->
    <template v-else>
    <NodeEmptyState v-if="NodeEmptyState" text="（无可视化）" :description="hint" />
    <div v-else class="ui-empty">
      <div class="ui-empty-title">可视化</div>
      <div class="ui-empty-hint">{{ hint }}</div>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* 内容铺满整张卡；卡片边框由外壳（BaseNode 的 .v2-card）画，本组件不画框 */
.ui-node {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* 不铺底色：与视频/图片节点同源，空态/未画时让壳的内容底透出来
     （--card-content-surface：亮色白 / 暗色深）。这里曾经写 --canvas-node-surface（卡片表面灰），
     于是可视化节点比其它节点灰一档（用户 2026-10-27 截图对比出来）。 */
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



</style>

