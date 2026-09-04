import { Context } from '../core'
import type { PluginModule } from '../core'
import { NodeRegistry } from '../core/registry/nodeRegistry'
import { SaveServiceImpl } from '../services/storage/SaveService'
import { NodeStore } from '../services/nodeStore'
import type { CanvasNode } from '../services/nodeStore'
import type { StorageAdapter } from '../services/storage/types'
import { Selection } from '../services/selection'
import { History } from '../services/history'
import { CommandRegistry } from '../services/command'
import { NodeFactory } from '../services/nodeFactory'
import { nodeTextPlugin } from '../plugins/nodeText'
import { canvasCommandsPlugin } from '../plugins/canvasCommands'
import type { SelectionService } from '../services/selection'
import type { HistoryService } from '../services/history'
import type { CommandService } from '../services/command'
import type { NodeFactoryService } from '../services/nodeFactory'

/**
 * 一个已启动的画布实例（宿主返回句柄，供 UI/测试操作）。
 */
export interface CanvasHost {
  ctx: Context
  save: SaveServiceImpl
  nodeStore: NodeStore
  /** ctx.get('nodeRegistry') 的快捷访问（展示注册表：type→content/toolbar 段组件） */
  nodeRegistry: NodeRegistry
  /** ctx.get('selection') 的快捷访问 */
  selection: SelectionService
  /** ctx.get('command') 的快捷访问 */
  command: CommandService
  /** ctx.get('history') 的快捷访问 */
  history: HistoryService
  /** ctx.get('nodeFactory') 的快捷访问 */
  nodeFactory: NodeFactoryService
  /** 停止并回收（等效卸载全部插件副作用） */
  stop(): void
}

/** 可注册的节点类型插件 */
export type NodePluginModule = PluginModule

/** bootCanvas 可选项 */
export interface BootOptions {
  /** 存储后端（本地/云端可插拔）。默认内存 adapter。 */
  adapter?: StorageAdapter
  /** 额外插件（在 text/image 等内置插件之后按序装载）。 */
  plugins?: PluginModule[]
  /** 首次启动(存储为空)时生成默认画布；返回的节点会被 replaceAll。 */
  seedDefault?: () => CanvasNode[]
}

/**
 * bootCanvas —— 建一个画布内核 + 注入服务 + 装内置插件(text + canvasCommands) + start。
 *
 * - 注入服务：save / nodeStore / selection / command / history(基于 nodeStore 快照) / nodeFactory。
 * - 内置插件：text（+ image 由调用方经 opts.plugins 传 nodeImagePlugin）；canvasCommands 提供
 *   command:delete / command:create-node / command:undo / command:redo。
 * - 传同一 adapter 两次 boot = 模拟"刷新页面"，第二次自动恢复上次画布。
 */
export async function bootCanvas(adapterOrOpts?: StorageAdapter | BootOptions): Promise<CanvasHost> {
  // 判别：传的是 StorageAdapter（有 set/get 能力）还是 BootOptions（有 plugins/seedDefault 等）
  const isAdapter = (x: unknown): x is StorageAdapter =>
    !!x && typeof (x as StorageAdapter).set === 'function' && typeof (x as StorageAdapter).get === 'function'
  const opts: BootOptions = adapterOrOpts && isAdapter(adapterOrOpts) ? { adapter: adapterOrOpts } : ((adapterOrOpts ?? {}) as BootOptions)

  const ctx = new Context()

  // —— 注入内核服务（宿主负责，插件只 ctx.get） ——
  const save = new SaveServiceImpl()
  if (opts.adapter) save.useAdapterForAll(opts.adapter)
  ctx.inject('save', save)

  const nodeStore = new NodeStore()
  ctx.inject('nodeStore', nodeStore)

  const nodeRegistry = new NodeRegistry()
  ctx.inject('nodeRegistry', nodeRegistry)

  const selection = new Selection()
  ctx.inject('selection', selection)

  // history 基于 nodeStore 全量快照：undo/redo 即回填/恢复节点图
  const history = new History({
    snapshot: () => JSON.parse(JSON.stringify(nodeStore.getNodes())),
    restore: (nodes) => nodeStore.replaceAll(nodes as CanvasNode[]),
  })
  ctx.inject('history', history)

  const command = new CommandRegistry()
  ctx.inject('command', command)

  const nodeFactory = new NodeFactory()
  ctx.inject('nodeFactory', nodeFactory)

  // —— 装内置插件 + 额外插件 + 画布命令并启动 ——
  // 顺序：先 text/image(注册 nodeFactory creator + nodeStore type)，再 canvasCommands(消费它们)
  ctx.plugin(nodeTextPlugin)
  for (const p of opts.plugins ?? []) ctx.plugin(p)
  ctx.plugin(canvasCommandsPlugin)
  await ctx.start()
  // 给命令注入执行上下文（命令内部如需 ctx.get 用服务）
  command.setContext(ctx)

  // 恢复上次画布；首次(空)则跑 seedDefault（若有）
  const saved = await save.get<CanvasNode[]>('graph', 'canvas')
  if (saved && saved.length > 0) {
    nodeStore.replaceAll(saved)
  } else if (opts.seedDefault) {
    nodeStore.replaceAll(opts.seedDefault())
  }

  return {
    ctx,
    save,
    nodeStore,
    nodeRegistry,
    selection,
    command,
    history,
    nodeFactory,
    stop: () => ctx.stop(),
  }
}
