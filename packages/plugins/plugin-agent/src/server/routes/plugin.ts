/**
 * Agent 的后台插件半：三条内置路由（配置 / 单轮对话 / 多轮会话）。
 *
 * 归属为什么在**插件**里：这三条路由的形状、参数、SSE 事件都是 Agent 自己的协议，
 * 跟宿主的通用路由没有关系。宿主只该提供两样东西：一个 ctx（注册场 + 路由表），
 * 以及「怎么跑插件的 pre-turn 中间件」这一个函数指针。
 *
 * 因此本文件**不 import 宿主的 serverFramework / store**：中间件通过 `runMiddleware` 注入。
 */
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'
import { agentRoutes } from './agent.js'
import { agentSessionRoutes } from './agentSessions.js'
import { agentChatRoutes, type ChatRunner } from './agentChat.js'
import { createSdkChatRunner } from '../agent/chatSdk.js'
import type { AgentConfigService } from '../agent/config.js'
import type { AgentSessionStore } from '../agent/sessionStore.js'
import type { AgentRuntime } from '../agent/runtime.js'
import type { SessionHub } from '../agent/sessionHub.js'
import type { QueueScheduler } from '../agent/queueScheduler.js'
import type { BranchStore } from '../agent/branchStore.js'
import type { GoalRuntimePort } from './agentSessions.js'
import type { AgentTurnEnvelope, AgentTurnOutcome } from '../ports.js'

/**
 * 本插件用到的后台能力段形状：`ctx.routes.adopt(app)`。
 *
 * 为什么不用 `declare module` 往 kernel 里合并：宿主已经声明过 `routes: RouteRegistrar`，
 * 再声明一次会撞「同一属性两种类型」。这里只在**取用点**做一次结构化断言，
 * 形状对不对由宿主侧类型检查兜底（它自己的 RouteRegistrar 才是真源）。
 */
interface AgentRouteCapability {
  adopt(app: unknown): void
}

function routesOf(ctx: PluginScope): AgentRouteCapability {
  const caps = ctx as unknown as { routes?: AgentRouteCapability }
  if (!caps.routes) throw new Error('[agent] 宿主没有提供 routes 能力段（后台路由注册）')
  return caps.routes
}

/** 宿主在 ctx 里登记的服务名（与本包 server.ts 的装配一一对应）。 */
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
    throw new Error('[agent] 缺少服务 "' + name + '"：请检查装配时是否注入了 Agent 服务组')
  }
  return v
}

/** 配置 / 模型 / 技能 / MCP / 提示词（GET/PUT /api/agent/*）。 */
export const agentConfigPlugin: PluginModule = {
  name: 'agent-routes',
  inject: [AGENT_SERVICES.config, AGENT_SERVICES.runtime],
  apply(ctx) {
    routesOf(ctx).adopt(agentRoutes(need<AgentConfigService>(ctx, AGENT_SERVICES.config), need<AgentRuntime>(ctx, AGENT_SERVICES.runtime)))
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
    routesOf(ctx).adopt(agentChatRoutes({ config, run: run as unknown as ChatRunner }))
  },
}

/**
 * 会话 / 队列 / 审批 / 目标（`/api/agent/canvases/:canvasId/...`）。
 *
 * @param runMiddleware 宿主的 pre-turn 中间件链（与 HTTP /messages 同一套）。
 *   由宿主传进来，是因为插件不能 import 宿主的注册场实现。
 */
export function createAgentSessionPlugin(
  runMiddleware: (turn: AgentTurnEnvelope) => Promise<AgentTurnOutcome>,
): PluginModule {
  return {
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
      routesOf(ctx).adopt(
        agentSessionRoutes(
          need<AgentSessionStore>(ctx, AGENT_SERVICES.sessions),
          need<AgentRuntime>(ctx, AGENT_SERVICES.runtime),
          need<AgentConfigService>(ctx, AGENT_SERVICES.config),
          need<BranchStore>(ctx, AGENT_SERVICES.branches),
          runMiddleware,
          need<SessionHub>(ctx, AGENT_SERVICES.hub),
          // forced：这些回调全部来自用户明确操作（加 / 删 / 改 / 暂停 / 恢复 / 引导），
          // 不该被自动重试的 30 秒冷却挡住。
          (canvasId, sessionId) =>
            need<QueueScheduler>(ctx, AGENT_SERVICES.queue).tick(canvasId, sessionId, { forced: true }),
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
}

/** 三条一起给（宿主在 Agent 开启时按顺序登记）。 */
export function agentPlugins(
  runMiddleware: (turn: AgentTurnEnvelope) => Promise<AgentTurnOutcome>,
): PluginModule[] {
  return [agentConfigPlugin, createAgentSessionPlugin(runMiddleware), agentChatPlugin]
}
