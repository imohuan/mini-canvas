/**
 * Agent 的三条内置路由插件 —— **实现住在 `@mini-canvas/plugin-agent`**。
 *
 * 本文件只剩一层接线：把宿主跑中间件的函数交给插件，插件返回它自己的三条路由插件。
 * 之所以留在宿主里做这一步，是因为「用哪个 ctx / 哪套中间件链」是宿主的决定，
 * 而「这三条路由怎么实现」是 Agent 自己的事。
 */
import type { PluginModule } from '@mini-canvas/kernel'
import { agentPlugins, AGENT_SERVICES } from '@mini-canvas/plugin-agent/server/routes/plugin.js'
import { runAgentMiddleware } from '../../serverFramework/agent.js'
import type { Context } from '@mini-canvas/kernel'

export { AGENT_SERVICES }

/** 按宿主 ctx 造出这一组插件（每条路由的 apply 都会拿到同一个 ctx）。 */
export function createAgentPlugins(ctx: Context): PluginModule[] {
  return agentPlugins((turn) => runAgentMiddleware(ctx, turn))
}
