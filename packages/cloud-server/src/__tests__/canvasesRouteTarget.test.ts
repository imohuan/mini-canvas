/**
 * 整包写 / 写视口必须落到 **:id 那张画布**。
 *
 * 现场（2026-10-14，我在核另一个问题时用真机 HTTP 复现）：
 *   PUT /api/canvases/<探针画布>  { nodes: [...] }
 *   → 探针画布仍是空的，而 **default 画布被整份覆盖成那两个探针节点**。
 * 根因：这两个端点拿的是工厂参数里的默认文档（`doc`），`:id` 只做了合法性校验、没参与写。
 * 后果很重：用户对任意一张画布做整包保存（删光节点 / 恢复历史 / 导入画布都走它），
 * 落到的却是默认画布 —— 自己的画布没存上，默认画布被清掉。
 *
 * 契约：
 *  - 给了 docForCanvas → 写 :id 那张；
 *  - 没给（老宿主）→ 只服务默认画布，别的 id 一律 404，**绝不回落默认画布**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { canvasesRoutes } from '../routes/canvases'
import { CanvasStore } from '../store/canvasStore'
import { CanvasResourceStore } from '../store/canvasResources'
import { CanvasDocument } from '../mcp/canvasDoc'
import { ProjectStore } from '../store/projectStore'
import { AssetStore } from '../store/assetStore'
import { projectsRoutes } from '../routes/projects'

let root: string
const OTHER = 'othercanvas00001'

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-target-'))
})
afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true })
})

function buildApp(withResolver: boolean): { app: Hono; store: CanvasStore } {
  const store = new CanvasStore(root)
  const resources = new CanvasResourceStore(root)
  const doc = new CanvasDocument(store, resources, 'default')
  const app = new Hono()
  app.route(
    '/',
    canvasesRoutes(
      store,
      resources,
      doc,
      withResolver ? (id) => new CanvasDocument(store, resources, id) : undefined,
    ),
  )
  return { app, store }
}

const put = (app: Hono, p: string, body: unknown) =>
  app.fetch(
    new Request('http://x' + p, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

describe('PUT /api/canvases/:id 落到哪张画布', () => {
  it('写别的画布 → 只动那张，默认画布一个字不改', async () => {
    const { app, store } = buildApp(true)
    await store.writeCanvas('default', { nodes: [{ id: 'keep', type: 'text' }], edges: [] })
    const res = await put(app, '/api/canvases/' + OTHER, { nodes: [{ id: 'a', type: 'text' }], edges: [] })
    expect(res.status).toBe(200)
    // 目标画布拿到了新内容
    expect((await store.readCanvas(OTHER))?.nodes).toHaveLength(1)
    // ★ 默认画布**原封不动** —— 这就是那个 bug 的判据
    const def = await store.readCanvas('default')
    expect(def?.nodes).toHaveLength(1)
    expect((def?.nodes[0] as { id: string }).id).toBe('keep')
  })

  it('写视口同样按 :id 分流（默认画布的视口不被改）', async () => {
    const { app, store } = buildApp(true)
    await store.writeView('default', { x: 1, y: 2, zoom: 3 })
    await put(app, '/api/canvases/' + OTHER + '/view', { x: 9, y: 9, zoom: 9 })
    expect(await store.readView(OTHER)).toEqual({ x: 9, y: 9, zoom: 9 })
    expect(await store.readView('default')).toEqual({ x: 1, y: 2, zoom: 3 })
  })

  it('没给 docForCanvas（老宿主）→ 别的 id 回 404，绝不静默写进默认画布', async () => {
    const { app, store } = buildApp(false)
    const res = await put(app, '/api/canvases/' + OTHER, { nodes: [{ id: 'a', type: 'text' }], edges: [] })
    expect(res.status).toBe(404)
    // 连文件都不该被创建
    expect(await store.readCanvas(OTHER)).toBeUndefined()
    expect(await store.readCanvas('default')).toBeUndefined()
  })

  it('默认画布本身照常可写（护栏不误伤）', async () => {
    const { app, store } = buildApp(true)
    const res = await put(app, '/api/canvases/default', { nodes: [{ id: 'x', type: 'text' }], edges: [] })
    expect(res.status).toBe(200)
    expect((await store.readCanvas('default'))?.nodes).toHaveLength(1)
  })
})

describe('画布版本（定时核对 / revision）', () => {
  it('图写入成功后 revision 递增；只读版本接口返回同一个值', async () => {
    const { app } = buildApp(true)
    // 通过真正会发号的图提交口（整包 PUT 在真实装配里走 replaceAll）写一次。
    const doc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root), 'default')
    await doc.replaceAll([{ id: 'a', type: 'text', position: { x: 0, y: 0 }, data: {} }], [])

    const rev = await app.fetch(new Request('http://x/api/canvases/default/revision'))
    expect(rev.status).toBe(200)
    expect(rev.headers.get('cache-control')).toContain('no-store')
    expect(((await rev.json()) as { revision: number }).revision).toBe(1)

    const full = await app.fetch(new Request('http://x/api/canvases/default'))
    expect(((await full.json()) as { revision: number }).revision).toBe(1)
  })

  it('无变化提交不涨版本；有新图内容才涨', async () => {
    const store = new CanvasStore(root)
    const doc = new CanvasDocument(store, new CanvasResourceStore(root), 'default')
    const node = { id: 'a', type: 'text', position: { x: 0, y: 0 }, data: {} }
    await doc.replaceAll([node], [])
    const afterFirst = (await store.readCanvas('default'))?.revision
    await doc.replaceAll([node], [])
    expect((await store.readCanvas('default'))?.revision).toBe(afterFirst)
    await doc.replaceAll([{ ...node, data: { text: 'changed' } }], [])
    expect((await store.readCanvas('default'))?.revision).toBe((afterFirst ?? 0) + 1)
  })

  it('改名只动 name：不涨版本，也不会把图覆盖回旧快照', async () => {
    const store = new CanvasStore(root)
    const projects = new ProjectStore(root)
    const assets = new AssetStore(root)
    const doc = new CanvasDocument(store, new CanvasResourceStore(root), 'default')
    const node = { id: 'a', type: 'text', position: { x: 0, y: 0 }, data: { text: 'old' } }
    await doc.replaceAll([node], [])
    // 先发生一次图提交，再改名：改名不能把中间那份新图写成旧快照。
    await doc.replaceAll([{ ...node, data: { text: 'newer' } }], [])
    const beforeRename = await store.readCanvas('default')
    const app = new Hono()
    app.route('/', projectsRoutes(projects, store, assets))
    const res = await app.fetch(
      new Request('http://x/api/canvases/default/meta', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '改名后' }),
      }),
    )
    expect(res.status).toBe(200)
    const after = await store.readCanvas('default')
    expect(after?.name).toBe('改名后')
    expect(after?.revision).toBe(beforeRename?.revision)
    expect(((after?.nodes[0] as { data: { text: string } }).data.text)).toBe('newer')
  })

  it('画布不存在时版本接口是 404，不用 0 冒充空画布', async () => {
    const { app } = buildApp(true)
    const res = await app.fetch(new Request('http://x/api/canvases/' + OTHER + '/revision'))
    expect(res.status).toBe(404)
  })
})
