import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  currentThemeMode,
  RenderEvents,
  useCanvasRender,
  watchThemeMode,
} from '@mini-canvas/canvas-render'
import type {
  AddEdgeRequest,
  CanvasNode,
  CanvasNodeType,
  NodePatchEntry,
  SelectionService,
} from '@mini-canvas/canvas-data'
import { shouldFrameFollowDrag } from '../batchConnect'
import {
  computeSelectionFrameGeometry,
  computeUnionBounds,
  paddedBounds,
  type MultiSelectRect,
  type SelectionFrameGeometry,
} from '../multiSelectEngine'
import {
  applyMultiSelectFrameChange,
  framePaddingsOf,
  resolveMultiSelectFrameConfig,
  scaleFramePaddings,
  type MultiSelectFrameConfig,
} from '../multiSelectConfig'
import { useGroupDragState } from './useGroupDragState'
import { useSelectionStyles } from './useSelectionStyles'

interface NodeReader {
  getNodes(): CanvasNode[]
  getNode(id: string): CanvasNode | undefined
  readonly types: ReadonlyMap<string, CanvasNodeType>
  subscribe(listener: (reason: string, nodeId?: string) => void): () => void
}

interface BatchWriter {
  updateNodes(entries: NodePatchEntry[]): void
  transaction<T>(reason: string, fn: (tx: { connectEdge(input: AddEdgeRequest): unknown }) => T): T
}

