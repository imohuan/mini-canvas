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

  it('两框各自的颜色 / 线型 / 线宽 / 圆角 / 填充都有独立项', () => {
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerColor].type).toBe('color')
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerStyle].type).toBe('select')
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerWidth].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerRadius].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerFill].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerColor].type).toBe('color')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerStyle].type).toBe('select')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerWidth].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerRadius].type).toBe('number')
    expect(Config[MULTI_SELECT_FRAME_KEYS.innerFill].type).toBe('number')
  })

  it('线型下拉就是实线/虚线/点线三种（不是"有没有边框"的开关）', () => {
    expect(FRAME_LINE_STYLE_OPTIONS.map((o) => o.value)).toEqual(['solid', 'dashed', 'dotted'])
    expect(Config[MULTI_SELECT_FRAME_KEYS.outerStyle].options?.map((o) => (typeof o === 'string' ? o : o.value)))
      .toEqual(['solid', 'dashed', 'dotted'])
  })

  it('默认值对齐老版（v1 selectionFramePadding*）：左右 16 / 上 34 / 下 16，外框灰虚线、内框浅蓝实线', () => {
    expect(DEFAULT_MULTI_SELECT_FRAME.paddingX).toBe(16)
    expect(DEFAULT_MULTI_SELECT_FRAME.paddingTop).toBe(34)
    expect(DEFAULT_MULTI_SELECT_FRAME.paddingBottom).toBe(16)
    expect(DEFAULT_MULTI_SELECT_FRAME.outer).toEqual({
      color: '#94a3b8',
      lineStyle: 'dashed',
      lineWidth: 1,
      radius: 6,
      fillOpacity: 0,
    })
    expect(DEFAULT_MULTI_SELECT_FRAME.inner).toEqual({
      color: '#60a5fa',
      lineStyle: 'solid',
      lineWidth: 1,
      radius: 0,
      fillOpacity: 0.05,
    })
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
    all[MULTI_SELECT_FRAME_KEYS.outerColor] = '#ff0000'
    all[MULTI_SELECT_FRAME_KEYS.innerStyle] = 'dotted'
    const cfg = resolveMultiSelectFrameConfig((k) => all[k])
    expect(cfg.paddingX).toBe(40)
    expect(cfg.outer.color).toBe('#ff0000')
    expect(cfg.inner.lineStyle).toBe('dotted')
  })

  it('非法值只回落那一项，别的项照旧（一项坏了不连累其它项）', () => {
    const all = schemaDefaults()
    all[MULTI_SELECT_FRAME_KEYS.paddingX] = 'abc'
    all[MULTI_SELECT_FRAME_KEYS.paddingTop] = Number.NaN
    all[MULTI_SELECT_FRAME_KEYS.paddingBottom] = -50
    all[MULTI_SELECT_FRAME_KEYS.outerColor] = 'not-a-color'
    all[MULTI_SELECT_FRAME_KEYS.outerStyle] = 'wavy'
    all[MULTI_SELECT_FRAME_KEYS.innerColor] = '#00ff00' // 这一项合法，必须保住
    const cfg = resolveMultiSelectFrameConfig((k) => all[k])
    expect(cfg.paddingX).toBe(DEFAULT_MULTI_SELECT_FRAME.paddingX)
    expect(cfg.paddingTop).toBe(DEFAULT_MULTI_SELECT_FRAME.paddingTop)
    expect(cfg.paddingBottom).toBe(DEFAULT_MULTI_SELECT_FRAME.paddingBottom)
    expect(cfg.outer.color).toBe(DEFAULT_MULTI_SELECT_FRAME.outer.color)
    expect(cfg.outer.lineStyle).toBe(DEFAULT_MULTI_SELECT_FRAME.outer.lineStyle)
    expect(cfg.inner.color).toBe('#00ff00')
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
      MULTI_SELECT_FRAME_KEYS.innerColor,
      '#123456',
    )
    expect(after.inner.color).toBe('#123456')
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
 * 缩放后两框间距（用户报的缺陷："你的这个多选框缩放之后的 padding 存在 BUG"）。
 *
 * 根因：两框线宽按 1/zoom 反缩放（屏幕上恒定粗细，线宽 4 在 zoom=0.2 时撑到 20px），
 * 而 padding 是 flow 常量（屏幕上只剩 24×0.2 = 4.8px）。于是缩得越小、线越粗、间距越窄，
 * 两条线最终糊成一条 —— 实测 zoom=0.3 起重叠、zoom=0.2 重叠 10px。
 *
 * 修法：padding 与线宽用**同一套空间约定** —— 都除以 zoom。这样"间距"这个配置项的含义
 * 恒等于"你在屏幕上量到的两框间隙"，缩放画布时观感不变。
 */
describe('scaleFramePaddings —— 间距必须与线宽同空间（1/zoom 反缩放）', () => {
  const PADS = framePaddingsOf({
    ...DEFAULT_MULTI_SELECT_FRAME,
    paddingX: 24,
    paddingTop: 24,
    paddingBottom: 24,
    innerPaddingX: 10,
    innerPaddingTop: 23,
    innerPaddingBottom: 12,
  })

  it('zoom=1 原样返回（屏幕上量到的就是配置值）', () => {
    const s = scaleFramePaddings(PADS, 1)
    expect(s.gap).toEqual(PADS.gap)
    expect(s.inner).toEqual(PADS.inner)
  })

  it('zoom=0.5 → 间距翻倍（flow 值变大，屏幕上才还是 24px）', () => {
    const s = scaleFramePaddings(PADS, 0.5)
    expect(s.gap).toEqual({ paddingX: 48, paddingTop: 48, paddingBottom: 48 })
    expect(s.inner).toEqual({ paddingX: 20, paddingTop: 46, paddingBottom: 24 })
  })

  it('zoom 非法 / 为 0 → 回落到 1（绝不产生 Infinity 把几何算炸）', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const s = scaleFramePaddings(PADS, bad)
      expect(s.gap).toEqual(PADS.gap)
    }
  })

  it('回归：zoom=0.2 时间距不再被线宽吃掉（修前 gap=4.8 < 线宽需求 15 → 糊成一条）', () => {
    const s = scaleFramePaddings(PADS, 0.2)
    const outerLineScreen = 4 // 外框线宽配置（frameStrokeCss 里 ×1/zoom 后屏幕上仍是 4px）
    const innerLineScreen = 2
    const gapOnScreen = s.gap.paddingX * 0.2
    expect(gapOnScreen).toBeCloseTo(24, 5)
    // 两条线各自半宽之和必须小于间距，否则视觉重叠
    expect(gapOnScreen).toBeGreaterThan(outerLineScreen / 2 + innerLineScreen / 2)
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

  it('填充不透明度 >0 时生成 rgba 底色', () => {
    const css = frameStrokeCss({ color: '#60a5fa', lineStyle: 'solid', lineWidth: 1, radius: 0, fillOpacity: 0.5 })
    expect(css.background).toBe('rgba(96, 165, 250, 0.5)')
  })

  it('外框线宽按 1/zoom 反向缩放（缩放画布时线粗细看起来恒定）', () => {
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
})
