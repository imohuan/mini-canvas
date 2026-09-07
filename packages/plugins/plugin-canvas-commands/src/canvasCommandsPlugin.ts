/**
 * plugin-canvas-commands —— 画布级最小命令集插件（cordis 最新写法，纯逻辑无 Vue，纯依赖方、不对外提供服务）。
 *
 * 原内核内置插件，抽成独立插件包(见 docs/plan/canvas-host-component-plan.md 方向 A)：与 text/image/theme
 * 等业务插件一致，由宿主在 createMiniCanvasHost/CanvasHost 的 plugins 里显式装配。
 *
 * 收敛（runbook M3 + api.md §3.2/3.3）：
 * - 删除：统一 `command:delete`（读 selection 删选中，包进 history 记历史），取代散落的各处手写删除。
 * - 创建：统一 `command:create-node`（经 nodeFactory.create），取代各处各自 add* 建节点。
 * - 撤销/重做：`command:undo` / `command:redo`（调 history）。
 *
 * cordis 最新写法：本插件是**纯消费方**（无对外服务），故把真用的核心服务写进 `inject` 硬依赖——
 * 缺提供方让本插件 PENDING 而非静默（旧 inject=[] 全靠 ctx.get，P6 后 ctx.get 缺返 undefined 有隐患：
 * 命令会在服务缺失时静默错）。宿主在 createMiniCanvasHost 已恒在注入这些服务（start 前），故无 PENDING 风险。
 * apply 里删 ctx.get，改 `ctx.nodeStore/save/nodeFactory/selection/history` 直访（运行靠服务解析 Proxy）；
 * 类型由下方 `declare module` 增强 `interface Context` 提供。
 */
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import type {
  NodeStoreService,
  SaveService,
  NodeFactoryService,
  SelectionService,
  HistoryService,
  EdgeStoreService,
} from '@mini-canvas/canvas-core-v2'
import { GRAPH_EDGES_KEY } from '@mini-canvas/canvas-core-v2'

/** 类型增强缝：宿主"恒在服务"上 ctx.xxx 直访（nodeStore/save/nodeFactory/selection/history/edgeStore 已核与宿主注入名一致） */
declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    nodeStore: NodeStoreService
    save: SaveService
    nodeFactory: NodeFactoryService
    selection: SelectionService
    history: HistoryService
    edgeStore: EdgeStoreService
  }
}

export const name = 'commands'
export const inject = ['nodeStore', 'save', 'nodeFactory', 'selection', 'history', 'edgeStore'] as string[]

export function apply(ctx: Context) {
  // inject 硬依赖已保证这些服务在（宿主恒在）；直访(Proxy 解析服务名)，不再手 ctx.get。
  const { nodeStore, save, nodeFactory, selection, history, edgeStore } = ctx

  // —— 落盘当前节点图 + 边（节点存 'graph'，边存 'graph-edges'，分存以兼容旧节点数组） ——
  function persist(): void {
    save.set('graph', nodeStore.getNodes(), 'canvas')
    save.set(GRAPH_EDGES_KEY, edgeStore.getEdges(), 'canvas')
  }

  // —— 删选中（经 history 记一次；删节点连带清掉与它相连的边，undo/redo 对边也生效） ——
  ctx.commands.register({
    id: 'command:delete',
    title: '删除选中',
    keys: ['Delete', 'Backspace'],
    run() {
      history.withRecord(() => {
        // 先删选中的边（v2 边双集选中）：只删边、保留两端节点
        const edgeIds = [...selection.edgeIds]
        for (const eid of edgeIds) {
          edgeStore.removeEdge(eid)
          selection.removeEdge(eid)
        }
        // 再删选中的节点（连带清与它相连的边）
        const ids = [...selection.ids]
        if (ids.length === 0 && edgeIds.length === 0) return
        for (const id of ids) {
          nodeStore.removeNode(id)
          edgeStore.removeEdgesOfNode(id)
          selection.remove(id)
        }
        persist()
      })
    },
  })

  // —— 建节点（经 nodeFactory.create，一次历史）；payload = { type, position, ...extra } ——
  ctx.commands.register({
    id: 'command:create-node',
    title: '创建节点',
    run(_ctx, payload: { type: string; position: { x: number; y: number }; [k: string]: unknown }) {
      return history.withRecord(() => {
        // extra = payload 除 type/position 外的字段（如 image 的 imageUrl），透传给 nodeFactory creator
        const { type, position, ...extra } = payload
        const id = nodeFactory.create(type, position, extra)
        persist()
        return id
      })
    },
  })

  // —— 撤销 / 重做 ——
  ctx.commands.register({ id: 'command:undo', title: '撤销', keys: ['mod+z'], run: () => { history.undo(); selection.clear() } })
  ctx.commands.register({ id: 'command:redo', title: '重做', keys: ['mod+shift+z'], run: () => { history.redo(); selection.clear() } })
}

/** 兼容旧装配的 PluginModule 出口 */
export const canvasCommandsPlugin: PluginModule = { name, inject, apply }

