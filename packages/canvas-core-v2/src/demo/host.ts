import { Context } from '../core'
import type { PluginModule } from '../core'
import { SaveServiceImpl } from '../services/storage/SaveService'
import { NodeStore } from '../services/nodeStore'
import type { CanvasNode } from '../services/nodeStore'
import type { StorageAdapter } from '../services/storage/types'
import { nodeTextPlugin } from '../plugins/nodeText'

/**
 * 一个已启动的画布实例（宿主返回句柄，供 UI/测试操作）。
 */
export interface CanvasHost {
  ctx: Context
  save: SaveServiceImpl
  nodeStore: NodeStore
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
 * bootCanvas —— 建一个画布内核 + 注入服务 + 装内置插件(text/image) + start。
 *
 * - 传同一 adapter 两次 boot = 模拟"刷新页面"，第二次自动恢复上次画布。
 * - 内置插件默认 text（+ image 由调用方决定是否传入或经 nodeImagePlugin 装）。
 */
export async function bootCanvas(adapterOrOpts?: StorageAdapter | BootOptions): Promise<CanvasHost> {
  // 判别：传的是 StorageAdapter（有 set/get 能力）还是 BootOptions（有 plugins/seedDefault 等）
  const isAdapter = (x: unknown): x is StorageAdapter =>
    !!x && typeof (x as StorageAdapter).set === 'function' && typeof (x as StorageAdapter).get === 'function'
  const opts: BootOptions = adapterOrOpts && isAdapter(adapterOrOpts) ? { adapter: adapterOrOpts } : ((adapterOrOpts ?? {}) as BootOptions)

  const ctx = new Context()

  // 注入内核服务（save + nodeStore）—— 宿主负责，插件只 ctx.get
  const save = new SaveServiceImpl()
  if (opts.adapter) save.useAdapterForAll(opts.adapter)
  ctx.inject('save', save)
  const nodeStore = new NodeStore()
  ctx.inject('nodeStore', nodeStore)

  // 装内置插件 + 额外插件并启动
  ctx.plugin(nodeTextPlugin)
  for (const p of opts.plugins ?? []) ctx.plugin(p)
  await ctx.start()

  // 恢复上次画布；首次(空)则跑 seedDefault（若有）
  // 注意：restore 必须在插件 setup 之后（nodeStore 类型已注册）
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
    stop: () => ctx.stop(),
  }
}
