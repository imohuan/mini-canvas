/**
 * projects / assets 路由单测（Hono 直接 fetch，不启真端口）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { ProjectStore } from '../store/projectStore'
import { AssetStore } from '../store/assetStore'
import { CanvasStore } from '../store/canvasStore'
import { projectsRoutes } from '../routes/projects'
import { assetsRoutes } from '../routes/assets'

let root: string
let app: Hono
let projects: ProjectStore
let canvases: CanvasStore
let assets: AssetStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-pr-'))
  projects = new ProjectStore(root)
  canvases = new CanvasStore(root)
  assets = new AssetStore(root)
  app = new Hono()
  app.route('/', projectsRoutes(projects, canvases, assets))
  app.route('/', assetsRoutes(assets))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const call = (p: string, method = 'GET', body?: unknown) =>
  app.fetch(
    new Request('http://x' + p, {
      method,
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    }),
  )
const j = async (r: Response) => (await r.json()) as Record<string, any>

describe('projects 路由', () => {
  it('首次 GET 就有 default 项目（画布数按索引统计）', async () => {
    const r = await j(await call('/api/projects'))
    expect(r.ok).toBe(true)
    expect(r.projects.map((p: any) => p.id)).toContain('default')
  })

  it('建项目 → 建画布 → 列画布 → 重命名画布 → 删画布', async () => {
    const p = await j(await call('/api/projects', 'POST', { name: '项目甲' }))
    expect(p.project.name).toBe('项目甲')

    const made = await j(await call('/api/projects/' + p.project.id + '/canvases', 'POST', { name: '第一张' }))
    expect(made.canvas.name).toBe('第一张')
    const cid = made.canvas.id as string

    const list = await j(await call('/api/projects/' + p.project.id + '/canvases'))
    expect(list.canvases.map((c: any) => c.id)).toEqual([cid])

    // 重命名：索引与 canvas.json 都要变
    expect((await call('/api/canvases/' + cid + '/meta', 'PATCH', { name: '改名后' })).status).toBe(200)
    const list2 = await j(await call('/api/projects/' + p.project.id + '/canvases'))
    expect(list2.canvases[0].name).toBe('改名后')
    expect((await canvases.readCanvas(cid))?.name).toBe('改名后')

    // 删画布：文件夹与索引一起没
    expect((await call('/api/canvases/' + cid, 'DELETE')).status).toBe(200)
    expect(await canvases.list()).not.toContain(cid)
    await expect(fs.access(path.join(root, 'canvases', cid))).rejects.toBeTruthy()
  })

  it('默认项目不可删，但默认**画布**可以删（用户口径：任何画布都能删）', async () => {
    expect((await call('/api/projects/default', 'DELETE')).status).toBe(400)
    // 用户口径 2026-10-09：「不管是哪个画布都支持删除，即使是当前选中的也支持删除」——
    // 内置 default 画布不再有豁免；删掉后它只是目录不存在，任何「没给画布 id」的调用
    // 都会按需重新建回一张空画布（CanvasDocument 的默认 canvasId 兜底）。
    await canvases.writeCanvas('default', { nodes: [{ id: 'x', type: 'text', position: { x: 0, y: 0 } }], edges: [] })
    expect((await call('/api/canvases/default', 'DELETE')).status).toBe(200)
    expect(await canvases.list()).not.toContain('default')
    await expect(fs.access(path.join(root, 'canvases', 'default'))).rejects.toBeTruthy()
    // 删完再列画布也不报错（删除后仍能自洽）
    expect((await call('/api/projects/default/canvases')).status).toBe(200)
  })

  it('复制画布：新 id / 名字带副本 / 节点边拷过去 / 资源地址换成新画布 id / 视口不带走', async () => {
    const p = await j(await call('/api/projects', 'POST', { name: '项目乙' }))
    const made = await j(await call('/api/projects/' + p.project.id + '/canvases', 'POST', { name: '原画布' }))
    const from = made.canvas.id as string
    // 给原画布塞一个带资源的节点 + 一条边 + 一个视口
    const resName = '0123456789abcdef.png'
    await canvases.writeCanvas(from, {
      name: '原画布',
      nodes: [{
        id: 'n1',
        type: 'image',
        position: { x: 1, y: 2 },
        data: {
          // 迁移期两种形态同时存在：旧 URL 字段 + 新逻辑 ID
          imageUrl: '/api/canvases/' + from + '/resources/' + resName,
          resourceId: from + '/' + resName,
        },
      }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
    })
    await canvases.writeView(from, { x: 9, y: 9, zoom: 2 })

    const dup = await j(await call('/api/canvases/' + from + '/duplicate', 'POST'))
    expect(dup.ok).toBe(true)
    const to = dup.canvas.id as string
    expect(to).not.toBe(from)
    expect(dup.canvas.name).toBe('原画布 副本')
    expect(dup.canvas.projectId).toBe(p.project.id)

    const copy = await canvases.readCanvas(to)
    expect(copy?.name).toBe('原画布 副本')
    expect(copy?.nodes).toHaveLength(1)
    expect(copy?.edges).toHaveLength(1)
    // 关键：资源地址里的画布 id 换成新的（副本自包含，原画布删了也不裂图）
    expect(JSON.stringify(copy?.nodes)).toContain('/api/canvases/' + to + '/resources/' + resName)
    expect(JSON.stringify(copy?.nodes)).not.toContain('/api/canvases/' + from + '/resources/')
    // 逻辑 ID 同样要换画布作用域：副本不能指回原画布的资源
    expect(JSON.stringify(copy?.nodes)).toContain('"' + to + '/' + resName + '"')
    expect(JSON.stringify(copy?.nodes)).not.toContain('"' + from + '/' + resName + '"')
    // 视口不复制
    expect(await canvases.readView(to)).toBeUndefined()
    // 原始画布不受影响
    expect(JSON.stringify((await canvases.readCanvas(from))?.nodes)).toContain('/api/canvases/' + from + '/resources/')

    // 再复制一次：重名要递增，不出现两条同名的
    const dup2 = await j(await call('/api/canvases/' + from + '/duplicate', 'POST'))
    expect(dup2.canvas.name).toBe('原画布 副本 2')
  })

  it('复制不存在的画布 → 404', async () => {
    expect((await call('/api/canvases/nope-nope/duplicate', 'POST')).status).toBe(404)
  })

  it('删项目连带删它的画布', async () => {
    const p = await j(await call('/api/projects', 'POST', { name: 'P' }))
    const made = await j(await call('/api/projects/' + p.project.id + '/canvases', 'POST', { name: 'C' }))
    const cid = made.canvas.id as string
    expect((await call('/api/projects/' + p.project.id, 'DELETE')).status).toBe(200)
    expect(await canvases.list()).not.toContain(cid)
  })
})

describe('assets 路由', () => {
  it('上传 → 列表 → 取字节 → 删除', async () => {
    const up = await app.fetch(
      new Request('http://x/api/assets?name=a.png', { method: 'POST', body: new Uint8Array([1, 2, 3]) }),
    )
    const upj = await j(up)
    expect(upj.asset.source).toBe('upload')
    const name = String(upj.asset.url).split('/').pop()

    const list = await j(await call('/api/assets'))
    expect(list.assets).toHaveLength(1)

    const fileRes = await call('/api/assets/files/' + name)
    expect(fileRes.status).toBe(200)
    expect(Array.from(new Uint8Array(await fileRes.arrayBuffer()))).toEqual([1, 2, 3])

    expect((await call('/api/assets/' + upj.asset.id, 'DELETE')).status).toBe(200)
    expect((await j(await call('/api/assets'))).assets).toHaveLength(0)
  })

  it('上传空文件 → 400', async () => {
    const r = await app.fetch(new Request('http://x/api/assets?name=a.png', { method: 'POST', body: new Uint8Array() }))
    expect(r.status).toBe(400)
  })
})
