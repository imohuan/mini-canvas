import { describe, it, expect } from 'vitest'
import { SettingsStore } from '../settingsStore'

describe('SettingsStore 保存快照（配置持久化桥原语）', () => {
  it('define 时命中快照的 key 以其为初值（优先于 schema.default）', () => {
    const s = new SettingsStore()
    s.setSavedSnapshot({ edgeColor: '#ff0000', untouched: 7 })
    s.define('g', { edgeColor: { type: 'color', default: '#000' }, other: { type: 'number', default: 1 } }, 'p')
    expect(s.get('edgeColor')).toBe('#ff0000') // 快照优先
    expect(s.get('other')).toBe(1) // 未保存项用默认
  })
  it('setSavedSnapshot 覆盖已声明项并通知；热装前注入快照也生效', () => {
    const s = new SettingsStore()
    s.define('g', { x: { type: 'number', default: 1 } }, 'p')
    const seen: unknown[][] = []
    s.onChange((k, v) => seen.push([k, v]))
    s.setSavedSnapshot({ x: 5 })
    expect(s.get('x')).toBe(5)
    expect(seen).toEqual([[ 'x', 5 ]])
  })
  it('clearSavedKeys 恢复该 key 到 schema.default 并从快照删除', () => {
    const s = new SettingsStore()
    s.define('g', { x: { type: 'number', default: 1 }, y: { type: 'number', default: 2 } }, 'p')
    s.setSavedSnapshot({ x: 9, y: 8 })
    s.clearSavedKeys(['x'])
    expect(s.get('x')).toBe(1)
    expect(s.get('y')).toBe(8) // 未清的不动
    const snap = s.getSavedSnapshot()!
    expect(snap.x).toBeUndefined()
    expect(snap.y).toBe(8)
  })
  it('entries 导出当前全部值（供桥保存）；setSavedSnapshot 无命中项也能整体重置', () => {
    const s = new SettingsStore()
    s.define('g', { a: { type: 'text', default: 'd' }, b: { type: 'boolean', default: false } }, 'p')
    s.set('a', 'changed')
    expect(s.entries()).toEqual({ a: 'changed', b: false })
    s.setSavedSnapshot({ a: 'restored' })
    expect(s.get('a')).toBe('restored')
  })
  it('从未注入快照时 getSavedSnapshot 返回 null', () => {
    const s = new SettingsStore()
    expect(s.getSavedSnapshot()).toBeNull()
  })
})

describe('SettingsStore onSchemaChange（P2-1 schema 变更订阅）', () => {
  it('define 新增项触发；removeByScope 移除项触发；set 值不触发（值变更走 onChange）', () => {
    const s = new SettingsStore()
    let calls = 0
    const off = s.onSchemaChange(() => { calls += 1 })
    s.define('g', { a: { type: 'number', default: 1 } }, 'p')
    expect(calls).toBe(1)
    s.define('g', { b: { type: 'number', default: 2 } }, 'p')
    expect(calls).toBe(2)
    s.set('a', 9) // 值变更不触发 schema
    expect(calls).toBe(2)
    s.removeByScope('p') // 移除两项 → 通知
    expect(calls).toBe(3)
    off.dispose()
    s.define('g', { c: { type: 'number', default: 3 } }, 'p')
    expect(calls).toBe(3) // 退订后不再收
  })
})

