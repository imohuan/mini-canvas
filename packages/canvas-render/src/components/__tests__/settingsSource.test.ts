/**
 * settingsSource.test —— settingsSourceFrom 的纯逻辑单测。
 *
 * 覆盖：从 ctx 取内置 settings 单一数据源并适配成设置面板消费的最小接口(SettingsPanelSource)：
 * groups/groupOf/set/onChange 一致可用、值读回一致、变更能订阅到。
 */
import { describe, it, expect } from 'vitest'
import { Context, SettingsStore } from '@mini-canvas/canvas-core-v2'
import { settingsSourceFrom } from '../settingsSource'

/** 造一个 ctx 并在其内置 settings 里声明一组配置(scope='theme')，模拟插件 Config 自动登记后的状态 */
function makeCtxWithSetting(): Context {
  const ctx = new Context()
  // ctx.get('settings') 恒为内置 SettingsStore 实例（见 Context）
  const store = ctx.get<SettingsStore>('settings')
  store.define(
    '连线',
    {
      edgeColor: { type: 'color', default: '#3b82f6', label: '连线颜色' },
      edgeType: { type: 'select', default: 'bezier', options: [{ value: 'bezier', label: '贝塞尔' }, { value: 'straight' }], label: '线型' },
    },
    'theme',
  )
  return ctx
}

describe('settingsSourceFrom（ctx.settings → 面板消费最小接口）', () => {
  it('返回内置 settings 单一数据源，groups 列出声明组', () => {
    const ctx = makeCtxWithSetting()
    const source = settingsSourceFrom(ctx)
    expect(source.groups()).toEqual(['连线'])
  })

  it('groupOf 返回该组项(schema 带类型/默认/label)，get 读当前值', () => {
    const ctx = makeCtxWithSetting()
    const source = settingsSourceFrom(ctx)
    const items = source.groupOf('连线')
    expect(items.map((i) => i.key).sort()).toEqual(['edgeColor', 'edgeType'])
    const color = items.find((i) => i.key === 'edgeColor')!
    expect(color.schema.type).toBe('color')
    expect(color.value).toBe('#3b82f6')
  })

  it('set 改值并返回 true；未声明 key 抛错(响亮失败同内核 SettingsStore)', () => {
    const ctx = makeCtxWithSetting()
    const source = settingsSourceFrom(ctx)
    expect(source.set('edgeColor', '#ff0000')).toBe(true)
    expect(source.groupOf('连线').find((i) => i.key === 'edgeColor')!.value).toBe('#ff0000')
    expect(() => source.set('no-such-key', 1)).toThrow(/not defined/)
  })

  it('onChange 订阅：set 触发回调(key,value)，返回句柄可 dispose 停收', () => {
    const ctx = makeCtxWithSetting()
    const source = settingsSourceFrom(ctx)
    const seen: Array<[string, unknown]> = []
    const h = source.onChange((k, v) => seen.push([k, v]))
    source.set('edgeType', 'straight')
    expect(seen).toEqual([['edgeType', 'straight']])
    h.dispose()
    source.set('edgeType', 'bezier')
    expect(seen).toHaveLength(1) // dispose 后不再收
  })
})
