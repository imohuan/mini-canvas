import { describe, it, expect } from 'vitest'
import { CanvasDiffAdapter } from '../canvasDiffAdapter'
import { CloudApi } from '../api'
import type { FetchLike } from '../apiTypes'

const URL = '/api/canvases/default/resources/0123456789abcdef.png'

/** 假后端：存着当前的 nodes / edges / view，并记录收到的增量写 */
function fakeBackend(initial: { nodes?: unknown[]; edges?: unknown[]; view?: unknown } = {}) {
  let nodes = initial.nodes ?? []
  let edges = initial.edges ?? []
  const view = initial.view ?? null
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []
  const uploads: Array<{ path: string; name: string }> = []
  const fetchImpl: FetchLike = async (url, init) => {
    const path = String(url).replace('http://srv', '')
    if (!init || init.method === undefined || init.method === 'GET') {
      if (path === '/api/canvases/default') {
        return new Response(JSON.stringify({ ok: true, nodes, edges, view }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 })
    }
    if (path.startsWith('/api/canvases/default/resources?')) {
      uploads.push({ path, name: decodeURIComponent(path.split('?name=')[1] ?? '') })
      return new Response(
        JSON.stringify({ ok: true, hashName: 'fedcba9876543210.png', url: '/api/canvases/default/resources/fedcba9876543210.png' }),
        { status: 200 },
      )
    }
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
    writes.push({ path, body })
    if (path === '/api/canvases/default/nodes') {
      const del = new Set((body.delete as string[]) ?? [])
      const list = nodes.filter((n) => !del.has((n as { id: string }).id))
      for (const a of (body.add as unknown[]) ?? []) list.push(a)
      for (const u of (body.update as Array<{ id: string }>) ?? []) {
        const i = list.findIndex((n) => (n as { id: string }).id === u.id)
        if (i >= 0) list[i] = { ...(list[i] as object), ...u }
      }
      nodes = list
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  return {
    api: new CloudApi({ baseUrl: 'http://srv', fetchImpl }),
    writes,
    uploads,
    seed(nextNodes: unknown[], nextEdges: unknown[]) {
      nodes = nextNodes
      edges = nextEdges
    },
    get nodes() { return nodes },
  }
}

describe('读：节点原样返回（资源字段里就是同源 URL）', () => {
  it('读出来的节点一个字段都不动（渲染组件直接就能用）', async () => {
    const b = fakeBackend({ nodes: [{ id: 'n1', type: 'image', data: { imageUrl: URL, text: 'hi' } }] })
    const adapter = new CanvasDiffAdapter(b.api)
    const nodes = (await adapter.get('canvas:graph')) as Array<{ data: { imageUrl: string; text: string } }>
    expect(nodes[0].data.imageUrl).toBe(URL)
    expect(nodes[0].data.text).toBe('hi')
  })

  it('视口原样返回', async () => {
    const b = fakeBackend({ view: { x: 1, y: 2, zoom: 3 } })
    const adapter = new CanvasDiffAdapter(b.api)
    expect(await adapter.get('canvas:graph-viewport')).toEqual({ x: 1, y: 2, zoom: 3 })
  })
})

describe('写：只发差异，节点里的资源地址原样发', () => {
  it('首次保存 = 全是新增', async () => {
    const b = fakeBackend()
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    await adapter.set('canvas:graph', [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} }])
    expect(b.writes).toHaveLength(1)
    expect(b.writes[0].path).toBe('/api/canvases/default/nodes')
    expect((b.writes[0].body.add as unknown[]).length).toBe(1)
  })

  it('没变化 → 一个请求都不发（否则会和本地保存形成回环）', async () => {
    const nodes = [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} }]
    const b = fakeBackend({ nodes })
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    await adapter.set('canvas:graph', nodes)
    expect(b.writes).toHaveLength(0)
  })

  it('只发差集：改了哪个只发哪个', async () => {
    const n1 = { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} }
    const n2 = { id: 'n2', type: 'text', position: { x: 9, y: 9 }, data: {} }
    const b = fakeBackend({ nodes: [n1, n2] })
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    await adapter.set('canvas:graph', [n1, { ...n2, position: { x: 99, y: 99 } }])
    expect(b.writes).toHaveLength(1)
    expect((b.writes[0].body.update as unknown[]).length).toBe(1)
    expect((b.writes[0].body.add as unknown[] | undefined)?.length ?? 0).toBe(0)
  })

  it('写出去的节点里，资源地址原样发（就是同源 URL）', async () => {
    const b = fakeBackend()
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    await adapter.set('canvas:graph', [{ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: URL } }])
    const added = b.writes[0].body.add as Array<{ data: { imageUrl: string } }>
    expect(added[0].data.imageUrl).toBe(URL)
  })

  it('保存**不再上传**：字节在上传/生成时就由 resource adapter 存好了', async () => {
    // 这是本次重构的核心：保存路径只负责"把显示地址写成引用"，
    // 不再扫描节点、按 resourceId 取字节重传 —— 那段补丁已删除。
    const b = fakeBackend()
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    await adapter.set('canvas:graph', [
      { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: URL, resourceId: 'res-1' } },
    ])
    expect(b.uploads).toHaveLength(0)
    const added = b.writes[0].body.add as Array<{ data: { imageUrl: string; resourceId: string } }>
    expect(added[0].data.imageUrl).toBe(URL)
  })
})

