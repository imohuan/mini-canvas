/**
 * 群组框外观配置（用户要求）：
 * "小框就是根据选中节点计算的最小 rect 框（不包含标题）；大框是根据一个固定的 padding 进行的
 *  （这个请写在插件的 config 配置中）；你的小框和大框颜色和样式（比如使用实线还是虚线、线框宽度、
 *  颜色等）写在 config 配置中"。
 *
 * 这条文件锁三件事：
 * 1. schema 里确实有这些项（间距 + 两框各自的色/线型/线宽/圆角/填充）；
 * 2. 读配置时非法值各自独立回落默认（一项坏了不连累别的项，也绝不写出坏 CSS）；
 * 3. 生成出的 CSS 是配置的直接映射（改配置 → 样式就变）。
 */
import { describe, it, expect } from 'vitest'
import {
  Config,
  DEFAULT_MULTI_SELECT_FRAME,
  FRAME_LINE_STYLE_OPTIONS,
  MULTI_SELECT_FRAME_KEYS,
  MULTI_SELECT_COLOR_KEYS,
  applyMultiSelectFrameChange,
  frameStrokeCss,
  hexToRgba,
  framePaddingsOf,
  scaleFramePaddings,
  resolveMultiSelectFrameConfig,
} from '../multiSelectConfig'

/** 把 schema 当"key → 当前值"的读取器（模拟 settings 未改动时的初始态） */
function schemaDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, f] of Object.entries(Config)) out[k] = f.default
  return out
}

describe('Config schema（这些项必须出现在设置页面里）', () => {
  it('三个间距项都在，且都在「布局/多选」分组下', () => {
    for (const key of [
      MULTI_SELECT_FRAME_KEYS.paddingX,
      MULTI_SELECT_FRAME_KEYS.paddingTop,
      MULTI_SELECT_FRAME_KEYS.paddingBottom,
    ]) {
      expect(Config[key]).toBeDefined()
      expect(Config[key].group).toBe('布局/多选')
      expect(Config[key].type).toBe('number')
    }
  })

  it('两框各自的线型 / 线宽 / 圆角 / 填充都有独立项；颜色键保留但**不在设置里**（统一走主题配色）', () => {
    // 颜色键不在 Config 里（设置页面不出取色器；颜色统一在「常规/主题配色」里调）
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerColor]).toBeUndefined()
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerColor]).toBeUndefined()
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerStyle].type).toBe('select')
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerWidth].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerRadius].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerFill].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerStyle].type).toBe('select')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerWidth].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerRadius].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerFill].type).toBe('number')
  })

  it('绘制框（Shift 拖拽那个框）的线型 / 线宽 / 填充在设置里；颜色走主题', () => {
    expect(Config[MULTI_SELECT_FRAME_KEYS.boxStyle].type).toBe('select')
    expect(Config[MULTI_SELECT_FRAME_KEYS.boxStyle].group).toBe('布局/多选')
    expect(Config[MULTI_SELECT_FRAME_KEYS.boxWidth].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.boxFill].type).toBe('number')
  })

  it('线型下拉就是实线/虚线/点线三种（不是"有没有边框"的开关）', () => {
    expect(FRAME_LINE_STYLE_OPTIONS.map((o) => o.value)).toEqual(['solid', 'dashed', 'dotted'])
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerStyle].options?.map((o) => (typeof o === 'string' ? o : o.value)))
      .toEqual(['solid', 'dashed', 'dotted'])
  })

  it('默认值：左右 16 / 上 34 / 下 16；颜色默认留空（走主题配色）', () => {
    expect(DEFAULT_MULTI_SELECT_FRAME.paddingX).toBe(16)
    expect(DEFAULT_MULTI_SELECT_FRAME.paddingTop).toBe(34)
    expect(DEFAULT_MULTI_SELECT_FRAME.paddingBottom).toBe(16)
    // 颜色不再是默认值的一部分（缺省 = 用主题色）
    expect(DEFAULT_MULTI_SELECT_FRAME.outer.color).toBeUndefined()
    expect(DEFAULT_MULTI_SELECT_FRAME.inner.color).toBeUndefined()
    expect(DEFAULT_MULTI_SELECT_FRAME.outer.lineStyle).toBe('dashed')
    expect(DEFAULT_MULTI_SELECT_FRAME.outer.radius).toBe(6)
    expect(DEFAULT_MULTI_SELECT_FRAME.inner.lineStyle).toBe('solid')
    expect(DEFAULT_MULTI_SELECT_FRAME.inner.radius).toBe(0)
  })

  it('颜色已从本插件 Config 移出（用户要求删掉自定义色、改用主题配色）', () => {
    expect(Config['multiSelectFrameOuterColor']).toBeUndefined()
    expect(Config['multiSelectFrameInnerColor']).toBeUndefined()
  })

  it('内框默认直角（radius 0）—— 用户明确要求去掉内框的圆角效果', () => {
    expect(DEFAULT_MULTI_SELECT_FRAME.inner.radius).toBe(0)
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerRadius].default).toBe(0)
    // 默认配置生成出的内框样式必须是不圆角的
    const css = frameStrokeCss(DEFAULT_MULTI_SELECT_FRAME.inner)
    expect(css.borderRadius).toBe('0px')
  })

  it('小框 padding 三个项都在设置里（左右/上/下），默认全 0 = 紧贴节点', () => {
    for (const key of [
      MULTI_SELECT_FRAME_KEYS.innerPaddingX,
      MULTI_SELECT_FRAME_KEYS.innerPaddingTop,
      MULTI_SELECT_FRAME_KEYS.innerPaddingBottom,
    ]) {
      expect(Config[key]).toBeDefined()
      expect(Config[key].type).toBe('number')
      expect(Config[key].group).toBe('布局/多选')
      expect(Config[key].default).toBe(0)
    }
    expect(DEFAULT_MULTI_SELECT_FRAME.innerPaddingX).toBe(0)
    expect(DEFAULT_MULTI_SELECT_FRAME.innerPaddingTop).toBe(0)
    expect(DEFAULT_MULTI_SELECT_FRAME.innerPaddingBottom).toBe(0)
  })

  it('群组框总开关 与 多选时隐藏标题 两个开关都在设置里（默认：画框 + 不隐藏标题）', () => {
    expect(Config[MULTI_SELECT_FRAME_KEYS.enabled].type).toBe('boolean')
    expect(Config[MULTI_SELECT_FRAME_KEYS.enabled].group).toBe('布局/多选')
    expect(Config[MULTI_SELECT_FRAME_KEYS.enabled].default).toBe(true)
    expect(Config[MULTI_SELECT_FRAME_KEYS.hideTitles].type).toBe('boolean')
    expect(Config[MULTI_SELECT_FRAME_KEYS.hideTitles].group).toBe('布局/多选')
    expect(Config[MULTI_SELECT_FRAME_KEYS.hideTitles].default).toBe(false)
  })
})

