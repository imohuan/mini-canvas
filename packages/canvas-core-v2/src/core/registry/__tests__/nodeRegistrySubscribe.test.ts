import { describe, it, expect } from 'vitest'
import { NodeRegistry } from '../nodeRegistry'

describe('NodeRegistry subscribe 变更订阅', () => {
  it('register/unregister/set/contribution 都触发；取消订阅后不再触发', () => {
    const r = new NodeRegistry()
    let calls = 0
    const off = r.subscribe(() => { calls += 1 })
    r.register('a', { content: 'A' })
    r.set('b', { content: 'B' })
    r.registerContribution('a', 'content', { id: 'x', component: 'X' })
    r.unregister('a')
    expect(calls).toBe(4)
    off()
    r.register('c', { content: 'C' })
    expect(calls).toBe(4)
  })
  it('重复 register 抛错前不触发', () => {
    const r = new NodeRegistry()
    r.register('a', { content: 'A' })
    let calls = 0
    r.subscribe(() => { calls += 1 })
    expect(() => r.register('a', { content: 'A2' })).toThrow()
    expect(calls).toBe(0)
  })
  it('最后一次取消订阅后转发链也回收', () => {
    const r = new NodeRegistry()
    let calls = 0
    const off = r.subscribe(() => { calls += 1 })
    off()
    const off2 = r.subscribe(() => { calls += 1 })
    r.registerContribution('a', 'content', { id: 'x', component: 'X' })
    expect(calls).toBe(1)
    off2()
  })
})

