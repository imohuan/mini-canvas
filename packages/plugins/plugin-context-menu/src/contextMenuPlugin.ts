/**
 * plugin-context-menu —— 右键上下文菜单插件（v2 独立包，复刻老版 canvas-core/plugins/context-menu）。
 *
 * 复刻范围（对齐老版核心，不越权）：
 * - 右键画布空白(pane)：弹"新建节点"菜单（枚举已注册节点类型 → command:create-node）+ 通用/pane 区命令；
 * - 右键节点(node)：删除该节点（连带边，history 一次）；
 * - 右键连线(edge)：删除该连线（history 一次）。
 *
 * v2 铁律落地：
 * - 不 import canvas-core/src、不反向依赖宿主 demo、不碰 VueFlow/宿主内部。
 * - 事件源：渲染层 RenderEvents.ContextMenuPane/Node/Edge（宿主已 preventDefault + ctx.emit，
 *   flowPosition 已由宿主算好随事件给到），插件 ctx.on 订阅即弹菜单。
 * - 命令与建节点：删除走本插件注册的 context-menu:delete-* 命令（areas 标 node/edge，history 原子）；
 *   新建走既有 command:create-node（不重复造建节点）。
 * - UI 自管：ContextMenu.vue 由 createApp 挂到 body（Teleport 内层），ctx.effect 回收 app + DOM 监听。
 *
 * 浏览器守卫：菜单浮层/DOM 绑定仅在浏览器装配（node 装配/测试安全跳过）；命令注册任何时候都做。
 */
import { createApp, reactive, type Component } from 'vue'
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type {
  NodeStoreService,
  SelectionService,
  CommandService,
  NodeFactoryService,
  GraphDocumentService,
  MenuService,
} from '@mini-canvas/canvas-core-v2'
import { RenderEvents } from '@mini-canvas/canvas-render'
import ContextMenu from './ContextMenu.vue'
import type { ContextMenuItem, ContextMenuMode } from './menuBuilder'
import { enrichMenuItems } from './menuEnrich'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    nodeStore: NodeStoreService
    selection: SelectionService
    graph: GraphDocumentService
    nodeFactory: NodeFactoryService
  }
}

export const name = 'context-menu'
export const inject = ['nodeStore', 'selection', 'graph', 'menu'] as string[]


/** 渲染层右键事件 payload（与 canvas-render RenderEvents.ContextMenu* 契约一致；本地声明避免依赖导出遗漏） */
interface ContextMenuPanePayload {
  clientX: number
  clientY: number
  flowPosition: { x: number; y: number }
}
interface ContextMenuNodePayload extends ContextMenuPanePayload {
  nodeId: string
  nodeType?: string
}
interface ContextMenuEdgePayload extends ContextMenuPanePayload {
  edgeId: string
}

/** 菜单浮层当前状态（reactive；经 props 喂给 ContextMenu.vue） */
interface MenuUiState {
  visible: boolean
  x: number
  y: number
  mode: ContextMenuMode
  items: ContextMenuItem[]
}

