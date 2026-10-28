/**
 * SettingsStore.orderGroups —— 设置分组的显示顺序（与 UI 槽同一套规则）。
 *
 * before / after 填**分组名**（如「节点/端口」），不是 setting key。
 */
import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../settingsStore'

function seed(): SettingsStore {
  const s = new SettingsStore()
  s.define('节点/端口', { a: { type: 'number', default: 1 } }, 'p')
  s.define('节点/标题', { b: { type: 'number', default: 1 } }, 'p')
  s.define('常规/主题配色', { c: { type: 'color', default: '#000' } }, 'p')
  s.define('插件', { d: { type: 'boolean', default: false } }, 'p')
  return s
}

describe('SettingsStore.orderGroups', () => {
  it('未声明顺序时保持 groups() 原序', () => {
    expect(seed().groups()).toEqual(['节点/端口', '节点/标题', '常规/主题配色', '插件'])
  })

  it('order 小的分组在前；未声明 order 的保持原序', () => {
    const s = seed()
    s.orderGroups([{ group: '插件', order: 1 }])
    expect(s.groups()).toEqual(['插件', '节点/端口', '节点/标题', '常规/主题配色'])
  })

  it('before 把分组插到目标之前（目标填分组名）', () => {
    const s = seed()
    s.orderGroups([{ group: '插件', before: '节点/端口' }])
    expect(s.groups()).toEqual(['插件', '节点/端口', '节点/标题', '常规/主题配色'])
  })

  it('after 把分组放到目标之后', () => {
    const s = seed()
    s.orderGroups([{ group: '常规/主题配色', after: '插件' }])
    const order = s.groups()
    expect(order.indexOf('常规/主题配色')).toBeGreaterThan(order.indexOf('插件'))
  })

  it('目标不存在时忽略约束、退回 order（不报错）', () => {
    const s = seed()
    s.orderGroups([{ group: '插件', before: '不存在的分组', order: 1 }])
    expect(s.groups()).toEqual(['插件', '节点/端口', '节点/标题', '常规/主题配色'])
  })

  it('重复声明同组 = 覆盖（后写赢）', () => {
    const s = seed()
    s.orderGroups([{ group: '插件', order: 1 }])
    expect(s.groups()[0]).toBe('插件')
    s.orderGroups([{ group: '插件', order: 250 }])
    // 250 仍小于"未声明组"的兜底区间（声明最大 order + 1 + 索引），故仍在最前
    expect(s.groups()[0]).toBe('插件')
    // 再覆盖成 99 仍然只有一条声明（不会叠出第二个"插件"）
    s.orderGroups([{ group: '插件', order: 99 }])
    expect(s.groups().filter((g) => g === '插件')).toHaveLength(1)
  })

  it('orderGroups 触发 schema 变更订阅（面板会刷新）', () => {
    const s = seed()
    let hits = 0
    const off = s.onSchemaChange(() => { hits += 1 })
    s.orderGroups([{ group: '插件', order: 1 }])
    expect(hits).toBe(1)
    off.dispose()
  })
})
