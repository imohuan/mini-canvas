import { describe, it, expect } from 'vitest'
import { SlotRegistry } from '../slotRegistry'

describe('SlotRegistry subscribe 变更订阅', () => {
  it('add/remove/clear 都触发；取消订阅后不再触发', () => {
    const r = new SlotRegistry()
    let calls = 0
    const off = r.subscribe(() => { calls += 1 })
    r.add('s', { id: 'a', value: 'A' })
    r.add('s', { id: 'b', value: 'B' })
    r.remove('s', 'a')
    r.clear('s')
    expect(calls).toBe(4)
    off()
    r.add('s', { id: 'c', value: 'C' })
    expect(calls).toBe(4)
  })
  it('remove no-op 不触发', () => {
    const r = new SlotRegistry()
    r.add('s', { id: 'a', value: 'A' })
    let calls = 0
    r.subscribe(() => { calls += 1 })
    expect(r.remove('s', 'nope')).toBe(false)
    expect(calls).toBe(0)
  })
  it('clearByPrefix 触发', () => {
    const r = new SlotRegistry()
    r.add('x/a', { value: 1 })
    r.add('y/b', { value: 2 })
    let calls = 0
    r.subscribe(() => { calls += 1 })
    r.clearByPrefix('x/')
    expect(calls).toBe(1)
    expect(r.slots()).toEqual(['y/b'])
  })
})

