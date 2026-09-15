/**
 * CanvasDocument 单测。
 *
 * 最要紧的一条是**共用同一份数据**：MCP 读写必须落在网页界面用的那几个 key 上
 * （`canvas:graph` / `canvas:graph-edges`），否则 AI 改了画布、浏览器里却看不到，
 * 这个 MCP 就是摆设。所以下面不只测"方法返回值对"，还直接去 KvStore 里按
 * 网页端那套 key 把数据捞出来核对。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KvStore } from '../store/kvStore'
import { FileStore } from '../store/fileStore'
import { CanvasDocument, GRAPH_KEY, GRAPH_EDGES_KEY, edgeIdOf } from '../mcp/canvasDoc'

let dir: string
let kv: KvStore
let doc: CanvasDocument

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-doc-'))
  kv = new KvStore(dir)
  doc = new CanvasDocument(kv, new FileStore(dir))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('读画布', () => {
  it('从未保存过 → 空画布（不是错误）', async () => {
    expect(await doc.read()).toEqual({ nodes: [], edges: [] })
  })

  it('认得出"旧数组只存节点"这种形态', async () => {
    await kv.set('canvas', GRAPH_KEY, [{ id: '1', type: 'text', position: { x: 0, y: 0 }, data: {} }])
    const snap = await doc.read()
    expect(snap.nodes.map((n) => n.id)).toEqual(['1'])
    expect(snap.edges).toEqual([])
  })

  it('认得出"信封里同时有 nodes/edges"这种形态', async () => {
    await kv.set('canvas', GRAPH_KEY, {
      nodes: [{ id: '1', type: 'text', position: { x: 0, y: 0 }, data: {} }],
      edges: [{ id: 'e-1-2', source: '1', target: '2' }],
    })
    const snap = await doc.read()
    expect(snap.nodes).toHaveLength(1)
    expect(snap.edges).toHaveLength(1)
  })

  it('边单独存的 graph-edges 会被并进来；也在时以它为准', async () => {
    await kv.set('canvas', GRAPH_KEY, [{ id: '1', type: 'text', position: { x: 0, y: 0 }, data: {} }])
    await kv.set('canvas', GRAPH_EDGES_KEY, [{ id: 'e-1-2', source: '1', target: '2' }])
    const snap = await doc.read()
    expect(snap.edges.map((e) => e.id)).toEqual(['e-1-2'])
  })

  it('读出来的是副本：调用方改了不会污染下一次读', async () => {
    await kv.set('canvas', GRAPH_KEY, [{ id: '1', type: 'text', position: { x: 0, y: 0 }, data: {} }])
    const a = await doc.read()
    a.nodes[0].id = '改坏了'
    expect((await doc.read()).nodes[0].id).toBe('1')
  })
})

describe('与网页界面共用同一份存储', () => {
  it('MCP 存的资源落在网页端同一个 uploads 目录（同内容去重成同一个 url）', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const a = await doc.saveResource(bytes, { fileName: 'x.png' })
    expect(a.url).toMatch(/^\/uploads\/[0-9a-f]{16}\.png$/)
    expect(a.mime).toBe('image/png')

    // 同一份字节再来一次 → 同一个 URL（不存两份）
    const b = await doc.saveResource(bytes, { fileName: 'y.png' })
    expect(b.url).toBe(a.url)

    // 网页端的 FileStore 读得到同一份（同一个存储根）
    expect(await doc.listResources()).toEqual([a.id])
    // 直接读服务器文件核对字节
    const back = await fs.readFile(path.join(dir, 'uploads', a.id))
    expect(new Uint8Array(back)).toEqual(bytes)
  })

  it('存资源时扩展名走白名单（.html/.js 不按原名存，防同源 XSS）', async () => {
    const r = await doc.saveResource(new Uint8Array([60, 104, 49, 62]), { fileName: 'evil.html' })
    expect(r.id).not.toMatch(/\.html$/)
    expect(r.mime).toBe('application/octet-stream')
  })

  it('空内容被拒', async () => {
    await expect(doc.saveResource(new Uint8Array([]))).rejects.toThrow('为空')
  })

  it('写入后，网页端按 canvas:graph / canvas:graph-edges 能读到同一份数据', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'n1', data: { text: '你好' } }] })
    await doc.batchEdges({ add: [{ source: 'n1', target: 'n1' }] }).catch(() => {})

    // 网页端的 HttpAdapter 就是打这两个 key（经 /api/kv/canvas/*）
    const nodesOnWeb = await kv.get<{ id: string }[]>('canvas', GRAPH_KEY)
    expect(nodesOnWeb?.map((n) => n.id)).toEqual(['n1'])
    expect(await kv.get('canvas', GRAPH_EDGES_KEY)).toEqual([])
  })

  it('网页端写了什么，MCP 也读得到（反向）', async () => {
    await kv.set('canvas', GRAPH_KEY, [{ id: 'web-1', type: 'image', position: { x: 5, y: 6 }, data: { imageUrl: '/uploads/a.png' } }])
    const snap = await doc.read()
    expect(snap.nodes[0]).toMatchObject({ id: 'web-1', type: 'image', data: { imageUrl: '/uploads/a.png' } })
  })

  it('写画布不碰 viewport（AI 加节点不该把用户当前视野重置掉）', async () => {
    const viewport = { x: 100, y: 200, zoom: 0.7 }
    await kv.set('canvas', 'graph-viewport', viewport)
    await doc.batchNodes({ add: [{ type: 'text' }] })
    expect(await kv.get('canvas', 'graph-viewport')).toEqual(viewport)
  })
})

describe('batchNodes', () => {
  it('新增：没给 id 就生成 ai- 前缀的，并摆在已有节点右侧空位（不压在别人身上）', async () => {
    const r = await doc.batchNodes({
      add: [
        { type: 'text', id: 'n1', position: { x: 0, y: 0 }, size: { w: 200, h: 100 } },
        { type: 'text' },
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.added).toHaveLength(2)
    const auto = r.added[1]
    expect(auto.startsWith('ai-')).toBe(true)
    const snap = await doc.read()
    const autoNode = snap.nodes.find((n) => n.id === auto)!
    // 落在 n1 右边（n1 右边缘 200 + 间隔），不与它重叠
    expect(autoNode.position.x).toBeGreaterThan(200)
  })

  it('更新：data 浅合并', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'n1', data: { text: 'a', keep: 1 } }] })
    const r = await doc.batchNodes({ update: [{ id: 'n1', data: { text: 'b' } }] })
    expect(r.ok).toBe(true)
    expect(r.updated).toEqual(['n1'])
    const node = (await doc.read()).nodes[0]
    expect(node.data).toEqual({ text: 'b', keep: 1 })
  })

  it('删节点会连带删掉它的连线（不留悬挂边）', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    await doc.batchEdges({ add: [{ source: 'a', target: 'b' }] })
    expect((await doc.read()).edges).toHaveLength(1)

    await doc.batchNodes({ delete: ['a'] })
    const snap = await doc.read()
    expect(snap.nodes.map((n) => n.id)).toEqual(['b'])
    expect(snap.edges).toEqual([])
  })

  it('整批先预校验：有一条非法就一个都不改（半成品最难查）', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'kept' }] })
    const r = await doc.batchNodes({
      add: [{ type: 'text', id: 'new-one' }],
      delete: ['不存在的节点'],
    })
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).toContain('不存在')
    // 合法的那条也不该生效
    expect((await doc.read()).nodes.map((n) => n.id)).toEqual(['kept'])
  })

  it('id 重复被拦（防静默覆盖已有数据）', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'dup' }] })
    const r = await doc.batchNodes({ add: [{ type: 'text', id: 'dup' }] })
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).toContain('重复')
  })

  it('缺 type 被拦', async () => {
    const r = await doc.batchNodes({ add: [{ type: '' }] })
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).toContain('type')
  })
})

describe('batchEdges', () => {
  it('新增边：id 按 e-{source}-{target} 生成', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    const r = await doc.batchEdges({ add: [{ source: 'a', target: 'b' }] })
    expect(r.ok).toBe(true)
    expect(r.added).toEqual([edgeIdOf({ source: 'a', target: 'b' })])
    expect(r.added[0]).toBe('e-a-b')
  })

  it('同一条边重复添加被去重（不产生第二条）', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    await doc.batchEdges({ add: [{ source: 'a', target: 'b' }] })
    const again = await doc.batchEdges({ add: [{ source: 'a', target: 'b' }] })
    expect(again.ok).toBe(true)
    expect(again.added).toEqual([])
    expect((await doc.read()).edges).toHaveLength(1)
  })

  it('两端节点不存在 / 自连 都被拦下', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'a' }] })
    const missing = await doc.batchEdges({ add: [{ source: 'a', target: '没有这个' }] })
    expect(missing.ok).toBe(false)
    const self = await doc.batchEdges({ add: [{ source: 'a', target: 'a' }] })
    expect(self.ok).toBe(false)
    expect(self.errors[0].message).toContain('同一节点')
  })

  it('删除边', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    await doc.batchEdges({ add: [{ source: 'a', target: 'b' }] })
    const r = await doc.batchEdges({ delete: ['e-a-b'] })
    expect(r.ok).toBe(true)
    expect(r.deleted).toEqual(['e-a-b'])
    expect((await doc.read()).edges).toEqual([])
  })
})
