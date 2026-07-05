import { createApp, h, reactive, nextTick, type Component } from "vue"
import type { Node, Edge } from "@vue-flow/core"
import { Position } from "@vue-flow/core"
import type { CanvasPlugin, PluginContext, ConnectionReleaseEndpoint, ConnectionReleasePayload } from "../types"
import type { Point } from "../types"
import type { MenuContext } from "../../registry/MenuRegistry"
import type { CanvasMenuItem, CanvasMenuState } from "../../registry/types"
import CanvasMenu from "../../components/Menu/CanvasMenu.vue"
import { registerBuiltinMenuItems } from "./builtinMenuItems"

const GROUP_ORDER: Record<string, number> = { create: 1, action: 2, delete: 3 }

interface ResolvedMenuItem {
  id: string; label: string; description?: string; icon?: string | Component; badge?: string
  shortcut?: string; danger?: boolean; disabled?: boolean; group: string; order?: number
  nodeType?: string; commandId?: string
}

function resolveItems(
  mode: string, nodeType: string | undefined, context: PluginContext,
  connSourceType?: string, connSourceHandle?: string, connEndpoints?: ConnectionReleaseEndpoint[],
): ResolvedMenuItem[] {
  const items: ResolvedMenuItem[] = []

  // 创建节点菜单项（pane / connection 模式）
  if (mode === "pane" || mode === "connection") {
    const prefix = mode === "connection" ? "connect:" : "create:"

    context.canvasNodes.getMenuItems().forEach((item, index) => {
      // connection 模式：过滤不可连接的节点类型；批量连接必须对所有端点都合法
      if (mode === "connection") {
        const newDef = context.canvasNodes.get(item.id)
        if (!newDef) return  // 跳过未注册类型

        const endpoints = connEndpoints?.length
          ? connEndpoints
          : connSourceType
            ? [{ nodeId: '', handle: (connSourceHandle ?? 'source') as 'source' | 'target', nodeType: connSourceType }]
            : []

        for (const endpoint of endpoints) {
          if (endpoint.handle === 'target') {
            // 新节点 → 既有节点：新节点必须能输出，既有节点必须接受新节点类型
            if (newDef.canProduceOutput === false) return
            const targetAccept = endpoint.nodeType ? context.canvasNodes.get(endpoint.nodeType)?.acceptsInputs : undefined
            if (Array.isArray(targetAccept) && !targetAccept.includes(item.id)) return
            continue
          }

          // 既有节点 → 新节点：新节点必须能接收，且必须接受既有节点类型
          if (newDef.canReceiveInput === false) return
          const newAccept = newDef.acceptsInputs
          if (endpoint.nodeType && Array.isArray(newAccept) && !newAccept.includes(endpoint.nodeType)) return
        }
      }

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
      commandId: item.commandId,
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
  context: PluginContext, options: { requireTarget?: boolean; requireSource?: boolean; align?: 'center' | 'top-left' } = {}
) {
  const nodeType = item.nodeType || item.id
  const nodeId = `node-${nodeType}-${Date.now()}`
  const def = context.canvasNodes.get(nodeType)
  const defaultSize = def?.defaultSize ?? { cardWidth: 256, cardHeight: 256 }
  const canReceiveInput = options.requireTarget ?? def?.canReceiveInput ?? true
  const canProduceOutput = options.requireSource ?? def?.canProduceOutput ?? true
  const align = options.align ?? 'center'

  const posX = align === 'top-left'
    ? flowPosition.x
    : flowPosition.x - defaultSize.cardWidth / 2
  const posY = align === 'top-left'
    ? flowPosition.y
    : flowPosition.y - defaultSize.cardHeight / 2

  const node: Node = {
    id: nodeId, type: "custom",
    position: { x: posX, y: posY },
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
      endpoints: ConnectionReleaseEndpoint[],
    ) {
      const flowPosition = toFlowPosition(point.x, point.y)
      const tempNodeId = `temp-target-${Date.now()}`
      const sourceHandle = endpoints[0]?.handle ?? 'source'
      const isReverseConnection = sourceHandle === 'target'
      const tempEdgeIds = endpoints.map(endpoint => `temp-edge-${endpoint.nodeId}-${Date.now()}`)

      context.actions.addNodes([{
        id: tempNodeId,
        type: 'tempTarget',
        position: flowPosition,
        data: { isTemp: true, tempKind: 'connection-menu' },
        sourcePosition: isReverseConnection ? Position.Right : undefined,
        targetPosition: isReverseConnection ? undefined : Position.Left,
        draggable: false,
        selectable: false,
      } as Node])

      context.actions.addEdges(endpoints.map((endpoint, index) => ({
        id: tempEdgeIds[index],
        type: 'custom',
        source: isReverseConnection ? tempNodeId : endpoint.nodeId,
        target: isReverseConnection ? endpoint.nodeId : tempNodeId,
        sourceHandle: isReverseConnection ? 'source' : endpoint.handle,
        targetHandle: isReverseConnection ? endpoint.handle : 'target',
        selectable: false,
        zIndex: 99999,
        data: { isTemp: true, tempKind: 'connection-menu' },
      } as Edge)))

      const tempEdgeId = tempEdgeIds[0]
      context.connectionState.value.tempConnection = {
        tempNodeId,
        tempEdgeId,
        flowPosition,
      }

      return {
        clientX: point.x,
        clientY: point.y,
        sourceNodeId: endpoints[0]?.nodeId ?? '',
        sourceNodeIds: endpoints.map(endpoint => endpoint.nodeId),
        sourceHandle,
        tempNodeId,
        tempEdgeId,
        tempEdgeIds,
        flowPosition,
        sourceNodeType: endpoints[0]?.nodeType,
        sourceNodeTypes: endpoints.map(endpoint => endpoint.nodeType),
        endpoints,
      }
    }

    // 连接核心只发布释放事实；菜单插件在这里决定是否响应。

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
      if (p) {
        const edgeIds = p.tempEdgeIds ?? [p.tempEdgeId]
        context.actions.removeEdges(edgeIds)
        context.actions.removeNodes([p.tempNodeId])
      }
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
        items: resolveItems(mode, ctx.nodeType, context, ctx.connectionSourceType, ctx.pendingConnection?.sourceHandle, ctx.pendingConnection?.endpoints),
      }, ctx)
    }

    async function onMenuSelect(item: CanvasMenuItem) {
      // 优先处理有 commandId 的菜单项 — 执行已注册的命令
      if (item.commandId && context.commands.has(item.commandId)) {
        // 先取出 nodeId/nodeType，closeMenu() 会清空 menuCtx
        const nodeId = menuCtx.nodeId
        const nodeType = menuCtx.nodeType
        closeMenu()
        // 构建 CommandContext：工具栏的执行路径会传 node 对象，右键菜单也需要
        const node = nodeId
          ? context.actions.getNodes().find(n => n.id === nodeId)
          : undefined
        await context.commands.execute(item.commandId, {
          node: node as any,
          edge: undefined,
          nodeType,
          runtime: null,
          actions: null,
          selection: null,
          viewport: null,
          store: null,
          logger: console,
        })
        return
      }

      const ctx = { ...menuCtx }

      if (menuState.mode === "connection" && ctx.pendingConnection) {
        const pending = ctx.pendingConnection
        closeMenu()
        const endpoints = pending.endpoints ?? (pending.sourceNodeIds ?? [pending.sourceNodeId]).map(nodeId => ({
          nodeId,
          handle: pending.sourceHandle as 'source' | 'target',
        }))
        const isReverse = endpoints[0]?.handle === "target"
        const node = createNode(item, pending.flowPosition, context, {
          requireTarget: !isReverse,
          ...(isReverse ? { requireSource: true } : {}),
          align: 'top-left',
        })
        await nextTick()
        context.actions.addEdges(endpoints.map(endpoint => endpoint.handle === 'target' ? {
          id: `e-${node.id}-${endpoint.nodeId}-${Date.now()}`, type: "custom",
          source: node.id, target: endpoint.nodeId, sourceHandle: "source", targetHandle: endpoint.handle,
        } as Edge : {
          id: `e-${endpoint.nodeId}-${node.id}-${Date.now()}`, type: "custom",
          source: endpoint.nodeId, target: node.id, sourceHandle: endpoint.handle, targetHandle: "target",
        } as Edge))
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

    const offRelease = context.on("connectionRelease", (release: ConnectionReleasePayload) => {
      if (release.result !== 'blank') return
      if (release.target.kind !== 'pane') return
      if (!context.canShowConnectionMenu.value) return
      if (release.endpoints.length === 0) return

      const p = createTempConnection(release.clientPoint, release.endpoints)
      openCreateNodeMenu({ x: p.clientX, y: p.clientY }, "connection", "引用该节点生成", {
        connectionSourceType: p.sourceNodeType,
        pendingConnection: {
          endpoints: p.endpoints,
          sourceNodeId: p.sourceNodeId,
          sourceNodeIds: p.sourceNodeIds,
          sourceHandle: p.sourceHandle,
          tempNodeId: p.tempNodeId,
          tempEdgeId: p.tempEdgeId,
          tempEdgeIds: p.tempEdgeIds,
          flowPosition: p.flowPosition,
        },
      })
    })

    const off5 = context.on("connectionContextMenu", (p: any) => {
      const menuPayload = (!p.tempNodeId || !p.tempEdgeId)
        ? createTempConnection(
            { x: p.clientX, y: p.clientY },
            p.endpoints ?? (p.sourceNodeIds ?? [p.sourceNodeId]).map((nodeId: string, index: number) => ({
              nodeId,
              handle: p.sourceHandle ?? 'source',
              nodeType: p.sourceNodeTypes?.[index] ?? p.sourceNodeType,
            })),
          )
        : p

      openCreateNodeMenu({ x: menuPayload.clientX, y: menuPayload.clientY }, "connection", "引用该节点生成", {
        connectionSourceType: menuPayload.sourceNodeType,
        pendingConnection: {
          endpoints: menuPayload.endpoints,
          sourceNodeId: menuPayload.sourceNodeId,
          sourceNodeIds: menuPayload.sourceNodeIds,
          sourceHandle: menuPayload.sourceHandle,
          tempNodeId: menuPayload.tempNodeId,
          tempEdgeId: menuPayload.tempEdgeId,
          tempEdgeIds: menuPayload.tempEdgeIds,
          flowPosition: menuPayload.flowPosition,
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
        off1(); off2(); off3(); off4(); off5(); offRelease()
        if (appInstance) { appInstance.unmount(); appInstance = null }
        if (containerEl) { containerEl.remove(); containerEl = null }
      },
    }
  },
}
