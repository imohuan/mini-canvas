/**
 * useCanvasConnection — 连接线核心逻辑 Composable
 *
 * 职责：
 * - 连接拖拽生命周期（start → drag → connect / end）
 * - 吸附区域计算（端口 + 节点主体）
 * - 连接验证（循环 / 重复 / 方向）
 * - 批量连线（多选后从 SelectionFrame 连线）
 * - connectionState 管理
 *
 * 使用方式：
 *   const conn = useCanvasConnection(vfInstance, vueFlowModule)
 *   // 在 <VueFlow> 上绑定
 *   @connect-start="conn.onConnectStart($event)"
 *   @connect-end="conn.onConnectEnd($event)"
 *   @connect="conn.onConnect($event)"
 *   :is-valid-connection="conn.isValidConnection"
 *   <template #connection-line="props">
 *     <CustomEdge v-bind="conn.buildConnectionEdgeProps(props)" />
 *   </template>
 */
import { ref, shallowRef, watch, nextTick, computed } from 'vue'
import { useCanvasStore } from './useCanvasStore'
import type { Node, Edge, Connection, OnConnectStartParams } from '@vue-flow/core'
import type { ConnectionLineProps } from '@vue-flow/core'

// ============================================================================
// 类型
// ============================================================================

/** 画布坐标点 */
export interface Point { x: number; y: number }

export interface BatchConnectState {
  type: 'source' | 'target'
  nodeIds: string[]
  tempNodeId: string
  tempEdgeIds: string[]
}

export interface UseCanvasConnectionOptions {
  /** VueFlow 节点获取 */
  getNodes: { value: Node[] }
  /** VueFlow 边获取 */
  getEdges: { value: Edge[] }
  /** 添加节点 */
  addNodes: (nodes: Node[]) => void
  /** 添加边 */
  addEdges: (edges: Edge[]) => void
  /** 删除节点 */
  removeNodes: (ids: string[]) => void
  /** 删除边 */
  removeEdges: (ids: string[]) => void
  /** 更新节点 */
  updateNode: (id: string, data: Partial<Omit<Node, 'id'>>) => void
  /** 视口信息 */
  viewport: { value: { x: number; y: number; zoom: number } }
  /** 事件总线（可选，用于 emit connect 等事件） */
  eventBus?: {
    emit: (event: string, payload?: unknown) => void
  }
  /** 获取节点定义（用于连接类型校验）。返回 CanvasNodeDefinition 或 null */
  getNodeDefinition?: (type: string) => { acceptsInputs?: string[]; label?: string } | null
}

// ============================================================================
// Helpers
// ============================================================================

/** 屏幕坐标 → 画布坐标 */
function toFlowPosition(viewport: { x: number; y: number; zoom: number }, clientX: number, clientY: number): Point {
  const pane = document.querySelector('.vue-flow')?.getBoundingClientRect()
  const zoom = viewport.zoom || 1
  const originX = pane?.left ?? 0
  const originY = pane?.top ?? 0
  return {
    x: (clientX - originX - viewport.x) / zoom,
    y: (clientY - originY - viewport.y) / zoom,
  }
}

/** 从 MouseEvent 或 TouchEvent 提取屏幕坐标 */
function getMousePoint(event?: MouseEvent | TouchEvent): Point | null {
  if (!event) return null
  if ('changedTouches' in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0]
    return { x: touch.clientX, y: touch.clientY }
  }
  if ('clientX' in event) {
    return { x: event.clientX, y: event.clientY }
  }
  return null
}

/** 从 DOM 元素提取节点 ID */
function getNodeIdFromElement(el: Element): string {
  return (
    el.getAttribute('data-id') ||
    (el as HTMLElement).dataset?.id ||
    el.getAttribute('data-nodeid') ||
    ''
  )
}

/** 判断节点是否为临时节点 */
function isTempNode(node: Node | undefined | null): boolean {
  return Boolean(node?.type === 'tempTarget' || node?.data?.isTemp)
}

/** 判断边是否为临时边 */
function isTempEdge(edge: Edge | undefined | null): boolean {
  return Boolean(edge?.data?.isTemp)
}

/** 获取节点的实际渲染尺寸 */
const DEFAULT_NODE_SIZE = 256
function getNodeSize(node: Node): { width: number; height: number } {
  const anyNode = node as any
  return {
    width: anyNode.dimensions?.width || anyNode.width || DEFAULT_NODE_SIZE,
    height: anyNode.dimensions?.height || anyNode.height || DEFAULT_NODE_SIZE,
  }
}

/** 获取节点卡片在画布坐标系中的矩形 */
function getNodeCardFlowRect(
  nodeId: string,
  fallbackPosition: Point,
  fallbackSize: { width: number; height: number },
  viewport: { x: number; y: number; zoom: number },
): { x: number; y: number; width: number; height: number } {
  const nodeEl = [...document.querySelectorAll('.vue-flow__node')]
    .find(el => getNodeIdFromElement(el) === nodeId)

  const cardEl = nodeEl?.querySelector('.custom-node-card') as HTMLElement | null
  if (!cardEl) {
    return {
      x: fallbackPosition.x,
      y: fallbackPosition.y,
      width: fallbackSize.width,
      height: fallbackSize.height,
    }
  }

  const rect = cardEl.getBoundingClientRect()
  const zoom = viewport.zoom || 1
  return {
    x: (rect.left - viewport.x) / zoom,
    y: (rect.top - viewport.y) / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  }
}

