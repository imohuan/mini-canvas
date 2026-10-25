/**
 * events 路由 —— 实时通道（`GET /api/kv/events`，SSE）。
 *
 * 解决什么问题：MCP 工具改画布是**直接落到服务器文件**的，网页端没有任何途径知道
 * 「刚才那一改」。没有这条通道，用户让 AI 加个节点，得手动刷新浏览器才看得见。
 *
 * 为什么是 SSE 而不是 WebSocket：这里的数据流天生单向 —— 服务器只需要喊一声「变了」，
 * 浏览器要写东西已经有现成的 HTTP PUT 了。用 WebSocket 等于为了单向通知背上双向连接的复杂度
 * （自己写重连、心跳、粘包处理），换来的能力用不上。真要做多人协同再考虑 CRDT 那一套。
 *
 * 契约（对外，定死）：
 *   GET /api/kv/events?type=canvas  → text/event-stream
 *   data: {"type":"canvas","key":"graph"}   一次 kv 写入/删除
 *   : ping                                     保活（非业务事件，客户端忽略）
 *
 * 有意**只报哪个 key 变了，不带新值**：订阅方按需自己去读。理由是大画布每写一次就把整份
 * 数据塞进事件里穿过若干层，网络与内存都不划算；而写方本来就已经把值写进 store 了，重复搬运没意义。
 *
 * 有意**不区分「谁写的」**：同源问题（谁改的、要不要回灌）交给订阅方自己判断 ——
 * 它才知道自己刚写没写过。服务器不该替客户端记住这种状态。
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { isKvType, type KvChangeEvent, type KvStore } from '../store/kvStore.js'
import type { CanvasStore } from '../store/canvasStore.js'

/** 对外事件：kv 只有 type/key；画布事件额外带 canvasId 与图版本（客户端据此过滤与核对） */
type StreamChangeEvent = KvChangeEvent & { canvasId?: string; revision?: number }

/**
 * 保活间隔。
 *
 * 为什么必须有：浏览器/代理会掐掉长时间没数据的连接（常见阈值 30~60 秒），
 * 而画布可能几十分钟没人动。发个注释帧把连接喂着，客户端按 SSE 规范自动忽略。
 * 25 秒是留了余量的选择（低于常见 30 秒阈值）。
 */
const PING_INTERVAL_MS = 25_000

export function eventsRoutes(store: KvStore, canvas?: CanvasStore): Hono {
  const app = new Hono()

  /**
   * 收集该订阅者应收到的事件。
   *
   * 两个来源：
   * - KvStore 的写（设置 / 快捷这类按 key 存的小数据）；
   * - CanvasStore 的写（画布本体 / 视口）—— 画布数据已经不经过 kv 了，
   *   若只听 kv，AI 改完画布网页端就永远收不到通知（得手动刷新）。
   */
  function collector(emit: (e: StreamChangeEvent) => void): () => void {
    const offKv = store.onChange(emit)
    const offCanvas = canvas?.onChange((e) =>
      emit({
        type: 'canvas',
        key: e.key,
        // canvasId 不能丢：多画布时前端必须知道是哪一张变了；
        // revision 只是提示，最终以完整快照返回的版本为准。
        canvasId: e.canvasId,
        ...(e.revision !== undefined ? { revision: e.revision } : {}),
      }),
    )
    return () => {
      offKv()
      offCanvas?.()
    }
  }

  app.get('/api/kv/events', (c) => {
    const type = c.req.query('type')
    // 给了作用域就必须合法：写错一个字会静默地永远收不到事件，不如当场报错
    if (type !== undefined && !isKvType(type)) {
      return c.json({ ok: false, error: `未知作用域: ${type}` }, 400)
    }

    return streamSSE(c, async (stream) => {
      let closed = false
      const queue: StreamChangeEvent[] = []
      let wake: (() => void) | null = null

      const off = collector((e) => {
        if (closed) return
        if (type !== undefined && e.type !== type) return
        queue.push(e)
        // 叫醒正挂着等的那个 await（队列里刚有东西了）
        wake?.()
      })

      // 客户端断开（关页面/断网）：立刻退订，别把订阅者留在 store 里越积越多
      stream.onAbort(() => {
        closed = true
        off()
        wake?.()
      })

      const ping = setInterval(() => {
        if (!closed) void stream.write(': ping\n\n')
      }, PING_INTERVAL_MS)

      try {
        while (!closed) {
          if (queue.length === 0) {
            // 没事件就睡着等，而不是空转轮询 —— 一个订阅者一条长连接，代价应该是一条挂起的 promise
            await new Promise<void>((resolve) => {
              wake = resolve
            })
            wake = null
            continue
          }
          const event = queue.shift()!
          await stream.writeSSE({ data: JSON.stringify(event) })
        }
      } finally {
        closed = true
        clearInterval(ping)
        off()
      }
    })
  })

  return app
}
