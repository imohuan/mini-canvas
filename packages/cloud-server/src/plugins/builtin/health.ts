/**
 * health —— 最简内置后台插件（样板）。
 *
 * 它就是原来 `server.ts` 里的 `app.get('/health', ...)` 那一行；
 * 收敛成插件后：**行为一字不变**，且获得"可装卸/可回收"的能力。
 * 其它路由组（canvases / jobs / agent / …）照这个形状写。
 */
import type { Context, PluginModule } from '@mini-canvas/kernel'

export const name = 'health'

export function apply(ctx: Context): void {
  ctx.routes.get('/health', (c) => c.json({ ok: true }))
}

export const healthPlugin: PluginModule = { name, apply }
