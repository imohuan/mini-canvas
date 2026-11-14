import { type Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import { RenderEvents } from '@plume-canvas/canvas-render'
import { BoxSelectClickGuard } from '../boxSelectGuard'
import { isHitOwnBatchPort } from '../batchConnect'
import {
  computeUnionBounds,
  draggableMembers,
  nodeIdAtPoint,
  resolveFramePress,
  type MultiSelectRect,
} from '../multiSelectEngine'

type Point = { x: number; y: number }

interface GroupDragDeps {
  ctx: CanvasRenderContext['ctx']
  viewport: CanvasRenderContext['flow']['viewport']
  sel: () => { ids: ReadonlySet<string>; set(ids: Iterable<string>): void }
  layout: () => CanvasRenderContext['ctx']['view'] | undefined
  nodeStore: () => {
    getNodes(): Array<{ id: string; parentId?: string }>
    getNode(id: string): { id: string; parentId?: string } | undefined
  }
  graph: () => { updateNodes(entries: Array<{ id: string; patch: { position: Point } }>): void }
  frame: Ref<{ outer: MultiSelectRect } | null>
  isDragging: Ref<boolean>
  dragStartUnion: Ref<MultiSelectRect | null>
  dragDelta: Ref<Point>
  lastClient: Ref<Point | null>
  dragStartPositions: Ref<Map<string, { abs: Point; base: Point }>>
  livePositions: Ref<Map<string, Point>>
  updateNodeVisual: (id: string, p: Point) => void
  dragFrameGeometry: () => { outer: MultiSelectRect; inner: MultiSelectRect } | null
  refreshFrame: () => void
  pointInRect: (p: Point, r: { x: number; y: number; w: number; h: number }) => boolean
  screenToFlowPoint: (x: number, y: number) => Point
}

/** 两次单击之间允许的抖动（flow 像素）：小于它视为"没动"，不落盘、不当成拖动 */
const DRAG_EPSILON = 0.5

/**
 * 框内拖动 = 整组平移；框内按下一律由这里接管（capture 阶段），节点里的按钮/进度条/
 * 缩放角/端口在当前多选手势里收不到事件 —— 用户 2026-11-14 口径：
 * 「多选时节点内所有地方都只用来拖，只保留加选和减选。」
 */
export function useGroupDrag(input: GroupDragDeps) {
  const groupDragClickGuard = new BoxSelectClickGuard()
  /**
   * 要吞掉紧随的那一次 click：
   * - 整组拖动结束时（浏览器会补一次 click，落在节点上会把多选收缩成单选）；
   * - 框内 Shift 加减选之后（宿主/节点还会再按一次普通点选走一遍）。
   */
  let swallowNextClick = false

  function onOwnerCaptureClick(e: MouseEvent): void {
    if (swallowNextClick) {
      // 整组拖动结束时浏览器会补一次 click。若它落在节点上，宿主会把它当"点这个节点"
      // 把多选收缩成单选 —— 用户看到的就是"拖完整组，选择没了"。
      swallowNextClick = false
      e.stopImmediatePropagation()
      e.preventDefault()
      return
    }
    const target = e.target as HTMLElement | null
    const isPaneBlank = !!target && !target.closest('.vue-flow__node') && !target.closest('.vue-flow__edge')
    const swallowed = groupDragClickGuard.shouldSwallow(isPaneBlank)
    if (!swallowed) return
    e.stopImmediatePropagation()
    e.preventDefault()
  }

  function onPaneCaptureDown(e: PointerEvent | MouseEvent): void {
    if (input.isDragging.value && e.type === 'mousedown') {
      e.stopImmediatePropagation()
      e.preventDefault()
      return
    }
    if (e.type === 'pointerdown') groupDragClickGuard.reset()
    if (e.button !== 0 || input.isDragging.value) return
    const g = input.frame.value
    if (!g) return
    const target = e.target as HTMLElement | null
    if (!(target instanceof HTMLElement)) return

    // 画布自己的控件、多选框的批量端口永远不接管（它们在框外，按几何也会被排除，
    // 这里保留显式判断，避免框与控件重叠时误吞）。
    if (
      target.closest('.vue-flow__controls') ||
      target.closest('.vue-flow__minimap') ||
      target.closest('.vue-flow__panel') ||
      target.closest('.selection-frame-slot') ||
      isHitOwnBatchPort({
        batchSlot: !!target.closest('.selection-frame-batch-slot'),
        movingHandle: !!target.closest('.moving-handle-anchor'),
      })
    ) {
      return
    }

    const p = input.screenToFlowPoint(e.clientX, e.clientY)
    const insideFrame = input.pointInRect(p, g.outer)
    const action = resolveFramePress({ insideFrame, shiftKey: e.shiftKey })
    if (action === 'native') return

    // 到这一步说明按在框内：节点内的按钮/滑杆/端口等一概收不到这一下。
    e.stopImmediatePropagation()
    e.preventDefault()

    // mousedown 是 pointerdown 之后补发的同一 gesture：pointerdown 已经处理过，这里只负责挡。
    if (e.type === 'mousedown') return

    if (action === 'toggle') {
      const nodeId = target.closest('.vue-flow__node')?.getAttribute('data-id') ?? ''
      trackShiftPress(nodeId, e.clientX, e.clientY)
      return
    }

    startGroupDrag(e.clientX, e.clientY)
  }

/**
   * 框内 Shift 手势：
   * - 没移动 → 只做加选/减选（点到的节点在选中集里就移除，否则加入）；
   * - 移动了 → 当整组拖动处理（框内任何位置都能拖，控件不参与）。
   * 无论哪种，这一次 click 都吞掉，避免再落到节点自己的普通点选上。
   */
  function trackShiftPress(nodeId: string, clientX: number, clientY: number): void {
    let started = false
    const onMove = (mv: PointerEvent): void => {
      if (started) return
      if (Math.hypot(mv.clientX - clientX, mv.clientY - clientY) <= 4) return
      started = true
      window.removeEventListener('pointermove', onMove)
      startGroupDrag(clientX, clientY)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      swallowNextClick = true
      if (started) return
      if (!nodeId) return
      const next = new Set(input.sel().ids)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      input.sel().set(next)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function startGroupDrag(clientX: number, clientY: number): void {
    if (!input.frame.value) return
    try {
      input.isDragging.value = true
      input.lastClient.value = { x: clientX, y: clientY }
      input.dragDelta.value = { x: 0, y: 0 }
      input.dragStartUnion.value = computeUnionBounds(
        [...input.sel().ids]
          .map((id) => input.layout()?.getNodeRect(id))
          .filter((r): r is MultiSelectRect => !!r),
      )
      if (!input.dragStartUnion.value) {
        throw new Error('起手时取不到选中节点的矩形')
      }

      const nodes = input.nodeStore().getNodes()
      const movable = draggableMembers(input.sel().ids, nodes)
      const l = input.layout()
      const ns = input.nodeStore()
      const startMap = new Map<string, { abs: Point; base: Point }>()
      const liveMap = new Map<string, Point>()
      for (const id of movable) {
        const rect = l?.getNodeRect(id)
        if (rect) {
          const n = ns.getNode(id)
          const parentAbs = n?.parentId ? (l?.absolutePosition(n.parentId) ?? { x: 0, y: 0 }) : { x: 0, y: 0 }
          startMap.set(id, { abs: { x: rect.x, y: rect.y }, base: { x: rect.x - parentAbs.x, y: rect.y - parentAbs.y } })
          liveMap.set(id, { x: rect.x - parentAbs.x, y: rect.y - parentAbs.y })
        }
      }
      input.dragStartPositions.value = startMap
      input.livePositions.value = liveMap

      window.addEventListener('pointermove', onDragMove)
      window.addEventListener('pointerup', onDragUp)
    } catch (err) {
      input.isDragging.value = false
      input.lastClient.value = null
      input.dragStartUnion.value = null
      input.dragDelta.value = { x: 0, y: 0 }
      window.removeEventListener('pointermove', onDragMove)
      window.removeEventListener('pointerup', onDragUp)
      console.error('[multi-select] 整组拖动起手失败（已回滚）', err)
    }
  }

  function onDragMove(e: MouseEvent): void {
    if (!input.isDragging.value) return
    if (!input.lastClient.value) return
    const last = input.lastClient.value ?? { x: e.clientX, y: e.clientY }
    const zoom = input.viewport.value.zoom || 1
    const segDx = (e.clientX - last.x) / zoom
    const segDy = (e.clientY - last.y) / zoom
    input.lastClient.value = { x: e.clientX, y: e.clientY }
    const canvasDx = input.dragDelta.value.x + segDx
    const canvasDy = input.dragDelta.value.y + segDy

    const nextLive = new Map<string, Point>()
    for (const [id, start] of input.dragStartPositions.value) {
      const p = { x: start.base.x + canvasDx, y: start.base.y + canvasDy }
      nextLive.set(id, p)
      input.updateNodeVisual(id, p)
    }
    input.livePositions.value = nextLive

    input.dragDelta.value = { x: canvasDx, y: canvasDy }
    input.frame.value = input.dragFrameGeometry()
  }

  function onDragUp(): void {
    if (!input.isDragging.value) return
    const moved = Math.hypot(input.dragDelta.value.x, input.dragDelta.value.y) > DRAG_EPSILON
    input.isDragging.value = false
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragUp)

    if (!moved) {
      // 原地按了一下（没拖动）：不写节点、不发拖拽结束事件，选择也不动。
      // 这一下可能落在标题条/装饰层上 —— 它本来就没有拖动语义，不能顺手把多选收成单选。
      swallowNextClick = true
      input.dragStartPositions.value.clear()
      input.livePositions.value.clear()
      input.dragStartUnion.value = null
      input.dragDelta.value = { x: 0, y: 0 }
      input.refreshFrame()
      return
    }

    groupDragClickGuard.markGestureDone(true)
    swallowNextClick = true

    const entries = [...input.dragStartPositions.value].map(([id, start]) => {
      const write = input.livePositions.value.get(id) ?? { x: start.base.x, y: start.base.y }
      return { id, patch: { position: write } }
    })
    if (entries.length > 0) input.graph().updateNodes(entries)
    for (const [id, start] of input.dragStartPositions.value) {
      ;(input.ctx as unknown as { emit(name: string, payload: unknown): void }).emit(
        RenderEvents.NodeDragEnd,
        { nodeId: id, position: start.abs },
      )
    }

    input.dragStartPositions.value.clear()
    input.livePositions.value.clear()
    input.dragStartUnion.value = null
    input.dragDelta.value = { x: 0, y: 0 }
    input.refreshFrame()
  }

  function stopGroupDrag(): void {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragUp)
  }

  return {
    onOwnerCaptureClick,
    onPaneCaptureDown,
    startGroupDrag,
    onDragMove,
    onDragUp,
    stopGroupDrag,
  }
}
