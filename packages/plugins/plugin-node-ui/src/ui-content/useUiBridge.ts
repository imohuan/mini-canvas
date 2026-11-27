import { ref, watch, type Ref } from 'vue'
import type { UiPalette, UpstreamItem } from '../uiData'
import { outputTypeForName, toCloneableState } from '../uiData'
import type { UiOutputField } from './useUiOutput'
import { outputFieldForName, resourceRefFromUiUrl } from './useUiOutput'

export interface UseUiBridgeOptions {
  iframeEl: Ref<HTMLIFrameElement | null>
  html: Ref<string>
  /** iframe 重挂序号 */
  gen: Ref<number>
  upstream: Ref<UpstreamItem[]>
  inputValues: Ref<Record<string, unknown>>
  /** 当前深浅色（只在**消息**里送，不进 srcdoc —— 否则切主题会重建整个文档） */
  theme: Ref<'light' | 'dark'>
  /** 画布色板（亮/暗两套）；用来算滚动条那两格颜色 */
  palette: Ref<UiPalette>
  nodeData: () => Record<string, unknown>
  nodeId: string
  doc: () => {
    updateNode(id: string, patch: { data: Record<string, unknown> }): void
    updateNodeRuntime(id: string, patch: { data: Record<string, unknown> }): void
  } | undefined
  handleProxyRequest: (win: Window, reqId: string, m: Record<string, unknown>) => void
}

interface CanvasUiMessage extends Record<string, unknown> {
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
  value?: unknown
}

/** 页面交上来的参数去版本号再比（与原 UiContent 的防循环逻辑一致） */
function stripVersion(v: unknown): unknown {
  return typeof v === 'string' ? v.split('?v=')[0] : v
}

/**
 * 生成页面桥接：初值冻结、ready 回包、状态 / 产物写入。
 *
 * 原样搬出 UiContent.vue；消息来源与 origin 校验、写入字段映射均未改。
 */
