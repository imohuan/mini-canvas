// 文件：packages/docs/public/examples/settings-persist/plugin-theme-toggle/src/host-wiring.ts
// 格式：TypeScript 模块（宿主接线示范；node 环境可跑，不依赖浏览器）
// 位置：示范"宿主该在哪一步 restore / 何时 dispose"；真实产品里等价代码在
//       packages/canvas-render/src/host/createMiniCanvasHost.ts
import { Context, createCanvasBasePlugin, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { themeTogglePlugin } from './index'

/**
 * 起一个最小宿主（无头）：
 *   ctx → 装基础插件（它建 save.settings 桥）→ 装业务插件 → start → restore 配置。
 * 顺序为什么是这个顺序：宿主必须在**插件全部装载完成之后**才 restore ——
 * 那时插件的 Config 已声明完，快照里的用户值才有地方命中。
 */
export async function bootHeadlessExample(): Promise<{ ctx: Context; stop: () => void }> {
  const adapter = new MemoryStorageAdapter()          // ① 存储后端：本地/云端/内存可插拔
  const ctx = new Context()
  const base = createCanvasBasePlugin({ adapter })   // ② 基础插件：建桥（persistSettings 默认开）
  ctx.plugin(base.plugin)
  ctx.plugin(themeTogglePlugin)                      // ③ 业务插件：声明 Config、读 settings
  await ctx.start()

  // ④ 桥：插件装载完成之后 restore 一次（把上次保存的值注回设置）
  const persist = base.services.settingsPersist
  if (persist) await persist.restore()

  // ⑤ 想"立刻把当前值写死"（比如用户点了"保存"）就调它
  if (persist) await persist.persistNow()

  return {
    ctx,
    stop: () => {
      persist?.dispose()   // ⑥ 停画布时取消订阅，防泄漏
      ctx.stop()
    },
  }
}
