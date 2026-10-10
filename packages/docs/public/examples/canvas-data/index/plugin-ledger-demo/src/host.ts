// 文件：packages/docs/public/examples/canvas-data/index/plugin-ledger-demo/src/host.ts
// 格式：TypeScript 模块（宿主装配函数）
// 位置：把“只装数据层”的最小画布跑起来的入口

import { Context, createCanvasBasePlugin, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import type { CanvasBaseAssembly } from '@mini-canvas/canvas-data'
import * as ledgerPlugin from './ledgerPlugin'

/**
 * 建一个**只有数据层**的画布。
 *
 * 这是理解 canvas-data 最快的姿势：没有 Vue、没有 VueFlow、没有屏幕，
 * 但节点、边、撤销、落盘一应俱全 —— 因为那些本来就不需要浏览器。
 *
 * @param adapter 存储后端；缺省给内存后端（测试 / 试跑用）。要真持久化就换
 *                `new LocalStorageAdapter()`（浏览器）或云端适配器。
 */
export async function bootLedger(adapter = new MemoryStorageAdapter()) {
  // ① 建 ctx（画布版默认装好能力层 → ctx.nodes / ctx.theme / ctx.commands / ctx.slots / ctx.settings）
  const ctx = new Context({ dev: true })

  // ② 建基础插件。它在**调用时就**把实例建好：这一步之后
  //    base.services.nodeStore / doc / save … 就能用了（哪怕还没 start）。
  const base: CanvasBaseAssembly = createCanvasBasePlugin({ adapter })

  // ③ 装基础插件 + 业务插件（顺序即装载顺序）
  ctx.plugin(base.plugin)
  ctx.plugin(ledgerPlugin)

  // ④ 启动
  await ctx.start()

  return {
    ctx,
    base,
    /** 停机：先把脏队列落盘，再回收全部插件副作用 */
    async stop() {
      await base.services.save.flush()
      ctx.stop()
    },
  }
}

