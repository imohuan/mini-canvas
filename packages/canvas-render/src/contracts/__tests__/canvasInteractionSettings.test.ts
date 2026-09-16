/**
 * canvasInteractionSettings.test —— 画布交互配置（「常规/画布」）的纯逻辑单测。
 *
 * 覆盖（对齐 v1 core 的 VueFlow 交互开关，全收进一组）：
 * - schema 声明：18 项（17 个开关 + 网格间距 X/Y 两项）、分组恒为「常规/画布」、类型正确；
 * - resolve：从任意取值器解析出完整值对象（缺项/非法回落默认，一项坏不连坐）；
 * - apply：单项变更只动认识的键，无关键原样返回同一引用（不触发无谓重渲染）。
 */
import { describe, it, expect } from 'vitest'
import {
  CANVAS_INTERACTION_GROUP,
  CANVAS_INTERACTION_DEFAULTS,
  CANVAS_INTERACTION_SCHEMA,
  resolveCanvasInteraction,
  applyCanvasInteractionChange,
  type CanvasInteractionSettings,
} from '../canvasInteractionSettings'

describe('canvasInteractionSettings schema 声明', () => {
  it('18 项配置、分组恒为「常规/画布」', () => {
    const keys = Object.keys(CANVAS_INTERACTION_SCHEMA)
    expect(keys).toHaveLength(18)
    for (const key of keys) {
      expect(CANVAS_INTERACTION_SCHEMA[key].group).toBe(CANVAS_INTERACTION_GROUP)
    }
  })

  it('默认值对齐 v1：edgesUpdatable 开 / selectNodesOnDrag 关 / zoomOnDoubleClick 关 / connectOnClick 关 / onlyRenderVisibleElements 开', () => {
    expect(CANVAS_INTERACTION_DEFAULTS.nodesDraggable).toBe(true)
    expect(CANVAS_INTERACTION_DEFAULTS.nodesConnectable).toBe(true)
    expect(CANVAS_INTERACTION_DEFAULTS.elementsSelectable).toBe(true)
    expect(CANVAS_INTERACTION_DEFAULTS.edgesUpdatable).toBe(true)
    expect(CANVAS_INTERACTION_DEFAULTS.selectNodesOnDrag).toBe(false)
    expect(CANVAS_INTERACTION_DEFAULTS.snapToGrid).toBe(false)
    expect(CANVAS_INTERACTION_DEFAULTS.snapGridX).toBe(15)
    expect(CANVAS_INTERACTION_DEFAULTS.snapGridY).toBe(15)
    expect(CANVAS_INTERACTION_DEFAULTS.zoomOnScroll).toBe(true)
    expect(CANVAS_INTERACTION_DEFAULTS.zoomOnPinch).toBe(true)
    expect(CANVAS_INTERACTION_DEFAULTS.panOnScroll).toBe(false)
    expect(CANVAS_INTERACTION_DEFAULTS.panOnDrag).toBe(true)
    expect(CANVAS_INTERACTION_DEFAULTS.zoomOnDoubleClick).toBe(false)
    expect(CANVAS_INTERACTION_DEFAULTS.connectOnClick).toBe(false)
    expect(CANVAS_INTERACTION_DEFAULTS.minZoom).toBe(0.2)
    expect(CANVAS_INTERACTION_DEFAULTS.maxZoom).toBe(2)
    expect(CANVAS_INTERACTION_DEFAULTS.onlyRenderVisibleElements).toBe(true)
    expect(CANVAS_INTERACTION_DEFAULTS.preventScrolling).toBe(true)
  })

  it('number 项带 min/max/step，boolean 项无 min/max，每项有 label/default 且类型一致', () => {
    for (const schema of Object.values(CANVAS_INTERACTION_SCHEMA)) {
      if (schema.type === 'number') {
        expect(typeof schema.min).toBe('number')
        expect(typeof schema.max).toBe('number')
        expect(typeof schema.step).toBe('number')
      } else {
        expect(schema.type).toBe('boolean')
        expect(schema.min).toBeUndefined()
        expect(schema.max).toBeUndefined()
      }
      expect(schema.label).toBeTruthy()
      expect(schema.default).toBeDefined()
      if (schema.type === 'number') expect(typeof schema.default).toBe('number')
      if (schema.type === 'boolean') expect(typeof schema.default).toBe('boolean')
    }
  })
})

