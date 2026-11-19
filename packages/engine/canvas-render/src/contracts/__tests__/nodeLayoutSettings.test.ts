/**
 * nodeLayoutSettings 单测 —— 控制栏贴边距离的解析与容错（纯函数，Node 环境）。
 *
 * 用户要求"上下控制栏的偏移可以在配置里设置"。要守住三件事：
 * 1. 配置里给了值就用它；
 * 2. 缺项 / 非法值各自回落默认（一项坏了不影响另一项，也不能让 NaN 把 CSS 整条打废）；
 * 3. 拼出的 CSS 位置正确（浮在上方用 bottom、浮在下方用 top）。
 *
 * useToolbarOffsets 本身要在 Vue 组件内调用（含 onBeforeUnmount），它的逻辑已被拆成
 * resolveToolbarOffsets / applyOffsetChange 两个纯函数，这里直接验它们 —— 与仓库
 * "纯逻辑抽出来单测、组件靠 vue-tsc 兜"的既有惯例一致。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GEN_PANEL_METRICS,
  DEFAULT_TOOLBAR_OFFSETS,
  applyGenPanelMetricChange,
  applyOffsetChange,
  resolveGenPanelMetrics,
  resolveNodeSlotStyle,
  resolveToolbarOffsets,
  toolbarOffsetStyle,
} from '../nodeLayoutSettings'

/** 用一张普通 map 当配置源 */
const cfg = (values: Record<string, unknown>) => (key: string) => values[key]

describe('resolveToolbarOffsets', () => {
  it('读到配置值就用配置值', () => {
    expect(resolveToolbarOffsets(cfg({ toolbarTopOffset: 14, toolbarBottomOffset: 22 }))).toEqual({
      top: 14,
      bottom: 22,
    })
  })

  it('0 是合法配置（贴紧卡片），不会被当成"没配置"', () => {
    expect(resolveToolbarOffsets(cfg({ toolbarTopOffset: 0, toolbarBottomOffset: 0 }))).toEqual({
      top: 0,
      bottom: 0,
    })
  })

  it('没配置 / 空配置 → 回落默认值', () => {
    expect(resolveToolbarOffsets(cfg({}))).toEqual(DEFAULT_TOOLBAR_OFFSETS)
    expect(resolveToolbarOffsets(() => undefined)).toEqual(DEFAULT_TOOLBAR_OFFSETS)
  })

  it('非法值回落默认（与合法值各自独立，不互相影响）', () => {
    expect(resolveToolbarOffsets(cfg({ toolbarTopOffset: '18', toolbarBottomOffset: 20 }))).toEqual({
      top: DEFAULT_TOOLBAR_OFFSETS.top,
      bottom: 20,
    })
  })

  it('负数 / NaN / Infinity 都回落默认（负数会让控制栏盖住节点内容）', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
      expect(resolveToolbarOffsets(cfg({ toolbarTopOffset: bad })).top).toBe(DEFAULT_TOOLBAR_OFFSETS.top)
    }
  })
})

describe('applyOffsetChange（设置面板改动 → 立刻生效）', () => {
  const base = { top: 6, bottom: 6 }

  it('改上偏移只动上偏移', () => {
    expect(applyOffsetChange(base, 'toolbarTopOffset', 30)).toEqual({ top: 30, bottom: 6 })
  })

  it('改下偏移只动下偏移', () => {
    expect(applyOffsetChange(base, 'toolbarBottomOffset', 18)).toEqual({ top: 6, bottom: 18 })
  })

  it('无关的配置键 → 原样返回（同引用，不引起多余重渲染）', () => {
    expect(applyOffsetChange(base, 'titleOffset', 40)).toBe(base)
    expect(applyOffsetChange(base, 'edgeColor', '#fff')).toBe(base)
  })

  it('改动值非法 → 该项回落默认，另一项保持', () => {
    expect(applyOffsetChange({ top: 30, bottom: 18 }, 'toolbarBottomOffset', 'x')).toEqual({
      top: 30,
      bottom: DEFAULT_TOOLBAR_OFFSETS.bottom,
    })
  })

  it('原对象不被改写（避免共享引用被就地修改）', () => {
    const src = { top: 6, bottom: 6 }
    applyOffsetChange(src, 'toolbarTopOffset', 12)
    expect(src).toEqual({ top: 6, bottom: 6 })
  })
})

