// 文件：packages/docs/public/examples/kernel/plugin-hello/src/heartbeatPlugin.ts
// 格式：TypeScript 模块（函数形态插件：函数名就是插件名）
// 位置：插件包里的极简插件
import type { Context } from '@mini-canvas/kernel'

export function heartbeat(ctx: Context): void {
  ctx.on('ping', () => console.log('[heartbeat] pong'))
}

