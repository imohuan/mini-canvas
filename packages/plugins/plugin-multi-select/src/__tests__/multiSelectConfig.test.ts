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

  it('默认值对齐老版观感：左右 16 / 上 36 / 下 16，外框灰虚线、内框浅蓝实线', () => {
    expect(DEFAULT_MULTI_SELECT_FRAME.paddingX).toBe(16)
    expect(DEFAULT_MULTI_SELECT_FRAME.paddingTop).toBe(36)
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
      radius: 12,
      fillOpacity: 0.05,
    })
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

