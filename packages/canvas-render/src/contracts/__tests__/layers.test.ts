import { describe, expect, it } from 'vitest'

import { LAYERS } from '../layers'

/**
 * layers —— 画布层叠带的唯一事实源。
 *
 * 这里**不断言具体数字**（数字可以调），只钉住「谁在谁之上」的**相对顺序**。
 * 顺序一旦被改坏，用户在画布上看到的就是「连线盖住节点 / 控制栏被连线盖住」这类
 * 层次错乱（2026-09-29 实测报过）。
 */
describe('LAYERS：画布层叠带相对顺序', () => {
  it('分组容器垫在连线之下', () => {
    expect(LAYERS.groupBase).toBeLessThan(LAYERS.edge)
  })

  it('默认：连线在节点之下（节点压边）', () => {
    expect(LAYERS.edge).toBeLessThan(LAYERS.node)
  })

  it('选中节点抬到普通节点之上', () => {
    expect(LAYERS.node).toBeLessThan(LAYERS.nodeSelected)
  })

  it('选中节点**仍在**置顶连线之下（用户口述：抬层后依然在置顶连线下面）', () => {
    expect(LAYERS.nodeSelected).toBeLessThan(LAYERS.edgeTop)
  })

  it('节点上/下控制栏压过置顶连线（用户口述：控制栏始终在最上面）', () => {
    expect(LAYERS.edgeTop).toBeLessThan(LAYERS.nodeToolbar)
  })

  it('画布级浮层在节点控制栏之上', () => {
    expect(LAYERS.nodeToolbar).toBeLessThan(LAYERS.overlay)
  })

  it('外壳 UI（顶栏/底栏）在画布浮层之上', () => {
    expect(LAYERS.overlay).toBeLessThan(LAYERS.appChrome)
  })

  it('模态/菜单在最上（沿用 100000 约定）', () => {
    expect(LAYERS.appChrome).toBeLessThan(LAYERS.modal)
    expect(LAYERS.modal).toBe(100000)
  })

  it('临时菜单卡在置顶连线之上、控制栏之下', () => {
    expect(LAYERS.edgeTop).toBeLessThan(LAYERS.tempNode)
    expect(LAYERS.tempNode).toBeLessThan(LAYERS.nodeToolbar)
  })
})

describe('LAYERS：整条带严格递增（防手滑写重）', () => {
  it('按自下而上的顺序严格递增', () => {
    const order = [
      LAYERS.groupBase,
      LAYERS.groupNested,
      LAYERS.edge,
      LAYERS.node,
      LAYERS.nodeSelected,
      LAYERS.tempEdge,
      LAYERS.edgeTop,
      LAYERS.tempNode,
      LAYERS.nodeToolbar,
      LAYERS.overlay,
      LAYERS.appFloat,
      LAYERS.appChrome,
      LAYERS.gesture,
      LAYERS.modal,
      LAYERS.modalTop,
    ]
    for (let i = 1; i < order.length; i++) {
      expect(order[i], `第 ${i} 项 ${order[i]} 应严格大于前一项 ${order[i - 1]}`).toBeGreaterThan(order[i - 1]!)
    }
  })
})
