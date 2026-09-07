/**
 * plugin-history —— 历史记录/撤销重做兼容薄插件（v2 独立包，复刻老版 canvas-core/plugins/history）。
 *
 * 老版 HistoryPlugin 做了什么：命令式撤销/重做栈、批量记录(beginBatch/endBatch)、
 * 自动记录拖拽/连线/删除、Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 快捷键、history:state-change 事件。
 *
 * v2 分工（薄适配包，不重复造、零耦合）：
 * - 撤销/重做本体：内核 History 服务（ctx.history，宿主已注入；快照式 withRecord/undo/redo）。
 * - 自动记录：内核命令/操作经 withRecord 自动入历史；拖拽/连线由渲染层 CanvasHost 处理。
 * - 快捷键：canvas-commands 插件已注册 command:undo(mod+z) / command:redo(mod+shift+z)，
 *   渲染层统一分发 → 本包**不再注册带 keys 的撤销/重做命令**，避免键位/命令冲突。
 *
 * 本包存在的价值：给「只想要老版 history 命令名、不想依赖 canvas-commands 的宿主」一个
 * 独立可装配的撤销/重做命令入口 + 只读查询服务，并把内核缺口显式列出。
 */
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type { HistoryService } from '@mini-canvas/canvas-core-v2'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    history: HistoryService
  }
}

export const name = 'history'
export const inject = ['history'] as string[]

/** history 兼容服务（老版 HistoryAPI 里 v2 有意义的只读子集；状态查询 + 命令执行） */
export interface HistoryFacadeService {
  canUndo(): boolean
  canRedo(): boolean
  get undoCount(): number
  undo(): void
  redo(): void
}

export function apply(ctx: Context): void {
  const { history } = ctx

  // —— 撤销 / 重做命令（无 keys：键位由 canvas-commands 的 command:undo/redo 负责，避免冲突） ——
  ctx.commands.register({
    id: 'history:undo',
    title: '撤销',
    order: 5,
    run: () => history.undo(),
  })
  ctx.commands.register({
    id: 'history:redo',
    title: '重做',
    order: 6,
    run: () => history.redo(),
  })

  // —— 只读查询服务（菜单/按钮使能态用；独立名不撞宿主 history） ——
  const facade: HistoryFacadeService = {
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    get undoCount() {
      return history.undoDepth
    },
    undo: () => history.undo(),
    redo: () => history.redo(),
  }
  ctx.inject('history-facade', facade)

  // —— 内核 History 缺口（本薄包不越权补内核；如需要列给主 agent 补 API） ——
  // 1. 无 clear()/清空历史：老版有 history:clear 事件 + clear() API。
  // 2. 无 isRestoring 锁状态：老版撤销中抑制新记录；v2 withRecord 原子本身防嵌套记录。
  // 3. 无 redoDepth/undoDepth 之外的状态计数事件：老版 history:state-change 每次变化发。
  // 4. 无批量(beginBatch/endBatch)语义：v2 快照式 withRecord 天然把一批改动并成一条历史。
  // 若未来需要 clear/状态事件，应补内核 History 服务而非本插件绕过。
}

/** 兼容旧装配的 PluginModule 出口 */
export const historyPlugin: PluginModule = { name, inject, apply }
