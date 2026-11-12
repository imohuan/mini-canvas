/**
 * 虚拟画布（fn-probe-*）不应出现在用户能看到的地方。
 *
 * 背景：可视化节点的 canvas_fn_call 让 MCP **不必传 Canvas ID / Node ID** 也能调后台功能函数 ——
 * 做法是工具自己造一张空画布顶上（脚本的 ctx 需要这两个字段来拼"回写画布"的地址）。
 * 它落在同一个数据目录里（和真画布同一种文件）。
 *
 * 若不过滤，用户的项目页 / 画布下拉框就会凭空多出一张「fn-probe-default」——
 * 那是给函数探针用的临时画布，不该出现在用户界面上。这条用例就是那道闸。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasStore } from '../store/canvasStore'
import { isVirtualCanvasId, VIRTUAL_CANVAS_PREFIX } from '../store/canvasPaths'
import { Hono } from 'hono'
import { ProjectStore } from '../store/projectStore'
import { AssetStore } from '../store/assetStore'
import { projectsRoutes } from '../routes/projects'
import { canvasesRoutes } from '../routes/canvases'
import { CanvasDocument } from '../mcp/canvasDoc'
import { CanvasResourceStore } from '../store/canvasResources'

let root = ''

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-vcanvas-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('虚拟画布：判据与常量', () => {
  it('前缀是 fn-probe-；isVirtualCanvasId 只认它打头', () => {
    expect(VIRTUAL_CANVAS_PREFIX).toBe('fn-probe-')
    expect(isVirtualCanvasId('fn-probe-default')).toBe(true)
    expect(isVirtualCanvasId('default')).toBe(false)
    expect(isVirtualCanvasId('50b52864f72b4d0e')).toBe(false)
  })
})

describe('CanvasStore.list：别把虚拟画布当成用户的画布', () => {
  it('★ fn-probe-* 从列表里滤掉，真画布照常列', async () => {
    const store = new CanvasStore(root)
    await store.writeCanvas('default', { nodes: [], edges: [] })
    await store.writeCanvas('50b52864f72b4d0e', { nodes: [], edges: [] })
    // 工具造的那张探针画布
    await store.writeCanvas('fn-probe-default', {
      nodes: [{ id: 'probe', type: 'ui', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })

    const ids = await store.list()
    expect(ids).toContain('default')
    expect(ids).toContain('50b52864f72b4d0e')
    expect(ids.some((id) => id.startsWith('fn-probe-'))).toBe(false)
  })

  it('虚拟画布本身照样读得到（脚本回写产物那条路不能被挡）', async () => {
    const store = new CanvasStore(root)
    await store.writeCanvas('fn-probe-default', { nodes: [{ id: 'probe' }], edges: [] })
    const snap = await store.readCanvas('fn-probe-default')
    expect(snap?.nodes).toHaveLength(1)
  })
})

describe('★ 路由层：虚拟画布不是用户资产，删除/改名/复制/整包写都拒（审查 P2-1）', () => {
  let app: Hono
  beforeEach(async () => {
    const projects = new ProjectStore(root)
    const canvases = new CanvasStore(root)
    const assets = new AssetStore(root)
    const resources = new CanvasResourceStore(root)
    const doc = new CanvasDocument(canvases, resources, 'default')
    app = new Hono()
    app.route('/', projectsRoutes(projects, canvases, assets))
    app.route('/', canvasesRoutes(canvases, resources, doc))
    // 造一张探针画布（canvas_fn_call 会做的事）
    await canvases.writeCanvas('fn-probe-default', {
      nodes: [{ id: 'probe', type: 'ui', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    })
  })

  const call = (p: string, method = 'GET', body?: unknown) =>
    app.fetch(
      new Request('http://x' + p, {
        method,
        ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      }),
    )

  it('DELETE /api/canvases/fn-probe-default → 400（脚本回写产物不能被删穿）', async () => {
    const r = await call('/api/canvases/fn-probe-default', 'DELETE')
    expect(r.status).toBe(400)
    // 画布还在（脚本下次调用还能用）
    expect(await new CanvasStore(root).readCanvas('fn-probe-default')).toBeTruthy()
  })

  it('PATCH meta / duplicate / PUT 整包写 → 全部 400', async () => {
    expect((await call('/api/canvases/fn-probe-default/meta', 'PATCH', { name: 'x' })).status).toBe(400)
    expect((await call('/api/canvases/fn-probe-default/duplicate', 'POST')).status).toBe(400)
    expect((await call('/api/canvases/fn-probe-default', 'PUT', { nodes: [], edges: [] })).status).toBe(400)
  })

  it('真画布的删除/改名照常（护栏不误伤）', async () => {
    await new CanvasStore(root).writeCanvas('default', { nodes: [], edges: [] })
    expect((await call('/api/canvases/default/meta', 'PATCH', { name: '改名' })).status).toBe(200)
  })
})
