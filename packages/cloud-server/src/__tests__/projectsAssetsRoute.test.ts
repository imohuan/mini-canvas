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

  it('默认项目 / 默认画布不可删', async () => {
    expect((await call('/api/projects/default', 'DELETE')).status).toBe(400)
    expect((await call('/api/canvases/default', 'DELETE')).status).toBe(400)
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
