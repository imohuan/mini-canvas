/**
 * 首次上云的**资源迁移**：本地引用的图必须搬到云端，否则云端节点上没有可用地址。
 *
 * 这条路径以前是坏的：资源 adapter 在装载时就被换成了云端，本地 IndexedDB 里的字节够不着，
 * 而节点里存的还是本地引用 + blob: 地址 —— 整包推上去，用户的图就没了。
 */
import { describe, it, expect } from 'vitest'
import { migrateLocalResources } from '../plugin'
import { CloudApi } from '../api'
import type { FetchLike } from '../apiTypes'

/** 假云端：只处理资源上传 */
function fakeApi(): { api: CloudApi; uploads: Array<{ name: string; size: number }> } {
  const uploads: Array<{ name: string; size: number }> = []
  const fetchImpl: FetchLike = async (url, init) => {
    const path = String(url).replace('http://srv', '')
    if (path.startsWith('/api/canvases/default/resources')) {
      uploads.push({ name: decodeURIComponent(path.split('?name=')[1] ?? ''), size: 1 })
      return new Response(
        JSON.stringify({ ok: true, hashName: 'abc123.png', url: '/api/canvases/default/resources/abc123.png' }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  return { api: new CloudApi({ baseUrl: 'http://srv', fetchImpl }), uploads }
}

describe('migrateLocalResources：首次上云把本地资源搬上去', () => {
  it('本地引用 → 取字节 → 传云端 → 换成资源 URL 写进该类型的媒体字段', async () => {
    const { api, uploads } = fakeApi()
    const local = {
      async resolveResource(ref: string) {
        return ref === 'res-1-local' ? 'data:image/png;base64,AAAA' : undefined
      },
    }
    const nodes = [{ id: 'n1', type: 'image', data: { resourceId: 'res-1-local', imageUrl: 'blob:old' } }]
    const out = (await migrateLocalResources(nodes, local, api)) as Array<{ data: Record<string, unknown> }>
    expect(uploads).toHaveLength(1)
    expect(out[0].data.imageUrl).toBe('/api/canvases/default/resources/abc123.png')
    // 主字段：逻辑 ID（带画布作用域）。地址只是迁移期副本。
    expect(out[0].data.resourceId).toBe('default/abc123.png')
  })

  it('已是云端引用（资源 URL）→ 不重复上传', async () => {
    const { api, uploads } = fakeApi()
    const local = { async resolveResource() { return undefined } }
    const nodes = [
      { id: 'n1', type: 'image', data: { resourceId: '/api/canvases/default/resources/abc123.png' } },
    ]
    await migrateLocalResources(nodes, local, api)
    expect(uploads).toHaveLength(0)
  })

  it('已是新逻辑 ID → 不重复上传', async () => {
    const { api, uploads } = fakeApi()
    const local = { async resolveResource() { return undefined } }
    const nodes = [{ id: 'n1', type: 'image', data: { resourceId: 'default/abc123.png' } }]
    await migrateLocalResources(nodes, local, api)
    expect(uploads).toHaveLength(0)
  })

  it('别的画布的资源 URL → 不算「已上传」，照常走本地迁移（只认本画布前缀）', async () => {
    const { api, uploads } = fakeApi()
    const local = { async resolveResource() { return 'data:image/png;base64,AAAA' } }
    const nodes = [
      { id: 'n1', type: 'image', data: { resourceId: '/api/canvases/other/resources/abc123.png' } },
    ]
    const out = (await migrateLocalResources(nodes, local, api)) as Array<{ data: Record<string, unknown> }>
    expect(uploads).toHaveLength(1)
    expect(out[0].data.imageUrl).toBe('/api/canvases/default/resources/abc123.png')
  })

  it('取不到字节 → 原样保留（不因一张图失败把整次迁移搞崩）', async () => {
    const { api, uploads } = fakeApi()
    const local = { async resolveResource() { return undefined } }
    const nodes = [{ id: 'n1', type: 'image', data: { resourceId: 'res-gone', imageUrl: 'blob:x' } }]
    const out = (await migrateLocalResources(nodes, local, api)) as Array<{ data: Record<string, unknown> }>
    expect(uploads).toHaveLength(0)
    expect(out[0].data.imageUrl).toBe('blob:x')
  })

  it('同一张图被多个节点引用 → 只传一次', async () => {
    const { api, uploads } = fakeApi()
    const local = { async resolveResource() { return 'data:image/png;base64,AAAA' } }
    const nodes = [
      { id: 'n1', type: 'image', data: { resourceId: 'res-same' } },
      { id: 'n2', type: 'image', data: { resourceId: 'res-same' } },
    ]
    await migrateLocalResources(nodes, local, api)
    expect(uploads).toHaveLength(1)
  })

  it('没有本地资源后端 → 原样返回（不抛）', async () => {
    const { api } = fakeApi()
    const nodes = [{ id: 'n1', type: 'image', data: { resourceId: 'res-1' } }]
    await expect(migrateLocalResources(nodes, undefined, api)).resolves.toHaveLength(1)
  })
})