describe('toolbarOffsetStyle（拼 CSS）', () => {
  it('浮在卡片上方 → 用 bottom；浮在下方 → 用 top', () => {
    expect(toolbarOffsetStyle('top', 8)).toEqual({ bottom: 'calc(100% + 8px)' })
    expect(toolbarOffsetStyle('bottom', 8)).toEqual({ top: 'calc(100% + 8px)' })
  })

  it('0 产出合法的 CSS（不是 0 就省略）', () => {
    expect(toolbarOffsetStyle('top', 0)).toEqual({ bottom: 'calc(100% + 0px)' })
  })

  it('非法值收敛成 0（宁可贴紧卡片，也不产出 NaN 让整条声明失效）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, undefined as unknown as number]) {
      expect(toolbarOffsetStyle('top', bad)).toEqual({ bottom: 'calc(100% + 0px)' })
    }
  })
})

/**
 * resolveNodeSlotStyle —— 节点上/下插槽浮层的**整份定位样式**（纯函数）。
 *
 * 用户要求："定位交给 BaseNode 而不是单独的组件"。此前三个段组件各写一遍
 * "left:50% + translateX(-50%) + scale(1/zoom) + transformOrigin + calc(100% + Npx)"，
 * 抄三遍必然漂移。这里把它收成一个纯函数：壳拿到就能贴到插槽定位层上，插件不再碰定位。
 */
describe('resolveNodeSlotStyle（插槽定位层整份样式）', () => {
  it('上插槽：浮在卡片上方，锚在底边（bottom: calc(100% + 偏移)）', () => {
    const s = resolveNodeSlotStyle({ side: 'top', offset: 6, zoom: 1 })
    expect(s.left).toBe('50%')
    expect(s.bottom).toBe('calc(100% + 6px)')
    expect(s.top).toBeUndefined()
  })

  it('下插槽：浮在卡片下方，锚在顶边（top: calc(100% + 偏移)）', () => {
    const s = resolveNodeSlotStyle({ side: 'bottom', offset: 6, zoom: 1 })
    expect(s.top).toBe('calc(100% + 6px)')
    expect(s.bottom).toBeUndefined()
  })

  it('水平居中与反缩放合并在同一个 transform 里（分写会互相顶掉）', () => {
    const s = resolveNodeSlotStyle({ side: 'top', offset: 6, zoom: 1 })
    expect(s.transform).toBe('translateX(-50%) scale(1)')
  })

  it('反缩放锚点朝卡片：上插槽 center bottom、下插槽 center top（大小变化时贴边不跑）', () => {
    expect(resolveNodeSlotStyle({ side: 'top', offset: 6, zoom: 1 }).transformOrigin).toBe('center bottom')
    expect(resolveNodeSlotStyle({ side: 'bottom', offset: 6, zoom: 1 }).transformOrigin).toBe('center top')
  })

  it('缩放 0.5 → scale(2)：屏幕尺寸恒定，缩小时按钮不会被压成一条缝', () => {
    expect(resolveNodeSlotStyle({ side: 'top', offset: 6, zoom: 0.5 }).transform).toContain('scale(2)')
  })

  it('zoom 非法（0/NaN/负数）按 1 算，不产出 Infinity 让整条 transform 失效', () => {
    for (const bad of [0, Number.NaN, -2, Number.POSITIVE_INFINITY]) {
      expect(resolveNodeSlotStyle({ side: 'top', offset: 6, zoom: bad }).transform).toBe('translateX(-50%) scale(1)')
    }
  })

  it('偏移 0 是合法值（贴紧卡片），不是"没配置"', () => {
    expect(resolveNodeSlotStyle({ side: 'top', offset: 0, zoom: 1 }).bottom).toBe('calc(100% + 0px)')
  })

  it('偏移非法 → 收敛成 0（宁可贴紧，也不产出 NaN 让整条声明失效）', () => {
    expect(resolveNodeSlotStyle({ side: 'top', offset: Number.NaN, zoom: 1 }).bottom).toBe('calc(100% + 0px)')
  })
})

