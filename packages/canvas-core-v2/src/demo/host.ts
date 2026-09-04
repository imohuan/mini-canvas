import { Context } from '../core'
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

/**
 * bootCanvas —— 建一个画布内核 + 注入服务 + 装 text 插件 + start。
 *
 * @param adapter 存储后端（本地/云端可插拔）。不传则新建独立内存 adapter。
 *                "刷新恢复"测试：两次 boot 传同一个 adapter，即模拟同一浏览器存储。
 */
export async function bootCanvas(adapter?: StorageAdapter): Promise<CanvasHost> {
  const ctx = new Context()

  // 注入内核服务（save + nodeStore）—— 宿主负责，插件只 ctx.get
  const save = new SaveServiceImpl()
  if (adapter) save.useAdapterForAll(adapter)
  ctx.inject('save', save)
  const nodeStore = new NodeStore()
  ctx.inject('nodeStore', nodeStore)

  // 装插件并启动
  ctx.plugin(nodeTextPlugin)
  await ctx.start()

  // 恢复上次画布（若存储里有 canvas:graph）
  // 注意：restore 必须在插件 setup 之后（nodeStore 类型已注册），顺序 OK
  const saved = await save.get<CanvasNode[]>('graph', 'canvas')
  if (saved) nodeStore.replaceAll(saved)

  return {
    ctx,
    save,
    nodeStore,
    stop: () => ctx.stop(),
  }
}
