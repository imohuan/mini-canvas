import { describe, it, expect } from 'vitest'
import {
  ResourceStore,
  type ResourceUrlBackend,
  sanitizeTransientResourceUrls,
  sanitizeForeignResourceRefs,
  adoptNodeResources,
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

/** 带画布作用域的内存后端（模拟云端：`<画布id>/<哈希>`） */
function scopedAdapter(canvasId: string): ResourceAdapter {
  const blobs = new Map<string, Blob>()
  let seq = 0
  return {
    id: 'scoped',
    capability: {},
    ownsResource: (ref) => ref.startsWith(canvasId + '/') || ref.startsWith('/api/canvases/' + canvasId + '/resources/'),
    normalizeRef: (ref) => {
      const marker = '/api/canvases/' + canvasId + '/resources/'
      if (ref.startsWith(marker)) return canvasId + '/' + ref.slice(marker.length)
      return ref.startsWith(canvasId + '/') ? ref : undefined
    },
    async putResource(blob) {
      seq += 1
      const ref = canvasId + '/hash' + seq
      blobs.set(ref, blob)
      return ref
    },
    async resolveResource(ref) {
      return blobs.has(ref) ? '/api/canvases/' + ref : undefined
    },
    async removeResource(ref) { blobs.delete(ref) },
  }
}

describe('资源归属：画布就是文件夹', () => {
  it('owns 只认本画布的引用；后端没给判断时认本地取件码', () => {
    const scoped = new ResourceStore(() => scopedAdapter('a'), { revokeUrl() {} })
    expect(scoped.owns('a/hash1')).toBe(true)
    expect(scoped.owns('b/hash1')).toBe(false)
    const bare = new ResourceStore(() => memoryResourceAdapter(), { revokeUrl() {} })
    // 后端没给判断：本地取件码仍认（它产自本浏览器），别的画布 ID 一律不认
    expect(bare.owns('res-1')).toBe(true)
    expect(bare.owns('b/hash1')).toBe(false)
    // 完全没有资源后端时，本地取件码仍认定为本机（单测 / 极简宿主）
    const noAdapter = new ResourceStore(undefined, { revokeUrl() {} })
    expect(noAdapter.owns('res-1')).toBe(true)
    expect(noAdapter.owns('b/hash1')).toBe(false)
  })

  it('isForeign 认别的画布、外站与别的本地引用，放过临时地址', () => {
    const rs = new ResourceStore(() => scopedAdapter('a'), { revokeUrl() {} })
    expect(rs.isForeign('/api/canvases/b/resources/hash1.png')).toBe(true)
    expect(rs.isForeign('http://localhost:9000/files/x.png')).toBe(true)
    expect(rs.isForeign('b/hash1.png')).toBe(true)
    // 同源绝对地址但属于本画布：不算外站
    expect(rs.isForeign('http://localhost:8865/api/canvases/a/resources/hash1.png')).toBe(false)
    expect(rs.isForeign('/api/canvases/a/resources/hash1.png')).toBe(false)
    expect(rs.isForeign('a/hash1.png')).toBe(false)
    // 资产库文件也算画布外：画布不能指向资产库（删掉资产画布就破图）
    expect(rs.isForeign('/api/assets/files/abc.png')).toBe(true)
    expect(rs.isForeign('blob:xyz')).toBe(false)
    expect(rs.isForeign('data:image/png;base64,AAAA')).toBe(false)
  })

  it('adopt：本画布引用原样返回；外来字节复制进来后换成新引用', async () => {
    const adapter = scopedAdapter('a')
    const rs = new ResourceStore(() => adapter, { revokeUrl() {} })
    // 本画布的旧同源 URL → 升级成持久引用（地址不当第二份真相）
    expect(await rs.adopt('/api/canvases/a/resources/hash1.png')).toBe('a/hash1.png')
    const made = await rs.adopt('https://cdn.example.com/x.png', {
      kind: 'image',
      fetchBytes: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }),
    })
    expect(made).toBe('a/hash1')
  })

  it('adopt：取不到字节返回 undefined（绝不写一个打不开的引用）', async () => {
    const rs = new ResourceStore(() => scopedAdapter('a'), { revokeUrl() {} })
    expect(await rs.adopt('https://cdn.example.com/gone.png', { fetchBytes: async () => undefined })).toBeUndefined()
  })
})

describe('保存清理与打开修复', () => {
  const isForeign = (v: string) => /^https?:\/\//.test(v) || /^\/api\/canvases\/b\//.test(v) || v.startsWith('b/')

  it('有 resourceId 时不再保留地址字段（地址是副本，不是第二份真相）', () => {
    const got = sanitizeForeignResourceRefs(
      [{ id: '1', data: { resourceId: 'a/hash1', imageUrl: '/api/canvases/a/resources/hash1.png', label: 'x' } }],
      { isForeign },
    )
    expect(got.nodes[0].data).toEqual({ resourceId: 'a/hash1', label: 'x' })
    expect(got.foreign).toHaveLength(0)
  })

  it('外来地址删掉；外来引用保留并单独记下来待修复', () => {
    const got = sanitizeForeignResourceRefs(
      [{ id: '1', data: { imageUrl: '/api/canvases/b/resources/hash2.png' } },
       { id: '2', data: { resourceId: 'b/hash3.png' } }],
      { isForeign },
    )
    expect(got.nodes[0].data.imageUrl).toBeUndefined()
    expect(got.nodes[1].data.resourceId).toBe('b/hash3.png')
    expect(got.foreign).toEqual([{ id: '2', field: 'resourceId', value: 'b/hash3.png' }])
  })

  it('打开时把外来引用复制进本画布，失败则清掉并报告', async () => {
    const got = await adoptNodeResources(
      [
        { id: '1', type: 'image', data: { resourceId: 'b/hash1' } },
        { id: '2', type: 'video', data: { resourceId: 'b/hash2' } },
      ],
      {
        isForeign: (v: string) => v.startsWith('b/'),
        adopt: async (v) => (v === 'b/hash1' ? 'a/new1' : undefined),
      },
    )
    expect(got.nodes[0].data.resourceId).toBe('a/new1')
    expect(got.nodes[1].data.resourceId).toBeUndefined()
    expect(got.adopted).toBe(1)
    expect(got.failed).toEqual([{ id: '2', field: 'resourceId', value: 'b/hash2' }])
  })

  it('打开时把本画布的旧地址升级成引用（地址只是副本，不落存档）', async () => {
    const got = await adoptNodeResources(
      [
        { id: '1', type: 'image', data: { imageUrl: '/api/canvases/a/resources/hash1.png' } },
        { id: '2', type: 'video', data: { resourceId: 'a/hash2.mp4', videoUrl: '/api/canvases/a/resources/hash2.mp4' } },
      ],
      {
        isForeign: (v: string) => v.startsWith('b/'),
        adopt: async () => undefined,
        normalize: (v: string) => {
          const m = /^\/api\/canvases\/a\/resources\/(.+)$/.exec(v)
          return m ? 'a/' + m[1] : (v.startsWith('a/') ? v : undefined)
        },
      },
    )
    expect(got.nodes[0].data).toEqual({ resourceId: 'a/hash1.png' })
    expect(got.nodes[1].data).toEqual({ resourceId: 'a/hash2.mp4' })
  })
})