describe('resolveCanvasInteraction（取值器 → 完整值对象）', () => {
  it('读不到（空取值器）→ 全回落默认', () => {
    expect(resolveCanvasInteraction(() => undefined)).toEqual(CANVAS_INTERACTION_DEFAULTS)
  })

  it('从 settings 风格取值器解析当前值；未给的项回落默认', () => {
    const v = resolveCanvasInteraction((key) => {
      if (key === 'nodesDraggable') return false
      if (key === 'minZoom') return 0.1
      if (key === 'maxZoom') return 4
      if (key === 'snapGridX') return 30
      return undefined
    })
    expect(v.nodesDraggable).toBe(false)
    expect(v.minZoom).toBe(0.1)
    expect(v.maxZoom).toBe(4)
    expect(v.snapGridX).toBe(30)
    expect(v.panOnDrag).toBe(true)
    expect(v.snapGridY).toBe(15)
  })

  it('非法值逐项回落默认（一项坏不连坐）', () => {
    const v = resolveCanvasInteraction((key) => {
      if (key === 'nodesDraggable') return 'yes'
      if (key === 'minZoom') return Number.NaN
      if (key === 'snapGridX') return 0
      if (key === 'maxZoom') return -1
      return undefined
    })
    expect(v.nodesDraggable).toBe(true)
    expect(v.minZoom).toBe(0.2)
    expect(v.maxZoom).toBe(2)
    expect(v.snapGridX).toBe(15)
  })

  it('snapGrid 聚合：X/Y 两项拼成 [x, y] 元组', () => {
    const v = resolveCanvasInteraction((key) => (key === 'snapGridX' ? 40 : key === 'snapGridY' ? 20 : undefined))
    expect(v.snapGrid).toEqual([40, 20])
  })
})

describe('applyCanvasInteractionChange（单项变更 → 新值对象）', () => {
  it('认识的键才动：minZoom 变更生效、其余保持、产生新对象', () => {
    const next = applyCanvasInteractionChange(CANVAS_INTERACTION_DEFAULTS, 'minZoom', 0.1)
    expect(next.minZoom).toBe(0.1)
    expect(next.panOnDrag).toBe(true)
    expect(next).not.toBe(CANVAS_INTERACTION_DEFAULTS)
  })

  it('无关配置的键原样返回同一引用（不触发无谓重渲染）', () => {
    expect(applyCanvasInteractionChange(CANVAS_INTERACTION_DEFAULTS, 'toolbarTopOffset', 3)).toBe(CANVAS_INTERACTION_DEFAULTS)
  })

  it('非法值回落默认（订阅回调里坏值不炸）', () => {
    expect(applyCanvasInteractionChange(CANVAS_INTERACTION_DEFAULTS, 'minZoom', 'x').minZoom).toBe(0.2)
    expect(applyCanvasInteractionChange(CANVAS_INTERACTION_DEFAULTS, 'panOnDrag', 1).panOnDrag).toBe(true)
  })

  it('snapGridX/Y 变更反映到 snapGrid 元组', () => {
    const a = applyCanvasInteractionChange(CANVAS_INTERACTION_DEFAULTS, 'snapGridX', 50)
    expect(a.snapGrid).toEqual([50, 15])
    const b = applyCanvasInteractionChange(a, 'snapGridY', 25)
    expect(b.snapGrid).toEqual([50, 25])
  })
})

describe('类型收口', () => {
  it('CanvasInteractionSettings 的键 = 默认值的键', () => {
    const sample: CanvasInteractionSettings = { ...CANVAS_INTERACTION_DEFAULTS }
    expect(Object.keys(sample).sort()).toEqual(Object.keys(CANVAS_INTERACTION_DEFAULTS).sort())
  })
})
