/**
 * canvases 路由 —— 画布文件夹的 HTTP 面。
 *
 * 契约：
 *   GET  /api/canvases                        → { ok, canvases: string[] }
 *   GET  /api/canvases/:id                    → { ok, nodes, edges, view }
 *   PUT  /api/canvases/:id                    ← { nodes, edges }（整包保存）
 *   PUT  /api/canvases/:id/view               ← { x, y, zoom }
 *   POST /api/canvases/:id/resources          ← 原始字节（?name= 给扩展名）→ { ok, ref, hashName, size }
 *   GET  /api/canvases/:id/resources/:name    → 字节
 *
 * 与增量口的分工（两条都要）：
 *   - 整包 PUT 表达「以这份为准」（用户删光节点 / 恢复历史 / 导入画布），
 *     增量口表达不出「删掉你没提到的那些」；
 *   - 增量口 POST /api/canvas/nodes | /api/canvas/edges 表达「我只改这些」，
 *     让网页端与 AI 并发写同一张画布时都不被对方整个盖掉。
 * 两者都收进 CanvasDocument 的同一把写锁，所以混着用也安全。
 */
import { Hono } from 'hono'
import { isSafeCanvasId } from '../store/canvasPaths.js'
import type { CanvasStore } from '../store/canvasStore.js'
import { isSafeResourceName, type CanvasResourceStore } from '../store/canvasResources.js'
import type { CanvasDocument } from '../mcp/canvasDoc.js'
import { mimeFromName } from '../store/mime.js'

export function canvasesRoutes(
  store: CanvasStore,
  resources: CanvasResourceStore,
  doc: CanvasDocument,
): Hono {
  const app = new Hono()

  app.get('/api/canvases', async (c) => c.json({ ok: true, canvases: await store.list() }))

  app.get('/api/canvases/:id', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    const data = (await store.readCanvas(id)) ?? { nodes: [], edges: [] }
    const view = (await store.readView(id)) ?? null
    return c.json({ ok: true, nodes: data.nodes, edges: data.edges, view })
  })

  app.put('/api/canvases/:id', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    const body = await readJsonBody(c)
    if (!body.ok) return body.res
    const { nodes, edges } = body.value
    // 走 doc 的写锁（与增量口、AI 的写共用同一把锁）
    await doc.replaceAll(nodes, edges)
    return c.json({ ok: true })
  })

  app.put('/api/canvases/:id/view', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    let view: unknown
    try {
      view = await c.req.json()
    } catch {
      return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    }
    await doc.writeView(view)
    return c.json({ ok: true })
  })

  app.post('/api/canvases/:id/resources', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength === 0) return c.json({ ok: false, error: '空文件' }, 400)
    const name = c.req.query('name') ?? ''
    const dot = name.lastIndexOf('.')
    const saved = await resources.save(id, bytes, dot >= 0 ? name.slice(dot) : '')
    return c.json({ ok: true, ...saved })
  })

  app.get('/api/canvases/:id/resources/:name', async (c) => {
    const { id, name } = c.req.param()
    if (!isSafeCanvasId(id) || !isSafeResourceName(name)) {
      return c.json({ ok: false, error: '非法路径' }, 400)
    }
    const bytes = await resources.read(id, name)
    if (!bytes) return c.json({ ok: false, error: '资源不存在' }, 404)
    return c.body(bytes, 200, {
      'content-type': mimeFromName(name),
      // 内容寻址：地址与字节绑定，内容一变地址就变 → 可安全长缓存
      'cache-control': 'public, max-age=31536000, immutable',
    })
  })

  return app
}

/** 读 body 并校验成 { nodes, edges }；不合法时回一个 400 响应 */
async function readJsonBody(
  c: { req: { json: () => Promise<unknown> } },
): Promise<{ ok: true; value: { nodes: unknown[]; edges: unknown[] } } | { ok: false; res: Response }> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return { ok: false, res: Response.json({ ok: false, error: 'body 不是合法 JSON' }, { status: 400 }) }
  }
  // 必须**明确给出** nodes（数组）：缺字段就当成写错了 —— 否则 `{nope:1}` 会被默默当成
  // 「把画布清空」，一次拼错就抹掉整张画布。宁可 400 说清楚。
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray((body as { nodes?: unknown }).nodes)) {
    return {
      ok: false,
      res: Response.json({ ok: false, error: 'body 必须是对象 { nodes: [], edges: [] }（nodes 必给且为数组）' }, { status: 400 }),
    }
  }
  const obj = body as { nodes: unknown[]; edges?: unknown }
  return { ok: true, value: { nodes: obj.nodes, edges: Array.isArray(obj.edges) ? obj.edges : [] } }
}
