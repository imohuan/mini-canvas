import { type Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import { RenderEvents } from '@plume-canvas/canvas-render'
import { BoxSelectClickGuard } from '../boxSelectGuard'
import { isHitOwnBatchPort } from '../batchConnect'
import {
  computeUnionBounds,
  draggableMembers,
  resolveGroupDragHit,
  type MultiSelectRect,
} from '../multiSelectEngine'

type Point = { x: number; y: number }

interface GroupDragDeps {
  ctx: CanvasRenderContext['ctx']
  viewport: CanvasRenderContext['flow']['viewport']
  sel: () => { ids: ReadonlySet<string> }
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

/**
 * 落点上"要自己处理的控件"清单：按在这些上面拖动不是整组平移，
 * 而是它自己的动作（播放/滑杆/缩放角/拖线端口/浮层按钮…）。
 *
 * 只认**交互件**，不认节点壳本身：卡片上方的标题条、节点之间的透明边距虽然也属于节点元素，
 * 但它们没有自己的拖动语义，应该走整组拖动（见 resolveGroupDragHit 的说明）。
 */
const INTERACTIVE_SELECTOR = [
  '.vue-flow__edge',
  '.vue-flow__handle',
  '.moving-handle-anchor',
  '.drag-handle',
  '.resize-handle',
  '.v2-slot',
  '.ntp-root',
  '.csurface-overlay-item',
  '.selection-frame-slot',
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="slider"]',
  '[role="button"]',
  '[data-no-group-drag]',
].join(',')

/** 两次单击之间允许的抖动（flow 像素）：小于它视为"没动"，不落盘、不当成拖动 */
const DRAG_EPSILON = 0.5

/** 框内空白拖动 = 整组平移；capture 监听与拖拽守卫也在这一层。 */
export function useGroupDrag(input: GroupDragDeps) {
  const groupDragClickGuard = new BoxSelectClickGuard()
  /** 刚结束一次真的整组拖动：紧随的那次 click（落在节点上也一样）要吞掉 */
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
    if (
      target.closest('.vue-flow__controls') ||
      target.closest('.vue-flow__minimap') ||
      target.closest('.vue-flow__panel')
    ) {
      return
    }
    if (
      isHitOwnBatchPort({
        batchSlot: !!target.closest('.selection-frame-batch-slot'),
        movingHandle: !!target.closest('.moving-handle-anchor'),
      })
    ) {
      return
    }
    const p = input.screenToFlowPoint(e.clientX, e.clientY)

    // 落点归属：框内 + 非控件 + 不是"能自己拖节点的位置" → 整组拖动。
    // 这样框内任何位置（节点之间的空隙、卡片上方的标题条、选中卡片上的透明装饰层）
    // 都能带起整组，而不会落到节点自己的点选上把多选收成单选（用户 2026-11-14 反馈）。
    // "本来就能拖节点"直接用 VueFlow 自己的约定判断：落在 .nodrag 里就拖不动。
    const nodeEl = target.closest('.vue-flow__node')
    const overNode = !!nodeEl
    const nodeId = nodeEl?.getAttribute('data-id') ?? ''
    const interactive = !!target.closest(INTERACTIVE_SELECTOR)
    const hit = resolveGroupDragHit({
      insideFrame: input.pointInRect(p, g.outer),
      overNode,
      nodeSelected: overNode ? input.sel().ids.has(nodeId) : false,
      interactive,
      nativeDraggable: overNode && !target.closest('.nodrag'),
    })
    if (hit !== 'group') return

    e.stopImmediatePropagation()
    e.preventDefault()
    startGroupDrag(e.clientX, e.clientY)
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