/** 选择框的几何、配置、样式与节点拖拽跟随。 */
export function useSelectionFrame() {
  const { flow, ctx, interaction, handleParams, connectionState, snapZone } = useCanvasRender()
  const drag = useGroupDragState()
  const viewport = flow.viewport
  const pane = flow.pane
  const rootEl = flow.root
  const screenToFlow = (x: number, y: number) => flow.screenToFlow(x, y)
  const updateNodeVisual = (id: string, p: { x: number; y: number }) => flow.updateNodeVisual(id, p)

  /** 是否正在框选（多选框手势中）：框选期间不显示群组框，免得两套框叠在一起。 */
  const isSelecting = computed(() => interaction?.isSelecting?.value === true)

  function sel(): SelectionService {
    return ctx.get('selection')
  }
  function layout() {
    return ctx.get('view')
  }
  function nodeStore(): NodeReader {
    const doc = ctx.get('doc')
    if (!doc) throw new Error("[multi-select] 需要 doc 服务（宿主未装配画布数据层）")
    return {
      getNodes: () => doc.getNodes(),
      getNode: (id) => doc.getNode(id),
      types: doc.types,
      subscribe: (listener) => doc.subscribe((c) => listener(c.reason, c.id)),
    }
  }
  function graph(): BatchWriter {
    const doc = ctx.get('doc')
    if (!doc) throw new Error("[multi-select] 需要 doc 服务（宿主未装配画布数据层）")
    return doc
  }
  function edgeStore(): { getEdges(): Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }> } | undefined {
    return ctx.get('doc')
  }

  // ====== 外观配置（实时跟随设置面板）======
  const themeMode = ref<'light' | 'dark'>(currentThemeMode())
  const themeOff = watchThemeMode((m) => { themeMode.value = m })
  onBeforeUnmount(() => themeOff())
  const frameConfig = ref<MultiSelectFrameConfig>(
    resolveMultiSelectFrameConfig((key) => ctx.tryGet('settings')?.get(key), themeMode.value),
  )
  const settingsOff = ctx
    .get<{ onChange(cb: (key: string, value: unknown) => void): { dispose(): void } } | undefined>('settings')
    ?.onChange((key, value) => {
      // 颜色格（亮/暗）改的是另一份"值"，但 resolve 出来就是这个主题该用的颜色 → 直接全量重算
      if (key.startsWith('multiSelectFrame') || key.startsWith('multiSelectBoxColor') || key.startsWith('multiSelectFrameOuterColor') || key.startsWith('multiSelectFrameInnerColor')) {
        frameConfig.value = resolveMultiSelectFrameConfig((k) => ctx.tryGet('settings')?.get(k), themeMode.value)
        return
      }
      frameConfig.value = applyMultiSelectFrameChange(frameConfig.value, key, value)
    })
  onBeforeUnmount(() => settingsOff?.dispose())

  // ====== 当前选中节点的内外两框（随选中 / 布局变化重算）======
  const frame = ref<SelectionFrameGeometry | null>(null)
  let nodeDragFrameAnchor: {
    union: MultiSelectRect
    anchorNodeId: string
    anchorStart: { x: number; y: number }
  } | null = null

  const { isDragging, nodeDragging, dragStartUnion, dragDelta, lastClient } = drag
  function setFrame(next: SelectionFrameGeometry | null): void {
    frame.value = next
  }

  function dragFrameGeometry(): SelectionFrameGeometry | null {
    const union = dragStartUnion.value
    if (!union) return null
    const moved: MultiSelectRect = {
      id: union.id,
      x: union.x + dragDelta.value.x,
      y: union.y + dragDelta.value.y,
      w: union.w,
      h: union.h,
    }
    const pads = scaleFramePaddings(framePaddingsOf(frameConfig.value), viewport.value.zoom || 1)
    const inner = paddedBounds(moved, pads.inner)
    return { inner, outer: paddedBounds(inner, pads.gap) }
  }

  function refreshFrame(): void {
    const l = layout()
    if (!l) return
    // 总开关关掉：不画框（多选本身照常可用）
    if (!frameConfig.value.enabled) {
      setFrame(null)
      return
    }
    if (isDragging.value) {
      setFrame(dragFrameGeometry())
      return
    }
    const draggingNow = nodeDragging.value || interaction?.isNodeDragging?.value === true
    if (draggingNow && nodeDragFrameAnchor) {
      followFrameByDelta({ x: 0, y: 0 })
      return
    }
    const ids = [...sel().ids]
    if (ids.length <= 1) {
      setFrame(null)
      return
    }
    const rects = ids.map((id) => l.getNodeRect(id)).filter((r): r is MultiSelectRect => r !== null)
    const pads = framePaddingsOf(frameConfig.value)
    const scaled = scaleFramePaddings(pads, viewport.value.zoom || 1)
    setFrame(computeSelectionFrameGeometry(rects, scaled.gap, scaled.inner))
  }

  // 选中变化触发重算（内核 onChange 是选中单源，最可靠）
  let unsubSel: (() => void) | undefined
  unsubSel = sel().onChange(() => refreshFrame())

  // 节点尺寸/位置变化（拖拽落盘、插件增删节点、resize）后包围框要跟上。
  let unsubStore: (() => void) | undefined
  unsubStore = nodeStore().subscribe(() => refreshFrame())

  function nodeUnionSnapshot(anchorNodeId: string, anchorPos?: { x: number; y: number }): MultiSelectRect {
    const l = layout()
    const rects = [...sel().ids]
      .map((id) => {
        if (id === anchorNodeId && anchorPos) {
          const size = l?.nodeSize(id) ?? { w: 0, h: 0 }
          return { id, x: anchorPos.x, y: anchorPos.y, w: size.w, h: size.h }
        }
        return l?.getNodeRect(id) ?? null
      })
      .filter((r): r is MultiSelectRect => !!r)
    return computeUnionBounds(rects) ?? { id: '', x: 0, y: 0, w: 0, h: 0 }
  }

  function followFrameByDelta(delta: { x: number; y: number }): void {
    const a = nodeDragFrameAnchor
    if (!a) return
    const moved: MultiSelectRect = { ...a.union, x: a.union.x + delta.x, y: a.union.y + delta.y }
    const pads = scaleFramePaddings(framePaddingsOf(frameConfig.value), viewport.value.zoom || 1)
    const inner = paddedBounds(moved, pads.inner)
    setFrame({ inner, outer: paddedBounds(inner, pads.gap) })
  }

  // 订阅渲染层的节点拖拽事件（宿主逐帧广播）：拖动中实时跟随，松手回到 store 权威值。
  const dragDisposers: Array<{ dispose(): void }> = []
  type EventCtx = { on?: (name: string, cb: (payload: never) => void) => { dispose(): void } }
  const ctxOn = (ctx as unknown as EventCtx).on?.bind(ctx)
  if (ctxOn) {
    dragDisposers.push(
      ctxOn(RenderEvents.NodeDragStart, (p: { nodeId: string; position: { x: number; y: number } }) => {
        nodeDragging.value = true
        if (!frame.value || !shouldFrameFollowDrag(p.nodeId, sel().ids)) {
          nodeDragFrameAnchor = null
          return
        }
        nodeDragFrameAnchor = {
          union: nodeUnionSnapshot(p.nodeId, p.position),
          anchorNodeId: p.nodeId,
          anchorStart: { x: p.position.x, y: p.position.y },
        }
      }),
      ctxOn(RenderEvents.NodeDrag, (p: { nodeId: string; position: { x: number; y: number } }) => {
        const a = nodeDragFrameAnchor
        if (!a || p.nodeId !== a.anchorNodeId) return
        a.union = { ...a.union, x: a.union.x + (p.position.x - a.anchorStart.x), y: a.union.y + (p.position.y - a.anchorStart.y) }
        a.anchorStart = { x: p.position.x, y: p.position.y }
        followFrameByDelta({ x: 0, y: 0 })
      }),
      ctxOn(RenderEvents.NodeDragEnd, () => {
        nodeDragging.value = false
        nodeDragFrameAnchor = null
        refreshFrame()
      }),
    )
  }

  watch([() => sel().ids, frameConfig, () => viewport.value.zoom], () => refreshFrame(), {
    immediate: true,
  })

  // ====== 模板样式 ======
  const wrapperStyle = computed(() => ({
    transform: `translate(${viewport.value.x}px, ${viewport.value.y}px) scale(${viewport.value.zoom})`,
    transformOrigin: '0 0',
  }))
  const { outerStyle, innerStyle, showInner } = useSelectionStyles({ frame, frameConfig })

  const isVisible = computed(() => frame.value !== null && !isSelecting.value)

  function screenToFlowPoint(clientX: number, clientY: number): { x: number; y: number } {
    try {
      return screenToFlow(clientX, clientY)
    } catch {
      // 单测桩可能没提供
    }
    const vp = viewport.value
    const zoom = vp.zoom || 1
    const paneEl = pane?.value
    const rect = paneEl?.getBoundingClientRect()
    const originX = rect ? rect.left : 0
    const originY = rect ? rect.top : 0
    return { x: (clientX - originX - vp.x) / zoom, y: (clientY - originY - vp.y) / zoom }
  }

  function pointInRect(
    p: { x: number; y: number },
    r: { x: number; y: number; w: number; h: number },
  ): boolean {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
  }

  function hitsAnyNode(p: { x: number; y: number }): boolean {
    const l = layout()
    if (!l) return false
    return l.getAllRects().some((r) => pointInRect(p, r))
  }

  function stopFrameTracking(): void {
    for (const d of dragDisposers) d.dispose()
    unsubSel?.()
    unsubStore?.()
  }

  return {
    drag,
    flow,
    ctx,
    interaction,
    handleParams,
    connectionState,
    snapZone,
    viewport,
    pane,
    rootEl,
    sel,
    layout,
    nodeStore,
    graph,
    edgeStore,
    updateNodeVisual,
    frame,
    frameConfig,
    outerStyle,
    innerStyle,
    showInner,
    isSelecting,
    isVisible,
    wrapperStyle,
    isDragging,
    nodeDragging,
    dragStartUnion,
    dragDelta,
    lastClient,
    dragFrameGeometry,
    refreshFrame,
    followFrameByDelta,
    screenToFlowPoint,
    pointInRect,
    hitsAnyNode,
    stopFrameTracking,
  }
}
