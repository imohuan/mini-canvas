/**
 * backend-sync SSE 封装 —— 订阅后台画布变化 / 任务进度，增量派发给回调。
 *
 * - 幂等单连接：connect 前先 close 旧的。
 * - canvasId 过滤：收到非当前画布事件直接丢弃。
 * - 统一 message 事件：type 在 data.type（node:added / node:updated / node:removed / edge 增删 / batch:done / graph:changed）。
 * - EventSource 断线自动重连；close() 彻底关闭，避免泄漏（HMR/卸载时调用）。
 */
export type BackendEvent =
  | { type: 'node:added'; canvasId: string; node: any }
  | { type: 'node:removed'; canvasId: string; nodeId: string }
  | { type: 'node:updated'; canvasId: string; nodeId: string; node: any }
  | { type: 'edge:added'; canvasId: string; edge: any }
  | { type: 'edge:removed'; canvasId: string; edgeId: string }
  | { type: 'batch:done'; canvasId: string; resource: string }
  | { type: 'graph:changed'; canvasId: string }
  | { type: string; [k: string]: unknown }

export type BackendEventHandler = (evt: BackendEvent) => void

export class BackendSse {
  private es: EventSource | null = null
  private closed = false
  private firstOpenDone = false
  private baseUrl: string
  private targetCanvasId: string | null
  private handler: BackendEventHandler
  private openHandler?: (isReconnect: boolean) => void

  constructor(
    baseUrl: string,
    canvasId: string | null,
    onEvent: BackendEventHandler,
    onOpen?: (isReconnect: boolean) => void,
  ) {
    this.baseUrl = baseUrl
    this.targetCanvasId = canvasId
    this.handler = onEvent
    this.openHandler = onOpen
  }

  connect(): void {
    this.close()
    this.closed = false
    this.firstOpenDone = false
    const url = `${this.baseUrl}/events${this.targetCanvasId ? `?canvasId=${encodeURIComponent(this.targetCanvasId)}` : ''}`
    try {
      const es = new EventSource(url)
      this.es = es
      es.onmessage = (e) => {
        if (this.closed) return
        try {
          const evt = JSON.parse(e.data) as BackendEvent
          // canvasId 过滤（服务端已按 query 过滤，此处双保险）
          if (this.targetCanvasId && 'canvasId' in evt && evt.canvasId && evt.canvasId !== this.targetCanvasId) return
          this.handler(evt)
        } catch {
          /* 忽略解析失败 */
        }
      }
      es.onopen = () => {
        // 首次打开不算重连（插件已自行全量 load）；之后再 open 视为断线重连，交给外部 reconcile
        if (!this.firstOpenDone) { this.firstOpenDone = true; return }
        this.openHandler?.(true)
      }
      es.onerror = () => { /* EventSource 内置自动重连 */ }
    } catch (err) {
      console.error('[backend-sync] SSE 连接失败:', err)
    }
  }

  /** 切换目标画布后重连（只订阅该画布事件） */
  setCanvas(canvasId: string | null): void {
    if (this.targetCanvasId === canvasId && this.es) return
    this.targetCanvasId = canvasId
    if (!this.closed) this.connect()
  }

  close(): void {
    this.closed = true
    if (this.es) {
      this.es.close()
      this.es = null
    }
  }
}