export function useUiBridge(options: UseUiBridgeOptions) {
  const frameSeed = ref({ inputs: options.inputValues.value, upstream: options.upstream.value })
  /**
   * 挂载时的主题 / 色板快照。
   *
   * 为什么要快照：srcdoc 里注入的是"这份文档出生时"的主题。如果读实时值，
   * 主题一变 srcdoc 就变 → 文档重建（就是用户报的那个 bug）。快照 + 消息，两头都稳。
   */
  const themeSeed = ref<'light' | 'dark'>(options.theme.value)
  const paletteSeed = ref<UiPalette>(options.palette.value)

  // 重挂（换 HTML）时把初值刷成最新 —— 否则新文档里注入的还是上一次挂载时的旧数据，
  // 而"数据变了"那条消息是在页面还没建好时发的，会丢。
  watch(options.gen, () => {
    frameSeed.value = { inputs: options.inputValues.value, upstream: options.upstream.value }
    // 重挂出来的新文档，出生主题要跟着当时的主题走（否则换主题后一改 HTML 就回旧色）
    themeSeed.value = options.theme.value
    paletteSeed.value = options.palette.value
  })

  /** 滚动条那两格颜色（跟着主题走；壳里的 CSS 用 var() 读它们） */
  function scrollColorsOf(
    palette: UiPalette,
    theme: 'light' | 'dark',
  ): { thumb: string; hover: string } | undefined {
    const one = palette?.[theme] as Record<string, string> | undefined
    const thumb = one?.scrollThumb
    if (!thumb) return undefined
    return { thumb, hover: one?.scrollThumbHover || thumb }
  }

  /** 把**这个节点的全部数据**发给页面（**不重挂**）。 */
  function pushDataToFrame(): void {
    const win = options.iframeEl.value?.contentWindow
    if (!win) return
    const scroll = scrollColorsOf(options.palette.value, options.theme.value)
    try {
      win.postMessage(
        {
          __canvasUiCmd: 1,
          type: 'data',
          upstream: toCloneableState(options.upstream.value),
          inputs: toCloneableState(options.inputValues.value),
          /*
           * 主题跟着这条消息走（2026-11-27 用户实测：切主题色整个节点被重载）。
           * 页面收到它会改两处：__CANVAS_UI__.theme 与 <html data-theme>。
           * 于是"读全局变量"和"写 CSS 属性选择器"两种老写法都继续有效。
           */
          ui: { theme: options.theme.value },
          ...(scroll ? { scrollThumb: scroll.thumb, scrollThumbHover: scroll.hover } : {}),
        },
        '*',
      )
    } catch {
      // 文档还没建好：页面自己会发 ready 报到，那时再补一次
    }
  }

  /*
   * 上游素材 / 输入参数 / 深浅色 / 色板变了 → 发消息（**不碰 srcdoc**，所以页面不重启）。
   *
   * 色板也要盯着（2026-11-27）：用户改"主题色"时，亮/暗之外还有强调色等一整套值会变，
   * 滚动条那两格颜色就是从这里算的。它同样不该触发文档重建。
   */
  watch([options.upstream, options.inputValues, options.theme, options.palette], () => pushDataToFrame())

  /**
   * 收生成页面「往外报」的两件事。
   *
   * 必须校验 `ev.source`：只认本节点这个 iframe 发来的消息。
   * 还要看 origin：沙箱 iframe 是不透明源（'null'）；同源导航页面不能冒充。
   */
  function onBridgeMessage(ev: MessageEvent): void {
    const win = options.iframeEl.value?.contentWindow
    if (!win || ev.source !== win) return
    if (ev.origin && ev.origin !== 'null' && ev.origin === window.location.origin) return
    const m = ev.data as CanvasUiMessage | null
    if (!m || m.__canvasUi !== 1) return
    // 报到：页面已就绪 → 把存下来的状态送过去（刷新恢复）。同步返回，不走下面的 doc 写入。
    if (m.type === 'ready') {
      pushDataToFrame()
      return
    }
    // 代发：沙箱页不再自己请求后台，全部交给宿主（同源 + 管理令牌）。
    // reqId 原样带回，页面按它结算自己的 pending promise。
    if (m.type === 'save' || m.type === 'task' || m.type === 'task-cancel' || m.type === 'api') {
      if (typeof m.reqId !== 'string' || !m.reqId) return
      options.handleProxyRequest(win, m.reqId, m)
      return
    }
    const doc = options.doc()
    if (!doc) return
    try {
      if (m.type === 'state') {
        const data = options.nodeData()
        const prev = (data?.uiInputs ?? {}) as Record<string, unknown>
        const patch = m.state && typeof m.state === 'object' ? (m.state as Record<string, unknown>) : { value: m.state }
        const changed = Object.keys(patch).some((k) => JSON.stringify(stripVersion(prev[k])) !== JSON.stringify(stripVersion(patch[k])))
        if (changed) doc.updateNode(options.nodeId, { data: { uiInputs: { ...prev, ...patch } } })
      } else if (m.type === 'output' && typeof m.url === 'string' && m.url) {
        const url = m.url
        const bust = url.indexOf('?') >= 0 ? '&v=' : '?v='
        const versioned = url + bust + Date.now()
        const field: UiOutputField = outputFieldForName(url)
        // 产物落地即定输出类型（右侧端口类型跟着它走）
        const patch: Record<string, unknown> = { uiOutputUrl: url, uiOutputType: outputTypeForName(url) }
        // 地址只是引用的投影（与后台产物落地同一规矩）：两份一起写，保存时才不会只剩一个地址
        const ref = resourceRefFromUiUrl(url)
        if (ref) patch.resourceId = ref
        if (field === 'text') {
          if (typeof m.text === 'string') patch.text = m.text
        } else {
          patch[field] = versioned
        }
        // 地址与节点现值"去版本号后"相同 ⇒ 只是同一份产物又一次上报（循环末梢），不写节点。
        const cur = (options.nodeData()?.[field] as string | undefined) ?? ''
        if (field !== 'text' && cur.split('?')[0] === url.split('?')[0]) return
        doc.updateNodeRuntime(options.nodeId, { data: patch })
      } else if (m.type === 'output-type') {
        // 页面自己声明「我产出的是什么」：右侧端口与可连对象立刻跟着变，
        // 原来连出去的线如果不匹配，由数据层自动断开（GraphDocument 负责）。
        const v = typeof m.value === 'string' ? m.value.trim().toLowerCase() : ''
        doc.updateNode(options.nodeId, { data: { uiOutputType: v } })
      }
    } catch {
      // 节点可能已被删掉：静默跳过（不该因为一次上报把页面搞崩）
    }
  }

  return { frameSeed, themeSeed, paletteSeed, pushDataToFrame, onBridgeMessage }
}
