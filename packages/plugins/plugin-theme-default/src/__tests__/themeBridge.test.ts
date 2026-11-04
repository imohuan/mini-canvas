/**
 * themeBridge 契约：默认主题把「圆角 / 字体」交接给组件库。
 *
 * 这几条都在钉同一件事：**没配置时不改变观感**，只有用户主动改才写内联变量。
 * 颜色不在这里 —— 颜色统一走 --ui-* 语义色板，组件库 host.css 已映射过去。
 */
import { describe, expect, it } from 'vitest'
import {
  THEME_BRIDGE_VARS,
  THEME_FONT_CHOICES,
  THEME_RADIUS_CHOICES,
  applyThemeBridge,
  clearThemeBridge,
  resolveThemeBridgeVars,
  toThemeBridgeInput,
} from '../themeBridge'
import { DEFAULT_POPUP_CONFIG, popupConfig } from '@mini-canvas/ui-kit-shadcn'

/** 最小假的 style 容器：只实现 setProperty / removeProperty */
function fakeRoot() {
  const map = new Map<string, string>()
  const attrs = new Map<string, string>()
  return {
    el: {
      style: {
        setProperty: (name: string, value: string) => void map.set(name, value),
        removeProperty: (name: string) => void map.delete(name),
      },
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
      removeAttribute: (name: string) => void attrs.delete(name),
    } as unknown as HTMLElement,
    map,
    attrs,
  }
}

describe('外观交接：默认档不改观感', () => {
  it('全默认 → 一个变量都不写（CSS 回落到项目原有值）', () => {
    expect(
      resolveThemeBridgeVars({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'inherit' }),
    ).toEqual({})
  })

  it('只改圆角 → 组件库与项目自身的三档圆角一起写（设置面板里外一致）', () => {
    const vars = resolveThemeBridgeVars({
      radius: 'large',
      font: 'inherit',
      heading: 'inherit',
      size: 'inherit',
    })
    expect(vars[THEME_BRIDGE_VARS.radius]).toBe('0.875rem')
    expect(vars[THEME_BRIDGE_VARS.radiusControl]).toBe('0.875rem')
    expect(vars[THEME_BRIDGE_VARS.radiusOpen]).toBe('calc(0.875rem * 1.5)')
    expect(vars[THEME_BRIDGE_VARS.radiusPanel]).toBe('calc(0.875rem * 2)')
    // 字体没选，就不该写字体变量
    expect(vars[THEME_BRIDGE_VARS.fontBody]).toBeUndefined()
  })

  it('标题「跟随正文」→ 写 var 引用，正文变了标题一起变', () => {
    const vars = resolveThemeBridgeVars({
      radius: 'inherit',
      font: 'inter',
      heading: 'inherit',
      size: 'inherit',
    })
    expect(vars[THEME_BRIDGE_VARS.fontBody]).toContain('Inter')
    expect(vars[THEME_BRIDGE_VARS.fontHeading]).toBe('var(--mct-font-body, inherit)')
  })

  it('正文跟随宿主、标题单独选 → 只写标题，不写正文', () => {
    const vars = resolveThemeBridgeVars({
      radius: 'inherit',
      font: 'inherit',
      heading: 'roboto',
      size: 'inherit',
    })
    expect(vars[THEME_BRIDGE_VARS.fontBody]).toBeUndefined()
    expect(vars[THEME_BRIDGE_VARS.fontHeading]).toContain('Roboto')
  })
})

describe('外观交接：落值与清理', () => {
  it('写进去的变量能读到；改成默认后旧键被清掉（不留幽灵变量）', () => {
    const { el, map } = fakeRoot()
    applyThemeBridge({ radius: 'large', font: 'inter', heading: 'inherit', size: 'inherit' }, el)
    expect(map.get(THEME_BRIDGE_VARS.radius)).toBe('0.875rem')
    expect(map.has(THEME_BRIDGE_VARS.fontBody)).toBe(true)

    applyThemeBridge({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'inherit' }, el)
    expect(map.size).toBe(0)
  })

  it('卸载时清空全部桥接变量', () => {
    const { el, map } = fakeRoot()
    applyThemeBridge({ radius: 'small', font: 'inter', heading: 'inherit', size: 'inherit' }, el)
    clearThemeBridge(el)
    expect(map.size).toBe(0)
  })

  it('设置里读到不认识的档位 → 回落默认，不抛错', () => {
    expect(toThemeBridgeInput({ themeRadius: 'huge', themeFont: 'comic-sans' })).toEqual({
      radius: 'inherit',
      font: 'inherit',
      heading: 'inherit',
      size: 'inherit',
      popup: DEFAULT_POPUP_CONFIG,
    })
  })

  it('合法档位原样透传', () => {
    expect(
      toThemeBridgeInput({ themeRadius: 'medium', themeFont: 'inter', themeHeadingFont: 'roboto' }),
    ).toEqual({
      radius: 'medium',
      font: 'inter',
      heading: 'roboto',
      size: 'inherit',
      popup: DEFAULT_POPUP_CONFIG,
    })
  })
})

