import { describe, it, expect } from 'vitest'
import {
  ResourceStore,
  type ResourceUrlBackend,
  type ResourcePersistence,
  sanitizeTransientResourceUrls,
  mediaUrlFieldsOf,
  restoreNodeMediaUrls,
} from '../resourceService'

/** 记录 create/revoke 调用的假 backend */
function fakeBackend() {
  const calls = { created: [] as string[], revoked: [] as string[] }
  const backend: ResourceUrlBackend = {
    createUrl(resource) {
      const url = 'blob:mock-' + String(calls.created.length)
      calls.created.push(String((resource as { name?: string })?.name ?? ''))
      return url
    },
    revokeUrl(url) { calls.revoked.push(url) },
  }
  return { backend, calls }
}

describe('ResourceStore 资源生命周期', () => {
  it('视频节点按 node.type 恢复 videoUrl（不能读 data.nodeType）', async () => {
    const nodes = [
      { id: 'v1', type: 'video', data: { resourceId: 'res-v', videoName: 'a.mp4' } as Record<string, unknown> },
      { id: 'i1', type: 'image', data: { resourceId: 'res-i', imageUrl: 'blob:dead' } as Record<string, unknown> },
    ]
    expect(mediaUrlFieldsOf(nodes[0])).toEqual(['videoUrl'])
    const count = await restoreNodeMediaUrls(nodes, async (id) => `blob:ok-${id}`)
    expect(count).toBe(2)
    expect(nodes[0].data.videoUrl).toBe('blob:ok-res-v')
    expect(nodes[0].data.imageUrl).toBeUndefined()
    expect(nodes[1].data.imageUrl).toBe('blob:ok-res-i')
  })

  it('资源已不在时清掉失效地址，且不碰已持久化的地址', async () => {
    const nodes = [
      { id: 'v1', type: 'video', data: { resourceId: 'res-gone', videoUrl: 'blob:dead' } as Record<string, unknown> },
      { id: 'v2', type: 'video', data: { resourceId: 'res-keep', videoUrl: '/uploads/ok.mp4' } as Record<string, unknown> },
    ]
    const count = await restoreNodeMediaUrls(nodes, async (id) => (id === 'res-keep' ? 'blob:new' : undefined))
    // v2 已是持久地址 → 不需要重建，故重建计数为 0（计数只统计真的写了新地址的节点）
    expect(count).toBe(0)
    expect(nodes[0].data.videoUrl).toBeUndefined()
    expect(nodes[1].data.videoUrl).toBe('/uploads/ok.mp4')
  })
  it('资源 id 可跨页面恢复 Blob，旧 blob URL 不参与保存', async () => {
    const blobs = new Map<string, { kind: string; resource: Blob }>()
    const persistence: ResourcePersistence = {
      async save(id, kind, resource) { blobs.set(id, { kind, resource }) },
      async load(id) { return blobs.get(id) },
      async remove(id) { blobs.delete(id) },
    }
    const urls: string[] = []
    const rs = new ResourceStore({ createUrl: () => "blob:restored", revokeUrl() {} }, persistence)
    const id = rs.register({ kind: 'image', url: 'blob:old', resource: new Blob(['x'], { type: 'image/png' }) })
    await Promise.resolve()
    expect(await rs.restore?.(id)).toBe('blob:old')
    // 新页面由另一个 ResourceStore 实例读取同一持久化后端
    const rs2 = new ResourceStore({ createUrl: (blob) => { urls.push(String((blob as Blob).size)); return "blob:new-1" }, revokeUrl() {} }, persistence)
    expect(await rs2.restore?.(id, 'image')).toBe('blob:new-1')
    expect(urls).toEqual(['1'])
    const saved = sanitizeTransientResourceUrls([{ id: '1', data: { imageUrl: 'blob:old', resourceId: id, label: 'x' } }])
    expect(saved[0].data).toEqual({ resourceId: id, label: 'x' })
    const large = sanitizeTransientResourceUrls([{ id: '2', data: { imageUrl: 'data:image/png;base64,' + 'A'.repeat(70000) } }])
    expect(large[0].data.imageUrl).toBeUndefined()
  })
  it('register 自动生成 URL 并返回稳定 id；url/alive/get 可读', () => {
    const { backend } = fakeBackend()
    const rs = new ResourceStore(backend)
    const id = rs.register({ kind: 'image', resource: { name: 'a.png' } })
    expect(id).toMatch(/^res-/)
    expect(rs.url(id)).toMatch(/^blob:mock-/)
    expect(rs.alive(id)).toBe(true)
    expect(rs.get(id)?.kind).toBe('image')
    expect(rs.ids()).toEqual([id])
  })
  it('显式 url 绕过 createUrl；无 url 且无 createUrl 的 backend 抛错', () => {
    const rs = new ResourceStore({ revokeUrl() {} })
    const id = rs.register({ url: 'blob:explicit' })
    expect(rs.url(id)).toBe('blob:explicit')
    expect(() => rs.register({ resource: {} })).toThrow(/createUrl/)
  })
  it('revoke 回收 URL 并移除；不存在返回 false', () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(backend)
    const id = rs.register({ resource: { name: 'x' } })
    expect(rs.revoke(id)).toBe(true)
    expect(rs.alive(id)).toBe(false)
    expect(calls.revoked).toHaveLength(1)
    expect(rs.revoke(id)).toBe(false)
  })
  it('revokeByResource / revokeByKind 批量回收', () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(backend)
    const blob = { name: 'same' }
    rs.register({ kind: 'image', resource: blob })
    rs.register({ kind: 'image', resource: blob })
    rs.register({ kind: 'text', resource: { name: 't' } })
    expect(rs.revokeByResource(blob)).toBe(2)
    expect(calls.revoked).toHaveLength(2)
    expect(rs.revokeByKind('text')).toBe(1)
    expect(rs.ids()).toHaveLength(0)
  })
  it('disposeUnreferenced 只回收未被引用集合覆盖的资源', () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(backend)
    const alive = rs.register({ resource: { name: 'keep' } })
    rs.register({ resource: { name: 'drop1' } })
    rs.register({ resource: { name: 'drop2' } })
    const n = rs.disposeUnreferenced(new Set([alive]))
    expect(n).toBe(2)
    expect(calls.revoked).toHaveLength(2)
    expect(rs.ids()).toEqual([alive])
  })
  it('disposeUnreferenced 空集合 = 全量回收', () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(backend)
    rs.register({ resource: { name: 'a' } })
    rs.register({ resource: { name: 'b' } })
    rs.disposeUnreferenced(new Set())
    expect(calls.revoked).toHaveLength(2)
    expect(rs.ids()).toHaveLength(0)
  })
  it('dispose 全量回收并清空', () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(backend)
    rs.register({ resource: { name: '1' } })
    rs.register({ resource: { name: '2' } })
    rs.dispose()
    expect(calls.revoked).toHaveLength(2)
    expect(rs.ids()).toHaveLength(0)
  })
})
