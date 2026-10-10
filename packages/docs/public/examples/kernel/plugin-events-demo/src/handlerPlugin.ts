// 文件：packages/docs/public/examples/kernel/plugin-events-demo/src/handlerPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：插件包里「接活」的那一件 —— 它在 serial 链上排在 listener 后面
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'handler'

export function apply(ctx: Context): void {
  // ① 同一个事件名，第二个听众。serial 会按注册序依次问：listener 先（放弃），我后（接住）
  ctx.on('demo:handle', () => {
    console.log('[handler] 我来处理')
    return { by: 'handler' }   // ② 非 null/false/undefined → 有效答复，serial 立即返回它并停止
  })

  // ③ 为了演示「顺序固定」，把注册序在日志里点出来
  console.log('[handler] 已挂上 demo:handle 监听')
}

export const handlerPlugin: PluginModule = { name, apply }

