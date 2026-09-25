/**
 * 色板接通测试 —— 锁住"宿主声明 + 落值"这两件在真实 settings store 上的行为：
 * 两格都出现在设置分组里、改一格只写那一格的内联变量、停用后清干净。
 *
 * 为什么用真 store（不用假对象）：本组配置的坑全在**声明与落值的配合**上
 * （分组名写错 → 面板里凭空消失；卸载不清 → 幽灵变量挡住下一个主题），
 * 用假 store 恰好把这些都测掉。
 */
import { describe, it, expect } from 'vitest'
import { SettingsStore } from '@mini-canvas/kernel'
import { defineThemePaletteSettings, installThemePalette } from '../themePaletteSettings'
import {
  THEME_COLOR_LIGHT_GROUP,
  THEME_COLOR_DARK_GROUP,
  themeColorSlots,
  themeColorLightKey,
  themeColorDarkKey,
  themeColorInlineVar,
} from '../../contracts/themePalette'

/** 假 DOM 元素：只记账 setProperty / removeProperty（Node 环境无 document） */
function fakeRoot() {
  const styles = new Map<string, string>()
  return {
    styles,
    style: {
      setProperty: (name: string, value: string) => void styles.set(name, value),
      removeProperty: (name: string) => void styles.delete(name),
    },
  } as unknown as HTMLElement & { styles: Map<string, string> }
}

describe('defineThemePaletteSettings', () => {
  it('每个 token 的亮/暗两格都登记进设置分组（分组写错 = 面板里凭空消失）', () => {
    const s = new SettingsStore()
    defineThemePaletteSettings(s)
    const groups = s.groups()
    expect(groups).toContain(THEME_COLOR_LIGHT_GROUP)
    expect(groups).toContain(THEME_COLOR_DARK_GROUP)
    expect(s.groupOf(THEME_COLOR_LIGHT_GROUP)).toHaveLength(themeColorSlots().length / 2)
    expect(s.groupOf(THEME_COLOR_DARK_GROUP)).toHaveLength(themeColorSlots().length / 2)
    // 取值器能读到默认值（面板渲染取色器要有初值）
    expect(s.get(themeColorLightKey('accentColor'))).toBe('#0891b2')
    expect(s.get(themeColorDarkKey('edgeRailColor'))).toBe('#9ca3af')
  })

  it('重复调用幂等（多宿主 / 二次 boot 不撞 key）', () => {
    const s = new SettingsStore()
    defineThemePaletteSettings(s)
    expect(() => defineThemePaletteSettings(s)).not.toThrow()
  })
})

describe('installThemePalette', () => {
  it('启动时不写内联（用户没改过 → 让 CSS 默认值/主题插件生效）', () => {
    const s = new SettingsStore()
    defineThemePaletteSettings(s)
    const root = fakeRoot()
    const dispose = installThemePalette(s, root)
    expect(root.styles.size).toBe(0)
    dispose()
  })

  it('改暗色那格只写 -dark 变量：亮色内联不受影响（两套主题各自独立）', () => {
    const s = new SettingsStore()
    defineThemePaletteSettings(s)
    const root = fakeRoot()
    const dispose = installThemePalette(s, root)

    s.set(themeColorDarkKey('edgeRailColor'), '#e5e7eb')
    expect(root.styles.get(themeColorInlineVar('edgeRailColor', 'dark'))).toBe('#e5e7eb')
    expect(root.styles.has(themeColorInlineVar('edgeRailColor', 'light'))).toBe(false)

    s.set(themeColorLightKey('edgeRailColor'), '#111827')
    expect(root.styles.get(themeColorInlineVar('edgeRailColor', 'light'))).toBe('#111827')
    // 两格同时存在，各管一套主题
    expect(root.styles.get(themeColorInlineVar('edgeRailColor', 'dark'))).toBe('#e5e7eb')
    dispose()
  })

  it('改回默认值 = 清掉那一格的内联（交还给 CSS/主题插件）', () => {
    const s = new SettingsStore()
    defineThemePaletteSettings(s)
    const root = fakeRoot()
    const dispose = installThemePalette(s, root)
    s.set(themeColorDarkKey('accentColor'), '#7c3aed')
    const name = themeColorInlineVar('accentColor', 'dark')
    expect(root.styles.get(name)).toBe('#7c3aed')
    s.set(themeColorDarkKey('accentColor'), '#0891b2')
    expect(root.styles.has(name)).toBe(false)
    dispose()
  })

  it('别人的配置变化不误触：只认自己色板的 key', () => {
    const s = new SettingsStore()
    defineThemePaletteSettings(s)
    s.define('别的组', { someOtherColor: { type: 'color', default: '#000000' } }, 'other')
    const root = fakeRoot()
    const dispose = installThemePalette(s, root)
    s.set('someOtherColor', '#ff0000')
    expect(root.styles.size).toBe(0)
    dispose()
  })

  it('dispose 清掉全部内联覆盖（防幽灵变量挡住下一个主题）', () => {
    const s = new SettingsStore()
    defineThemePaletteSettings(s)
    const root = fakeRoot()
    const dispose = installThemePalette(s, root)
    s.set(themeColorLightKey('accentColor'), '#7c3aed')
    s.set(themeColorDarkKey('warnColor'), '#facc15')
    expect(root.styles.size).toBe(2)
    dispose()
    expect(root.styles.size).toBe(0)
    // 卸载后 store 再变也不再写
    s.set(themeColorLightKey('accentColor'), '#000000')
    expect(root.styles.size).toBe(0)
  })

  it('无 settings 时不抛（纯渲染宿主 / 测试环境）', () => {
    const root = fakeRoot()
    expect(() => installThemePalette(undefined, root)()).not.toThrow()
  })
})