describe('失败时不丢改动', () => {
  it('写失败 → 基准不动，下一轮会重发同一批差集', async () => {
    let fail = true
    const fetchImpl: FetchLike = async (url, init) => {
      const path = String(url).replace('http://srv', '')
      if (!init || !init.method || init.method === 'GET') {
        return new Response(JSON.stringify({ ok: true, nodes: [], edges: [], view: null }), { status: 200 })
      }
      if (fail) return new Response(JSON.stringify({ ok: false }), { status: 500 })
      void path
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    const adapter = new CanvasDiffAdapter(api)
    await adapter.primeFromServer()

    const node = { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} }
    await expect(adapter.set('canvas:graph', [node])).rejects.toThrow()

    fail = false
    let sent = 0
    const fetchImpl2: FetchLike = async (url, init) => {
      if (!init || !init.method || init.method === 'GET') {
        return new Response(JSON.stringify({ ok: true, nodes: [], edges: [], view: null }), { status: 200 })
      }
      sent += 1
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const adapter2 = new CanvasDiffAdapter(new CloudApi({ baseUrl: 'http://srv', fetchImpl: fetchImpl2 }))
    await adapter2.primeFromServer()
    await adapter2.set('canvas:graph', [node])
    expect(sent).toBe(1)
  })

  it('★ HTTP 200 + 业务 ok:false 不推进基准；下一次保存会重发同一批节点', async () => {
    let rejectFirst = true
    const writes: Array<Record<string, unknown>> = []
    const fetchImpl: FetchLike = async (url, init) => {
      const path = String(url).replace('http://srv', '')
      if (!init || !init.method || init.method === 'GET') {
        return new Response(JSON.stringify({ ok: true, nodes: [], edges: [], view: null }), { status: 200 })
      }
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
      writes.push(body)
      // 后台的真实形状：预校验失败也回 HTTP 200，但正文 ok:false
      if (rejectFirst && path.endsWith('/nodes')) {
        rejectFirst = false
        return new Response(JSON.stringify({ ok: false, errors: [{ message: '缺少节点 type' }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const adapter = new CanvasDiffAdapter(new CloudApi({ baseUrl: 'http://srv', fetchImpl }))
    await adapter.primeFromServer()
    const node = { id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: {} }

    await expect(adapter.set('canvas:graph', [node])).rejects.toThrow(/缺少节点 type/)
    // 第二次：基准没动，必须真的重发 add（否则刷新后改动消失）
    await adapter.set('canvas:graph', [node])
    expect(writes).toHaveLength(2)
    expect((writes[1].add as unknown[]).length).toBe(1)
  })
})

describe('远端合并后的保存基准', () => {
  it('primeFromSnapshot 后，已合入的远端节点不会被再当新增重发', async () => {
    const b = fakeBackend({ nodes: [{ id: 'local', type: 'text', position: { x: 0, y: 0 }, data: {} }] })
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()

    // 远端新增一个节点，客户端合并后调用 primeFromSnapshot 记录同一份快照。
    const merged = [
      { id: 'local', type: 'text', position: { x: 0, y: 0 }, data: {} },
      { id: 'remote', type: 'text', position: { x: 60, y: 0 }, data: {} },
    ]
    b.seed(merged, [])
    adapter.primeFromSnapshot({ nodes: merged, edges: [] })

    // 再保存本地当前这份：不应把 remote 这条重新作为 add 发出去
    await adapter.set('canvas:graph', merged)
    expect(b.writes).toHaveLength(0)
  })

  it('primeFromSnapshot 只更新云端基准，用户本地新编辑仍会被提交', async () => {
    const b = fakeBackend({ nodes: [{ id: 'local', type: 'text', position: { x: 0, y: 0 }, data: {} }] })
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    adapter.primeFromSnapshot({ nodes: [], edges: [] })

    await adapter.set('canvas:graph', [{ id: 'local', type: 'text', position: { x: 0, y: 0 }, data: {} }])
    expect(b.writes).toHaveLength(1)
    expect((b.writes[0].body.add as unknown[]).length).toBe(1)
  })
})

describe('恢复：服务器那份原样交给渲染层', () => {

/**
 * 出组 / 解组的持久化（真 bug 回归，2026-10-08 实测）。
 *
 * 服务端把「对象里没有 parentId 这个 key」读成「这次没提这个字段」，只有显式 `null`
 * 才执行删除。而本地节点出组后就是根本没有这个 key —— 于是「拖出分组 / 解散分组」
 * 写上去等于没写：刷新后节点又回到组里，组被删时还会留下悬挂 parentId。
 */
describe('出组持久化：解除父子要发显式 parentId: null', () => {
  it('本地去掉 parentId → 增量里带 parentId: null（服务端据此删字段）', async () => {
    const grouped = { id: 'n1', type: 'image', position: { x: 10, y: 10 }, data: {}, parentId: 'g1' }
    const b = fakeBackend({ nodes: [grouped] })
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    // 出组后的本地形状：parentId 键**不存在**（不是 null）
    const out = { id: 'n1', type: 'image', position: { x: 10, y: 10 }, data: {} }
    expect('parentId' in out).toBe(false)
    await adapter.set('canvas:graph', [out])
    expect(b.writes).toHaveLength(1)
    const upd = b.writes[0].body.update as Array<Record<string, unknown>>
    expect(upd).toHaveLength(1)
    expect(upd[0].parentId).toBeNull()
  })

  it('一直在组里（没变）→ 不发任何请求，也不会被塞 null', async () => {
    const grouped = { id: 'n1', type: 'image', position: { x: 10, y: 10 }, data: {}, parentId: 'g1' }
    const b = fakeBackend({ nodes: [grouped] })
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    await adapter.set('canvas:graph', [{ ...grouped }])
    expect(b.writes).toHaveLength(0)
  })

  it('只是换了个组（g1 → g2）→ 原样送新父，不塞 null', async () => {
    const grouped = { id: 'n1', type: 'image', position: { x: 10, y: 10 }, data: {}, parentId: 'g1' }
    const b = fakeBackend({ nodes: [grouped] })
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    await adapter.set('canvas:graph', [{ ...grouped, parentId: 'g2' }])
    const upd = b.writes[0].body.update as Array<Record<string, unknown>>
    expect(upd[0].parentId).toBe('g2')
  })
})
  it('getRaw 读回来的节点里，资源字段就是同源 URL', async () => {
    const b = fakeBackend({
      nodes: [{ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: URL, imageName: 'a.png' } }],
    })
    const adapter = new CanvasDiffAdapter(b.api)
    const snap = await adapter.getRaw()
    const node = snap.nodes[0] as { data: { imageUrl: string; imageName: string } }
    expect(node.data.imageUrl).toBe(URL)
    expect(node.data.imageName).toBe('a.png')
  })
})
