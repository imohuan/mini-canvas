/**
 * canvasCommands —— 画布级通用命令集（建节点 / 删选中 / 撤销 / 重做）。
 *
 * 归属：`src/canvas`（画布语义层）。这四条是**每张画布都该有的看家操作**，
 * 与同层的 nodeFactory（建节点）/ menuService（菜单聚合）同类：纯逻辑、零 Vue、可无头单测。
 * 原先住在 `@mini-canvas/plugin-canvas-commands` 独立包里 —— 宿主忘装就没 Delete / Ctrl+Z，
 * 且它的依赖（graph/selection/nodeFactory）本就全在本包，故收进数据层由宿主 boot 时注册。
 *
 * v2 写模型：所有图变更走 `graph`（GraphDocument 唯一写入口）。
 * graph 统一负责：node/edge 变更、级联清边/清选中、history、提交落盘。
 * - command:delete：graph.removeEdges + graph.removeNodes（同一事务）。
 * - command:create-node：经 nodeFactory.create（creator 内部走 graph）。
 * - command:undo/redo：graph.undo/redo。
 *
 * 命令 id / title / keys 与插件时期**逐字保持一致**，故调用方（UI 按钮、右键菜单、
 * 快捷键帮助面板）零改动。
 */
import type { CommandService, Disposable } from '@mini-canvas/kernel'
import type { GraphDocumentService } from '../graphDocument'
import type { SelectionService } from '../selection'
import type { NodeFactoryService } from './nodeFactory'

/** 注册画布命令所需的四个宿主服务（均由 canvas-data / 渲染宿主注入，恒在） */
export interface CanvasCommandServices {
  command: CommandService
  graph: GraphDocumentService
  selection: SelectionService
  nodeFactory: NodeFactoryService
}

/** 命令 id 常量（调用方 execute 用；避免各处手抄字符串） */
export const CANVAS_COMMAND = {
  delete: 'command:delete',
  createNode: 'command:create-node',
  undo: 'command:undo',
  redo: 'command:redo',
} as const

/**
 * 注册画布通用命令（建节点 / 删选中 / 撤销 / 重做）。
 *
 * @returns 撤销函数：注销全部已注册命令（宿主登记进 ctx.effect，随 ctx.stop 回收）。
 *          id 已被占用时抛出（command 注册表语义：重复 id 必抛，不静默覆盖）。
 */
export function registerCanvasCommands(services: CanvasCommandServices): () => void {
  const { command, graph, selection, nodeFactory } = services
  const handles: Disposable[] = []

  // —— 删选中：统一走 graph（删除/级联清边/清选中/历史/提交落盘由唯一写入口负责） ——
  handles.push(
    command.register({
      id: CANVAS_COMMAND.delete,
      title: '删除选中',
      keys: ['Delete', 'Backspace'],
      run() {
        const edgeIds = [...selection.edgeIds]
        const ids = [...selection.ids]
        if (ids.length === 0 && edgeIds.length === 0) return
        // 混选(边+节点)时包进同一事务：history.withRecord 嵌套只记最外层 → 一次撤销恢复整批删除
        graph.transaction(CANVAS_COMMAND.delete, (tx) => {
          tx.removeEdges(edgeIds)
          tx.removeNodes(ids)
        })
      },
    }),
  )

  // —— 建节点（经 nodeFactory.create；creator 内部已走 graph，自动进历史+提交落盘） ——
  handles.push(
    command.register({
      id: CANVAS_COMMAND.createNode,
      title: '创建节点',
      run(_ctx, payload: unknown) {
        const { type, position, ...extra } = payload as {
          type: string
          position: { x: number; y: number }
          [k: string]: unknown
        }
        return nodeFactory.create(type, position, extra)
      },
    }),
  )

  // —— 撤销 / 重做：统一走 graph（恢复后自动清选中并触发提交落盘） ——
  handles.push(
    command.register({
      id: CANVAS_COMMAND.undo,
      title: '撤销',
      keys: ['mod+z'],
      run: () => graph.undo(),
    }),
  )
  handles.push(
    command.register({
      id: CANVAS_COMMAND.redo,
      title: '重做',
      keys: ['mod+shift+z'],
      run: () => graph.redo(),
    }),
  )

  return () => {
    for (const h of handles) h.dispose()
  }
}
