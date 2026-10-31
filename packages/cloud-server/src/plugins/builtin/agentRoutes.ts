/**
 * agentRoutes —— Agent 专属的三条内置路由插件（配置 / 单轮对话 / 多轮会话）。
 *
 * 从通用 `builtin/routes.ts` 拆出来的原因：
 * - 通用内置插件清单不该 import Agent 实现（关闭 Agent 时那些依赖根本不存在）；
 * - 「Agent 开关」现在只影响本文件导出的这一组，不再靠插件名前缀判断。
 *
 * 边界仍与之前一致：插件只拥有 HTTP 外壳，服务由宿主注入。
 * 后台实现向 plugin-agent 迁移时，替换的是这些服务的提供者，不是这里的路由形状。
 */
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'
import { agentRoutes } from '../../routes/agent.js'
import { agentSessionRoutes } from '../../routes/agentSessions.js'
import { agentChatRoutes, type ChatRunner } from '../../routes/agentChat.js'
import { runAgentMiddleware } from '../../serverFramework/agent.js'
import { createSdkChatRunner } from '../../agent/chatSdk.js'
import type { AgentConfigService } from '../../agent/config.js'
import type { AgentSessionStore } from '../../agent/sessionStore.js'
import type { AgentRuntime } from '../../agent/runtime.js'
import type { SessionHub } from '../../agent/sessionHub.js'
import type { QueueScheduler } from '../../agent/queueScheduler.js'
import type { BranchStore } from '../../agent/branchStore.js'
import type { GoalRuntimePort } from '../../routes/agentSessions.js'

export const AGENT_SERVICES = {
  config: 'agentConfig',
  sessions: 'agentSessions',
  runtime: 'agentRuntime',
  branches: 'agentBranches',
  hub: 'agentHub',
  queue: 'agentQueue',
  goal: 'agentGoal',
  loadSdk: 'agentLoadSdk',
} as const

function need<T>(ctx: PluginScope, name: string): T {
  const v = ctx.tryGet<T>(name)
  if (v === undefined) {
    throw new Error('[builtin] 缺少服务 "' + name + '"：请检查 server.ts 的 inject 登记（见 serverFramework 的服务名表）')
  }
  return v
}

/** 配置 / 模型 / 技能 / MCP / 提示词（GET/PUT /api/agent/*）。 */
export const agentConfigPlugin: PluginModule = {
  name: 'agent-routes',
  inject: [AGENT_SERVICES.config, AGENT_SERVICES.runtime],
  apply(ctx) {
    ctx.routes.adopt(agentRoutes(need<AgentConfigService>(ctx, AGENT_SERVICES.config), need<AgentRuntime>(ctx, AGENT_SERVICES.runtime)))
  },
}

/**
 * agent-chat —— 单轮对话（`POST /api/agent/chat/completion`）。
 *
 * 与多轮会话分开住：这条不建会话、不进列表、不留痕迹，是“模型直连”，
 * 不是“跟 Agent 聊天”。
 */
export const agentChatPlugin: PluginModule = {
  name: 'agent-chat',
  inject: [AGENT_SERVICES.config, AGENT_SERVICES.loadSdk],
  apply(ctx) {
    const config = need<AgentConfigService>(ctx, AGENT_SERVICES.config)
    const loadSdk = need<() => Promise<never>>(ctx, AGENT_SERVICES.loadSdk)
    const { run } = createSdkChatRunner({ config, loadSdk: loadSdk as never })
    ctx.routes.adopt(agentChatRoutes({ config, run: run as unknown as ChatRunner }))
  },
}

/** 会话 / 队列 / 审批 / 目标（`/api/agent/canvases/:canvasId/...`）。 */
export const agentSessionPlugin: PluginModule = {
  name: 'agent-sessions',
  inject: [
    AGENT_SERVICES.sessions,
    AGENT_SERVICES.runtime,
    AGENT_SERVICES.config,
    AGENT_SERVICES.branches,
    AGENT_SERVICES.hub,
    AGENT_SERVICES.queue,
    AGENT_SERVICES.goal,
  ],
  apply(ctx) {
    ctx.routes.adopt(
      agentSessionRoutes(
        need<AgentSessionStore>(ctx, AGENT_SERVICES.sessions),
        need<AgentRuntime>(ctx, AGENT_SERVICES.runtime),
        need<AgentConfigService>(ctx, AGENT_SERVICES.config),
        need<BranchStore>(ctx, AGENT_SERVICES.branches),
        // pre-turn 中间件：与 HTTP 的 /messages 同一套；注册场全插件共享，直接用 ctx 即可。
        (turn) => runAgentMiddleware(ctx, turn),
        // 托管通道：给了它 = 「后台对话」模式（一轮不绑连接）
        need<SessionHub>(ctx, AGENT_SERVICES.hub),
        // forced：这些回调全部来自用户明确操作（加 / 删 / 改 / 暂停 / 恢复 / 引导），
        // 不该被自动重试的 30 秒冷却挡住。
        (canvasId, sessionId) => need<QueueScheduler>(ctx, AGENT_SERVICES.queue).tick(canvasId, sessionId, { forced: true }),
        // 会话删除 → 清掉按会话记账的内存表（调度器冷却、hub 通道与 running 标记）。
        (canvasId, sessionId) => {
          need<QueueScheduler>(ctx, AGENT_SERVICES.queue).forget(canvasId, sessionId)
          need<SessionHub>(ctx, AGENT_SERVICES.hub).forget(canvasId, sessionId)
        },
        need<GoalRuntimePort>(ctx, AGENT_SERVICES.goal),
      ),
    )
  },
}

/** 三条一起给（server.ts 在 Agent 开启时按顺序登记）。 */
export const AGENT_PLUGINS: PluginModule[] = [agentConfigPlugin, agentSessionPlugin, agentChatPlugin]
