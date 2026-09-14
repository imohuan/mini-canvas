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

describe('resolveGenPanelMetrics（生成控制栏尺寸，纯函数）', () => {
  it('读到配置就用配置值', () => {
    expect(
      resolveGenPanelMetrics(
        cfg({ panelImageWidth: 700, panelTextWidth: 480, panelEditorMinHeight: 80, panelEditorMaxHeight: 300 }),
      ),
    ).toEqual({ imageWidth: 700, textWidth: 480, editorMinHeight: 80, editorMaxHeight: 300 })
  })

  it('没配置 → 回落默认（图片 650 / 文本 520 / 输入框 64~220）', () => {
    expect(resolveGenPanelMetrics(cfg({}))).toEqual(DEFAULT_GEN_PANEL_METRICS)
    expect(resolveGenPanelMetrics(() => undefined)).toEqual(DEFAULT_GEN_PANEL_METRICS)
  })

  it('非法/非正值回落默认（宽度 0 或负数会让面板消失）', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY, '700', null, {}]) {
      expect(resolveGenPanelMetrics(cfg({ panelImageWidth: bad })).imageWidth).toBe(
        DEFAULT_GEN_PANEL_METRICS.imageWidth,
      )
    }
  })

  it('一项非法不影响另一项', () => {
    const m = resolveGenPanelMetrics(cfg({ panelImageWidth: 'x', panelTextWidth: 480 }))
    expect(m.imageWidth).toBe(DEFAULT_GEN_PANEL_METRICS.imageWidth)
    expect(m.textWidth).toBe(480)
  })
})

describe('applyGenPanelMetricChange（改设置就生效）', () => {
  const base = { ...DEFAULT_GEN_PANEL_METRICS }

  it('认识四个键，各自只改自己那项', () => {
    expect(applyGenPanelMetricChange(base, 'panelImageWidth', 800).imageWidth).toBe(800)
    expect(applyGenPanelMetricChange(base, 'panelTextWidth', 400).textWidth).toBe(400)
    expect(applyGenPanelMetricChange(base, 'panelEditorMinHeight', 90).editorMinHeight).toBe(90)
    expect(applyGenPanelMetricChange(base, 'panelEditorMaxHeight', 360).editorMaxHeight).toBe(360)
  })

  it('改一项不动其它项', () => {
    const next = applyGenPanelMetricChange(base, 'panelImageWidth', 800)
    expect(next.textWidth).toBe(base.textWidth)
    expect(next.editorMinHeight).toBe(base.editorMinHeight)
  })

  it('无关的配置键 → 原样返回（同引用，不引起多余重渲染）', () => {
    expect(applyGenPanelMetricChange(base, 'toolbarTopOffset', 20)).toBe(base)
    expect(applyGenPanelMetricChange(base, 'edgeColor', '#fff')).toBe(base)
  })

  it('改动值非法 → 该项回落默认', () => {
    expect(applyGenPanelMetricChange(base, 'panelImageWidth', -1).imageWidth).toBe(
      DEFAULT_GEN_PANEL_METRICS.imageWidth,
    )
  })

  it('原对象不被改写', () => {
    const src = { ...DEFAULT_GEN_PANEL_METRICS }
    applyGenPanelMetricChange(src, 'panelTextWidth', 300)
    expect(src).toEqual(DEFAULT_GEN_PANEL_METRICS)
  })
})
