import { describe, it, expect } from 'vitest'
import { RenderEvents, toDragPayload } from '../renderEvents'

describe('renderEvents 事件桥契约', () => {
  it('事件名常量稳定（插件按名订阅）', () => {
    expect(RenderEvents.NodeDragStart).toBe('canvas:node:drag-start')
    expect(RenderEvents.NodeDrag).toBe('canvas:node:drag')
    expect(RenderEvents.NodeDragEnd).toBe('canvas:node:drag-end')
    expect(RenderEvents.MoveStart).toBe('canvas:viewport:move-start')
    expect(RenderEvents.MoveEnd).toBe('canvas:viewport:move-end')
    expect(RenderEvents.NodeClick).toBe('canvas:node:click')
    expect(RenderEvents.EdgeClick).toBe('canvas:edge:click')
    expect(RenderEvents.PaneClick).toBe('canvas:pane:click')
    expect(RenderEvents.SelectionChange).toBe('canvas:selection:change')
  })

  it('toDragPayload 归一 VueFlow NodeDragEvent', () => {
    const p = toDragPayload({ node: { id: 'n1', position: { x: 5, y: 6 } } })
    expect(p).toEqual({ nodeId: 'n1', position: { x: 5, y: 6 } })
  })

  it('toDragPayload 缺 node.id 返回 null', () => {
    expect(toDragPayload({ node: {} })).toBeNull()
    expect(toDragPayload({})).toBeNull()
  })

  /**
   * 分组子节点的坐标归一（用户报的缺陷：主节点内多选拖拽时选框高度突破画面）。
   *
   * VueFlow 给有父节点的节点存的 position 是**相对父**的（父在 (200,260)、子在父内 (60,90) 时报 (60,90)），
   * 而 computedPosition 才是逐级累加父链的**绝对**坐标。事件契约规定 payload.position 是绝对坐标
   * （消费方都按绝对理解：多选包围盒用 nodeLayout 的绝对矩形、对齐吸附也用绝对矩形），
   * 所以必须优先取 computedPosition —— 取 position 会让子节点场景下消费方算出错误的几何。
   */
  it('toDragPayload 对分组子节点取绝对坐标（computedPosition 优先于 relative position）', () => {
    const p = toDragPayload({
      node: { id: 'child', position: { x: 60, y: 90 }, computedPosition: { x: 260, y: 350 } },
    })
    expect(p).toEqual({ nodeId: 'child', position: { x: 260, y: 350 } })
  })

  it('toDragPayload 顶层节点（无父）computedPosition 与 position 同值，结果不变', () => {
    const p = toDragPayload({
      node: { id: 'top', position: { x: 300, y: 360 }, computedPosition: { x: 300, y: 360 } },
    })
    expect(p).toEqual({ nodeId: 'top', position: { x: 300, y: 360 } })
  })

  it('toDragPayload 只有 position 时回落（窄对象/旧调用方不受影响）', () => {
    expect(toDragPayload({ node: { id: 'n1', position: { x: 5, y: 6 } } })).toEqual({
      nodeId: 'n1',
      position: { x: 5, y: 6 },
    })
  })
})
