import { describe, it, expect } from 'vitest'
import {
  createInteractionState,
  updateActivity,
  clearActivity,
  emptyActivity,
  beginNodeDrag,
  endNodeDrag,
  beginViewportMove,
  endViewportMove,
  beginSelecting,
  endSelecting,
  beginNodeResize,
  endNodeResize,
} from '../interactionContext'

describe('createInteractionState', () => {
  it('初始：全部活动位 false + 对象句柄空，派生位均 false', () => {
    const s = createInteractionState()
    const a = s.activity.value
    expect(a.nodeDragging).toBe(false)
    expect(a.nodeDragId).toBeNull()
    expect(a.paneDragging).toBe(false)
    expect(a.zooming).toBe(false)
    expect(a.edgeDragging).toBe(false)
    expect(a.edgeDragId).toBeNull()
    expect(a.selecting).toBe(false)
    expect(s.isNodeDragging.value).toBe(false)
    expect(s.isPanning.value).toBe(false)
    expect(s.isZooming.value).toBe(false)
    expect(s.isEdgeDragging.value).toBe(false)
    expect(s.isSelecting.value).toBe(false)
    expect(s.isBusyDragging.value).toBe(false)
    expect(s.isBusy.value).toBe(false)
  })

  it('局部分片写：开 nodeDragging 只动该位 + id，其余保留', () => {
    const s = createInteractionState()
    updateActivity(s, { paneDragging: true })
    updateActivity(s, { nodeDragging: true, nodeDragId: 'n1' })
    const a = s.activity.value
    expect(a.nodeDragging).toBe(true)
    expect(a.nodeDragId).toBe('n1')
    expect(a.paneDragging).toBe(true) // 上一片保留
    expect(a.zooming).toBe(false)
    expect(s.isNodeDragging.value).toBe(true)
    expect(s.isBusyDragging.value).toBe(true)
  })

  it('派生 isBusyDragging：node/pan/edge/selecting 任一为真即 true；纯 zoom 不触发', () => {
    const s = createInteractionState()
    updateActivity(s, { zooming: true })
    expect(s.isZooming.value).toBe(true)
    expect(s.isBusyDragging.value).toBe(false) // zoom 不算物理拖拽
    expect(s.isBusy.value).toBe(true)          // isBusy 更宽，含 zoom
    updateActivity(s, { edgeDragging: true, edgeDragId: 'e1' })
    expect(s.isEdgeDragging.value).toBe(true)
    expect(s.isBusyDragging.value).toBe(true)
  })

  it('叠加：node + pan 同时为真不互斥（多手势可叠加）', () => {
    const s = createInteractionState()
    updateActivity(s, { nodeDragging: true, nodeDragId: 'a' })
    updateActivity(s, { paneDragging: true })
    expect(s.isNodeDragging.value).toBe(true)
    expect(s.isPanning.value).toBe(true)
    expect(s.isBusyDragging.value).toBe(true)
  })

  it('clearActivity 全清：回到空态且引用替换为新空对象', () => {
    const s = createInteractionState()
    updateActivity(s, { nodeDragging: true, nodeDragId: 'a', paneDragging: true, zooming: true })
    const before = s.activity.value
    clearActivity(s)
    expect(s.activity.value).toEqual(emptyActivity())
    expect(s.activity.value).not.toBe(before) // 新引用 → 响应式下游能感知
    expect(s.isBusyDragging.value).toBe(false)
    expect(s.isBusy.value).toBe(false)
  })

  it('beginNodeDrag/endNodeDrag：驱动 nodeDragging + id，往返对称且不碰其它位', () => {
    const s = createInteractionState()
    beginNodeDrag(s, 'n7')
    expect(s.activity.value.nodeDragging).toBe(true)
    expect(s.activity.value.nodeDragId).toBe('n7')
    expect(s.isNodeDragging.value).toBe(true)
    expect(s.isBusyDragging.value).toBe(true)
    // 叠加场景：pan 进行中开始拖节点 → 结束拖节点不误清 pan
    beginViewportMove(s)
    endNodeDrag(s)
    expect(s.activity.value.nodeDragging).toBe(false)
    expect(s.activity.value.nodeDragId).toBeNull()
    expect(s.activity.value.paneDragging).toBe(true) // pan 位保留
    expect(s.isBusyDragging.value).toBe(true)
  })

  it('beginViewportMove/endViewportMove：驱动 paneDragging，往返对称', () => {
    const s = createInteractionState()
    beginViewportMove(s)
    expect(s.activity.value.paneDragging).toBe(true)
    expect(s.isPanning.value).toBe(true)
    expect(s.isBusyDragging.value).toBe(true)
    endViewportMove(s)
    expect(s.activity.value.paneDragging).toBe(false)
    expect(s.isPanning.value).toBe(false)
    expect(s.isBusyDragging.value).toBe(false)
  })

  it('beginSelecting/endSelecting：驱动 selecting 位 + isSelecting 派生', () => {
    const s = createInteractionState()
    expect(s.isSelecting.value).toBe(false)
    beginSelecting(s)
    expect(s.activity.value.selecting).toBe(true)
    expect(s.isSelecting.value).toBe(true)
    expect(s.isBusyDragging.value).toBe(true) // selecting 计入 isBusyDragging
    endSelecting(s)
    expect(s.activity.value.selecting).toBe(false)
    expect(s.isSelecting.value).toBe(false)
    expect(s.isBusyDragging.value).toBe(false)
  })
})