describe('外观交接：选项表', () => {
  it('圆角与字体的每个档位都有对应值（漏一个 = 选了点不动）', () => {
    for (const radius of THEME_RADIUS_CHOICES) {
      const value = resolveThemeBridgeVars({
        radius,
        font: 'inherit',
        heading: 'inherit',
        size: 'inherit',
      })[THEME_BRIDGE_VARS.radius]
      expect(typeof value).toBe(radius === 'inherit' ? 'undefined' : 'string')
    }
    for (const font of THEME_FONT_CHOICES) {
      const vars = resolveThemeBridgeVars({
        radius: 'inherit',
        font,
        heading: 'inherit',
        size: 'inherit',
      })
      expect(Boolean(vars[THEME_BRIDGE_VARS.fontBody])).toBe(font !== 'inherit')
    }
  })
})

describe('外观交接：尺寸档位', () => {
  it('选标准档 → 写出整组 --mct-size-*（值与原 shadcn 尺寸一致）', () => {
    const vars = resolveThemeBridgeVars({
      radius: 'inherit',
      font: 'inherit',
      heading: 'inherit',
      size: 'default',
    })
    expect(vars['--mct-size-control-h']).toBe('2.25rem')
    expect(vars['--mct-size-control-h-sm']).toBe('2rem')
    expect(vars['--mct-size-switch-w']).toBe('2.75rem')
  })

  it('紧凑比标准小，大档比标准大（档位单调）', () => {
    const base = { radius: 'inherit', font: 'inherit', heading: 'inherit' } as const
    const compact = resolveThemeBridgeVars({ ...base, size: 'compact' })['--mct-size-control-h']
    const standard = resolveThemeBridgeVars({ ...base, size: 'default' })['--mct-size-control-h']
    const large = resolveThemeBridgeVars({ ...base, size: 'large' })['--mct-size-control-h']
    expect(parseFloat(compact!)).toBeLessThan(parseFloat(standard!))
    expect(parseFloat(large!)).toBeGreaterThan(parseFloat(standard!))
  })

  it('切回跟随默认 → 尺寸变量全部清掉，不留幽灵值', () => {
    const { el, map, attrs } = fakeRoot()
    applyThemeBridge({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'large' }, el)
    expect(map.has('--mct-size-control-h')).toBe(true)
    expect(attrs.get('data-mct-size')).toBe('large')
    applyThemeBridge({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'inherit' }, el)
    expect([...map.keys()].filter((k) => k.startsWith('--mct-size-'))).toEqual([])
    expect(attrs.has('data-mct-size')).toBe(false)
  })
})

describe('外观交接：浮层配置', () => {
  it('浮层四项进入桥接输入，未知值回落默认', () => {
    const input = toThemeBridgeInput({
      themePopupArrow: 'show',
      themePopupGap: '12',
      themePopupSubGap: '4',
      themePopupSelectedStyle: 'check',
    })
    expect(input.popup).toEqual({ arrow: 'show', gap: 12, subGap: 4, selectedStyle: 'check' })

    const fallback = toThemeBridgeInput({
      themePopupArrow: 'wat',
      themePopupGap: Number.NaN,
      themePopupSubGap: Number.NaN,
      themePopupSelectedStyle: 'wat',
    })
    expect(fallback.popup).toEqual(DEFAULT_POPUP_CONFIG)
  })

  it('落值时同步更新组件库的浮层响应式配置', () => {
    applyThemeBridge({
      radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'inherit',
      popup: { arrow: 'hide', gap: 12, subGap: 4, selectedStyle: 'check' },
    })
    expect(popupConfig.arrow).toBe('hide')
    expect(popupConfig.gap).toBe(12)
    expect(popupConfig.subGap).toBe(4)
    // 传一个最小根节点：纯逻辑测试没有 document，clearThemeBridge 在没有 root 时会直接返回。
    clearThemeBridge(fakeRoot().el)
    expect(popupConfig).toEqual(DEFAULT_POPUP_CONFIG)
  })
})

describe('外观交接：浮层字段文案', () => {
  it('Config 的四个浮层字段挂在「外观/浮层」并给出真实选项', { timeout: 15000 }, async () => {
    const { Config } = await import('../index')
    const fields = Object.entries(Config).filter(([, schema]) => schema.group === '外观/浮层')
    expect(fields.map(([key]) => key).sort()).toEqual([
      'themePopupArrow', 'themePopupGap', 'themePopupSelectedStyle', 'themePopupSubGap',
    ])
    for (const [, schema] of fields) expect(schema.type).toBe('select')
  })
})

