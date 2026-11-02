import { ref, watch, type Ref } from 'vue'
import type { UpstreamItem } from '../uiData'
import { toCloneableState } from '../uiData'
import type { UiOutputField } from './useUiOutput'
import { outputFieldForName } from './useUiOutput'

export interface UseUiBridgeOptions {
  iframeEl: Ref<HTMLIFrameElement | null>
  html: Ref<string>
  /** iframe 重挂序号 */
  gen: Ref<number>
  upstream: Ref<UpstreamItem[]>
  inputValues: Ref<Record<string, unknown>>
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

  // 重挂（换 HTML）时把初值刷成最新 —— 否则新文档里注入的还是上一次挂载时的旧数据，
  // 而"数据变了"那条消息是在页面还没建好时发的，会丢。
  watch(options.gen, () => {
    frameSeed.value = { inputs: options.inputValues.value, upstream: options.upstream.value }
  })

  /** 把**这个节点的全部数据**发给页面（**不重挂**）。 */
  function pushDataToFrame(): void {
    const win = options.iframeEl.value?.contentWindow
    if (!win) return
    try {
      win.postMessage(
        {
          __canvasUiCmd: 1,
          type: 'data',
          upstream: toCloneableState(options.upstream.value),
          inputs: toCloneableState(options.inputValues.value),
        },
        '*',
      )
    } catch {
      // 文档还没建好：页面自己会发 ready 报到，那时再补一次
    }
  }

  // 上游素材 / 输入参数变了 → 发消息（**不碰 srcdoc**，所以页面不重启）
  watch([options.upstream, options.inputValues], () => pushDataToFrame())

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
        const patch: Record<string, unknown> = { uiOutputUrl: url }
        if (field === 'text') {
          if (typeof m.text === 'string') patch.text = m.text
        } else {
          patch[field] = versioned
        }
        // 地址与节点现值"去版本号后"相同 ⇒ 只是同一份产物又一次上报（循环末梢），不写节点。
        const cur = (options.nodeData()?.[field] as string | undefined) ?? ''
        if (field !== 'text' && cur.split('?')[0] === url.split('?')[0]) return
        doc.updateNodeRuntime(options.nodeId, { data: patch })
      }
    } catch {
      // 节点可能已被删掉：静默跳过（不该因为一次上报把页面搞崩）
    }
  }

  return { frameSeed, pushDataToFrame, onBridgeMessage }
}
