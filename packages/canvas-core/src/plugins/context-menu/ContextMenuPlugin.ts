import { createApp, h, reactive, nextTick, type Component } from "vue"
import type { Node, Edge } from "@vue-flow/core"
import { Position } from "@vue-flow/core"
import type { CanvasPlugin, PluginContext } from "../types"
import type { ConnectionState, Point } from "../types"
import type { MenuContext } from "../../registry/MenuRegistry"
import type { CanvasMenuItem, CanvasMenuState } from "../../registry/types"
import CanvasMenu from "../../components/Menu/CanvasMenu.vue"
import { registerBuiltinMenuItems } from "./builtinMenuItems"

// ==================== 连线拖拽菜单工具函数（从 Canvas.vue 移植） ====================

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

/** 从 DOM 元素上提取节点 ID */
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

/** 在屏幕坐标附近查找最近的可连线目标节点（吸附区域版，简化版） */
function findNearestValidTarget(
  clientX: number,
  clientY: number,
  context: PluginContext,
  sourceNodeId: string,
): Node | null {
  const excludedNodeIds = new Set([sourceNodeId])
  // 构建 O(1) 查找索引，避免循环内 O(n) find 导致 O(n²)
  const nodeMap = new Map(context.actions.getNodes().map(n => [n.id, n]))
  let bestNode: Node | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const SNAP_THRESHOLD = 50

  const nodeEls = document.querySelectorAll('.vue-flow__node')
  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || excludedNodeIds.has(nodeId)) continue

    const node = nodeMap.get(nodeId)
    if (!node || isTempNode(node) || !node.targetPosition) continue

    const rect = el.getBoundingClientRect()
    const insideSnapArea =
      clientX >= rect.left - SNAP_THRESHOLD &&
      clientX <= rect.left + SNAP_THRESHOLD &&
      clientY >= rect.top &&
      clientY <= rect.bottom

    if (!insideSnapArea) continue

    const centerX = rect.left
    const centerY = rect.top + rect.height / 2
    const distance = Math.hypot(clientX - centerX, clientY - centerY)

    if (distance < bestDistance) {
      bestNode = node
      bestDistance = distance
    }
  }

  return bestNode
}

/** 在屏幕坐标附近查找最近的可连线源节点（右侧吸附，用于反向拖线） */
function findNearestValidSource(
  clientX: number,
  clientY: number,
  context: PluginContext,
  targetNodeIds: Set<string>,
): Node | null {
  // 构建 O(1) 查找索引，避免循环内 O(n) find 导致 O(n²)
  const nodeMap = new Map(context.actions.getNodes().map(n => [n.id, n]))
  let bestNode: Node | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const SNAP_THRESHOLD = 50

  const nodeEls = document.querySelectorAll('.vue-flow__node')
  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || targetNodeIds.has(nodeId)) continue

    const node = nodeMap.get(nodeId)
    if (!node || isTempNode(node) || !node.sourcePosition) continue

    const rect = el.getBoundingClientRect()
    // 源节点吸附区域在右侧
    const insideSnapArea =
      clientX >= rect.right - SNAP_THRESHOLD &&
      clientX <= rect.right + SNAP_THRESHOLD &&
      clientY >= rect.top &&
      clientY <= rect.bottom

    if (!insideSnapArea) continue

    const centerX = rect.right
    const centerY = rect.top + rect.height / 2
    const distance = Math.hypot(clientX - centerX, clientY - centerY)

    if (distance < bestDistance) {
      bestNode = node
      bestDistance = distance
    }
  }

  return bestNode
}