describe('resolveMultiSelectFrameConfig（读配置）', () => {
  it('settings 未就绪 / 全为空 → 全走默认值', () => {
    expect(resolveMultiSelectFrameConfig(() => undefined)).toEqual(DEFAULT_MULTI_SELECT_FRAME)
  })

  it('按 schema 默认读出的值与常量默认一致（单一数据源不漂移）', () => {
    const all = schemaDefaults()
    expect(resolveMultiSelectFrameConfig((k) => all[k])).toEqual(DEFAULT_MULTI_SELECT_FRAME)
  })

  it('用户改了值就读到改后的值', () => {
    const all = schemaDefaults()
    all[MULTI_SELECT_FRAME_KEYS.paddingX] = 40
    all[MULTI_SELECT_FRAME_KEYS.innerStyle] = 'dotted'
    all[MULTI_SELECT_FRAME_KEYS.boxStyle] = 'dashed'
    const cfg = resolveMultiSelectFrameConfig((k) => all[k])
    expect(cfg.paddingX).toBe(40)
    expect(cfg.inner.lineStyle).toBe('dotted')
    expect(cfg.boxSelect.lineStyle).toBe('dashed')
  })

  it('非法值只回落那一项，别的项照旧（一项坏了不连累其它项）', () => {
    const all = schemaDefaults()
    all[MULTI_SELECT_FRAME_KEYS.paddingX] = 'abc'
    all[MULTI_SELECT_FRAME_KEYS.paddingTop] = Number.NaN
    all[MULTI_SELECT_FRAME_KEYS.paddingBottom] = -50
    all[MULTI_SELECT_FRAME_KEYS.outerStyle] = 'wavy'
    const cfg = resolveMultiSelectFrameConfig((k) => all[k])
    expect(cfg.paddingX).toBe(DEFAULT_MULTI_SELECT_FRAME.paddingX)
    expect(cfg.paddingTop).toBe(DEFAULT_MULTI_SELECT_FRAME.paddingTop)
    expect(cfg.paddingBottom).toBe(DEFAULT_MULTI_SELECT_FRAME.paddingBottom)
    expect(cfg.outer.lineStyle).toBe(DEFAULT_MULTI_SELECT_FRAME.outer.lineStyle)
  })

  it('颜色可选：给了就用它，没给 / 空串 / 非法 → undefined（消费方走主题变量）', () => {
    const withColor = schemaDefaults()
    withColor[MULTI_SELECT_COLOR_KEYS.outerLight] = '#ff0000'
    withColor[MULTI_SELECT_COLOR_KEYS.outerDark] = '#00ff00'
    // 亮色主题读亮色格、暗色主题读暗色格
    expect(resolveMultiSelectFrameConfig((k) => withColor[k], 'light').outer.color).toBe('#ff0000')
    expect(resolveMultiSelectFrameConfig((k) => withColor[k], 'dark').outer.color).toBe('#00ff00')
    for (const bad of ['', 'not-a-color', undefined]) {
      const all = schemaDefaults()
      all[MULTI_SELECT_COLOR_KEYS.outerLight] = bad
      all[MULTI_SELECT_COLOR_KEYS.outerDark] = bad
      expect(resolveMultiSelectFrameConfig((k) => all[k], 'dark').outer.color).toBeUndefined()
    }
  })

  it('填充% 换算成 0~1 不透明度，并按 0~100 夹取', () => {
    const all = schemaDefaults()
    all[MULTI_SELECT_FRAME_KEYS.innerFill] = 40
    expect(resolveMultiSelectFrameConfig((k) => all[k]).inner.fillOpacity).toBe(0.4)
    all[MULTI_SELECT_FRAME_KEYS.innerFill] = 500
    expect(resolveMultiSelectFrameConfig((k) => all[k]).inner.fillOpacity).toBe(1)
  })
})