export function apply(ctx: Context): void {
  const { nodeStore, selection, graph } = ctx
  // 菜单聚合走内核 menu 服务（依赖声明在 inject；ctx.menu 直访由 declare module 类型提供）

  // —— 内置命令：右键删除节点 / 删除连线（areas 限定显示区，menuBuilder 据此收进菜单）——
  // 删除右键的节点：连带清掉与它相连的边 + 从选中集移除；history 一次可撤销。
  ctx.commands.register({
    id: 'context-menu:delete-node',
    title: '删除节点',
    areas: ['node'],
    group: '节点',
    order: 10,
    run(_c, payload: { nodeId: string }) {
     const nodeId = payload?.nodeId
     if (!nodeId) return
      graph.removeNodes([nodeId])
   },
 })
  // 删除右键的连线（只删边，保留两端节点）
  ctx.commands.register({
    id: 'context-menu:delete-edge',
    title: '删除连线',
    areas: ['edge'],
    group: '连线',
    order: 10,
    run(_c, payload: { edgeId: string }) {
     const edgeId = payload?.edgeId
     if (!edgeId) return
      graph.removeEdges([edgeId])
   },
 })

  // —— 菜单浮层 UI（仅浏览器）——
  if (typeof window === 'undefined') return
  const state = reactive<MenuUiState>({ visible: false, x: 0, y: 0, mode: 'pane', items: [] })
  // 当前右键上下文（供命令执行时传 payload）
  let current: { nodeId?: string; edgeId?: string; flowPosition: { x: number; y: number } } = {
    flowPosition: { x: 0, y: 0 },
  }

  function openMenu(mode: ContextMenuMode, x: number, y: number, flowPosition: { x: number; y: number }, nodeId?: string, edgeId?: string): void {
    current = { nodeId, edgeId, flowPosition }
    // 新建节点候选 = nodeFactory 可创建类型（只列有 creator 的，避免建出无内容节点）
    const creatable = new Set(ctx.get<NodeFactoryService>('nodeFactory').creatableTypes())
    const nodeTypes = [...nodeStore.types.values()]
      .filter((t) => creatable.has(t.type))
      .map((t) => ({ type: t.type, label: t.label }))
    // G 项：菜单聚合走内核 menu 服务（与未来 toolbar/面板同一数据源），不再插件内自组。
    // areas 语义 = 开放注册：任何插件命令显式声明 areas 含当前 mode 即自动出现在右键，
    // 未声明 areas 的命令（纯快捷键）不进菜单 —— 无需本插件白名单。
    const raw = ctx.get<MenuService>('menu').menuFor(mode, nodeTypes)
    // UI 增强：补图标 + hover 描述（与快捷键面板同款 item 视觉）
    state.items = enrichMenuItems(raw)
    state.mode = mode
    state.x = x
    state.y = y
    state.visible = state.items.length > 0
  }

  function closeMenu(): void {
    state.visible = false
  }

  /** 菜单项点击：建节点 → command:create-node；命令 → execute(commandId, 上下文 payload) */
  function onSelect(item: ContextMenuItem): void {
    closeMenu()
    const command = ctx.get<CommandService>('command')
    if (item.kind === 'create-node' && item.nodeType) {
      command.execute('command:create-node', {
        type: item.nodeType,
        position: current.flowPosition,
      })
      return
    }
    if (item.commandId) {
      const payload: Record<string, unknown> = {}
      if (current.nodeId) payload.nodeId = current.nodeId
      if (current.edgeId) payload.edgeId = current.edgeId
      command.execute(item.commandId, payload)
    }
  }

  // —— 渲染层右键事件 → 开菜单 ——
  ctx.on(RenderEvents.ContextMenuPane, (p: ContextMenuPanePayload) => {
    openMenu('pane', p.clientX, p.clientY, p.flowPosition)
  })
  ctx.on(RenderEvents.ContextMenuNode, (p: ContextMenuNodePayload) => {
    // 右键节点即把它选为唯一选中（老版语义：右键菜单的复制/复制一份作用于被右键节点）
    selection.set([p.nodeId])
    selection.clearEdges()
    openMenu('node', p.clientX, p.clientY, p.flowPosition, p.nodeId, undefined)
  })
  ctx.on(RenderEvents.ContextMenuEdge, (p: ContextMenuEdgePayload) => {
    openMenu('edge', p.clientX, p.clientY, p.flowPosition, undefined, p.edgeId)
  })

  // —— 挂载浮层 + 点外部/Esc/滚轮关闭（ctx.effect 自动回收）——
  // createApp 的 props 传**同一个 reactive state 对象**：组件读 props.state.xxx 会建立响应式追踪，
  // openMenu/closeMenu 改 state 属性即自动触发浮层重渲染，无需任何手动同步。
  ctx.effect(() => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = createApp(ContextMenu as Component, {
      state, // reactive 对象整体传入；内部属性变化被组件读取时自动响应
      onSelect,
      onClose: closeMenu,
    })
    app.mount(container)

    function onPointerDown(e: PointerEvent): void {
      const el = e.target as HTMLElement | null
      if (el && el.closest('.ctx-menu')) return
      closeMenu()
    }
    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeMenu()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('blur', closeMenu)
    document.addEventListener('scroll', closeMenu, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('blur', closeMenu)
      document.removeEventListener('scroll', closeMenu, true)
      app.unmount()
      container.remove()
    }
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const contextMenuPlugin: PluginModule = { name, inject, apply }