describe('resolveGenPanelMetrics（生成控制栏尺寸，纯函数）', () => {
  it('读全局宽度 panelWidth：三项同步（用户 2026-11-18）', () => {
    const m = resolveGenPanelMetrics(
      cfg({
        panelWidth: 820,
        panelEditorMinWidth: 300,
        panelEditorMinHeight: 80,
        panelEditorMaxHeight: 300,
      }),
    )
    expect(m.panelWidth).toBe(820)
    // 旧字段作为别名跟着走，避免仍在读 imageWidth / textWidth 的调用方拿到旧值
    expect(m.imageWidth).toBe(820)
    expect(m.textWidth).toBe(820)
    expect(m).toMatchObject({ editorMinWidth: 300, editorMinHeight: 80, editorMaxHeight: 300 })
  })

  it('没配置 → 回落默认', () => {
    expect(resolveGenPanelMetrics(cfg({}))).toEqual(DEFAULT_GEN_PANEL_METRICS)
    expect(resolveGenPanelMetrics(() => undefined)).toEqual(DEFAULT_GEN_PANEL_METRICS)
  })

  /**
   * 兼容：老用户配过「图片生成栏宽度 / 文本生成栏宽度」，升级后不能让值凭空消失。
   * 优先级 panelWidth > panelImageWidth > panelTextWidth > 默认。
   */
  it('老的两项仍然认（优先图片，其次文本）', () => {
    const legacy = resolveGenPanelMetrics(cfg({ panelImageWidth: 700, panelTextWidth: 480 }))
    expect(legacy.panelWidth).toBe(700)
    const onlyText = resolveGenPanelMetrics(cfg({ panelTextWidth: 480 }))
    expect(onlyText.panelWidth).toBe(480)
  })

  it('新键优先于老键', () => {
    const m = resolveGenPanelMetrics(cfg({ panelWidth: 900, panelImageWidth: 700 }))
    expect(m.panelWidth).toBe(900)
  })

  it('非法/非正值回落默认（宽度 0 或负数会让面板消失）', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY, '700', null, {}]) {
      expect(resolveGenPanelMetrics(cfg({ panelWidth: bad })).panelWidth).toBe(
        DEFAULT_GEN_PANEL_METRICS.panelWidth,
      )
    }
  })
})

describe('applyGenPanelMetricChange（改设置就生效）', () => {
  const base = { ...DEFAULT_GEN_PANEL_METRICS }

  it('三个宽度键都改同一份宽度，其余项各自独立', () => {
    expect(applyGenPanelMetricChange(base, 'panelWidth', 800).panelWidth).toBe(800)
    // 老键也生效，并且三项保持一致
    const legacy = applyGenPanelMetricChange(base, 'panelImageWidth', 760)
    expect(legacy).toMatchObject({ panelWidth: 760, imageWidth: 760, textWidth: 760 })
    expect(applyGenPanelMetricChange(base, 'panelEditorMinHeight', 90).editorMinHeight).toBe(90)
    expect(applyGenPanelMetricChange(base, 'panelEditorMaxHeight', 360).editorMaxHeight).toBe(360)
    expect(applyGenPanelMetricChange(base, 'panelEditorMinWidth', 320).editorMinWidth).toBe(320)
  })

  it('改宽度不动输入框那几项', () => {
    const next = applyGenPanelMetricChange(base, 'panelImageWidth', 800)
    expect(next.editorMinHeight).toBe(base.editorMinHeight)
  })

  it('无关的配置键 → 原样返回（同引用，不引起多余重渲染）', () => {
    expect(applyGenPanelMetricChange(base, 'toolbarTopOffset', 20)).toBe(base)
    expect(applyGenPanelMetricChange(base, 'edgeColor', '#fff')).toBe(base)
  })

  it('改动值非法 → 该项回落默认', () => {
    expect(applyGenPanelMetricChange(base, 'panelWidth', -1).panelWidth).toBe(
      DEFAULT_GEN_PANEL_METRICS.panelWidth,
    )
  })

  it('原对象不被改写', () => {
    const src = { ...DEFAULT_GEN_PANEL_METRICS }
    applyGenPanelMetricChange(src, 'panelTextWidth', 300)
    expect(src).toEqual(DEFAULT_GEN_PANEL_METRICS)
  })
})
