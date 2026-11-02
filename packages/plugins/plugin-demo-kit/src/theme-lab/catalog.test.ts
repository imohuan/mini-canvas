import { describe, expect, it } from 'vitest'
import { baseKeyOf, buildColorEntries, type DeclaredColorField } from './catalog'

function field(key: string, extra: Partial<DeclaredColorField['schema']> = {}): DeclaredColorField {
  return {
    group: '外观/主题配色',
    key,
    schema: { type: 'color', default: '', ...extra },
    value: '',
  }
}

const baseFields: DeclaredColorField[] = [
  field('accentColorLight', { default: '#0891b2' }),
  field('accentColorDark', { default: '#22d3ee' }),
  field('multiSelectBoxColorLight', { default: '' }),
  field('multiSelectBoxColorDark', { default: '' }),
  field('pathColor', { default: '' }),
  field('bladeColor', { default: '' }),
]

describe('theme lab 颜色目录', () => {
  it('亮/暗两格合成一条，base key 只留语义名', () => {
    expect(baseKeyOf('accentColorLight')).toBe('accentColor')
    expect(baseKeyOf('pathColor')).toBe('pathColor')
    const entries = buildColorEntries(baseFields.slice(0, 2), new Set(['theme-default']))
    expect(entries).toHaveLength(1)
    expect(entries[0].keys).toEqual({ light: 'accentColorLight', dark: 'accentColorDark' })
    expect(entries[0].defaults).toEqual({ light: '#0891b2', dark: '#22d3ee' })
  })

  it('插件没装时，它声明的颜色不会出现', () => {
    const entries = buildColorEntries(baseFields, new Set(['theme-default']))
    expect(entries.map((entry) => entry.id)).toEqual(['accentColor'])
  })

  it('插件装上后自动多出对应颜色，顺序按品牌 → 连线 → 选择 → 切割', () => {
    const entries = buildColorEntries(baseFields, new Set(['theme-default', 'multi-select', 'edge-cutting']))
    expect(entries.map((entry) => entry.id)).toEqual(['accentColor', 'multiSelectBoxColor', 'pathColor', 'bladeColor'])
    expect(entries[1].label).toBe('绘制框颜色')
  })

  it('没有元数据的字段仍然可编辑，但明确标成未绑定，不画假线', () => {
    const entries = buildColorEntries(
      [field('customBrandColorLight', { default: '#123456', label: '自定义品牌色' })],
      new Set(['theme-default']),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].bound).toBe(false)
    expect(entries[0].anchors).toEqual([])
  })
})