describe('applyMultiSelectFrameChange（设置改动实时生效）', () => {
  it('只动被改的那一项，其余保持原值', () => {
    const before = { ...DEFAULT_MULTI_SELECT_FRAME, paddingX: 20 }
    const after = applyMultiSelectFrameChange(before, MULTI_SELECT_FRAME_KEYS.paddingX, 60)
    expect(after.paddingX).toBe(60)
    expect(after.paddingTop).toBe(before.paddingTop)
    expect(after.outer).toEqual(before.outer)
  })

  it('改内框样式不会碰到外框（两框互相独立）', () => {
    const after = applyMultiSelectFrameChange(
      DEFAULT_MULTI_SELECT_FRAME,
      MULTI_SELECT_FRAME_KEYS.innerStyle,
      'dotted',
    )
    expect(after.inner.lineStyle).toBe('dotted')
    expect(after.outer).toEqual(DEFAULT_MULTI_SELECT_FRAME.outer)
  })

  it('不认识的 key 原样返回同一引用（别的插件的配置改动不该引起本插件重渲染）', () => {
    const before = { ...DEFAULT_MULTI_SELECT_FRAME }
    expect(applyMultiSelectFrameChange(before, 'edgeColor', '#000000')).toBe(before)
  })

  it('改小框 padding 只动那一项，两框间距不受影响', () => {
    const after = applyMultiSelectFrameChange(
      DEFAULT_MULTI_SELECT_FRAME,
      MULTI_SELECT_FRAME_KEYS.innerPaddingTop,
      12,
    )
    expect(after.innerPaddingTop).toBe(12)
    expect(after.paddingTop).toBe(DEFAULT_MULTI_SELECT_FRAME.paddingTop)
    expect(after.innerPaddingX).toBe(0)
  })

  it('改两个开关也只动那一项（开关与几何参数互不干扰）', () => {
    const off = applyMultiSelectFrameChange(DEFAULT_MULTI_SELECT_FRAME, MULTI_SELECT_FRAME_KEYS.enabled, false)
    expect(off.enabled).toBe(false)
    expect(off.paddingX).toBe(DEFAULT_MULTI_SELECT_FRAME.paddingX)
    expect(off.inner).toEqual(DEFAULT_MULTI_SELECT_FRAME.inner)
    const hide = applyMultiSelectFrameChange(DEFAULT_MULTI_SELECT_FRAME, MULTI_SELECT_FRAME_KEYS.hideTitles, true)
    expect(hide.hideTitles).toBe(true)
    expect(hide.enabled).toBe(true)
  })

  it('开关传入非布尔脏值 → 回落默认（不会把开关误判成 false）', () => {
    const cfg = resolveMultiSelectFrameConfig((k) =>
      k === MULTI_SELECT_FRAME_KEYS.enabled ? 'yes' : undefined,
    )
    expect(cfg.enabled).toBe(true)
  })
})

