import { describe, expect, it } from 'vitest'
import { isTransient, TRANSIENT_KEY, TRANSIENT_LEGACY_KEY } from '../transient'

describe('isTransient（中间态元素通用契约）', () => {
  it('data.transient === true 判为中间态', () => {
    expect(isTransient({ data: { [TRANSIENT_KEY]: true } })).toBe(true)
  })

  it('兼容历史遗留的 data.isTemp（内核 M5 起的约定）', () => {
    expect(isTransient({ data: { [TRANSIENT_LEGACY_KEY]: true } })).toBe(true)
  })

  it('其它值 / 缺省 data / 空对象都不是中间态', () => {
    expect(isTransient({ data: {} })).toBe(false)
    expect(isTransient({ data: { transient: false } })).toBe(false)
    expect(isTransient({ data: { transient: 'yes' } })).toBe(false)
    expect(isTransient({ data: { isTemp: 1 } })).toBe(false)
    expect(isTransient({})).toBe(false)
    expect(isTransient(undefined)).toBe(false)
    expect(isTransient(null)).toBe(false)
  })

  it('节点与边共用同一判定（形状只需带 data）', () => {
    const node = { id: 'n1', type: 'connection-menu', data: { transient: true } }
    const edge = { id: 'e1', source: 'a', target: 'n1', data: { transient: true } }
    expect(isTransient(node)).toBe(true)
    expect(isTransient(edge)).toBe(true)
  })
})
