import { describe, it, expect } from 'vitest'
import { ThemeRegistry } from '../themeRegistry'

describe('ThemeRegistry subscribe 变更订阅', () => {
  it('register/addOccupant/removeOccupant/set 都触发；取消订阅后不再触发', () => {
    const r = new ThemeRegistry()
    let calls = 0
    const off = r.subscribe(() => { calls += 1 })
    r.register('nodeShell', 'Shell')
    r.addOccupant('nodeShell', { id: 'skin2', order: 1, value: 'Shell2' })
    r.set('background', 'Bg')
    r.removeOccupant('nodeShell', 'skin2')
    expect(calls).toBe(4)
    off()
    r.register('edge', 'Edge')
    expect(calls).toBe(4)
  })
  it('重复 register 抛错前不触发；unregister 触发', () => {
    const r = new ThemeRegistry()
    r.register('nodeShell', 'Shell')
    let calls = 0
    r.subscribe(() => { calls += 1 })
    expect(() => r.register('nodeShell', 'Shell2')).toThrow()
    expect(calls).toBe(0)
    r.unregister('nodeShell')
    expect(calls).toBe(1)
    expect(r.winner('nodeShell')).toBeUndefined()
  })
})

