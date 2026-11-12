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
import type { AssetStore } from '../store/assetStore.js'

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

export function historyRoutes(history: HistoryStore, assetStore?: AssetStore): Hono {
  const app = new Hono()

  app.get('/api/history', async (c) => {
    const page = await history.query(parseQuery(c.req.query()))
    return c.json({ ok: true, ...page })
  })

  // 删除一条历史（批量操作 / 单条删除共用；找条目自带的 canvasId 落删）
  app.delete('/api/history/:id', async (c) => {
    const id = c.req.param('id')
    const entry = await history.find(id)
    if (!entry) return c.json({ ok: false, error: '历史不存在' }, 404)
    const ok = await history.remove(entry.canvasId, id)
    return ok ? c.json({ ok: true }) : c.json({ ok: false, error: '删除失败' }, 500)
  })

  // 批量删除
  app.post('/api/history/batch-delete', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] }
    if (!Array.isArray(body.ids) || body.ids.length === 0) return c.json({ ok: false, error: 'ids 为空' }, 400)
    let removed = 0
    for (const id of body.ids) {
      const entry = await history.find(id)
      if (entry && await history.remove(entry.canvasId, id)) removed += 1
    }
    return c.json({ ok: true, removed })
  })

  // 批量改评级
  app.post('/api/history/batch-rating', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: string[]; rating?: string }
    if (!Array.isArray(body.ids) || body.ids.length === 0) return c.json({ ok: false, error: 'ids 为空' }, 400)
    const rating = body.rating
    if (rating !== 'passed' && rating !== 'pending' && rating !== 'rejected') {
      return c.json({ ok: false, error: 'rating 非法' }, 400)
    }
    let updated = 0
    for (const id of body.ids) {
      const entry = await history.find(id)
      if (entry && await history.setRating(entry.canvasId, id, rating)) updated += 1
    }
    return c.json({ ok: true, updated })
  })

  // 保存到资产（把历史产物的地址登记进资产库；addByUrl 按地址去重）
  app.post('/api/history/batch-save-assets', async (c) => {
    if (!assetStore) return c.json({ ok: false, error: '资产服务不可用' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] }
    if (!Array.isArray(body.ids) || body.ids.length === 0) return c.json({ ok: false, error: 'ids 为空' }, 400)
    let saved = 0
    for (const id of body.ids) {
      const entry = await history.find(id)
      for (const url of entry?.urls ?? []) {
        try {
          await assetStore.addByUrl({ url, canvasId: entry!.canvasId, source: 'generated' })
          saved += 1
        } catch {
          /* 单条失败不断整批 */
        }
      }
    }
    return c.json({ ok: true, saved })
  })

  return app
}
