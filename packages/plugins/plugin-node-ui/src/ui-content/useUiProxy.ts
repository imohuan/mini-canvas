import { createHostProxy, errText, isSavePayload, type SavePayload } from '../hostFetch'

export interface UseUiProxyOptions {
  /** 每次请求现读后台地址（可能先空后到） */
  baseUrl(): string
  canvasId: string
  nodeId: string
}

/** 给沙箱页回一条代发结果（reqId 必须原样带回） */
export function replyProxy(win: Window, msg: Record<string, unknown>): void {
  try {
    win.postMessage({ __canvasUi: 1, ...msg }, '*')
  } catch {
    /* iframe 可能已经重挂：这条回包没人收了 */
  }
}

/**
 * 宿主代发：save / task / task-cancel / api。
 *
 * 从 UiContent.vue 原样搬出；hostProxy 仍按每次请求现建，令牌与后台地址不会被冻结。
 */
export function useUiProxy(options: UseUiProxyOptions) {
  function hostProxy() {
    return createHostProxy({ baseUrl: options.baseUrl(), canvasId: options.canvasId, nodeId: options.nodeId })
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
    const failType = m.type === 'save' ? 'save-result' : m.type === 'api' ? 'api-result' : 'task-result'
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
      if (m.type === 'api') {
        // 通用转发：只接受 /api/ 下的同源路径（hostFetch 里再校验一次）。
        const path = String(m.path ?? '')
        const method = String(m.method ?? 'GET')
        const headers = (m.headers && typeof m.headers === 'object' ? m.headers : {}) as Record<string, string>
        const body = m.body
        const res = await proxy.fetchApi({
          path,
          method,
          headers,
          ...(body == null ? {} : { body: body as BodyInit }),
        })
        replyProxy(win, {
          type: 'api-result',
          reqId,
          ok: true,
          status: res.status,
          headers: res.headers,
          body: res.body,
        })
        return
      }
      const runId = typeof m.runId === 'string' ? m.runId : ''
      if (!runId) throw new Error('缺少 runId')
      const result = await proxy.cancel(runId)
      replyProxy(win, { type: 'task-result', reqId, ...result })
    } catch (err) {
      replyProxy(win, { failType, reqId, ok: false, error: errText(err) })
    }
  }

  /** 调试 SDK 的代发请求（__uiDebugCmd）：只认本节点 iframe，回包按 reqId 对上。 */
  function handleDebugProxyRequest(win: Window, reqId: string, m: Record<string, unknown>): void {
    const reply = (msg: Record<string, unknown>): void => {
      try {
        win.postMessage({ __uiDebugReply: 1, reqId, ...msg }, '*')
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

  return { hostProxy, handleProxyRequest, handleDebugProxyRequest, replyProxy }
}
