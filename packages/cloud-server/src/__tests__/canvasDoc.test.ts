/**
 * CanvasDocument 单测。
 *
 * 最要紧的一条是**共用同一份数据**：MCP 与网页界面读写的是同一个画布文件夹
 * （`canvases/default/canvas.json`）。否则 AI 改了画布、浏览器里却看不到，这个 MCP 就是摆设。
 * 所以下面不只测"方法返回值对"，还直接去磁盘上把文件捞出来核对。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasStore } from '../store/canvasStore'
import { CanvasResourceStore } from '../store/canvasResources'
import { CanvasDocument } from '../mcp/canvasDoc'

let dir: string
let store: CanvasStore
let doc: CanvasDocument

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-doc-'))
  store = new CanvasStore(dir)
  doc = new CanvasDocument(store, new CanvasResourceStore(dir))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('读画布', () => {
  it('从未保存过 → 空画布（不是错误）', async () => {
    expect(await doc.read()).toEqual({ nodes: [], edges: [] })
  })

  it('读出来的是副本：调用方改了不会污染下一次读', async () => {
    await store.writeCanvas('default', { nodes: [{ id: '1', type: 'text', position: { x: 0, y: 0 }, data: {} }], edges: [] })
    const a = await doc.read()
    a.nodes[0].id = '改坏了'
    expect((await doc.read()).nodes[0].id).toBe('1')
  })
})

describe('与网页界面共用同一份存储', () => {
  it('MCP 存的资源落在本画布 resources/ 下（同内容去重成同一个引用）', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const a = await doc.saveResource(bytes, { fileName: 'x.png' })
    expect(a.ref).toMatch(/^res:[0-9a-f]{16}\.png$/)
    expect(a.mime).toBe('image/png')

    // 同一份字节再来一次 → 同一个引用（不存两份）
    const b = await doc.saveResource(bytes, { fileName: 'y.png' })
    expect(b.ref).toBe(a.ref)

    // listResources 列的是本画布资源名
    expect(await doc.listResources()).toEqual([a.hashName])
    // 直接读服务器文件核对字节
    const back = await fs.readFile(path.join(dir, 'canvases', 'default', 'resources', a.hashName))
    expect(new Uint8Array(back)).toEqual(bytes)
  })

  it('存资源时扩展名走白名单（.html/.js 不按原名存，防同源 XSS）', async () => {
    const r = await doc.saveResource(new Uint8Array([60, 104, 49, 62]), { fileName: 'evil.html' })
    expect(r.hashName).not.toMatch(/\.html$/)
    expect(r.mime).toBe('application/octet-stream')
  })

  it('空内容被拒', async () => {
    await expect(doc.saveResource(new Uint8Array([]))).rejects.toThrow('为空')
  })

  it('写入后，磁盘上的 canvas.json 就是同一份数据（网页端读的也是它）', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'n1', data: { text: '你好' } }] })
    await doc.batchEdges({ add: [{ source: 'n1', target: 'n1' }] }).catch(() => {})

    // 网页端经 /api/canvases/:id 读的就是这个文件
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'canvases', 'default', 'canvas.json'), 'utf8'))
    expect(raw.nodes.map((n: { id: string }) => n.id)).toEqual(['n1'])
    expect(raw.edges).toEqual([])
  })

  it('网页端写了什么，MCP 也读得到（反向）', async () => {
    await store.writeCanvas('default', {
      nodes: [{ id: 'web-1', type: 'image', position: { x: 5, y: 6 }, data: { imageUrl: 'res:a1b2c3d4e5f6a7b8.png' } }],
      edges: [],
    })
    const snap = await doc.read()
    expect(snap.nodes[0]).toMatchObject({ id: 'web-1', type: 'image', data: { imageUrl: 'res:a1b2c3d4e5f6a7b8.png' } })
  })

  it('写画布不碰 viewport（AI 加节点不该把用户当前视野重置掉）', async () => {
    const viewport = { x: 100, y: 200, zoom: 0.7 }
    await store.writeView('default', viewport)
    await doc.batchNodes({ add: [{ type: 'text' }] })
    expect(await store.readView('default')).toEqual(viewport)
  })
})

describe('batchNodes', () => {
  it('新增：没给 id 就发一个自增数字号，并摆在已有节点右侧空位（不压在别人身上）', async () => {
    const r = await doc.batchNodes({
      add: [
        { type: 'text', id: 'n1', position: { x: 0, y: 0 }, size: { w: 200, h: 100 } },
        { type: 'text' },
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.added).toHaveLength(2)
    const auto = r.added[1]
    // 与网页端同一套规则：自增数字（现有 id 都不是数字 → 从 1 起）
    expect(auto).toBe('1')
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
  it('新增边：id 是自增数字（与网页端同一套规则）', async () => {
    await doc.batchNodes({ add: [{ type: 'text', id: 'a' }, { type: 'text', id: 'b' }] })
    const r = await doc.batchEdges({ add: [{ source: 'a', target: 'b' }] })
    expect(r.ok).toBe(true)
    expect(r.added).toEqual(['1'])
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
    // 边 id 现在是自增数字（不再是 e-{source}-{target}）
    const r = await doc.batchEdges({ delete: ['1'] })
    expect(r.ok).toBe(true)
    expect(r.deleted).toEqual(['1'])
    expect((await doc.read()).edges).toEqual([])
  })
})


describe('并发写同一个画布文件：不能因为 rename 撞车而失败', () => {
  it('多轮并发写 canvas.json 全部成功（Windows 上 rename 打同一目标会 EPERM）', async () => {
    // 复现真实场景：网页端保存 与 AI（MCP）改画布同时落在同一个文件上。
    // 没有「同文件串行 + 退避重试」时，这里会偶发 EPERM（"另一个程序正在使用此文件"）。
    for (let round = 0; round < 6; round++) {
      await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          store.writeCanvas('default', {
            nodes: [{ id: 'n' + i, type: 'text', position: { x: i, y: i }, data: { round } }],
            edges: [],
          }),
        ),
      )
      // 每一轮都必须留下一个**完整可解析**的文件（不能是半截 JSON）
      const raw = await fs.readFile(path.join(dir, 'canvases', 'default', 'canvas.json'), 'utf8')
      expect(JSON.parse(raw).nodes).toHaveLength(1)
    }
    // 这是并发压力用例：负载高时单轮 fs 往返会明显变慢，给它足够余量（默认 5s 太紧）
  }, 30_000)
})
