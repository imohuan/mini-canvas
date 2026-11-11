/**
 * themeBridge 契约：把「圆角 / 字体 / 尺寸」交接给组件库与外壳。
 *
 * 这几条都在钉同一件事：**没配置时不改变观感**，只有用户主动改才写内联变量。
 * 颜色不在这里 —— 颜色统一走 --ui-* 语义色板，组件库 host.css 已映射过去。
 *
 * 背景：主题拆包时这份测试一度丢失，此后「尺寸档只写进组件配置、设置面板行高读一个
 * 永远没人写的 --plume-size-control-h」就没人守了（用户 2026-11-05 实测设置切大毫无反应）。
 */
import { describe, expect, it } from 'vitest'
import {
  THEME_BRIDGE_VARS,
  THEME_FONT_CHOICES,
  THEME_RADIUS_CHOICES,
  THEME_RADIUS_VALUES,
  applyThemeBridge,
  clearThemeBridge,
  resolveThemeBridgeVars,
  toThemeBridgeInput,
} from './themeBridge'
// 直接引用配置模块：从包根导入会连带 .vue 组件，纯 node 测试环境解析不了。
import {
  DEFAULT_COMPONENT_CONFIG,
  componentConfig,
  resetComponentConfig,
} from '@plume-canvas/ui-kit-shadcn/componentConfig'

/** 最小假的 style 容器：只实现 setProperty / removeProperty */
function fakeRoot() {
  const map = new Map<string, string>()
  return {
    el: {
      style: {
        setProperty: (name: string, value: string) => void map.set(name, value),
        removeProperty: (name: string) => void map.delete(name),
      },
    } as unknown as HTMLElement,
    map,
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
    // 期望值从档位表读：档位调过几轮，写死 0.875rem 早就过期了
    const large = THEME_RADIUS_VALUES.large
    expect(large).toBeTruthy()
    expect(vars[THEME_BRIDGE_VARS.radius]).toBe(large)
    expect(vars[THEME_BRIDGE_VARS.radiusControl]).toBe(large)
    expect(vars[THEME_BRIDGE_VARS.radiusOpen]).toBe('calc(' + large + ' * 1.5)')
    expect(vars[THEME_BRIDGE_VARS.radiusPanel]).toBe('calc(' + large + ' * 2)')
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
    expect(vars[THEME_BRIDGE_VARS.fontHeading]).toBe('var(--plume-font-body, inherit)')
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
    expect(map.get(THEME_BRIDGE_VARS.radius)).toBe(THEME_RADIUS_VALUES.large)
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
    })
  })

  it('合法档位原样透传', () => {
    expect(
      toThemeBridgeInput({ themeRadius: 'default', themeFont: 'inter', themeHeadingFont: 'roboto' }),
    ).toEqual({
      radius: 'default',
      font: 'inter',
      heading: 'roboto',
      size: 'inherit',
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
  it('尺寸写进组件配置（组件库控件按 size prop 变高）', () => {
    resetComponentConfig()
    const { el } = fakeRoot()
    applyThemeBridge({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'lg' }, el)
    expect(componentConfig.size).toBe('lg')
    resetComponentConfig()
  })

  /**
   * 用户口径 2026-11-05：设置界面切「大」时，面板里的行 / 下拉 / 输入框全都不动。
   *
   * 根因是面板自己的 CSS 读 `--plume-size-control-h`，而**没有任何地方写它**。
   * 这条钉住：每个非 inherit 档都必须写出一个可用的行高，且三档严格递增。
   */
  it('每一档都写设置面板行高变量，且小 < 标准 < 大', () => {
    const heightOf = (size: 'sm' | 'default' | 'lg'): string | undefined =>
      resolveThemeBridgeVars({ radius: 'inherit', font: 'inherit', heading: 'inherit', size })[
        THEME_BRIDGE_VARS.sizeControlHeight
      ]

    const small = heightOf('sm')
    const normal = heightOf('default')
    const large = heightOf('lg')
    for (const [tier, value] of [['sm', small], ['default', normal], ['lg', large]] as const) {
      expect(value, tier + ' 档没有写行高').toBeTruthy()
    }

    const px = (rem: string | undefined): number => {
      const match = /^([\d.]+)rem$/.exec(rem ?? '')
      expect(match, '行高必须是 rem：' + String(rem)).toBeTruthy()
      return Number(match![1]) * 16
    }
    expect(px(small)).toBeLessThan(px(normal))
    expect(px(normal)).toBeLessThan(px(large))
    // 与组件库按钮三档（32 / 36 / 40px）对齐，设置行才和其它控件齐平
    expect([px(small), px(normal), px(large)]).toEqual([32, 36, 40])
  })

  it('inherit 不写行高：回落到项目原有值', () => {
    const vars = resolveThemeBridgeVars({
      radius: 'inherit',
      font: 'inherit',
      heading: 'inherit',
      size: 'inherit',
    })
    expect(vars[THEME_BRIDGE_VARS.sizeControlHeight]).toBeUndefined()
  })

  it('清理时行高变量也一起摘掉', () => {
    const { el, map } = fakeRoot()
    applyThemeBridge({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'lg' }, el)
    expect(map.get(THEME_BRIDGE_VARS.sizeControlHeight)).toBeTruthy()
    clearThemeBridge(el)
    expect(map.has(THEME_BRIDGE_VARS.sizeControlHeight)).toBe(false)
    expect(componentConfig.size).toBe(DEFAULT_COMPONENT_CONFIG.size)
  })
})

describe('外观交接：浮层配置（已删除）', () => {
  it('设置页不再提供「外观/浮层」分组（四项只提供单一或近乎单一选择，已固定为默认）', { timeout: 15000 }, async () => {
    // 文件随主题拆包从 plugin-theme-default/src/__tests__ 挪到了本包 src，路径跟着改。
    const { Config } = await import('./index')
    const fields = Object.entries(Config).filter(([, schema]) => schema.group === '外观/浮层')
    expect(fields).toEqual([])
  })

  it('已删掉的浮层键不再出现在 Config 里（旧存档里的值被内核忽略）', {
    timeout: 15000,
  }, async () => {
    const { Config } = await import('./index')
    for (const key of ['themePopupArrow', 'themePopupGap', 'themePopupSubGap', 'themePopupSelectedStyle']) {
      expect(Object.keys(Config)).not.toContain(key)
    }
    // 旧存档里的 'medium' 档已并入 'default'：读不到就回落 inherit
    const input = toThemeBridgeInput({ themeRadius: 'medium' })
    expect(input).toEqual({ radius: 'inherit', font: 'inherit', heading: 'inherit', size: 'inherit' })
  })
})
