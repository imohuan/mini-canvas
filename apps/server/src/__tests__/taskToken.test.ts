import { describe, expect, it } from 'vitest'
import { createTaskTokens } from '../taskToken.js'

describe('任务令牌（只允许写本节点槽位）', () => {
  const fixedNow = 1_700_000_000_000
  const tokens = createTaskTokens({ secret: Buffer.alloc(32, 7), now: () => fixedNow })

  it('签出来的令牌对得上绑定的 canvas + node', () => {
    const t = tokens.issue('c1', 'n1')
    expect(tokens.verify(t, 'c1', 'n1')).toBe(true)
  })

  it('换画布 / 换节点都不行', () => {
    const t = tokens.issue('c1', 'n1')
    expect(tokens.verify(t, 'c2', 'n1')).toBe(false)
    expect(tokens.verify(t, 'c1', 'n2')).toBe(false)
  })

  it('过期即失效', () => {
    const t = tokens.issue('c1', 'n1', 1000)
    expect(tokens.verify(t, 'c1', 'n1')).toBe(true)
    // 到期那一刻也算过期（`exp < now()` 会让它多活一毫秒）
    const atExpiry = createTaskTokens({ secret: Buffer.alloc(32, 7), now: () => fixedNow + 1000 })
    expect(atExpiry.verify(t, 'c1', 'n1')).toBe(false)
    const later = createTaskTokens({ secret: Buffer.alloc(32, 7), now: () => fixedNow + 2000 })
    expect(later.verify(t, 'c1', 'n1')).toBe(false)
  })

  it('改一个字节就校验失败（签名保护）', () => {
    const t = tokens.issue('c1', 'n1')
    const broken = t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')
    expect(tokens.verify(broken, 'c1', 'n1')).toBe(false)
  })

  it('不同密钥签的令牌互不认', () => {
    const other = createTaskTokens({ secret: Buffer.alloc(32, 8), now: () => fixedNow })
    expect(tokens.verify(other.issue('c1', 'n1'), 'c1', 'n1')).toBe(false)
  })

  it('空 / 畸形令牌一律 false（不抛）', () => {
    for (const v of ['', 'abc', 'a.b.c', '..', undefined]) {
      expect(() => tokens.verify(v as string | undefined, 'c1', 'n1')).not.toThrow()
      expect(tokens.verify(v as string | undefined, 'c1', 'n1')).toBe(false)
    }
  })
})
