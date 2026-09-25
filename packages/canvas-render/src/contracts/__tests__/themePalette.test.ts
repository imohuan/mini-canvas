/**
 * themePalette 契约测试 —— 锁住"每个可配置颜色都有亮/暗两格"这条不变量，
 * 以及 token 表(TS) 与消费点(ui-theme.css) 两侧**不漂移**。
 *
 * 为什么值得单开：色板真正的坑是"改成两套值以后某一侧漏了/名字抄错" ——
 * 那种错误在界面上表现为"切到暗色后这个颜色没跟着变"，肉眼极难发现，
 * 而 token 表与消费点分居两个文件，只能靠测试钉住。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  THEME_COLOR_TOKENS,
  THEME_COLOR_LIGHT_GROUP,
  THEME_COLOR_DARK_GROUP,
  themeColorSlots,
  themeColorLightKey,
  themeColorDarkKey,
  themeColorInlineVar,
  themeColorVarNames,
  isThemeColorKey,
  buildThemeColorConfig,
  resolveThemeColorOverrides,
  resolveThemeColorValue,
  themeColorInlineVar as inlineVar,
} from '../themePalette'

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

describe('themePalette token 表', () => {
  it('每个 token 都有亮/暗两个默认值，且都是合法 hex（Config color 字段只收 hex）', () => {
    expect(THEME_COLOR_TOKENS.length).toBeGreaterThan(0)
    for (const t of THEME_COLOR_TOKENS) {
      expect(HEX.test(t.light), `${t.key}.light=${t.light}`).toBe(true)
      expect(HEX.test(t.dark), `${t.key}.dark=${t.dark}`).toBe(true)
    }
  })

  it('token key / cssVar 都不重复（重复会让两格互相覆盖）', () => {
    const keys = THEME_COLOR_TOKENS.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    const vars = THEME_COLOR_TOKENS.map((t) => t.cssVar)
    expect(new Set(vars).size).toBe(vars.length)
  })

  it('展平成 2×N 格：亮暗成对，settings key 与内联变量名一一对应', () => {
    const slots = themeColorSlots()
    expect(slots).toHaveLength(THEME_COLOR_TOKENS.length * 2)
    for (const t of THEME_COLOR_TOKENS) {
      expect(slots.find((s) => s.settingKey === themeColorLightKey(t.key))?.cssVar).toBe(
        themeColorInlineVar(t.key, 'light'),
      )
      expect(slots.find((s) => s.settingKey === themeColorDarkKey(t.key))?.cssVar).toBe(
        themeColorInlineVar(t.key, 'dark'),
      )
    }
  })

  it('内联变量名规则：--uic-<kebab>-light / -dark', () => {
    expect(themeColorInlineVar('accentColor', 'light')).toBe('--uic-accent-color-light')
    expect(themeColorInlineVar('accentColor', 'dark')).toBe('--uic-accent-color-dark')
    expect(themeColorInlineVar('edgeRailColor', 'dark')).toBe('--uic-edge-rail-color-dark')
  })
})

describe('buildThemeColorConfig', () => {
  it('为每格长一个 color 字段，默认值/分组/类型都对', () => {
    const schema = buildThemeColorConfig()
    expect(Object.keys(schema)).toHaveLength(THEME_COLOR_TOKENS.length * 2)
    for (const s of themeColorSlots()) {
      const f = schema[s.settingKey]
      expect(f, s.settingKey).toBeTruthy()
      expect(f.type).toBe('color')
      expect(f.default).toBe(s.default)
      expect(f.group).toBe(s.mode === 'light' ? THEME_COLOR_LIGHT_GROUP : THEME_COLOR_DARK_GROUP)
      expect(f.label).toBe(s.token.label)
    }
  })

  it('亮暗两套分组不同（设置面板里是两个页签，不是一坨）', () => {
    expect(THEME_COLOR_LIGHT_GROUP).not.toBe(THEME_COLOR_DARK_GROUP)
  })
})

describe('resolveThemeColorOverrides', () => {
  it('只返回"与默认值不同"的格：用户没动过的不写内联（否则会压掉主题插件的 CSS）', () => {
    const values: Record<string, unknown> = {}
    for (const s of themeColorSlots()) values[s.settingKey] = s.default
    values[themeColorLightKey('accentColor')] = '  #7c3aed  '
    delete values[themeColorDarkKey('dangerColor')]

    const vars = resolveThemeColorOverrides((k) => values[k])
    const map = new Map(vars.map((v) => [v.name, v.value]))
    // 唯一改动的一格被收敛成规范值写出来
    expect(map.get(inlineVar('accentColor', 'light'))).toBe('#7c3aed')
    // 其余全部等于默认值 → 一律不写
    expect(vars).toHaveLength(1)
  })

  it('改回默认值 = 不再写内联（清掉覆盖，交还给 CSS）', () => {
    const byKey = new Map(themeColorSlots().map((s) => [s.settingKey, s.default]))
    const vars = resolveThemeColorOverrides((k) => byKey.get(k))
    expect(vars).toEqual([])
  })

  it('非字符串/空白一律跳过', () => {
    expect(resolveThemeColorOverrides(() => 42)).toEqual([])
    expect(resolveThemeColorOverrides(() => '   ')).toEqual([])
  })
})

describe('resolveThemeColorValue', () => {
  it('给非 CSS 通道的消费方：同一 token 在亮/暗下能取到不同值', () => {
    // 读不到配置 → 回落 token 默认值
    expect(resolveThemeColorValue(() => undefined, 'edgeRailColor', 'light')).toBe('#1f2937')
    expect(resolveThemeColorValue(() => undefined, 'edgeRailColor', 'dark')).toBe('#9ca3af')
    // 用户改过暗色那格 → 只影响暗色
    const get = (k: string): unknown => (k === themeColorDarkKey('edgeRailColor') ? '#e5e7eb' : undefined)
    expect(resolveThemeColorValue(get, 'edgeRailColor', 'dark')).toBe('#e5e7eb')
    expect(resolveThemeColorValue(get, 'edgeRailColor', 'light')).toBe('#1f2937')
  })

  it('未知 token 返回 undefined（不抛）', () => {
    expect(resolveThemeColorValue(() => undefined, 'nope', 'light')).toBeUndefined()
  })
})

describe('key 归类', () => {
  it('isThemeColorKey 只认本色板的 key', () => {
    expect(isThemeColorKey(themeColorLightKey('accentColor'))).toBe(true)
    expect(isThemeColorKey(themeColorDarkKey('edgeFlowColor'))).toBe(true)
    expect(isThemeColorKey('edgeColor')).toBe(false)
    expect(isThemeColorKey('accentColor')).toBe(false)
  })

  it('themeColorVarNames 两格都覆盖（卸载时逐个清）', () => {
    expect(themeColorVarNames()).toHaveLength(THEME_COLOR_TOKENS.length * 2)
  })
})

describe('token 表 ↔ ui-theme.css 不漂移', () => {
  const css = readFileSync(fileURLToPath(new URL('../../styles/ui-theme.css', import.meta.url)), 'utf-8')
  const lightBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const darkBlock =
    css.match(/html\.dark,\s*\nhtml\[data-canvas-theme='dark'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

  it('两侧都能解析出变量块（解析失败会让下面的断言变成空断言）', () => {
    expect(lightBlock).toContain('--ui-accent')
    expect(darkBlock).toContain('--ui-accent')
  })

  it('每个 token：亮色块引用 -light 内联变量、暗色块引用 -dark（漏一侧 = 切主题不变色）', () => {
    for (const t of THEME_COLOR_TOKENS) {
      // 只断言"该格的内联变量名出现在该侧变量块里"：有的 token 需要包一层 color-mix 现算透明度
      // （如 --ui-guide），写死 `var(...)` 前缀会把合法写法误判成漂移。
      expect(lightBlock, `${t.key} 亮色块缺 ${themeColorInlineVar(t.key, 'light')}`).toContain(
        themeColorInlineVar(t.key, 'light'),
      )
      expect(darkBlock, `${t.key} 暗色块缺 ${themeColorInlineVar(t.key, 'dark')}`).toContain(
        themeColorInlineVar(t.key, 'dark'),
      )
      // 反向：亮色块不该出现暗色格、暗色块不该出现亮色格（抄错一侧同样是"切主题不变色"）
      expect(lightBlock, `${t.key} 亮色块误用暗色格`).not.toContain(
        themeColorInlineVar(t.key, 'dark'),
      )
      expect(darkBlock, `${t.key} 暗色块误用亮色格`).not.toContain(
        themeColorInlineVar(t.key, 'light'),
      )
    }
  })
})
