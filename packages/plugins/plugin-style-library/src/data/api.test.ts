import { describe, expect, it } from 'vitest'
import { apiUrl, friendlyError, resolveApiBase } from './api'

describe('apiUrl', () => {
  it('base 为空 = 同源相对路径', () => {
    expect(apiUrl('', '/api/style-library/items')).toBe('/api/style-library/items')
  })
  it('base 非空时补齐斜杠', () => {
    expect(apiUrl('http://127.0.0.1:8865', '/api/x')).toBe('http://127.0.0.1:8865/api/x')
    expect(apiUrl('http://127.0.0.1:8865', 'api/x')).toBe('http://127.0.0.1:8865/api/x')
  })
  it('绝对地址原样返回', () => {
    expect(apiUrl('http://a', 'https://b/c')).toBe('https://b/c')
  })
})

describe('resolveApiBase', () => {
  it('无 ctx → 空串（同源）', () => {
    expect(resolveApiBase(undefined)).toBe('')
  })
  it('优先读设置里的服务地址，并去掉尾斜杠', () => {
    const ctx = { tryGet: (n: string) => (n === 'settings' ? { get: () => 'http://x:1/' } : undefined) }
    expect(resolveApiBase(ctx)).toBe('http://x:1')
  })
  it('设置没有则回落 cloud-client 运行时服务', () => {
    const ctx = {
      tryGet: (n: string) =>
        n === 'cloud-client' ? { status: () => ({ baseUrl: 'http://y:2' }) } : undefined,
    }
    expect(resolveApiBase(ctx)).toBe('http://y:2')
  })
  it('都没有 → 空串', () => {
    const ctx = { tryGet: () => undefined }
    expect(resolveApiBase(ctx)).toBe('')
  })
})

describe('friendlyError', () => {
  it('HTML 应答翻成人话（提示服务地址 / 后台半）', () => {
    const msg = friendlyError("Unexpected token '<'")
    expect(msg).toContain('cloud-server')
    expect(msg).not.toContain('Unexpected')
  })
  it('其它错误原样返回', () => {
    expect(friendlyError('目录不存在：X')).toBe('目录不存在：X')
  })
})