/** 判断鼠标是否落在某个节点主体区域内 */
function findNodeBodyAtPoint(
  clientX: number,
  clientY: number,
  context: PluginContext,
  excludedNodeIds: Iterable<string> = [],
): Node | null {
  const excluded = new Set(excludedNodeIds)
  // 构建 O(1) 查找索引，避免循环内 O(n) find 导致 O(n²)
  const nodeMap = new Map(context.actions.getNodes().map(n => [n.id, n]))
  const nodeEls = document.querySelectorAll('.vue-flow__node')

  for (const el of nodeEls) {
    const nodeId = getNodeIdFromElement(el)
    if (!nodeId || excluded.has(nodeId)) continue

    const node = nodeMap.get(nodeId)
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

/** 判定鼠标下方的目标类型 */
function resolveHoverTarget(
  clientX: number,
  clientY: number,
  context: PluginContext,
  sourceNodeId: string,
): ConnectionState['hoverTarget'] {
  // 1. 检查节点主体
  const bodyNode = findNodeBodyAtPoint(clientX, clientY, context, [sourceNodeId])
  if (bodyNode) {
    return { type: 'node', nodeId: bodyNode.id }
  }
  // 2. 检查端口（通过 DOM 类名）
  const handleEl = document.elementFromPoint(clientX, clientY)
  if (handleEl?.classList.contains('vue-flow__handle')) {
    const nodeEl = handleEl.closest('.vue-flow__node')
    const nodeId = nodeEl ? getNodeIdFromElement(nodeEl) : ''
    if (nodeId && nodeId !== sourceNodeId) {
      const handle = handleEl.classList.contains('source') ? 'source' : 'target'
      return { type: 'node-handle', nodeId, handle }
    }
  }
  // 3. 检查连线
  const edgeEl = document.elementFromPoint(clientX, clientY)
  if (edgeEl?.closest('.vue-flow__edge')) {
    const edgeId = edgeEl.closest('.vue-flow__edge')?.getAttribute('data-id') || ''
    if (edgeId) return { type: 'edge', edgeId }
  }
  // 4. 默认画布空白
  return { type: 'pane' }
}

const GROUP_ORDER: Record<string, number> = { create: 1, action: 2, delete: 3 }

interface ResolvedMenuItem {
  id: string; label: string; description?: string; icon?: string | Component; badge?: string
  shortcut?: string; danger?: boolean; disabled?: boolean; group: string; order?: number
  nodeType?: string
}

function resolveItems(
  mode: string, nodeType: string | undefined, context: PluginContext
): ResolvedMenuItem[] {
  const items: ResolvedMenuItem[] = []

  // 创建节点菜单项（pane / connection 模式）
  if (mode === "pane" || mode === "connection") {
    const prefix = mode === "connection" ? "connect:" : "create:"
    context.canvasNodes.getMenuItems().forEach((item, index) => {
      items.push({
        id: prefix + item.id, label: item.label, description: item.description,
        icon: item.icon, badge: item.badge, group: "create", order: 100 - index,
        nodeType: item.id,
      })
    })
  }

  // 操作菜单项（从 MenuRegistry）
  const area = mode || "pane"
  for (const { item } of context.menus.getAll()) {
    if (item.areas && !item.areas.includes(area as any)) continue
    if (item.nodeTypes?.length && nodeType && !item.nodeTypes.includes(nodeType)) continue
    if (item.nodeTypes?.length && !nodeType) continue

    let disabled = false
    if (typeof item.disabled === "boolean") disabled = item.disabled

    items.push({
      id: item.id, label: item.title || item.id, description: item.description,
      icon: item.icon,
      badge: item.badge, shortcut: item.shortcut, danger: item.danger, disabled,
      group: item.group || "action", order: item.order ?? 0,
    })
  }

  return items.sort((a, b) => {
    const ga = GROUP_ORDER[a.group] ?? 99
    const gb = GROUP_ORDER[b.group] ?? 99
    if (ga !== gb) return ga - gb
    return (b.order ?? 0) - (a.order ?? 0)
  })
}

function createNode(
  item: CanvasMenuItem, flowPosition: { x: number; y: number },
  context: PluginContext, options: { requireTarget?: boolean; requireSource?: boolean } = {}
) {
  const nodeType = item.nodeType || item.id
  const nodeId = `node-${nodeType}-${Date.now()}`
  const def = context.canvasNodes.get(nodeType)
  const defaultSize = def?.defaultSize ?? { cardWidth: 256, cardHeight: 256 }
  const canReceiveInput = options.requireTarget ?? def?.canReceiveInput ?? true
  const canProduceOutput = options.requireSource ?? def?.canProduceOutput ?? true

  const node: Node = {
    id: nodeId, type: "custom",
    position: { x: flowPosition.x - defaultSize.cardWidth / 2, y: flowPosition.y - defaultSize.cardHeight / 2 },
    data: { label: item.label, nodeType, cardWidth: defaultSize.cardWidth, cardHeight: defaultSize.cardHeight, resizable: def?.resizable ?? false },
    ...(canProduceOutput ? { sourcePosition: Position.Right } : {}),
    ...(canReceiveInput ? { targetPosition: Position.Left } : {}),
  }
  context.actions.addNodes([node])
  return node
}

export const ContextMenuPlugin: CanvasPlugin = {
  name: "context-menu", version: "1.0.0",

  install(context: PluginContext) {
    registerBuiltinMenuItems(context)

    // ===== 连线拖拽菜单辅助函数（闭包，访问 context） =====
    function toFlowPosition(clientX: number, clientY: number): Point {
      return context.viewport.screenToFlowCoordinate({ x: clientX, y: clientY })
    }

    function createTempConnection(
      point: Point,
      sourceNodeId: string,
      sourceHandle: 'source' | 'target',
    ) {
      const flowPosition = toFlowPosition(point.x, point.y)
      const tempNodeId = `temp-target-${Date.now()}`
      const tempEdgeId = `temp-edge-${sourceNodeId}-${Date.now()}`
      const isReverseConnection = sourceHandle === 'target'

      context.actions.addNodes([{
        id: tempNodeId,
        type: 'tempTarget',
        position: flowPosition,
        data: { isTemp: true },
        sourcePosition: isReverseConnection ? Position.Right : undefined,
        targetPosition: isReverseConnection ? undefined : Position.Left,
        draggable: false,
        selectable: false,
      } as Node])

      context.actions.addEdges([{
        id: tempEdgeId,
        type: 'custom',
        source: isReverseConnection ? tempNodeId : sourceNodeId,
        target: isReverseConnection ? sourceNodeId : tempNodeId,
        sourceHandle: isReverseConnection ? 'source' : sourceHandle,
        targetHandle: isReverseConnection ? sourceHandle : 'target',
        selectable: false,
        zIndex: 99999,
        // CustomEdge.vue 不读取 edge.data 中的样式字段（edgeType/edgeLineWidth/edgeColor/edgeDashed），
        // 而是从 useCanvasStore() 的 canvas.state.core.* 获取并有兜底默认值（如 edgeType 默认 'bezier'）。
        // 因此临时边只需 { isTemp: true } 即可正确渲染，无需注入 makeEdgeData 字段。
        data: { isTemp: true },
      } as Edge])

      // 记录到 connectionState
      context.connectionState.value.tempConnection = {
        tempNodeId,
        tempEdgeId,
        flowPosition,
      }

      // emit 事件给现有的菜单 UI 流程
      context.emit('connectionContextMenu', {
        clientX: point.x,
        clientY: point.y,
        sourceNodeId,
        sourceHandle,
        tempNodeId,
        tempEdgeId,
        flowPosition,
      })
    }

    // ===== 连线拖拽菜单逻辑（从 Canvas.vue 迁移） =====
    let lastNativeConnectAt = 0
    const offConnectStart = context.on('connectStart', () => {
      lastNativeConnectAt = 0
    })
    const offConnect = context.on('connect', () => {
      lastNativeConnectAt = Date.now()
    })

    const offConnectEnd = context.on('connectEnd', (event: MouseEvent | TouchEvent | undefined) => {
      const point = getMousePoint(event)
      const active = context.connectionState.value.activeConnection
      if (!point || !active) return
      // 如果已经精确连到了 Handle，@connect 会先创建边，这里不要再抢着处理
      if (Date.now() - lastNativeConnectAt < 80) return

      const { sourceNodeId, sourceHandle } = active

      // 判定 hoverTarget
      const hoverTarget = resolveHoverTarget(point.x, point.y, context, sourceNodeId)
      context.connectionState.value.hoverTarget = hoverTarget

      // 判定吸附（source 方向查目标节点，target 方向反向查源节点）
      let snapNode: Node | null = null
      if (sourceHandle === 'source') {
        snapNode = findNearestValidTarget(point.x, point.y, context, sourceNodeId)
      } else if (sourceHandle === 'target') {
        snapNode = findNearestValidSource(point.x, point.y, context, new Set([sourceNodeId]))
      }
      context.connectionState.value.snapTarget = snapNode
        ? { nodeId: snapNode.id, isSnapped: true }
        : null

      // 核心：只在 canShowConnectionMenu 为 true 时弹菜单
      if (!context.canShowConnectionMenu.value) return

      // 创建临时节点 + 边，emit connectionContextMenu
      createTempConnection(point, sourceNodeId, sourceHandle)
    })

    let appInstance: ReturnType<typeof createApp> | null = null
    let containerEl: HTMLDivElement | null = null

    const menuState = reactive<CanvasMenuState>({
      visible: false, title: "", mode: "pane", position: { x: 0, y: 0 }, items: [],
    })
    const menuCtx = reactive<MenuContext>({})

    function openMenu(next: Omit<CanvasMenuState, "visible">, ctx: MenuContext = {}) {
      Object.assign(menuCtx, ctx)
      Object.assign(menuState, next, { visible: true })
    }

    function closeMenu() {
      const p = menuCtx.pendingConnection
      if (p) { context.actions.removeEdges([p.tempEdgeId]); context.actions.removeNodes([p.tempNodeId]) }
      // 清理 connectionState 中的临时状态
      context.connectionState.value.tempConnection = null
      context.connectionState.value.hoverTarget = null
      context.connectionState.value.snapTarget = null
      menuState.visible = false
      Object.keys(menuCtx).forEach(k => delete (menuCtx as any)[k])
    }

    function openCreateNodeMenu(pos: { x: number; y: number }, mode: any, title: string, ctx: MenuContext) {
      openMenu({
        mode, title, position: pos,
        items: resolveItems(mode, ctx.nodeType, context),
      }, ctx)
    }

    async function onMenuSelect(item: CanvasMenuItem) {
      const ctx = { ...menuCtx }

      if (menuState.mode === "connection" && ctx.pendingConnection) {
        const pending = ctx.pendingConnection
        closeMenu()
        const isReverse = pending.sourceHandle === "target"
        // 只控制输入端口方向，不覆盖输出端口（输出端口由节点类型定义决定）
        const node = createNode(item, pending.flowPosition, context, { requireTarget: !isReverse })
        await nextTick()
        context.actions.addEdges([isReverse ? {
          id: `e-${node.id}-${pending.sourceNodeId}-${Date.now()}`, type: "custom",
          source: node.id, target: pending.sourceNodeId, sourceHandle: "source", targetHandle: pending.sourceHandle,
        } as Edge : {
          id: `e-${pending.sourceNodeId}-${node.id}-${Date.now()}`, type: "custom",
          source: pending.sourceNodeId, target: node.id, sourceHandle: pending.sourceHandle, targetHandle: "target",
        } as Edge])
        return
      }

      if ((menuState.mode === "pane" || menuState.mode === "node") && ctx.flowPosition) {
        createNode(item, ctx.flowPosition, context)
        closeMenu()
        return
      }
      closeMenu()
    }

    const off1 = context.on("paneContextMenu", (p: any) => {
      openCreateNodeMenu({ x: p.clientX, y: p.clientY }, "pane", "添加节点", { flowPosition: toFlowPosition(p.clientX, p.clientY) })
    })
    const off2 = context.on("paneDoubleClick", (p: any) => {
      openCreateNodeMenu({ x: p.clientX, y: p.clientY }, "pane", "添加节点", { flowPosition: p.flowPosition })
    })
    const off3 = context.on("nodeContextMenu", (p: any) => {
      openCreateNodeMenu({ x: p.clientX, y: p.clientY }, "node", `节点菜单`, {
        nodeId: p.nodeId, nodeType: p.nodeType, flowPosition: toFlowPosition(p.clientX, p.clientY),
      })
    })
    const off4 = context.on("edgeContextMenu", (p: any) => {
      const fp = toFlowPosition(p.clientX, p.clientY)
      openMenu({
        mode: "edge", title: `连线菜单`, position: { x: p.clientX, y: p.clientY },
        items: resolveItems("edge", undefined, context),
      }, { edgeId: p.edgeId, flowPosition: fp })
    })

    const off5 = context.on("connectionContextMenu", (p: any) => {
      openCreateNodeMenu({ x: p.clientX, y: p.clientY }, "connection", "引用该节点生成", {
        pendingConnection: {
          sourceNodeId: p.sourceNodeId,
          sourceHandle: p.sourceHandle,
          tempNodeId: p.tempNodeId,
          tempEdgeId: p.tempEdgeId,
          flowPosition: p.flowPosition,
        },
      })
    })
    containerEl = document.createElement("div")
    document.body.appendChild(containerEl)
    appInstance = createApp({ setup: () => () => h(CanvasMenu, { menu: menuState, onSelect: onMenuSelect, onClose: closeMenu }) })
    appInstance.mount(containerEl)

    return {
      uninstall() {
        context.menus.unregisterSource("context-menu")
        off1(); off2(); off3(); off4(); off5()
        offConnectStart(); offConnect(); offConnectEnd()
        if (appInstance) { appInstance.unmount(); appInstance = null }
        if (containerEl) { containerEl.remove(); containerEl = null }
      },
    }
  },
}
