/**
 * history 路由 —— 生成历史的读口（分页 + 汇总）。
 *
 * 契约：
 *   GET /api/history?page&pageSize&kind&status&rating&order&canvasId
 *     → { ok, items, total, page, pageSize, summary }
 *
 * 只有读，没有写：历史由**后台在任务收尾时**归档（所以 AI 用 MCP 下的单也会被记上）。
 */
import { Hono } from 'hono'
import type { HistoryStore } from '../tasks/history.js'
import type { HistoryQuery } from '../tasks/types.js'

/** 把 query string 转成筛选条件（只认认识的键，其余忽略） */
function parseQuery(q: Record<string, string | undefined>): HistoryQuery {
  const num = (v: string | undefined): number | undefined => {
    if (v === undefined) return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    ...(num(q.page) !== undefined ? { page: num(q.page) } : {}),
    ...(num(q.pageSize) !== undefined ? { pageSize: num(q.pageSize) } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.rating ? { rating: q.rating } : {}),
    ...(q.order === 'asc' ? { order: 'asc' as const } : q.order === 'desc' ? { order: 'desc' as const } : {}),
    ...(q.canvasId ? { canvasId: q.canvasId } : {}),
  }
}

export function historyRoutes(history: HistoryStore): Hono {
  const app = new Hono()

  app.get('/api/history', async (c) => {
    const page = await history.query(parseQuery(c.req.query()))
    return c.json({ ok: true, ...page })
  })

  return app
}
