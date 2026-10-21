/**
 * 托管版后台注入令牌的消费逻辑（`adoptInjectedAdminToken`）。
 *
 * 三条规则：
 *   · 本地为空 → 接受注入；
 *   · 本地 == 上一轮注入的值 → 覆盖（后台轮换令牌也能跟上）；
 *   · 本地是**手填的别的值** → 不碰。
 *
 * 「是不是手填」用 `mc_admin_token_injected` 判断：它记着上一轮注入写的是什么。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adoptInjectedAdminToken } from '../adoptInjectedAdminToken'

let store: Map<string, string>

beforeEach(() => {
  store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  })
  vi.stubGlobal('window', {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function inject(token: string | undefined): void {
  ;(globalThis as unknown as { window: { __MC_ADMIN_TOKEN__?: unknown } }).window.__MC_ADMIN_TOKEN__ = token
  adoptInjectedAdminToken()
}

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const HAND = 'f'.repeat(64)

describe('adoptInjectedAdminToken：手填优先', () => {
  it('★ 本地为空 → 接受注入，并记下注入值', () => {
    inject(A)
    expect(store.get('mc_admin_token')).toBe(A)
    expect(store.get('mc_admin_token_injected')).toBe(A)
  })

  it('★ 本地 == 上一轮注入 → 覆盖（后台轮换令牌也能跟上）', () => {
    store.set('mc_admin_token', A)
    store.set('mc_admin_token_injected', A)
    inject(B)
    expect(store.get('mc_admin_token')).toBe(B)
    expect(store.get('mc_admin_token_injected')).toBe(B)
  })

  it('★ 本地是手填的别的值 → 不碰', () => {
    store.set('mc_admin_token', HAND)
    inject(A)
    expect(store.get('mc_admin_token')).toBe(HAND)
    // 也不该把自己记成「注入值」
    expect(store.get('mc_admin_token_injected')).toBeUndefined()
  })

  it('注入值为空时什么都不做', () => {
    store.set('mc_admin_token', HAND)
    inject('')
    expect(store.get('mc_admin_token')).toBe(HAND)
  })

  it('★ 读完就把全局变量删掉（不留在页面里被脚本读到）', () => {
    inject(A)
    const w = (globalThis as unknown as { window: { __MC_ADMIN_TOKEN__?: unknown } }).window
    expect(w.__MC_ADMIN_TOKEN__).toBeUndefined()
  })
})

