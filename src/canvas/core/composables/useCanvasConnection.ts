import { nextTick, type Ref } from 'vue'
import type { Node, Edge, Connection, OnConnectStartParams } from '@vue-flow/core'
import type { ConnectionLineProps } from '@vue-flow/core'
import type { CanvasMenuItem, CanvasMenuState } from '../components/CanvasMenu.types'

interface UseCanvasConnectionOptions {
  canvas: ReturnType<typeof import('../useCanvasStore').useCanvasStore>
  vueFlowInstance: any
  getNodes: any
  getEdges: any
  nodesById: any
  createConnection: (connection: Connection, source?: string) => boolean
  openMenu: (next: Omit<CanvasMenuState, 'visible'>, context?: any) => void
  menuContext: Ref<any>
  makeEdgeData: () => Record<string, unknown>
  resolveConnectionMenuItems: (args: { sourceNodeId: string; flowPosition: { x: number; y: number } }) => CanvasMenuItem[]
}

type CachedNodeRect = { nodeId: string; rect: DOMRect }

export function useCanvasConnection(options: UseCanvasConnectionOptions) {
  const { canvas, vueFlowInstance, getNodes, nodesById, openMenu, makeEdgeData, resolveConnectionMenuItems } = options

  let lastNativeConnectAt = 0
  let cachedNodeRects: CachedNodeRect[] = []
  let rafId: number | null = null

  const batchConnectState = {
    active: false,
    type: 'source' as 'source' | 'target',
    nodeIds: [] as string[],
    dragNodeId: '',
  }

  // --- Rect cache ---
  function rebuildNodeRectCache(excludedNodeIds: Set<string>) {
    cachedNodeRects = []
    const nodeEls = document.querySelectorAll('.vue-flow__node')
    for (const el of nodeEls) {
      const nodeId = getNodeIdFromElement(el)
      if (!nodeId || excludedNodeIds.has(nodeId)) continue
      cachedNodeRects.push({ nodeId, rect: getNodeCardRectFromNodeElement(el) })
    }
  }

  function clearNodeRectCache() {
    cachedNodeRects = []
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  }

  // --- Mouse helpers ---
  function getMousePoint(event?: MouseEvent | TouchEvent) {
    if (!event) return null
    if ('changedTouches' in event && event.changedTouches.length > 0) {
      const touch = event.changedTouches[0]
      return { x: touch.clientX, y: touch.clientY }
    }
    if ('clientX' in event) return { x: event.clientX, y: event.clientY }
    return null
  }

  function getNodeIdFromElement(el: Element) {
    return (el as HTMLElement).dataset?.id || el.querySelector('[data-id]')?.getAttribute('data-id') || null
  }

  function getNodeCardRectFromNodeElement(el: Element): DOMRect {
    const card = el.querySelector('.base-node-card') || el
    return card.getBoundingClientRect()
  }

  function isTempNode(node: Node | undefined | null) {
    return !node || node.type === 'tempTarget' || node.id.startsWith('temp-') || !!(node.data as any)?.isTemp
  }

  function isTempEdge(edge: Edge | undefined | null) {
    return !edge || edge.id.startsWith('temp-') || !!(edge.data as any)?.isTemp
  }

  function getNodeSize(node: Node) {
    return {
      width: (node.data as any)?.cardWidth ?? (node as any).dimensions?.width ?? 256,
      height: (node.data as any)?.cardHeight ?? (node as any).dimensions?.height ?? 256,
    }
  }

  function getNodeCardFlowRect(nodeId: string, fallbackPosition: { x: number; y: number }, fallbackSize: { width: number; height: number }) {
    const node = nodesById.value.get(nodeId)
    const size = node ? getNodeSize(node) : fallbackSize
    const pos = node?.position ?? fallbackPosition
    return { x: pos.x, y: pos.y, width: size.width, height: size.height }
  }

  // --- Connection targets ---
  function findNearestValidTarget(clientX: number, clientY: number, sourceNodeIdOverride?: string, excludedNodeIdsOverride?: Iterable<string>) {
    const sourceNodeId = sourceNodeIdOverride ?? canvas.connectionState.sourceNodeId
    if (!sourceNodeId) return null

    const excluded = new Set(excludedNodeIdsOverride ?? [sourceNodeId])
    const targetNodes = getNodes.value.filter((n: Node) => !isTempNode(n) && !excluded.has(n.id))

    let bestNodeId: string | null = null
    let bestDist = Infinity

    for (const node of targetNodes) {
      const el = document.querySelector(`[data-id="${node.id}"]`)
      if (!el) continue
      const rect = getNodeCardRectFromNodeElement(el)
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dist = Math.hypot(clientX - cx, clientY - cy)
      if (dist < bestDist) { bestDist = dist; bestNodeId = node.id }
    }

    if (bestNodeId && bestDist < 200) return bestNodeId
    return null
  }

  function findNearestValidSource(clientX: number, clientY: number, targetNodeIds: Set<string>) {
    const sourceNodes = getNodes.value.filter((n: Node) => !isTempNode(n) && !targetNodeIds.has(n.id))
    let bestNodeId: string | null = null
    let bestDist = Infinity

    for (const node of sourceNodes) {
      const el = document.querySelector(`[data-id="${node.id}"]`)
      if (!el) continue
      const rect = getNodeCardRectFromNodeElement(el)
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dist = Math.hypot(clientX - cx, clientY - cy)
      if (dist < bestDist) { bestDist = dist; bestNodeId = node.id }
    }

    if (bestNodeId && bestDist < 300) return bestNodeId
    return null
  }

  function createTempConnectionMenu(point: { x: number; y: number }, sourceNodeId: string, sourceHandle: string) {
    const tempNodeId = `temp-${Date.now()}`
    const tempEdgeId = `temp-edge-${Date.now()}`
    const flowPosition = vueFlowInstance.project({ x: point.x, y: point.y })

    vueFlowInstance.addNodes([{
      id: tempNodeId, type: 'tempTarget', position: flowPosition,
      data: { isTemp: true },
    }])
    vueFlowInstance.addEdges([{
      id: tempEdgeId, source: sourceNodeId, target: tempNodeId,
      sourceHandle, targetHandle: 'target', data: { isTemp: true },
    }])

    nextTick(() => {
      openMenu({
        mode: 'connection',
        title: '创建连线节点',
        position: point,
        items: resolveConnectionMenuItems({ sourceNodeId, flowPosition }),
      }, {
        pendingConnection: { sourceNodeId, sourceHandle, tempNodeId, tempEdgeId, flowPosition },
      })
    })
  }

  // --- Connect handlers ---
  function onConnectStart(payload: ({ event?: MouseEvent | TouchEvent } & OnConnectStartParams)) {
    canvas.connectionState.isConnecting = true
    canvas.connectionState.sourceNodeId = payload.nodeId || null
    canvas.connectionState.sourceHandle = payload.handleId || null
    canvas.connectionState.suppressHandles = true
    canvas.connectionState.hoverFeedbackNodeId = null
    canvas.connectionState.hoverFeedbackPoint = null
    rebuildNodeRectCache(new Set([payload.nodeId || '']))
  }

  function onConnectEnd(event?: MouseEvent | TouchEvent) {
    clearNodeRectCache()
    canvas.connectionState.isConnecting = false
    canvas.connectionState.sourceNodeId = null
    canvas.connectionState.sourceHandle = null
    canvas.connectionState.suppressHandles = false

    const point = getMousePoint(event)
    if (!point) return

    const targetNodeId = findNearestValidTarget(point.x, point.y)
    if (!targetNodeId) return

    const sourceNodeId = canvas.connectionState.sourceNodeId
    if (!sourceNodeId) return

    createTempConnectionMenu(point, sourceNodeId, canvas.connectionState.sourceHandle || 'source')
  }

  // --- Batch connect ---
  function resetBatchConnectState() {
    batchConnectState.active = false
    batchConnectState.nodeIds = []
    batchConnectState.dragNodeId = ''
    clearNodeRectCache()
  }

  function cancelBatchConnect() {
    resetBatchConnectState()
  }

  function onBatchConnectMove(_event: MouseEvent) {
    // throttled by requestAnimationFrame
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = null
    })
  }

  function onBatchConnectEnd(_event: MouseEvent) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    resetBatchConnectState()
  }

  function onSelectionBatchConnectStart(payload: { event: MouseEvent; type: 'source' | 'target'; nodeIds: string[] }) {
    batchConnectState.active = true
    batchConnectState.type = payload.type
    batchConnectState.nodeIds = [...payload.nodeIds]
  }

  function buildConnectionEdgeProps(connectionLineProps: ConnectionLineProps) {
    return {
      ...connectionLineProps,
      type: 'custom',
      data: makeEdgeData(),
    }
  }

  // --- Expose legacy vars needed by Canvas.vue ---
  return {
    lastNativeConnectAt,
    batchConnectState,
    onConnectStart,
    onConnectEnd,
    onSelectionBatchConnectStart,
    onBatchConnectMove,
    onBatchConnectEnd,
    cancelBatchConnect,
    resetBatchConnectState,
    findNearestValidTarget,
    findNearestValidSource,
    createTempConnectionMenu,
    getMousePoint,
    getNodeIdFromElement,
    isTempNode,
    isTempEdge,
    getNodeSize,
    getNodeCardFlowRect,
    buildConnectionEdgeProps,
  }
}