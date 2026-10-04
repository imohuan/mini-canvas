import { describe, it, expect } from 'vitest'
import { resolveApiBase, apiUrl } from './apiBase'

/** 造一个最小的 ctx 替身（只有 tryGet） */
const fakeCtx = (services: Record<string, unknown>) => ({
  tryGet<T>(name: string): T | undefined {
    return services[name] as T | undefined
  },
})

describe('resolveApiBase（后台半在哪）', () => {
  it('settings 里的服务地址优先（跨源独立界面场景）', () => {
    const ctx = fakeCtx({
      settings: { get: (k: string) => (k === 'cloudClientBaseUrl' ? 'http://127.0.0.1:8865/' : undefined) },
    })
    expect(resolveApiBase(ctx)).toBe('http://127.0.0.1:8865')
  })

  it('settings 空 → 回落 cloud-client 服务的 baseUrl', () => {
    const ctx = fakeCtx({
      settings: { get: () => '' },
      'cloud-client': { status: () => ({ baseUrl: 'http://srv:9000' }) },
    })
    expect(resolveApiBase(ctx)).toBe('http://srv:9000')
  })

  it('都没有 → 空串（同源托管，界面由 cloud-server 发）', () => {
    expect(resolveApiBase(fakeCtx({}))).toBe('')
  })

  it('忽略空白地址（用户清空设置项 = 回到同源）', () => {
    const ctx = fakeCtx({ settings: { get: () => '   ' } })
    expect(resolveApiBase(ctx)).toBe('')
  })
})

describe('apiUrl（拼地址）', () => {
  it('base 为空 → 保持相对（同源）', () => {
    expect(apiUrl('', '/api/showcase/meta')).toBe('/api/showcase/meta')
  })

  it('base 非空 → 拼成完整地址（跨源）', () => {
    expect(apiUrl('http://srv:8865', '/api/showcase/meta')).toBe('http://srv:8865/api/showcase/meta')
  })

  it('已是绝对地址 → 原样返回', () => {
    expect(apiUrl('http://srv', 'https://cdn/x')).toBe('https://cdn/x')
  })
})
