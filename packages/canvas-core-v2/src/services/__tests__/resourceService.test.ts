import { describe, it, expect } from 'vitest'
import { ResourceStore, type ResourceUrlBackend } from '../resourceService'

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

