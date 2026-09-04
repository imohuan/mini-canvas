/**
 * canvasCommands —— 画布级最小命令集（内核命令插件，无 Vue，可单测）。
 *
 * 收敛（runbook M3 + api.md §3.2/3.3）：
 * - 删除：统一 `command:delete`（读 selection 删选中，包进 history 记历史），取代散落的 onNodeClick 删/Delete 键各写一套。
 * - 创建：统一 `command:create-node`（经 nodeFactory.create），取代各处各自 add* 建节点。
 * - 撤销/重做：`command:undo` / `command:redo`（调 history）。
 * 缺服务(selection/history/nodeStore/save/nodeFactory/command) 时 setup 抛错（契约：不静默）。
 */
import type { PluginModule } from '../core'
import type { NodeStoreService } from '../services/nodeStore'
import type { SaveService } from '../services/storage/types'
import type { NodeFactoryService } from '../services/nodeFactory'
import type { SelectionService } from '../services/selection'
import type { HistoryService } from '../services/history'
import type { CommandService } from '../services/command'

export const canvasCommandsPlugin: PluginModule = {
  name: 'commands',
  deps: [],
  setup(ctx) {
    const nodeStore = ctx.get<NodeStoreService>('nodeStore')
    const save = ctx.get<SaveService>('save')
    const factory = ctx.get<NodeFactoryService>('nodeFactory')
    const selection = ctx.get<SelectionService>('selection')
    const history = ctx.get<HistoryService>('history')
    const command = ctx.get<CommandService>('command')

    // —— 落盘当前节点图 ——
    function persist(): void {
      save.set('graph', nodeStore.getNodes(), 'canvas')
    }

    // —— 删选中（经 history 记一次） ——
    command.register({
      id: 'command:delete',
      title: '删除选中',
      run() {
        history.withRecord(() => {
          const ids = [...selection.ids]
          if (ids.length === 0) return
          for (const id of ids) {
            nodeStore.removeNode(id)
            selection.remove(id)
          }
          persist()
        })
      },
    })

    // —— 建节点（经 nodeFactory.create，一次历史）；payload = { type, position, ...extra } ——
    command.register({
      id: 'command:create-node',
      title: '创建节点',
      run(_ctx, payload: { type: string; position: { x: number; y: number }; [k: string]: unknown }) {
        return history.withRecord(() => {
          // extra = payload 除 type/position 外的字段（如 image 的 imageUrl），透传给 nodeFactory creator
          const { type, position, ...extra } = payload
          const id = factory.create(type, position, extra)
          persist()
          return id
        })
      },
    })

    // —— 撤销 / 重做 ——
    command.register({ id: 'command:undo', title: '撤销', run: () => history.undo() })
    command.register({ id: 'command:redo', title: '重做', run: () => history.redo() })
  },
}