/**
 * 节点 resize（卡片右下角拖柄）是"节点手势"的一种，和 nodeDragging 同属 activity。
 *
 * 为什么需要它：普通节点的上下控制栏由壳（BaseNode）自己压掉就行，但**分组节点的控制栏
 * 挂在画布 overlay 槽**（节点外，见 GroupTopToolbarOverlay 的层叠上下文说明）——
 * 它读不到壳里的局部 isResizing。于是把"谁正在被 resize"写进共享 activity，两条路径读同一份。
 */
describe('节点 resize 活动位（nodeResizing / nodeResizeId）', () => {
  it('初始：nodeResizing=false、nodeResizeId=null，派生位同步', () => {
    const s = createInteractionState()
    expect(s.activity.value.nodeResizing).toBe(false)
    expect(s.activity.value.nodeResizeId).toBeNull()
    expect(s.isNodeResizing.value).toBe(false)
    expect(s.nodeResizeId.value).toBeNull()
  })

  it('beginNodeResize：亮 nodeResizing + 记 id，且不碰 nodeDragging', () => {
    const s = createInteractionState()
    beginNodeResize(s, 'n1')
    expect(s.activity.value.nodeResizing).toBe(true)
    expect(s.activity.value.nodeResizeId).toBe('n1')
    expect(s.isNodeResizing.value).toBe(true)
    expect(s.nodeResizeId.value).toBe('n1')
    expect(s.activity.value.nodeDragging).toBe(false)
    expect(s.isNodeDragging.value).toBe(false)
  })

  it('endNodeResize：不传 id 就清空（往返对称）', () => {
    const s = createInteractionState()
    beginNodeResize(s, 'n1')
    endNodeResize(s)
    expect(s.activity.value.nodeResizing).toBe(false)
    expect(s.activity.value.nodeResizeId).toBeNull()
    expect(s.isNodeResizing.value).toBe(false)
  })

  it('endNodeResize 传 id：只清自己那一条（别人正在 resize 时不许清掉）', () => {
    const s = createInteractionState()
    beginNodeResize(s, 'n2')
    endNodeResize(s, 'n1') // 我是 n1，正在被 resize 的是 n2 → 不该清
    expect(s.activity.value.nodeResizing).toBe(true)
    expect(s.activity.value.nodeResizeId).toBe('n2')
    endNodeResize(s, 'n2')
    expect(s.activity.value.nodeResizing).toBe(false)
    expect(s.activity.value.nodeResizeId).toBeNull()
  })

  it('与 nodeDragging 可叠加（互不覆写）', () => {
    const s = createInteractionState()
    beginNodeDrag(s, 'a')
    beginNodeResize(s, 'b')
    expect(s.activity.value.nodeDragging).toBe(true)
    expect(s.activity.value.nodeDragId).toBe('a')
    expect(s.activity.value.nodeResizing).toBe(true)
    expect(s.activity.value.nodeResizeId).toBe('b')
    endNodeResize(s, 'b')
    expect(s.activity.value.nodeResizing).toBe(false)
    expect(s.activity.value.nodeDragging).toBe(true)
    expect(s.activity.value.nodeDragId).toBe('a')
  })

  it('clearActivity 连 resize 位一起清（新空对象）', () => {
    const s = createInteractionState()
    beginNodeResize(s, 'n1')
    clearActivity(s)
    expect(s.activity.value).toEqual(emptyActivity())
    expect(s.isNodeResizing.value).toBe(false)
    expect(s.nodeResizeId.value).toBeNull()
  })
})
