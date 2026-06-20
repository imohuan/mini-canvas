import { createApp, h, reactive, nextTick } from "vue"
import type { Node, Edge } from "@vue-flow/core"
import { Position } from "@vue-flow/core"
import type { CanvasPlugin, PluginContext } from "../types"
import type { MenuContext } from "../../registry/MenuRegistry"
import type { CanvasMenuItem, CanvasMenuState } from "../../registry/types"
import CanvasMenu from "./CanvasMenu.vue"
import { registerBuiltinMenuItems } from "./builtinMenuItems"

const GROUP_ORDER: Record<string, number> = { create: 1, action: 2, delete: 3 }

interface ResolvedMenuItem {
  id: string; label: string; description?: string; icon?: string; badge?: string
  shortcut?: string; danger?: boolean; disabled?: boolean; group: string; order?: number
  nodeType?: string
}

function toFlowPosition(clientX: number, clientY: number, context: PluginContext) {
  const vp = context.viewport.getViewport()
  const zoom = vp.zoom || 1
  const pane = document.querySelector(".vue-flow")?.getBoundingClientRect()
  return {
    x: (clientX - (pane?.left ?? 0) - vp.x) / zoom,
    y: (clientY - (pane?.top ?? 0) - vp.y) / zoom,
  }
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
      icon: typeof item.icon === "string" ? item.icon : undefined,
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

  const node: Node = {
    id: nodeId, type: "custom",
    position: { x: flowPosition.x - defaultSize.cardWidth / 2, y: flowPosition.y - defaultSize.cardHeight / 2 },
    data: { label: item.label, nodeType, cardWidth: defaultSize.cardWidth, cardHeight: defaultSize.cardHeight, resizable: def?.resizable ?? false },
    ...(options.requireSource !== false ? { sourcePosition: Position.Right } : {}),
    ...(canReceiveInput ? { targetPosition: Position.Left } : {}),
  }
  context.actions.addNodes([node])
  return node
}

export const ContextMenuPlugin: CanvasPlugin = {
  name: "context-menu", version: "1.0.0",

  install(context: PluginContext) {
    registerBuiltinMenuItems(context)

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
        const node = createNode(item, pending.flowPosition, context, { requireSource: isReverse, requireTarget: !isReverse })
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
      openCreateNodeMenu({ x: p.clientX, y: p.clientY }, "pane", "添加节点", { flowPosition: toFlowPosition(p.clientX, p.clientY, context) })
    })
    const off2 = context.on("paneDoubleClick", (p: any) => {
      openCreateNodeMenu({ x: p.clientX, y: p.clientY }, "pane", "添加节点", { flowPosition: p.flowPosition })
    })
    const off3 = context.on("nodeContextMenu", (p: any) => {
      openCreateNodeMenu({ x: p.clientX, y: p.clientY }, "node", `节点 ${p.nodeId} 菜单`, {
        nodeId: p.nodeId, nodeType: p.nodeType, flowPosition: toFlowPosition(p.clientX, p.clientY, context),
      })
    })
    const off4 = context.on("edgeContextMenu", (p: any) => {
      const fp = toFlowPosition(p.clientX, p.clientY, context)
      openMenu({
        mode: "edge", title: `连线 ${p.edgeId} 菜单`, position: { x: p.clientX, y: p.clientY },
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
        if (appInstance) { appInstance.unmount(); appInstance = null }
        if (containerEl) { containerEl.remove(); containerEl = null }
      },
    }
  },
}