describe('framePaddingsOf（配置 → 几何用的两组 padding）', () => {
  it('拆出"小框外扩"与"两框间距"两组，值一一对应', () => {
    const pads = framePaddingsOf({
      ...DEFAULT_MULTI_SELECT_FRAME,
      paddingX: 20,
      paddingTop: 40,
      paddingBottom: 30,
      innerPaddingX: 5,
      innerPaddingTop: 6,
      innerPaddingBottom: 7,
    })
    expect(pads.gap).toEqual({ paddingX: 20, paddingTop: 40, paddingBottom: 30 })
    expect(pads.inner).toEqual({ paddingX: 5, paddingTop: 6, paddingBottom: 7 })
  })

  it('默认配置 → 小框全 0（紧贴节点）、间距为 16/34/16', () => {
    const pads = framePaddingsOf(DEFAULT_MULTI_SELECT_FRAME)
    expect(pads.inner).toEqual({ paddingX: 0, paddingTop: 0, paddingBottom: 0 })
    expect(pads.gap).toEqual({ paddingX: 16, paddingTop: 34, paddingBottom: 16 })
  })
})

/**
 * 缩放时的选框间距（用户最新要求："希望这边的边框可以和画布一样一同缩放"）。
 *
 * 语义：配置里的 padding 是**画布(flow)单位**，跟随画布一起缩放 —— 缩画布时选框连同它的
 * 内边距一起变小，与节点卡片完全一致。**不做** 1/zoom 反缩放。
 *
 * 历史：这里一度按 1/zoom 换算成"屏幕上恒定"，那是因为当时**线宽**反缩放、间距不反缩放
 * 会让缩小时的线糊在一起。现在线宽也跟随画布（见 frameStrokeCss），两者同域，
 * 1/zoom 反而会让间距与线宽对接不上，所以统一改成"跟随画布"。
 */
describe('scaleFramePaddings —— 间距跟随画布缩放（不做 1/zoom 反缩放）', () => {
  const PADS = framePaddingsOf({
    ...DEFAULT_MULTI_SELECT_FRAME,
    paddingX: 24,
    paddingTop: 24,
    paddingBottom: 24,
    innerPaddingX: 10,
    innerPaddingTop: 23,
    innerPaddingBottom: 12,
  })

  it('zoom=1 原样返回', () => {
    const s = scaleFramePaddings(PADS, 1)
    expect(s.gap).toEqual(PADS.gap)
    expect(s.inner).toEqual(PADS.inner)
  })

  it('缩小时间距**不变**（配置值就是画布单位，跟随画布一起缩，屏幕上变小）', () => {
    const s = scaleFramePaddings(PADS, 0.5)
    expect(s.gap).toEqual({ paddingX: 24, paddingTop: 24, paddingBottom: 24 })
    expect(s.inner).toEqual({ paddingX: 10, paddingTop: 23, paddingBottom: 12 })
  })

  it('放大时间距同样不变（跟随画布，与 zoom 无关）', () => {
    const s = scaleFramePaddings(PADS, 2)
    expect(s.gap).toEqual(PADS.gap)
    expect(s.inner).toEqual(PADS.inner)
  })

  it('zoom 非法 / 为 0 / 负数 → 结果仍与配置一致（本函数不再看 zoom，绝不产生 Infinity）', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const s = scaleFramePaddings(PADS, bad)
      expect(s.gap).toEqual(PADS.gap)
    }
  })

  it('回归：不再有 1/zoom 补偿 —— 任意缩放下 flow 间距恒为配置值', () => {
    for (const zoom of [0.2, 0.3, 0.5, 1, 1.6, 2, 3]) {
      const s = scaleFramePaddings(PADS, zoom)
      expect(s.gap.paddingX).toBe(24)
      expect(s.inner.paddingTop).toBe(23)
    }
  })
})

