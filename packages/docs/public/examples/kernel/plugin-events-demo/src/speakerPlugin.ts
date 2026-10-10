// 文件：packages/docs/public/examples/kernel/plugin-events-demo/src/speakerPlugin.ts
// 格式：TypeScript 模块（插件入口：导出 name / inject / apply）
// 位置：插件包里「喊话」的那一件
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'speaker'

export function apply(ctx: Context): void {
  // ① 启动完成后广播一条普通通知（ctx:ready 是内置登记名，不会 warn）
  ctx.on('ctx:ready', () => {
    ctx.emit('demo:hello', 'speaker', 42)
    void askWhoCanHandle(ctx)
  })
}

async function askWhoCanHandle(ctx: Context): Promise<void> {
  // ② serial：顺序问每个听众「你能处理吗」，谁先给出有效答复就停
  const winner = await ctx.serial('demo:handle')
  console.log('[speaker] 抢到处理权的是：', winner)
}

export const speakerPlugin: PluginModule = { name, apply }

