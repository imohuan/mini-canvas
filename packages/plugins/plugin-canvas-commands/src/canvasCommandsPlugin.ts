/**
 * plugin-canvas-commands —— 画布级最小命令集插件（cordis 写法：纯逻辑、纯消费方）。
 *
 * 收敛（runbook M3 + api.md §3.2/3.3）：删除/创建/撤销/重做统一命令。
 *
 * v2 写模型：所有图变更走 ctx.graph（GraphDocument 唯一写入口）。
 * graph 统一负责：node/edge 变更、级联清边/清选中、history、提交落盘。
 * - command:delete：graph.removeEdges + graph.removeNodes。
 * - command:create-node：经 nodeFactory.create，creator 内部走 graph（见 node-text/node-image）。
 * - command:undo/redo：graph.undo/redo。
 */
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import type { NodeFactoryService, SelectionService, GraphDocumentService } from '@mini-canvas/canvas-core-v2'

/** 类型增强缝：宿主"恒在服务"上 ctx.xxx 直访（nodeFactory/selection/graph 与宿主注入名一致） */
declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    nodeFactory: NodeFactoryService
    selection: SelectionService
    graph: GraphDocumentService
  }
}

export const name = 'commands'
export const inject = ['nodeFactory', 'selection', 'graph'] as string[]

export function apply(ctx: Context) {
  const { nodeFactory, selection, graph } = ctx

  // —— 删选中：统一走 graph（删除/级联清边/清选中/历史/提交落盘由唯一写入口负责） ——
  ctx.commands.register({
    id: 'command:delete',
    title: '删除选中',
    keys: ['Delete', 'Backspace'],
    run() {
      const edgeIds = [...selection.edgeIds]
      const ids = [...selection.ids]
      if (ids.length === 0 && edgeIds.length === 0) return
      // 混选(边+节点)时包进同一事务：history.withRecord 嵌套只记最外层 → 一次撤销恢复整批删除
      graph.transaction('command:delete', (tx) => {
        tx.removeEdges(edgeIds)
        tx.removeNodes(ids)
      })
    },
  })

  // —— 建节点（经 nodeFactory.create；creator 内部已走 graph，自动进历史+提交落盘） ——
  ctx.commands.register({
    id: 'command:create-node',
    title: '创建节点',
    run(_ctx, payload: { type: string; position: { x: number; y: number }; [k: string]: unknown }) {
      const { type, position, ...extra } = payload
      return nodeFactory.create(type, position, extra)
    },
  })

  // —— 撤销 / 重做：统一走 graph（恢复后自动清选中并触发提交落盘） ——
  ctx.commands.register({
    id: 'command:undo',
    title: '撤销',
    keys: ['mod+z'],
    run: () => graph.undo(),
  })
  ctx.commands.register({
    id: 'command:redo',
    title: '重做',
    keys: ['mod+shift+z'],
    run: () => graph.redo(),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const canvasCommandsPlugin: PluginModule = { name, inject, apply }



