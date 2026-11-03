/**
 * agentSessions 路由与消息处理共用的小类型、校验与偏好读取。
 *
 * 从 agentSessions.ts 原样搬出；函数体与返回值字段未改。
 */
import { isSafeCanvasId, isSafeSessionId } from '../agent/agentPaths.js'
import type { SessionPrefs } from '../agent/runtime.js'
import type { AgentConfigService } from '../agent/config.js'

/**
 * pre-turn 钩子：在调 `runtime.run` **之前**跑一遍（Agent 中间件链就挂在这里）。
 * 返回 `blocked` 为真时不进模型，直接把 `response` 推给前端。
 *
 * 为什么用回调参数而不是直接 import 中间件运行器：这条路由不该认识"插件系统"——
 * 它只管"跑 Agent"。谁在 pre-turn 做什么，由宿主（server.ts）注入。
 */
export type AgentPreTurn = (turn: {
  canvasId: string
  input: { canvasId: string; sessionId: string; text: string; images?: string[]; prefs?: SessionPrefs }
  abortSignal: AbortSignal
}) => Promise<{ blocked?: true; response?: unknown }>

/**
 * 目标运行时（设计 §3.4.4）：改预算 / 暂停 / 启动。
 *
 * 为什么是接口而不是直接 import 实现：这条路由不该认识 goal 的文件协议，
 * 谁来实现（server.ts 接线）由宿主决定 —— 与 preTurn / onQueueChanged 同一风格。
 */
export interface GoalRuntimePort {
  /** 以目标模式起第 1 轮（写 GOAL.json + 官方协议文本 + 开跑） */
  beginGoal(
    canvasId: string,
    sessionId: string,
    objective: string,
    budget: number,
  ): Promise<{ started: boolean }>
  /** 改预算（总预算或"再跑多少"）或目标内容；没有进行中的目标返回 null */
  updateGoal(
    canvasId: string,
    sessionId: string,
    patch: { objective?: string; budget?: number; deltaBudget?: number; tokensUsed?: number },
  ): Promise<{ objective: string; status: string; budget: number; round: number; tokensUsed: number } | null>
  /** 暂停：把目标文件挪走 + 记宿主侧标记（当前轮跑完自然停住） */
  pauseGoal(canvasId: string, sessionId: string): Promise<boolean>
  /** 启动：文件放回 + 清标记 + 踢一脚（起下一轮） */
  resumeGoal(canvasId: string, sessionId: string): Promise<{ started: boolean }>
  /** 结束目标：删掉目标状态文件（与暂停不同，不可恢复） */
  endGoal(canvasId: string, sessionId: string): Promise<boolean>
}

/** 校验路径两段；不合法时回一个 400 响应 */
export function guardParams(c: { req: { param: (k: string) => string | undefined } }):
    | { ok: true; canvasId: string; sessionId?: string }
    | { ok: false; res: Response } {
    const canvasId = c.req.param('canvasId') ?? ''
    if (!isSafeCanvasId(canvasId)) {
      return { ok: false, res: Response.json({ ok: false, error: '非法画布 id' }, { status: 400 }) }
    }
    const sessionId = c.req.param('sessionId')
    if (sessionId !== undefined && !isSafeSessionId(sessionId)) {
      return { ok: false, res: Response.json({ ok: false, error: '非法会话 id' }, { status: 400 }) }
    }
    return sessionId === undefined ? { ok: true, canvasId } : { ok: true, canvasId, sessionId }
}

/**
 * 从 body 里取本次的会话偏好（模型 / MCP / 技能）。
 *
 * 顺手把「这个模型的上下文窗口」带上：界面算上下文剩余百分比要用它，
 * 而 session_meta 只写进 trace、不从 run() 里出来（实测），所以只能从配置里查。
 */
export async function readPrefs(
  config: AgentConfigService,
  body: Record<string, unknown> | undefined,
): Promise<SessionPrefs | undefined> {
    if (!body) return undefined
    const prefs: SessionPrefs = {}
    if (typeof body.provider === 'string' && body.provider) prefs.provider = body.provider
    if (typeof body.modelId === 'string' && body.modelId) prefs.modelId = body.modelId
    if (Array.isArray(body.mcpServers)) prefs.mcpServers = body.mcpServers.map(String)
    if (Array.isArray(body.skills)) prefs.skills = body.skills.map(String)
    // 模式系统提示词（全能创作 / 剧本创编各一套）：随这一轮传给运行时，
    // 它在建会话时临时替换 AGENTS.md（见 AgentRuntime.ensureSession）。
    if (typeof body.systemPrompt === 'string' && body.systemPrompt.trim()) prefs.systemPrompt = body.systemPrompt
    const window = await config.modelContextWindow(prefs.provider, prefs.modelId)
    if (window) prefs.contextWindow = window
    return Object.keys(prefs).length ? prefs : undefined
}