/** 获取节点卡片 DOM 元素的屏幕矩形 */
function getNodeCardRectFromNodeElement(el: Element): DOMRect {
  return (el.querySelector('.custom-node-card') || el).getBoundingClientRect()
}

// ============================================================================
// 连接验证工具
// ============================================================================

/** 标准化连接对象 */
function normalizeConnection(connection: Connection): Connection {
  return {
    ...connection,
    sourceHandle: connection.sourceHandle || 'source',
    targetHandle: connection.targetHandle || 'target',
  }
}

/** 转换为统一方向（source=输出, target=输入） */
function toCanonicalConnection(connection: Connection): Connection | null {
  const normalized = normalizeConnection(connection)
  if (normalized.sourceHandle === 'source' && normalized.targetHandle === 'target') {
    return normalized
  }
  if (normalized.sourceHandle === 'target' && normalized.targetHandle === 'source') {
    return {
      ...normalized,
      source: normalized.target,
      target: normalized.source,
      sourceHandle: 'source',
      targetHandle: 'target',
    }
  }
  return null
}

/** 获取已有边标准化端点 */
function getCanonicalEdgeEndpoints(edge: Edge): { source: string; target: string } | null {
  const sourceHandle = edge.sourceHandle ?? 'source'
  const targetHandle = edge.targetHandle ?? 'target'
  if (sourceHandle === 'source' && targetHandle === 'target') {
    return { source: edge.source, target: edge.target }
  }
  if (sourceHandle === 'target' && targetHandle === 'source') {
    return { source: edge.target, target: edge.source }
  }
  return null
}

/** 判断添加连接是否会形成循环 */
function wouldCreateCycle(sourceId: string, targetId: string, edges: Edge[]): boolean {
  if (sourceId === targetId) return true
  const stack = [targetId]
  const visited = new Set<string>()
  const normalizedEdges = edges
    .filter(edge => !isTempEdge(edge))
    .map(getCanonicalEdgeEndpoints)
    .filter((e): e is { source: string; target: string } => Boolean(e))

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === sourceId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const e of normalizedEdges) {
      if (e.source === current && !visited.has(e.target)) {
        stack.push(e.target)
      }
    }
  }
  return false
}

/** 判断已有边和新连接是否相同 */
function isSameCanonicalConnection(edge: Edge, connection: Connection): boolean {
  const edgeEndpoints = getCanonicalEdgeEndpoints(edge)
  const canonical = toCanonicalConnection(connection)
  if (!edgeEndpoints || !canonical) return false
  return edgeEndpoints.source === canonical.source && edgeEndpoints.target === canonical.target
}

/** 查找已存在的相同连接 */
function findSameConnection(connection: Connection, edges: Edge[]): Edge | undefined {
  return edges.find(e => !isTempEdge(e) && isSameCanonicalConnection(e, connection))
}

/** 创建边的 data */
function makeEdgeData(canvasCore: any) {
  return {
    edgeType: canvasCore.edgeType,
    edgeLineWidth: canvasCore.edgeLineWidth,
    edgeColor: canvasCore.edgeColor,
    edgeDashed: canvasCore.edgeDashed,
  }
}

// ============================================================================
// 主体 Composable
// ============================================================================

