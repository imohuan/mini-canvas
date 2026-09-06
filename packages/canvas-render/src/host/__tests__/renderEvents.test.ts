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
})

