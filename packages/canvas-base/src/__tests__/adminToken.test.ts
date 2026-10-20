import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ADMIN_TOKEN_HEADER,
  ADMIN_TOKEN_KEY,
  clearAdminToken,
  getAdminToken,
  setAdminToken,
  withAdminToken,
} from '../adminToken'

/** 最小的 localStorage 替身（Node 里没有 DOM） */
class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}

const g = globalThis as { localStorage?: unknown }

beforeEach(() => { g.localStorage = new MemoryStorage() })
afterEach(() => { delete g.localStorage })

describe('adminToken', () => {
  it('键名固定', () => {
    expect(ADMIN_TOKEN_KEY).toBe('mc_admin_token')
    expect(ADMIN_TOKEN_HEADER).toBe('x-admin-token')
  })

  it('存取一致，周围空白被去掉', () => {
    setAdminToken('  abc  ')
    expect(getAdminToken()).toBe('abc')
  })

  it('空串等于清除', () => {
    setAdminToken('abc')
    setAdminToken('')
    expect(getAdminToken()).toBeUndefined()
    setAdminToken('abc')
    clearAdminToken()
    expect(getAdminToken()).toBeUndefined()
  })

  it('没存过时返回 undefined', () => {
    expect(getAdminToken()).toBeUndefined()
  })

  it('没有 localStorage 时也不抛（SSR / 隐私模式）', () => {
    delete g.localStorage
    expect(getAdminToken()).toBeUndefined()
    expect(() => setAdminToken('x')).not.toThrow()
    expect(withAdminToken({ a: '1' })).toEqual({ a: '1' })
  })

  it('withAdminToken 有令牌就加头，没有就原样', () => {
    expect(withAdminToken({ a: '1' })).toEqual({ a: '1' })
    setAdminToken('tok')
    expect(withAdminToken({ a: '1' })).toEqual({ a: '1', 'x-admin-token': 'tok' })
    expect(withAdminToken()).toEqual({ 'x-admin-token': 'tok' })
  })

  it('存储抛异常时读返回 undefined、写不抛', () => {
    g.localStorage = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
      removeItem() { throw new Error('denied') },
    }
    expect(getAdminToken()).toBeUndefined()
    expect(() => setAdminToken('x')).not.toThrow()
  })
})
