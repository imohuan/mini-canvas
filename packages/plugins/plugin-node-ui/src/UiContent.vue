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
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { buildPalette, buildSrcdoc, normalizeUpstream, toCloneableState, type PaletteToken, type UpstreamItem } from './uiData'
import { THEME_COLOR_TOKENS } from '@mini-canvas/canvas-render'
import { normalizeManualValues } from './uiValues'
import { currentCanvasId, readUiConfig, resolveBaseUrl } from './uiConfig'
import { fetchBackendOrigin } from './uiOrigin'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()

const { ctx } = useCanvasRender()

/**
 * 本插件的配置（后台地址 / 允不允许联网）。
 *
 * 后台地址要现算成**绝对**地址：生成页面在 srcdoc 里，相对路径解析不出来。
 */
const pluginConfig = readUiConfig(ctx.tryGet('settings') as { get(k: string): unknown } | undefined)

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
    const text = typeof d.text === 'string' ? d.text : undefined
    // 既没地址也没文字 = 空素材（例如还没生成的图片节点），别塞给生成物当噪音
    if (!url && !text) continue
    raw.push({
      id: n.id,
      kind: hit ? hit[1] : (n.type ?? 'other'),
      ...(typeof d.label === 'string' ? { name: d.label } : {}),
      ...(url ? { url } : {}),
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
  const m = ev.data as { __canvasUi?: unknown; type?: unknown; state?: unknown; url?: unknown; text?: unknown } | null
  if (!m || m.__canvasUi !== 1) return
  // 报到：页面已就绪 → 把存下来的状态送过去（刷新恢复）。同步返回，不走下面的 doc 写入。
  if (m.type === 'ready') {
    pushDataToFrame()
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
      doc.updateNode(props.id, { data: { uiInputs: { ...prev, ...patch } } })
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
      doc.updateNodeRuntime(props.id, { data: patch })
    }
  } catch {
    // 节点可能已被删掉：静默跳过（不该因为一次上报把页面搞崩）
  }
}

const iframeEl = ref<HTMLIFrameElement | null>(null)

// 注：这里曾有一版「反向缩放」（缩小画布时把 iframe 按屏幕像素重渲染，文字不糊）。
// 2026-10-12 用户决定删掉，理由两条，都成立：
//   1. 它不是用户想要的效果；
//   2. 用户在设置面板里拨那个开关**根本没生效**（我当时的验证是手改 settings 造的假象），
//      而实测「开着和关着画面完全一样」—— 留着就是个骗人的开关。
// 需要时从 git 历史里找回（counterScale.ts + UiContent 的对应那段）。
/** 双击进入交互态 */
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
        :srcdoc="srcdoc"
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
</style>