export function useCanvasConnection(options: UseCanvasConnectionOptions) {
  const canvas = useCanvasStore()
  const { getNodes, getEdges, addNodes, addEdges, removeNodes, removeEdges, updateNode, viewport, eventBus, getNodeDefinition } = options

  // --- 调试 ---
  const DEBUG_CONNECT = false
  const debugLog = (...args: any[]) => {
    if (DEBUG_CONNECT) console.log('[ConnectDebug]', ...args)
  }

  // --- 状态 ---
  let lastNativeConnectAt = 0
  const batchConnectState = ref<BatchConnectState | null>(null)

  /** 节点 ID 索引（O(1) 查找）。computed 确保与 getNodes 同步，避免 shallowRef+watch 异步延迟 */
  const nodesById = computed(() => {
    const map = new Map<string, Node>()
    for (const n of getNodes.value as Node[]) map.set(n.id, n)
    return map
  })

  // ==========================================================================
  // 节点查找
  // ==========================================================================

  /** 在屏幕坐标附近查找最近的可连线目标节点（吸附区域） */
  function findNearestValidTarget(
    clientX: number,
    clientY: number,
    sourceNodeIdOverride?: string,
    excludedNodeIdsOverride?: Iterable<string>,
  ): Node | null {
    const active = canvas.connectionState.activeConnection
    const sourceNodeId = sourceNodeIdOverride || active?.sourceNodeId
    const sourceHandle = sourceNodeIdOverride ? 'source' : active?.sourceHandle
    if (!sourceNodeId || sourceHandle !== 'source') return null

    const excludedNodeIds = new Set(excludedNodeIdsOverride ?? [sourceNodeId])
    const state = canvas.state.core
    const snapHeight = state.handleRadius * state.connectionSnapHeightRatio
    const snapOuter = state.handleRadius * state.connectionSnapOuterRatio
    const snapInner = state.handleRadius * state.connectionSnapInnerRatio

    let bestNode: Node | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    const nodeEls = document.querySelectorAll('.vue-flow__node')

    for (const el of nodeEls) {
      const nodeId = getNodeIdFromElement(el)
      if (!nodeId || excludedNodeIds.has(nodeId)) continue

      const node = nodesById.value.get(nodeId)
      if (!node || isTempNode(node) || !node.targetPosition) continue

      const rect = el.getBoundingClientRect()
      const nodeSize = getNodeSize(node)
      const zoomScale = nodeSize.width > 0 ? rect.width / nodeSize.width : 1
      const snapOuterInScreen = snapOuter * zoomScale
      const snapInnerInScreen = snapInner * zoomScale
      const snapHeightInScreen = snapHeight * zoomScale
      const centerY = rect.top + rect.height / 2
      const snapTop = centerY - snapHeightInScreen / 2
      const snapBottom = centerY + snapHeightInScreen / 2

      const insideSnapArea =
        clientX >= rect.left - snapOuterInScreen &&
        clientX <= rect.left + snapInnerInScreen &&
        clientY >= snapTop &&
        clientY <= snapBottom

      if (!insideSnapArea) continue

      const centerX = rect.left
      const distance = Math.hypot(clientX - centerX, clientY - centerY)
      if (distance < bestDistance) {
        bestNode = node
        bestDistance = distance
      }
    }
    return bestNode
  }

  /** 在屏幕坐标附近查找最近的可连线源节点（吸附区域） */
  function findNearestValidSource(
    clientX: number,
    clientY: number,
    targetNodeIds: Set<string>,
  ): Node | null {
    const state = canvas.state.core
    const snapHeight = state.handleRadius * state.connectionSnapHeightRatio
    const snapOuter = state.handleRadius * state.connectionSnapOuterRatio
    const snapInner = state.handleRadius * state.connectionSnapInnerRatio

    let bestNode: Node | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    const nodeEls = document.querySelectorAll('.vue-flow__node')

    for (const el of nodeEls) {
      const nodeId = getNodeIdFromElement(el)
      if (!nodeId || targetNodeIds.has(nodeId)) continue

      const node = nodesById.value.get(nodeId)
      if (!node || isTempNode(node) || !node.sourcePosition) continue

      const rect = getNodeCardRectFromNodeElement(el)
      const nodeSize = getNodeSize(node)
      const zoomScale = nodeSize.width > 0 ? rect.width / nodeSize.width : 1
      const snapOuterInScreen = snapOuter * zoomScale
      const snapInnerInScreen = snapInner * zoomScale
      const snapHeightInScreen = snapHeight * zoomScale
      const centerY = rect.top + rect.height / 2
      const snapTop = centerY - snapHeightInScreen / 2
      const snapBottom = centerY + snapHeightInScreen / 2

      const insideSnapArea =
        clientX >= rect.right - snapInnerInScreen &&
        clientX <= rect.right + snapOuterInScreen &&
        clientY >= snapTop &&
        clientY <= snapBottom

      if (!insideSnapArea) continue

      const distance = Math.hypot(clientX - rect.right, clientY - centerY)
      if (distance < bestDistance) {
        bestNode = node
        bestDistance = distance
      }
    }
    return bestNode
  }

  /** 根据起始端口类型查找最近的可连线节点 */
  function findNearestConnectableNode(
    clientX: number,
    clientY: number,
    startHandle: string | null,
    startNodeId?: string | null,
  ): Node | null {
    if (startHandle === 'source') {
      return findNearestValidTarget(clientX, clientY, startNodeId || undefined)
    }
    if (startHandle === 'target') {
      return findNearestValidSource(clientX, clientY, new Set(startNodeId ? [startNodeId] : []))
    }
    return null
  }

  /** 判断鼠标是否落在节点主体区域内 */
  function findNodeBodyAtPoint(
    clientX: number,
    clientY: number,
    excludedNodeIds: Iterable<string> = [],
  ): Node | null {
    const excluded = new Set(excludedNodeIds)
    const nodeEls = document.querySelectorAll('.vue-flow__node')

    for (const el of nodeEls) {
      const nodeId = getNodeIdFromElement(el)
      if (!nodeId || excluded.has(nodeId)) continue

      const node = nodesById.value.get(nodeId)
      if (!node || isTempNode(node)) continue

      const rect = el.getBoundingClientRect()
      const inside =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom

      if (inside) return node
    }
    return null
  }

  // ==========================================================================
  // 连接验证
  // ==========================================================================

  /** 返回连线不可创建的原因（拖线时判断） */
  function getInvalidConnectionReason(connection: Connection): string {
    const canonical = toCanonicalConnection(connection)
    if (!canonical?.source || !canonical.target) {
      console.log('[ConnDebug] INVALID: canonical', { canonical, raw: connection })
      return '无法连接'
    }
    if (canonical.source === canonical.target) {
      console.log('[ConnDebug] INVALID: self-connection', { canonical })
      return '无法连接'
    }
    if (wouldCreateCycle(canonical.source, canonical.target, getEdges.value as Edge[])) {
      console.log('[ConnDebug] INVALID: cycle', { canonical })
      return '无法连接'
    }
    // 确保两端节点存在且有正确的端口
    const src = nodesById.value.get(canonical.source)
    const tgt = nodesById.value.get(canonical.target)
    if (!src || !tgt) {
      console.log('[ConnDebug] INVALID: node not found in nodesById', {
        canonical,
        srcId: canonical.source, srcFound: !!src,
        tgtId: canonical.target, tgtFound: !!tgt,
        nodesByIdKeys: [...nodesById.value.keys()],
        getNodesKeys: (getNodes.value as Node[]).map(n => n.id),
      })
      return '无法连接'
    }
    if (!src.sourcePosition || !tgt.targetPosition) {
      console.log('[ConnDebug] INVALID: missing port', {
        canonical,
        srcId: src.id, srcSourcePos: src.sourcePosition, srcType: (src.data as any)?.nodeType,
        tgtId: tgt.id, tgtTargetPos: tgt.targetPosition, tgtType: (tgt.data as any)?.nodeType,
      })
      return '无法连接'
    }
    // 类型兼容性校验
    const srcType = (src.data as any)?.nodeType as string | undefined
    const tgtType = (tgt.data as any)?.nodeType as string | undefined
    if (srcType && tgtType && getNodeDefinition) {
      const tgtDef = getNodeDefinition(tgtType)
      if (tgtDef?.acceptsInputs && !tgtDef.acceptsInputs.includes(srcType)) {
        const tgtLabel = tgtDef.label ?? tgtType
        const srcLabel = getNodeDefinition(srcType)?.label ?? srcType
        return `${tgtLabel}不接受${srcLabel}输入`
      }
    }
    return ''
  }

  /** 判断连接是否合法 */
  function isValidConnection(connection: Connection): boolean {
    const normalized = normalizeConnection(connection)
    if (!normalized.source || !normalized.target) return false
    if (normalized.sourceHandle === normalized.targetHandle) return false
    if (normalized.source === normalized.target) return false

    const canonical = toCanonicalConnection(normalized)
    if (!canonical) return false

    const src = (getNodes.value as Node[]).find(n => n.id === canonical.source)
    const tgt = (getNodes.value as Node[]).find(n => n.id === canonical.target)
    if (!src || !tgt) return false
    if (!src.sourcePosition || !tgt.targetPosition) return false
    if (wouldCreateCycle(canonical.source, canonical.target, getEdges.value as Edge[])) return false
    // 类型兼容性校验
    const srcType = (src.data as any)?.nodeType as string | undefined
    const tgtType = (tgt.data as any)?.nodeType as string | undefined
    if (srcType && tgtType && getNodeDefinition) {
      const tgtDef = getNodeDefinition(tgtType)
      if (tgtDef?.acceptsInputs && !tgtDef.acceptsInputs.includes(srcType)) {
        return false
      }
    }
    return true
  }

  /** 修复已存在边的类型和数据 */
  function repairExistingConnection(edge: Edge, connection: Connection) {
    edge.type = 'custom'
    edge.sourceHandle = connection.sourceHandle
    edge.targetHandle = connection.targetHandle
    edge.data = { ...makeEdgeData(canvas.state.core), ...(edge.data || {}) }
  }

  /** 创建新连线：验证 → 去重 → 添加 */
  function createConnection(connection: Connection, _source = 'manual'): boolean {
    const normalized = toCanonicalConnection(connection)
    if (!normalized) {
      debugLog('createConnection fail: toCanonical returned null', connection)
      return false
    }
    if (!isValidConnection(normalized)) {
      debugLog('createConnection fail: isValidConnection false', {
        normalized,
        nodes: (getNodes.value as Node[]).map(n => ({ id: n.id, sp: n.sourcePosition, tp: n.targetPosition })),
      })
      return false
    }

    const existingEdge = findSameConnection(normalized, getEdges.value as Edge[])
    if (existingEdge) {
      debugLog('createConnection: repair existing edge', existingEdge.id)
      repairExistingConnection(existingEdge, normalized)
      const renderedEdge = (getEdges.value as Edge[]).find(e => e.id === existingEdge.id)
      if (!renderedEdge) {
        addEdges([{ ...existingEdge }])
        debugLog('createConnection: re-added existing edge')
        return true
      }
      debugLog('createConnection: edge already rendered, skipped')
      return false
    }

    const edgeId = `e-${normalized.source}-${normalized.target}-${Date.now()}`
    const edge: Edge = {
      id: edgeId,
      type: 'custom',
      source: normalized.source,
      target: normalized.target,
      sourceHandle: normalized.sourceHandle,
      targetHandle: normalized.targetHandle,
      data: makeEdgeData(canvas.state.core),
    }
    addEdges([edge])
    debugLog('createConnection: NEW edge added', edgeId)
    return true
  }

  /** 清空拖线时的"禁止连接"反馈 */
  function clearInvalidConnectionFeedback() {
    if (canvas.connectionState.hoverNode?.status === 'invalid') {
      canvas.connectionState.hoverNode = null
    }
  }

  /** 设置无效连接反馈 */
  function setInvalidConnectionFeedback(nodeId: string | null, point: Point | null, message = '无法连接') {
    if (!nodeId || !point) { clearInvalidConnectionFeedback(); return }
    canvas.connectionState.hoverNode = {
      nodeId, status: 'invalid', flowPosition: point, message,
    }
  }

  // ==========================================================================
  // 连接生命周期
  // ==========================================================================

  /** VueFlow connectStart：开始拖拽连线 */
  function onConnectStart(payload: ({ event?: MouseEvent | TouchEvent } & OnConnectStartParams)) {
    const nodeId = payload.nodeId
    debugLog('onConnectStart', { nodeId, handleId: payload.handleId })
    if (!nodeId) {
      debugLog('onConnectStart bail: no nodeId')
      canvas.connectionState.activeConnection = null
      return
    }
    canvas.connectionState.activeConnection = {
      sourceNodeId: nodeId,
      sourceHandle: (payload.handleId as 'source' | 'target') || 'source',
    }
    canvas.connectionState.suppressHandles = true
    canvas.connectionState.hoverNode = null
    canvas.connectionState.hoverTarget = null
    canvas.connectionState.snapTarget = null
    canvas.connectionState.tempConnection = null
  }

  /** VueFlow connectEnd：松开连线 */
  function onConnectEnd(event?: MouseEvent | TouchEvent) {
    const point = getMousePoint(event)
    const active = canvas.connectionState.activeConnection

    debugLog('onConnectEnd', {
      hasPoint: !!point, point,
      hasActive: !!active, active,
      timeSinceConnect: Date.now() - lastNativeConnectAt,
    })

    try {
      if (!point || !active) {
        debugLog('onConnectEnd bail: no point or active')
        return
      }
      // 如果 @connect 已处理，跳过
      if (Date.now() - lastNativeConnectAt < 80) {
        debugLog('onConnectEnd bail: @connect handled recently')
        return
      }

      const { sourceNodeId, sourceHandle } = active

      // 1. 尝试吸附连接
      const targetNode = findNearestConnectableNode(point.x, point.y, sourceHandle, sourceNodeId)
      debugLog('snap/body search', {
        foundId: targetNode?.id,
        sourceNodeId, sourceHandle, mouse: point,
      })

      if (targetNode) {
        const connection = sourceHandle === 'target'
          ? { source: targetNode.id, target: sourceNodeId, sourceHandle: 'source', targetHandle: sourceHandle }
          : { source: sourceNodeId, target: targetNode.id, sourceHandle, targetHandle: 'target' }

        const reason = getInvalidConnectionReason(connection)
        if (reason) {
          debugLog('snap connection INVALID:', reason)
          canvas.connectionState.hoverTarget = { type: 'node', nodeId: targetNode.id }
          canvas.connectionState.snapTarget = { nodeId: targetNode.id, isSnapped: true }
          return
        }
        const ok = createConnection(connection, 'snap')
        debugLog('snap connection result:', ok, connection)
        canvas.connectionState.snapTarget = { nodeId: targetNode.id, isSnapped: true }
        eventBus?.emit('connect', connection)
        return
      }

      // 2. 检查节点主体命中
      const bodyNode = findNodeBodyAtPoint(point.x, point.y, [sourceNodeId])
      debugLog('body hit', { foundId: bodyNode?.id })

      if (bodyNode) {
        const connection = sourceHandle === 'target'
          ? { source: bodyNode.id, target: sourceNodeId, sourceHandle: 'source', targetHandle: sourceHandle }
          : { source: sourceNodeId, target: bodyNode.id, sourceHandle, targetHandle: 'target' }

        const reason = getInvalidConnectionReason(connection)
        if (reason) {
          debugLog('body connection INVALID:', reason)
          canvas.connectionState.hoverTarget = { type: 'node', nodeId: bodyNode.id }
          return
        }
        const ok = createConnection(connection, 'snap')
        debugLog('body connection result:', ok, connection)
        canvas.connectionState.hoverTarget = { type: 'node', nodeId: bodyNode.id }
        eventBus?.emit('connect', connection)
        return
      }

      // 3. 拖到空白
      debugLog('released on blank area')
      canvas.connectionState.hoverTarget = { type: 'pane' }
      canvas.connectionState.snapTarget = null
    } finally {
      canvas.connectionState.suppressHandles = false
      canvas.connectionState.activeConnection = null
      canvas.connectionState.hoverNode = null
      canvas.connectionState.hoverTarget = null
      canvas.connectionState.snapTarget = null
    }
  }

  /** VueFlow connect：Handle 精确匹配 */
  function onConnect(connection: Connection) {
    lastNativeConnectAt = Date.now()
    debugLog('onConnect (handle match)', connection)
    try {
      const ok = createConnection(connection, 'handle')
      debugLog('onConnect createConnection result:', ok)
    } finally {
      canvas.connectionState.suppressHandles = false
      canvas.connectionState.hoverNode = null
      canvas.connectionState.activeConnection = null
      canvas.connectionState.hoverTarget = null
      canvas.connectionState.snapTarget = null
    }
  }

  // ==========================================================================
  // 连接线 Props
  // ==========================================================================

  type ConnectionFeedbackZone = {
    id: string; nodeId: string; kind: 'body'
    x: number; y: number; width: number; height: number
  }

  /** 构建连接线 props（含吸附区域计算） */
  function buildConnectionEdgeProps(connectionLineProps: ConnectionLineProps) {
    const sourceId = connectionLineProps.sourceNode?.id || canvas.connectionState.activeConnection?.sourceNodeId || '__source__'
    const startHandle = canvas.connectionState.activeConnection?.sourceHandle || (connectionLineProps as any).sourceHandleId || 'source'
    const isReverseConnection = startHandle === 'target'
    const handleRadius = canvas.state.core.handleRadius
    const snapOuter = handleRadius * canvas.state.core.connectionSnapOuterRatio
    const snapInner = handleRadius * canvas.state.core.connectionSnapInnerRatio
    const snapHeight = handleRadius * canvas.state.core.connectionSnapHeightRatio
    const snapWidth = snapOuter + snapInner

    const liveNodes = (getNodes.value as Node[])
    const connectableNodes = liveNodes
      .filter(node => node.id !== sourceId && (isReverseConnection ? node.sourcePosition : node.targetPosition))
      .map((node) => {
        const size = getNodeSize(node)
        const anyNode = node as any
        const position = anyNode.computedPosition || node.position
        const cardRect = getNodeCardFlowRect(node.id, position, size, viewport.value)
        return { node, size: { width: cardRect.width, height: cardRect.height }, position: { x: cardRect.x, y: cardRect.y } }
      })

    const feedbackNodes = liveNodes
      .filter(node => node.id !== sourceId && !isTempNode(node))
      .map((node) => {
        const size = getNodeSize(node)
        const anyNode = node as any
        const position = anyNode.computedPosition || node.position
        const cardRect = getNodeCardFlowRect(node.id, position, size, viewport.value)
        return { node, size: { width: cardRect.width, height: cardRect.height }, position: { x: cardRect.x, y: cardRect.y } }
      })

    const snapZones = connectableNodes
      .map(({ node, size, position }) => {
        const centerY = position.y + size.height / 2
        const anchorX = isReverseConnection ? position.x + size.width : position.x
        const snapX = isReverseConnection ? anchorX - snapInner : position.x - snapOuter
        const snapY = centerY - snapHeight / 2
        return { id: node.id, x: snapX, y: snapY, width: snapWidth, height: snapHeight, anchorX, anchorY: centerY }
      })

    const feedbackZones: ConnectionFeedbackZone[] = feedbackNodes.map(({ node, size, position }) => ({
      id: `${node.id}-body`,
      nodeId: node.id,
      kind: 'body' as const,
      x: position.x, y: position.y, width: size.width, height: size.height,
    }))

    let endX = connectionLineProps.targetX
    let endY = connectionLineProps.targetY
    let bestDistance = Number.POSITIVE_INFINITY
    let invalidNodeId: string | null = null
    let invalidMessage: string | undefined = undefined
    let snappedNodeId: string | null = null

    for (const zone of snapZones) {
      const inZone =
        connectionLineProps.targetX >= zone.x &&
        connectionLineProps.targetX <= zone.x + zone.width &&
        connectionLineProps.targetY >= zone.y &&
        connectionLineProps.targetY <= zone.y + zone.height

      if (!inZone) continue

      const candidateConnection = isReverseConnection
        ? { source: zone.id, target: sourceId, sourceHandle: 'source', targetHandle: startHandle }
        : { source: sourceId, target: zone.id, sourceHandle: startHandle, targetHandle: 'target' }

      if (getInvalidConnectionReason(candidateConnection)) {
        invalidNodeId = zone.id
        invalidMessage = getInvalidConnectionReason(candidateConnection)
        continue
      }

      const distance = Math.hypot(connectionLineProps.targetX - zone.anchorX, connectionLineProps.targetY - zone.anchorY)
      if (distance < bestDistance) {
        bestDistance = distance
        endX = zone.anchorX
        endY = zone.anchorY
        snappedNodeId = zone.id
      }
    }

    let bodyNodeId: string | null = null
    for (const zone of feedbackZones) {
      const x = connectionLineProps.targetX
      const y = connectionLineProps.targetY
      if (x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height) {
        bodyNodeId = zone.nodeId
        break
      }
    }

    if (!snappedNodeId && bodyNodeId) {
      const candidateConnection = isReverseConnection
        ? { source: bodyNodeId, target: sourceId, sourceHandle: 'source', targetHandle: startHandle }
        : { source: sourceId, target: bodyNodeId, sourceHandle: startHandle, targetHandle: 'target' }
      if (getInvalidConnectionReason(candidateConnection)) {
        invalidNodeId = bodyNodeId
        invalidMessage = getInvalidConnectionReason(candidateConnection)
      } else {
        snappedNodeId = bodyNodeId
      }
    }

    const effectiveFeedbackNodeId = snappedNodeId || bodyNodeId
    const nextFeedbackPoint = effectiveFeedbackNodeId ? { x: connectionLineProps.targetX, y: connectionLineProps.targetY } : null
    const currentHover = canvas.connectionState.hoverNode
    const hoverChanged =
      currentHover?.nodeId !== effectiveFeedbackNodeId ||
      currentHover?.flowPosition?.x !== nextFeedbackPoint?.x ||
      currentHover?.flowPosition?.y !== nextFeedbackPoint?.y

    if (hoverChanged) {
      // 延迟到 nextTick 写入，避免在 render 阶段触发 reactive state 变更
      // 导致 Vue 递归更新检测（Maximum recursive updates exceeded in <BaseNode>）
      const nextHover = effectiveFeedbackNodeId && nextFeedbackPoint
        ? {
            nodeId: effectiveFeedbackNodeId,
            status: (invalidNodeId ? 'invalid' : 'valid') as 'valid' | 'invalid',
            flowPosition: { x: nextFeedbackPoint.x, y: nextFeedbackPoint.y },
            message: invalidNodeId ? (invalidMessage || '无法连接') : undefined,
          }
        : null
      nextTick(() => {
        canvas.connectionState.hoverNode = nextHover
      })
    }

    return {
      ...connectionLineProps,
      id: '__connection-line__',
      source: sourceId,
      target: '__connection-target__',
      type: 'custom',
      selected: true,
      data: {},
      markerStart: '',
      markerEnd: '',
      events: {},
      animated: false,
      temporary: true,
      forceFlow: true,
      targetX: endX,
      targetY: endY,
      sourceHandleId: startHandle,
      targetHandleId: isReverseConnection ? 'source' : 'target',
      targetNode: connectionLineProps.targetNode || connectionLineProps.sourceNode || undefined as any,
      sourceNode: connectionLineProps.sourceNode,
    } as any
  }

  // ==========================================================================
  // 批量连线
  // ==========================================================================

  /** 移除批量连线中的临时节点和边 */
  function removeBatchTempConnection(batch = batchConnectState.value) {
    if (!batch) return
    removeEdges(batch.tempEdgeIds)
    removeNodes([batch.tempNodeId])
  }

  /** 重置批量连线状态 */
  function resetBatchConnectState() {
    batchConnectState.value = null
    canvas.connectionState.activeConnection = null
    canvas.connectionState.suppressHandles = true
    canvas.connectionState.hoverNode = null
    clearInvalidConnectionFeedback()
    document.removeEventListener('mousemove', onBatchConnectMove)
    document.removeEventListener('mouseup', onBatchConnectEnd)
    window.removeEventListener('blur', cancelBatchConnect)
    document.removeEventListener('pointercancel', cancelBatchConnect)
  }

  /** 取消批量连线 */
  function cancelBatchConnect() {
    if (!batchConnectState.value) return
    removeBatchTempConnection()
    resetBatchConnectState()
  }

  /** 更新批量连线中临时目标节点位置（含 snap 到端口） */
  function updateBatchTempTarget(point: Point) {
    const batch = batchConnectState.value
    if (!batch) return

    // 只在吸附区域（端口附近的窄条）内才 snap
    // 节点主体命中不 snap，只产生 3D 反馈（由 updateBatchConnectFeedback 处理）
    let snapNode: Node | null = null
    if (batch.type === 'source') {
      const sourceNodeIds = new Set(batch.nodeIds)
      snapNode = findNearestValidTarget(point.x, point.y, batch.nodeIds[0], sourceNodeIds)
    } else {
      const targetNodeIds = new Set(batch.nodeIds)
      snapNode = findNearestValidSource(point.x, point.y, targetNodeIds)
    }

    let position: Point
    if (snapNode) {
      // snap 到目标节点的端口位置（和单条连线 buildConnectionEdgeProps 一致）
      const size = getNodeSize(snapNode)
      const anySnap = snapNode as any
      const snapPos = anySnap.computedPosition || snapNode.position
      const cardRect = getNodeCardFlowRect(snapNode.id, snapPos, size, viewport.value)
      if (batch.type === 'source') {
        // 目标节点的左侧端口（target handle）
        position = { x: cardRect.x, y: cardRect.y + cardRect.height / 2 }
      } else {
        // 源节点的右侧端口（source handle）
        position = { x: cardRect.x + cardRect.width, y: cardRect.y + cardRect.height / 2 }
      }
    } else {
      // 不在吸附区域，跟鼠标走
      position = toFlowPosition(viewport.value, point.x, point.y)
    }
    updateNode(batch.tempNodeId, { position })
  }

  /** 批量连线鼠标移动 */
  function onBatchConnectMove(event: MouseEvent) {
    const point = { x: event.clientX, y: event.clientY }
    updateBatchTempTarget(point)
    updateBatchConnectFeedback(point)
  }

  /** 更新批量连线吸附反馈 */
  function updateBatchConnectFeedback(point: Point) {
    const batch = batchConnectState.value
    if (!batch) return

    let feedbackNode: Node | null = null
    let invalidNode: Node | null = null

    if (batch.type === 'source') {
      const sourceNodeIds = new Set(batch.nodeIds)
      feedbackNode = findNearestValidTarget(point.x, point.y, batch.nodeIds[0], sourceNodeIds)
      if (feedbackNode) {
        const sourceNodes = (getNodes.value as Node[]).filter(
          node => batch.nodeIds.includes(node.id) && node.sourcePosition,
        )
        invalidNode = sourceNodes.some(sn => wouldCreateCycle(sn.id, feedbackNode!.id, getEdges.value as Edge[]))
          ? feedbackNode : null
      }
      // 回退：节点主体命中
      if (!feedbackNode) {
        const bodyNode = findNodeBodyAtPoint(point.x, point.y, sourceNodeIds)
        if (bodyNode && bodyNode.targetPosition) {
          feedbackNode = bodyNode
        }
      }
    } else {
      const targetNodeIds = new Set(batch.nodeIds)
      feedbackNode = findNearestValidSource(point.x, point.y, targetNodeIds)
      if (feedbackNode) {
        const targetNodes = (getNodes.value as Node[]).filter(
          node => batch.nodeIds.includes(node.id) && node.targetPosition,
        )
        invalidNode = targetNodes.some(tn => wouldCreateCycle(feedbackNode!.id, tn.id, getEdges.value as Edge[]))
          ? feedbackNode : null
      }
      // 回退：节点主体命中
      if (!feedbackNode) {
        const bodyNode = findNodeBodyAtPoint(point.x, point.y, targetNodeIds)
        if (bodyNode && bodyNode.sourcePosition) {
          feedbackNode = bodyNode
        }
      }
    }

    const flowPoint = feedbackNode ? toFlowPosition(viewport.value, point.x, point.y) : null
    if (invalidNode) {
      canvas.connectionState.hoverNode = {
        nodeId: invalidNode.id,
        status: 'invalid',
        flowPosition: flowPoint || { x: 0, y: 0 },
        message: '无法连接',
      }
    } else if (feedbackNode) {
      canvas.connectionState.hoverNode = {
        nodeId: feedbackNode.id,
        status: 'valid',
        flowPosition: flowPoint || { x: 0, y: 0 },
      }
    } else {
      canvas.connectionState.hoverNode = null
    }
  }

  /** 批量连线结束 */
  function onBatchConnectEnd(event: MouseEvent) {
    const batch = batchConnectState.value
    if (!batch) return

    const point = { x: event.clientX, y: event.clientY }
    let tempRemoved = false
    try {
      removeBatchTempConnection(batch)
      tempRemoved = true

      if (batch.type === 'source') {
        const sourceNodes = (getNodes.value as Node[]).filter(
          node => batch.nodeIds.includes(node.id) && node.sourcePosition,
        )
        const sourceNodeIds = new Set(batch.nodeIds)

        // 1. 尝试吸附
        const targetNode = sourceNodes.length > 0
          ? findNearestValidTarget(point.x, point.y, sourceNodes[0].id, sourceNodes.map(n => n.id))
          : null

        if (targetNode) {
          for (const sourceNode of sourceNodes) {
            createConnection({
              source: sourceNode.id, target: targetNode.id,
              sourceHandle: 'source', targetHandle: 'target',
            }, 'selection-batch')
          }
          return
        }

        // 2. 回退：节点主体命中（和单条连接线行为一致）
        const bodyNode = findNodeBodyAtPoint(point.x, point.y, sourceNodeIds)
        if (bodyNode && bodyNode.targetPosition) {
          for (const sourceNode of sourceNodes) {
            createConnection({
              source: sourceNode.id, target: bodyNode.id,
              sourceHandle: 'source', targetHandle: 'target',
            }, 'selection-batch')
          }
        }
        return
      }

      const targetNodes = (getNodes.value as Node[]).filter(
        node => batch.nodeIds.includes(node.id) && node.targetPosition,
      )
      const targetNodeIds = new Set(batch.nodeIds)

      // 1. 尝试吸附
      const sourceNode = findNearestValidSource(point.x, point.y, new Set(targetNodes.map(n => n.id)))
      if (sourceNode) {
        for (const targetNode of targetNodes) {
          createConnection({
            source: sourceNode.id, target: targetNode.id,
            sourceHandle: 'source', targetHandle: 'target',
          }, 'selection-batch')
        }
        return
      }

      // 2. 回退：节点主体命中
      const bodySource = findNodeBodyAtPoint(point.x, point.y, targetNodeIds)
      if (bodySource && bodySource.sourcePosition) {
        for (const targetNode of targetNodes) {
          createConnection({
            source: bodySource.id, target: targetNode.id,
            sourceHandle: 'source', targetHandle: 'target',
          }, 'selection-batch')
        }
      }
    } finally {
      if (!tempRemoved) removeBatchTempConnection(batch)
      resetBatchConnectState()
    }
  }

  /** 框选后批量连线开始 */
  function onSelectionBatchConnectStart(payload: { event: MouseEvent; type: 'source' | 'target'; nodeIds: string[] }) {
    const activeNodes = (getNodes.value as Node[]).filter(node =>
      payload.nodeIds.includes(node.id) &&
      (payload.type === 'source' ? node.sourcePosition : node.targetPosition),
    )
    if (activeNodes.length === 0) return

    const flowPosition = toFlowPosition(viewport.value, payload.event.clientX, payload.event.clientY)
    const tempNodeId = `selection-batch-target-${Date.now()}`
    const tempEdgeIds = activeNodes.map(node => `selection-batch-edge-${node.id}-${Date.now()}`)

    // 创建临时节点（在用户鼠标位置）
    addNodes([{
      id: tempNodeId,
      type: 'tempTarget',
      position: flowPosition,
      data: { nodeType: 'temp', label: '目标', isTemp: true },
      draggable: false,
      selectable: false,
      deletable: false,
      targetPosition: payload.type === 'source' ? ('left' as any) : undefined,
      sourcePosition: payload.type === 'target' ? ('right' as any) : undefined,
    } as Node])

    // 创建临时边
    const tempEdges: Edge[] = activeNodes.map((node, i) => ({
      id: tempEdgeIds[i],
      type: 'custom',
      source: payload.type === 'source' ? node.id : tempNodeId,
      target: payload.type === 'source' ? tempNodeId : node.id,
      sourceHandle: payload.type === 'source' ? 'source' : 'source',
      targetHandle: payload.type === 'source' ? 'target' : 'target',
      selectable: false,
      style: { strokeDasharray: '6 4' },
      data: { isTemp: true },
    }))
    addEdges(tempEdges)

    batchConnectState.value = { type: payload.type, nodeIds: payload.nodeIds, tempNodeId, tempEdgeIds }

    // 设置连接状态（用于 hover 反馈）
    canvas.connectionState.activeConnection = {
      sourceNodeId: payload.type === 'source' ? activeNodes[0].id : tempNodeId,
      sourceHandle: 'source',
    }
    canvas.connectionState.suppressHandles = true
    canvas.connectionState.hoverNode = null
    canvas.connectionState.hoverTarget = null
    canvas.connectionState.snapTarget = null

    // 绑定全局鼠标事件 — 跟着鼠标移动更新临时节点位置
    document.addEventListener('mousemove', onBatchConnectMove)
    document.addEventListener('mouseup', onBatchConnectEnd)
    window.addEventListener('blur', cancelBatchConnect)
    document.addEventListener('pointercancel', cancelBatchConnect)
  }

  // ==========================================================================
  // 公开 API
  // ==========================================================================

  return {
    // 状态
    batchConnectState,
    nodesById,

    // 连接生命周期
    onConnectStart,
    onConnectEnd,
    onConnect,
    isValidConnection,

    // 连接线 props
    buildConnectionEdgeProps,

    // 连接创建 / 验证
    createConnection,
    getInvalidConnectionReason,

    // 节点查找
    findNearestValidTarget,
    findNearestConnectableNode,
    findNodeBodyAtPoint,
    findNearestValidSource,

    // 反馈管理
    clearInvalidConnectionFeedback,
    setInvalidConnectionFeedback,

    // 批量连线
    onSelectionBatchConnectStart,
    onBatchConnectMove,
    onBatchConnectEnd,
    resetBatchConnectState,
    cancelBatchConnect,

    // 工具函数
    toFlowPosition: (cx: number, cy: number) => toFlowPosition(viewport.value, cx, cy),
    getMousePoint,
    getNodeIdFromElement,
    isTempNode,
    isTempEdge,
  }
}
