/**
 * projects 路由 —— 项目 / 画布的两层组织（HTTP 面）。
 *
 * 契约（详见 docs/design/project-canvas-assets.md §二）：
 *   GET    /api/projects                     → { ok, projects:[{id,name,createdAt,canvasCount}] }
 *   POST   /api/projects           {name}     → { ok, project }
 *   PATCH  /api/projects/:id       {name}     → { ok, project }
 *   DELETE /api/projects/:id                  → { ok }（连带它的画布一起删；default 不可删）
 *   GET    /api/projects/:id/canvases         → { ok, canvases }
 *   POST   /api/projects/:id/canvases {name}  → { ok, canvas }
 *   PATCH  /api/canvases/:id/meta  {name}     → { ok }（重命名画布）
 *   POST   /api/canvases/:id/duplicate         → { ok, canvas }（复制画布：节点/边/资源/历史；视口不带）
 *   DELETE /api/canvases/:id                  → { ok }（删画布文件夹；任何画布都可删，含内置 default）
 *
 * 为什么画布文件夹路径不变、靠索引记归属：见 store/projectStore.ts 文件头（迁移代价的取舍）。
 */
import { Hono } from 'hono'
import type { CanvasStore } from '../store/canvasStore.js'
import type { AssetStore } from '../store/assetStore.js'
import { isSafeCanvasId, isVirtualCanvasId } from '../store/canvasPaths.js'
import { DEFAULT_PROJECT_ID, ProjectStore } from '../store/projectStore.js'

export function projectsRoutes(projects: ProjectStore, canvases: CanvasStore, assets: AssetStore): Hono {
  const app = new Hono()

  app.get('/api/projects', async (c) => {
    const list = await projects.listOrSeed()
    const ids = await canvases.list()
    const index = await projects.readIndex()
    const counts = new Map<string, number>()
    for (const id of ids) {
      const pid = index.find((e) => e.id === id)?.projectId ?? DEFAULT_PROJECT_ID
      counts.set(pid, (counts.get(pid) ?? 0) + 1)
    }
    return c.json({
      ok: true,
      projects: list.map((p) => ({ ...p, canvasCount: counts.get(p.id) ?? 0 })),
    })
  })

  app.post('/api/projects', async (c) => {
    const body = await readJson(c)
    if (!body.ok) return body.res
    const name = typeof body.value.name === 'string' ? body.value.name : ''
    return c.json({ ok: true, project: await projects.create(name) })
  })

  app.patch('/api/projects/:id', async (c) => {
    const id = c.req.param('id')
    const body = await readJson(c)
    if (!body.ok) return body.res
    const name = typeof body.value.name === 'string' ? body.value.name : ''
    const project = await projects.rename(id, name)
    if (!project) return c.json({ ok: false, error: '项目不存在' }, 404)
    return c.json({ ok: true, project })
  })

  app.delete('/api/projects/:id', async (c) => {
    const id = c.req.param('id')
    if (id === DEFAULT_PROJECT_ID) return c.json({ ok: false, error: '默认项目不可删除' }, 400)
    const ids = await canvases.list()
    const index = await projects.readIndex()
    // 先删它名下画布的**文件夹**，再让 projectStore 摘索引（顺序反了会漏删文件夹）
    for (const entry of index.filter((e) => e.projectId === id)) {
      if (ids.includes(entry.id)) {
        await canvases.remove(entry.id)
        await assets.removeByCanvas(entry.id)
      }
    }
    const removed = await projects.remove(id)
    return removed ? c.json({ ok: true }) : c.json({ ok: false, error: '项目不存在' }, 404)
  })

  app.get('/api/projects/:id/canvases', async (c) => {
    const id = c.req.param('id')
    const ids = await canvases.list()
    return c.json({ ok: true, canvases: await projects.listCanvases(id, ids) })
  })

  app.post('/api/projects/:id/canvases', async (c) => {
    const id = c.req.param('id')
    const body = await readJson(c)
    if (!body.ok) return body.res
    const name = typeof body.value.name === 'string' ? body.value.name : ''
    const made = await projects.createCanvas(id, name)
    if ('error' in made) return c.json({ ok: false, error: made.error }, 400)
    return c.json({ ok: true, canvas: made })
  })

  // 重命名画布：改索引 + 回写 canvas.json 的 name（两处保持一致）
  app.patch('/api/canvases/:id/meta', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    // 虚拟画布（canvas_fn_call 的探针画布）不归用户管：改名/删除/复制都不该碰它
    if (isVirtualCanvasId(id)) return c.json({ ok: false, error: '虚拟画布不可改名' }, 400)
    const body = await readJson(c)
    if (!body.ok) return body.res
    const name = typeof body.value.name === 'string' ? body.value.name : ''
    if (!name.trim()) return c.json({ ok: false, error: '名字不能为空' }, 400)
    // 只改名，不重写 nodes/edges：否则中间发生的图提交会被旧快照盖回去，
    // 而且改名不该涨图版本（revision 只由图提交点发号）。
    await canvases.writeName(id, name.trim())
    await projects.renameCanvas(id, name.trim())
    return c.json({ ok: true })
  })

  app.delete('/api/canvases/:id', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    // ★ 虚拟画布不可删（审查 P2-1）：脚本的 ctx.save 正往它写产物，删了那次调用会静默 404。
    //   它不在用户列表里（CanvasStore.list 已过滤），用户正常操作碰不到；这条挡的是直接打 API。
    if (isVirtualCanvasId(id)) return c.json({ ok: false, error: '虚拟画布不可删除' }, 400)
    await canvases.remove(id)
    await projects.removeCanvas(id)
    await assets.removeByCanvas(id)
    return c.json({ ok: true })
  })

  // 复制画布：先建新索引（新 id/名字），再把旧画布的内容拷进去。
  // 内容拷贝（含资源地址换画布 id）在 CanvasStore.copyInto 里 —— 路径拼装只此一份。
  app.post('/api/canvases/:id/duplicate', async (c) => {
    const id = c.req.param('id')
    if (!isSafeCanvasId(id)) return c.json({ ok: false, error: '非法画布 id' }, 400)
    if (isVirtualCanvasId(id)) return c.json({ ok: false, error: '虚拟画布不可复制' }, 400)
    const made = await projects.duplicateCanvas(id)
    if (!made) return c.json({ ok: false, error: '画布不存在' }, 404)
    await canvases.copyInto(id, made.id, made.name)
    return c.json({ ok: true, canvas: made })
  })

  return app
}

/** 读 JSON body；非法时回一个 400 响应 */
async function readJson(
  c: { req: { json: () => Promise<unknown> } },
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; res: Response }> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return { ok: false, res: Response.json({ ok: false, error: 'body 不是合法 JSON' }, { status: 400 }) }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, res: Response.json({ ok: false, error: 'body 必须是对象' }, { status: 400 }) }
  }
  return { ok: true, value: body as Record<string, unknown> }
}
