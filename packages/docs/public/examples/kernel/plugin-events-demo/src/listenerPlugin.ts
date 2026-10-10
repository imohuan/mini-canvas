// 文件：packages/docs/public/examples/kernel/plugin-events-demo/src/listenerPlugin.ts
// 格式：TypeScript 模块（插件入口）
// 位置：插件包里「听」的那一件
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'listener'

export function apply(ctx: Context): void {
  // ① on：听多参广播（ctx.on 的订阅随本插件自动回收）
  ctx.once('demo:hello', (who: string, n: number) => {
    console.log(`[listener] 收到 ${who} 的问候，数字是 ${n}`)
  })

  // ② serial 抢答第一轮：我先「放弃」（返回 undefined = 不算有效答复，继续问下一个）
  ctx.on('demo:handle', () => {
    console.log('[listener] 我处理不了，让给下一个')
    return undefined
  })
}

export const listenerPlugin: PluginModule = { name, apply }