describe('frameStrokeCss / hexToRgba（生成出的样式就是配置的直接映射）', () => {
  it('色 / 线型 / 线宽 / 圆角 直接落到 CSS', () => {
    const css = frameStrokeCss({ color: '#ff8800', lineStyle: 'dashed', lineWidth: 2, radius: 10, fillOpacity: 0 })
    expect(css.borderColor).toBe('#ff8800')
    expect(css.borderStyle).toBe('dashed')
    expect(css.borderWidth).toBe('2px')
    expect(css.borderRadius).toBe('10px')
    expect(css.background).toBe('transparent')
  })

  it('填充不透明度 >0 时用 color-mix 从该色生成底色（自定义色与主题变量都适用）', () => {
    const css = frameStrokeCss({ color: '#60a5fa', lineStyle: 'solid', lineWidth: 1, radius: 0, fillOpacity: 0.5 })
    expect(css.background).toBe('color-mix(in srgb, #60a5fa 50%, transparent)')
    expect(css.borderColor).toBe('#60a5fa')
  })

  it('颜色缺省（删掉自定义色）→ 走传入的主题变量，不写死 hex', () => {
    const css = frameStrokeCss(
      { lineStyle: 'solid', lineWidth: 1, radius: 0, fillOpacity: 0 },
      1,
      'var(--ui-select-inner, #60a5fa)',
    )
    expect(css.borderColor).toBe('var(--ui-select-inner, #60a5fa)')
    expect(css.background).toBe('transparent')
  })

  it('线宽/圆角默认跟随画布（lineScale 缺省 1，配置值原样落到 CSS）', () => {
    const stroke = { color: '#000000', lineStyle: 'solid' as const, lineWidth: 2, radius: 8, fillOpacity: 0 }
    expect(frameStrokeCss(stroke).borderWidth).toBe('2px')
    expect(frameStrokeCss(stroke).borderRadius).toBe('8px')
  })

  it('lineScale 仍可显式传入（保留"确需反缩放"的口子：0.5 → 宽度/圆角减半）', () => {
    const stroke = { color: '#000000', lineStyle: 'solid' as const, lineWidth: 2, radius: 8, fillOpacity: 0 }
    expect(frameStrokeCss(stroke, 0.5).borderWidth).toBe('1px')
    expect(frameStrokeCss(stroke, 0.5).borderRadius).toBe('4px')
  })

  it('hexToRgba 支持 #rgb 与 #rrggbb；解析不了时给 transparent（不写坏值）', () => {
    expect(hexToRgba('#fff', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(hexToRgba('#000000', 0.1)).toBe('rgba(0, 0, 0, 0.1)')
    expect(hexToRgba('oops', 1)).toBe('transparent')
    expect(hexToRgba('#ffffff', 5)).toBe('rgba(255, 255, 255, 1)')
  })

  it('hexToRgba 透传 #rgba / #rrggbbaa 自带的 alpha，再叠加 fillOpacity', () => {
    expect(hexToRgba('#f008', 1)).toBe('rgba(255, 0, 0, 0.5333333333333333)')
    expect(hexToRgba('#3b82f680', 1)).toBe('rgba(59, 130, 246, 0.5019607843137255)')
    const half = /, ([0-9.]+)\)$/.exec(hexToRgba('#3b82f680', 0.5))
    expect(Number(half?.[1])).toBeCloseTo((0x80 / 255) * 0.5, 12)
  })

  it('配置读取保留 8 位自定义颜色（含透明度）', () => {
    const outer = '#3b82f680'
    const cfg = resolveMultiSelectFrameConfig((key) =>
      key === MULTI_SELECT_COLOR_KEYS.outerDark ? outer : undefined,
      'dark',
    )
    expect(cfg.outer.color).toBe(outer)
  })
})
