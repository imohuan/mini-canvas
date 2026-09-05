import { describe, it, expect } from 'vitest'
import { SettingsStore } from '../settingsStore'

describe('SettingsStore（分组化配置单一数据源）', () => {
  it('define 声明组+items，get/groups 可读，初始值=default', () => {
    const s = new SettingsStore()
    s.define('基础', { nodeFill: { type: 'color', default: '#fff', label: '底色' }, corner: { type: 'number', default: 8, min: 0, max: 40, label: '圆角' } }, 'theme-a')
    expect(s.get('nodeFill')).toBe('#fff')
    expect(s.get('corner')).toBe(8)
    expect(s.groups()).toEqual(['基础'])
    expect(s.groupOf('基础').map((e) => e.key)).toEqual(['nodeFill', 'corner'])
  })

  it('set 改值并通知；未知 key 抛错；number 越界夹取', () => {
    const s = new SettingsStore()
    s.define('g', { x: { type: 'number', default: 5, min: 0, max: 10 } }, 'p')
    const seen: unknown[][] = []
    s.onChange((k, v) => seen.push([k, v]), { scope: 'p' })
    expect(s.set('x', 20)).toBe(true) // 夹到 10
    expect(s.get('x')).toBe(10)
    expect(seen).toEqual([['x', 10]])
    expect(s.set('x', 10)).toBe(false) // 没变不通知
    expect(seen).toHaveLength(1)
    expect(() => s.set('nope', 1)).toThrow(/not defined/)
  })

  it('同 key 重复 define 抛错', () => {
    const s = new SettingsStore()
    s.define('a', { k: { type: 'number', default: 1 } })
    expect(() => s.define('b', { k: { type: 'number', default: 2 } })).toThrow(/already defined/)
  })

  it('按作用域订阅：只收声明方(scope)的变更，别的插件改自己不触发', () => {
    const s = new SettingsStore()
    s.define('主题', { edgeColor: { type: 'color', default: '#000' } }, 'theme-default')
    s.define('别的', { foo: { type: 'boolean', default: false } }, 'other')
    const hits: string[] = []
    // theme-default 订阅自己那份 → 别的插件(other)改自己的不触发
    const off = s.onChange((k) => hits.push(k), { scope: 'theme-default' })
    s.set('edgeColor', '#123') // 声明方 theme-default → 命中
    s.set('foo', true) // 声明方 other → 不命中(不误触)
    expect(hits).toEqual(['edgeColor'])
    off.dispose()
    s.set('edgeColor', '#456') // 已退订
    expect(hits).toEqual(['edgeColor'])
  })
})
