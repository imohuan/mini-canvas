/**
 * capability 单测：内容类型接受 + 容量/挤出判定。
 * 纯函数、零 Vue，Node 可测。
 */
import { describe, it, expect } from 'vitest'
import {
  contentTypeAccepted,
  decideCapacity,
  evaluateContentConnect,
} from '../capability'

describe('capability: contentTypeAccepted', () => {
  it('双方都没声明 → 接受(回落人人可连)', () => {
    expect(contentTypeAccepted(undefined, undefined)).toBe(true)
    expect(contentTypeAccepted(undefined, ['image'])).toBe(true)
    expect(contentTypeAccepted('image', undefined)).toBe(true)
  })
  it('源产 image、目标收 image → 接受', () => {
    expect(contentTypeAccepted('image', ['image', 'text'])).toBe(true)
  })
  it('源产 image、目标不收 image → 拒绝', () => {
    expect(contentTypeAccepted('image', ['text'])).toBe(false)
  })
})

describe('capability: decideCapacity', () => {
  it('缺省容量=1：1 条满、0 条未满', () => {
    expect(decideCapacity(0, undefined, undefined)).toEqual({ full: false, willEvict: false })
    expect(decideCapacity(1, undefined, undefined)).toEqual({ full: true, willEvict: true })
  })
  it('capacity=2：满 2、不挤满额直拒(evictOnFull=false)', () => {
    expect(decideCapacity(1, 2, false)).toEqual({ full: false, willEvict: false })
    expect(decideCapacity(2, 2, false)).toEqual({ full: true, willEvict: false })
  })
  it('evictOnFull 缺省 true：满额 willEvict=true', () => {
    expect(decideCapacity(2, 2, undefined)).toEqual({ full: true, willEvict: true })
  })
})

describe('capability: evaluateContentConnect', () => {
  it('类型接受 + 未满 → ok，无 willEvict', () => {
    const r = evaluateContentConnect({
      outputContentType: 'image',
      inputCapability: { acceptsTypes: ['image', 'text'], capacity: 2 },
      incomingCount: 1,
    })
    expect(r).toEqual({
      ok: true,
      reason: 'ok',
      decision: { typeAccepted: true, incomingCount: 1, full: false, willEvict: false },
    })
  })
  it('类型接受 + 满额但可挤 → ok + willEvict=true', () => {
    const r = evaluateContentConnect({
      outputContentType: 'image',
      inputCapability: { acceptsTypes: ['image'], capacity: 2 },
      incomingCount: 2,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.decision.willEvict).toBe(true)
      expect(r.decision.full).toBe(true)
    }
  })
  it('类型不接受 → type-not-accepted', () => {
    const r = evaluateContentConnect({
      outputContentType: 'video',
      inputCapability: { acceptsTypes: ['image'] },
      incomingCount: 0,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('type-not-accepted')
  })
  it('满额且不允许挤 → limit-reached', () => {
    const r = evaluateContentConnect({
      outputContentType: 'image',
      inputCapability: { acceptsTypes: ['image'], capacity: 1, evictOnFull: false },
      incomingCount: 1,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('limit-reached')
  })
})
