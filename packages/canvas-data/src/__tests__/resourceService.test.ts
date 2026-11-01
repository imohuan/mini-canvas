import { describe, it, expect } from 'vitest'
import {
  ResourceStore,
  type ResourceUrlBackend,
  sanitizeTransientResourceUrls,
  mediaUrlFieldsOf,
  restoreNodeMediaUrls,
} from '../resourceService'
import type { ResourceAdapter } from '../storage/types'

/** 内存版资源后端（等价于本地的 IndexedDB 适配器，只是不碰真 DB） */
function memoryResourceAdapter(): ResourceAdapter & { blobs: Map<string, Blob> } {
  const blobs = new Map<string, Blob>()
  let seq = 0
  return {
    id: 'memory-resource',
    capability: {},
    blobs,
    async putResource(blob, opts) {
      // 契约升级：调用方给了 ref 就用它（名字可推算 → 才能"先查有没有"）
      seq += 1
      const ref = opts?.ref ?? 'res-' + seq
      blobs.set(ref, blob)
      return ref
    },
    async resolveResource(ref) {
      return blobs.has(ref) ? 'blob:resolved-' + ref : undefined
    },
    async removeResource(ref) { blobs.delete(ref) },
  }
}

/** 记录 revoke 调用的假 backend */
function fakeBackend() {
  const calls = { revoked: [] as string[] }
  const backend: ResourceUrlBackend = {
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

  it('已有持久地址不被解析结果覆盖（只存 ID 目标形态）', async () => {
    const nodes = [
      { id: 'i1', type: 'image', data: { resourceId: 'res-i', imageUrl: '/stable/key.png' } as Record<string, unknown> },
    ]
    const count = await restoreNodeMediaUrls(nodes, async () => 'blob:new-temporary')
    // 已有持久地址不需要重建 → 重建计数为 0（计数只统计真的补了地址的节点）
    expect(count).toBe(0)
    // 已有持久地址保留，不被会话内临时地址覆盖
    expect(nodes[0].data.imageUrl).toBe('/stable/key.png')
  })
  it('资源 id 可跨页面恢复 Blob，旧 blob URL 不参与保存', async () => {
    // 存字节 → 只拿回 ref（不拿 URL）；显示地址靠 resolve 现算
    const adapter = memoryResourceAdapter()
    const rs = new ResourceStore(() => adapter, { revokeUrl() {} })
    const ref = await rs.put(new Blob(['x'], { type: 'image/png' }), { kind: 'image', name: 'a.png' })
    expect(ref).toBe('res-1')
    expect(adapter.blobs.get(ref)?.size).toBe(1)
    expect(await rs.resolve(ref)).toBe('blob:resolved-res-1')

    // 新页面：另一个实例读同一份后端 → 按 ref 重新算出地址（旧地址已随页面消失）
    const rs2 = new ResourceStore(() => adapter, { revokeUrl() {} })
    expect(await rs2.resolve(ref)).toBe('blob:resolved-res-1')

    // 落盘时 blob: 被清掉、resourceId 保留（刷新后靠它重建）
    const saved = sanitizeTransientResourceUrls([{ id: '1', data: { imageUrl: 'blob:old', resourceId: ref, label: 'x' } }])
    expect(saved[0].data).toEqual({ resourceId: ref, label: 'x' })
    // 带 resourceId 的 dataURL：字节已在持久化资源表里，节点里这份是冗余副本 → 删
    const dup = sanitizeTransientResourceUrls([{ id: '3', data: { imageUrl: 'data:image/png;base64,AAAA', resourceId: 'res-x' } }])
    expect(dup[0].data.imageUrl).toBeUndefined()
    // 不带 resourceId 的 dataURL（图片上传/裁剪/旋转/扩展的产物）：它是这张图**唯一**的一份 → 必须留下
    const large = sanitizeTransientResourceUrls([{ id: '2', data: { imageUrl: 'data:image/png;base64,' + 'A'.repeat(70000) } }])
    expect(large[0].data.imageUrl).toBe('data:image/png;base64,' + 'A'.repeat(70000))
  })
  it('put 返回持久引用，之后 url/alive/get 可读', async () => {
    const { backend } = fakeBackend()
    const adapter = memoryResourceAdapter()
    const rs = new ResourceStore(() => adapter, backend)
    const id = await rs.put(new Blob([new Uint8Array([1])]), { kind: 'image', ref: 'res-1' })
    expect(id).toBe('res-1')
    expect(rs.alive(id)).toBe(true)
    expect(rs.get(id)?.kind).toBe('image')
    expect(rs.ids()).toEqual([id])
    expect(await rs.resolve(id)).toBe('blob:resolved-res-1')
  })
  it('revoke 回收 URL 并移除；不存在返回 false', async () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(() => memoryResourceAdapter(), backend)
    const id = await rs.put(new Blob([new Uint8Array([1])]), { kind: 'image', ref: 'res-x' })
    await rs.resolve(id)
    expect(rs.revoke(id)).toBe(true)
    expect(rs.alive(id)).toBe(false)
    expect(calls.revoked).toHaveLength(1)
    expect(rs.revoke(id)).toBe(false)
  })
  it('disposeUnreferenced 只回收未被引用集合覆盖的资源', async () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(() => memoryResourceAdapter(), backend)
    const alive = await rs.put(new Blob([new Uint8Array([1])]), { ref: 'res-keep' })
    await rs.put(new Blob([new Uint8Array([2])]), { ref: 'res-drop1' })
    await rs.put(new Blob([new Uint8Array([3])]), { ref: 'res-drop2' })
    const n = rs.disposeUnreferenced(new Set([alive]))
    expect(n).toBe(2)
    expect(calls.revoked).toHaveLength(2)
    expect(rs.ids()).toEqual([alive])
  })
  it('disposeUnreferenced 空集合 = 全量回收', async () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(() => memoryResourceAdapter(), backend)
    await rs.put(new Blob([new Uint8Array([1])]), { ref: 'res-a' })
    await rs.put(new Blob([new Uint8Array([2])]), { ref: 'res-b' })
    rs.disposeUnreferenced(new Set())
    expect(calls.revoked).toHaveLength(2)
    expect(rs.ids()).toHaveLength(0)
  })
  it('dispose 全量回收并清空', async () => {
    const { backend, calls } = fakeBackend()
    const rs = new ResourceStore(() => memoryResourceAdapter(), backend)
    await rs.put(new Blob([new Uint8Array([1])]), { ref: 'res-1' })
    await rs.put(new Blob([new Uint8Array([2])]), { ref: 'res-2' })
    rs.dispose()
    expect(calls.revoked).toHaveLength(2)
    expect(rs.ids()).toHaveLength(0)
  })

  describe('派生资源（缩略图 / 帧图）不受"未被引用即回收"影响', () => {
    it('put(derived) 的资源不会被 disposeUnreferenced 清掉', async () => {
      const { backend, calls } = fakeBackend()
      // put 走的是**资源适配器**（不是 URL 后端）→ 这里用内存适配器
      const rs = new ResourceStore(() => memoryResourceAdapter(), backend)
      const keep = await rs.put(new Blob([new Uint8Array([4])]), { ref: 'res-node' })
      // 派生资源不写进节点 resourceId → 回收时不应被算作"没人引用"
      await rs.put(new Blob([new Uint8Array([1])]), { kind: 'image', ref: 'img-a-t2', derived: true })
      const n = rs.disposeUnreferenced(new Set([keep]))
      expect(n).toBe(0) // 一个都不该回收
      expect(calls.revoked).toHaveLength(0)
      expect(rs.alive('img-a-t2')).toBe(true)
    })

    it('对照：没标 derived 的照旧被回收（证明上一条不是"什么都没回收"）', async () => {
      const { backend, calls } = fakeBackend()
      const rs = new ResourceStore(() => memoryResourceAdapter(), backend)
      await rs.put(new Blob([new Uint8Array([1])]), { kind: 'image', ref: 'img-b-t2' })
      expect(rs.disposeUnreferenced(new Set())).toBe(1)
      expect(calls.revoked).toHaveLength(1)
    })

    it('put 时传 ref → 就用它当引用（名字可推算，才能"先查有没有"）', async () => {
      const { backend } = fakeBackend()
      const rs = new ResourceStore(() => memoryResourceAdapter(), backend)
      const ref = await rs.put(new Blob([new Uint8Array([1])]), { kind: 'image', ref: 'img-c-t3', derived: true })
      expect(ref).toBe('img-c-t3')
      expect(rs.alive('img-c-t3')).toBe(true)
    })
  })
})
