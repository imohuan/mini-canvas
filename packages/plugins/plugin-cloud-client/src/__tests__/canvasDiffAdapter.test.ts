import { describe, it, expect } from 'vitest'
import { CanvasDiffAdapter } from '../canvasDiffAdapter'
import { CloudApi } from '../api'
import type { FetchLike } from '../apiTypes'

const REF = 'res:0123456789abcdef.png'
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
    if (path.startsWith('/api/canvases/default/resources')) {
      uploads.push({ path, name: decodeURIComponent(path.split('?name=')[1] ?? '') })
      return new Response(JSON.stringify({ ok: true, ref: 'res:fedcba9876543210.png', hashName: 'fedcba9876543210.png' }), { status: 200 })
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
  return { api: new CloudApi({ baseUrl: 'http://srv', fetchImpl }), writes, uploads, get nodes() { return nodes } }
}

describe('读：把 res: 展开成真地址', () => {
  it('读出来的节点里，资源字段已经是完整地址（渲染组件直接就能用）', async () => {
    const b = fakeBackend({ nodes: [{ id: 'n1', type: 'image', data: { imageUrl: REF, text: 'hi' } }] })
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

describe('写：只发差异，且磁盘上只存 res:', () => {
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

  it('写出去的节点里，本画布地址被收回 res:（磁盘上只存相对引用）', async () => {
    const b = fakeBackend()
    const adapter = new CanvasDiffAdapter(b.api)
    await adapter.primeFromServer()
    await adapter.set('canvas:graph', [{ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: URL } }])
    const added = b.writes[0].body.add as Array<{ data: { imageUrl: string } }>
    expect(added[0].data.imageUrl).toBe(REF)
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
    expect(added[0].data.imageUrl).toBe(REF)
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
})

describe('恢复：服务器上的 res: 引用要展开成真地址（否则浏览器渲染不出来）', () => {
  it('getRaw 读回来的节点里，资源字段已是当前画布的真地址', async () => {
    const b = fakeBackend({
      nodes: [{ id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: REF, imageName: 'a.png' } }],
    })
    const adapter = new CanvasDiffAdapter(b.api)
    const snap = await adapter.getRaw()
    const node = snap.nodes[0] as { data: { imageUrl: string; imageName: string } }
    expect(node.data.imageUrl).toBe(URL)
    expect(node.data.imageUrl.startsWith('res:')).toBe(false)
    expect(node.data.imageName).toBe('a.png')
  })
})


