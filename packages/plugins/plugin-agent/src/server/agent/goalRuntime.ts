/**
 * GoalRuntime —— 目标的运行时（设计 §3.4.4）。
 *
 * 目标循环**大部分由 SDK 原装负责**（stop hook 自动连播）；这个类只管三件宿主该管的事：
 * 1. **改**：预算 / 目标内容（写 GOAL.json，下一轮生效 —— 插件每轮重读那个文件）；
 * 2. **暂停**：把 GOAL.json 挪走（官方循环下一轮结束时读不到 ⇒ 静默退出 ⇒ 停住），
 *    并记一个宿主侧标记；同时**守住缺席**（当前轮里模型可能把文件写回来）。
 * 3. **启动**：文件放回 + 清标记 + **踢一脚**（执行官方 stop.mjs 拿 "continue" 的下一轮文本，
 *    作为输入起一轮）—— 因为官方循环已经退出，得有人把它重新推起来。
 *
 * 为什么"踢一脚"要真的执行 stop.mjs：下一轮的文本由插件生成（它要重述目标、给文件状态、
 * 带上完成/受阻审计那些话术），重写一份必然与插件漂移。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { GoalFiles, askGoalStop, makeScriptRunner, type HookScriptRunner } from './goal.js'
import { GOAL_FILE, readGoalState, updateGoalFile, writeGoalFile, type GoalState } from './goalState.js'
import { promises as fsp } from 'node:fs'
import type { GoalRuntimePort } from '../routes/agentSessions.js'
import type { AgentChatEvent } from './translate.js'

export interface GoalRuntimeDeps {
  /** 会话 scratchpad 目录（GOAL.json 落点） */
  scratchpadOf(canvasId: string, sessionId: string): string
  /** 已装 goal hook 包的目录（stop.mjs 在这里；踢一脚时用） */
  hooksDir: string
  /** 当轮 Trace 的绝对路径（stop.mjs 从它反推 scratchpad 并读 token 用量） */
  latestTraceOf(sessionId: string): Promise<string | null>
  /** 起一轮（宿主注入：runtime.startRun 的薄包装） */
  startRun(
    canvasId: string,
    sessionId: string,
    text: string,
    /** 目标协议文本：以 sender:'harness' 独立发送（SDK 靠它划轮次边界） */
    harnessText?: string,
  ): Promise<{ started: boolean }>
  /**
   * 经 **SDK 的会话**跑官方 start.mjs（写 GOAL.json + 返回第 1 轮协议文本）。
   *
   * 为什么必须走 SDK 而不是宿主自己 spawn：runUserPromptHook 会注入
   * sessionId / scratchpadDir（SDK 会话才知道的），且它是官方流程 ——
   * 宿主自己 spawn 一次等价物，迟早跟 SDK 的行为漂移（真机实测踩过）。
   * 返回 null = goal 包没装（调用方拒绝启动）。
   */
  runUserPromptHook?(
    canvasId: string,
    sessionId: string,
    name: string,
    prompt: string,
    extras?: Record<string, string | number | boolean>,
  ): Promise<{ context?: string } | null>
  /** 会话是否在跑（暂停/启动的判定要用） */
  isRunning(canvasId: string, sessionId: string): boolean
  /** 事件广播（界面看目标状态） */
  emit?(canvasId: string, sessionId: string, ev: AgentChatEvent): void
  /** 记/清"目标被暂停"（存会话文件，不进 GOAL.json） */
  setPausedFlag(canvasId: string, sessionId: string, paused: boolean): Promise<void>
  /** 宿主侧暂停标记的读取（启动时判断走哪条路） */
  isPausedFlag(canvasId: string, sessionId: string): Promise<boolean>
  /** 可注入的脚本执行器（单测喂假输出；缺省真跑 node） */
  runScript?: HookScriptRunner
  log?: (message: string, extra?: unknown) => void
}

export class GoalRuntime implements GoalRuntimePort {
  constructor(private readonly deps: GoalRuntimeDeps) {}

  private files(canvasId: string, sessionId: string): GoalFiles {
    return new GoalFiles(this.deps.scratchpadOf(canvasId, sessionId))
  }

  /** 读当前目标状态（给 GET 会话 / 界面用） */
  async read(canvasId: string, sessionId: string): Promise<GoalState | null> {
    return readGoalState(this.deps.scratchpadOf(canvasId, sessionId))
  }

  /**
   * **启动一个目标**（设计 §3.4.2）：写 GOAL.json + 起第 1 轮。
   *
   * **轮次的循环交给 SDK 原生的 stop hook**（用户口径 2026-10-09：`hooks.json` 里
   * `stop:[stop.mjs]` 已装，SDK 的 `session.run` 每轮结束会自动问它 —— continue 就
   * 接着跑，宿主**不需要也不应该**自己驱动轮次。之前宿主自己拼协议文本、自己起轮，
   * 结果 SDK 的循环没人接住（stop hook 读不到正确的文件、tokens_used 记账也乱），
   * 目标永远停在第 1 轮 —— 用户实测"目标没生效"的根因。
   *
   * 这里只做两件事：
   * 1. 经 **SDK 的 runUserPromptHook** 跑官方 start.mjs（它写 GOAL.json + 返回第 1 轮
   *    协议文本，宿主把它接在用户目标原文后面发出）；
   * 2. 起第 1 轮 run（之后 SDK 自动接轮）。
   */
  async beginGoal(
    canvasId: string,
    sessionId: string,
    objective: string,
    budget: number,
  ): Promise<{ started: boolean }> {
    // SDK 的 runUserPromptHook 需要**会话对象**（它注入 sessionId / scratchpadDir），
    // 所以由 deps 里的钩子调（server.ts 接线 runtime 拿到的会话）。
    let protocol = ''
    const hookResult = await this.deps.runUserPromptHook?.(canvasId, sessionId, 'goal', objective, { budget })
    protocol = hookResult?.context ?? ''
    /**
     * 双保险：hook 因为任何原因没产出协议文本（包缺失 / 脚本超时）时，
     * 宿主**自己写**初始 GOAL.json —— 这样至少：
     *   ① 目标文件在（stop.mjs 每轮读它，装好包后会正常续轮）；
     *   ② 用户"发目标"永远有反应（不会点了没动静）。
     * hook 正常时它已经写过（start.mjs 同形字段），这里幂等覆盖一次也无害。
     */
    if (!protocol) {
      await writeInitialGoal(this.deps.scratchpadOf(canvasId, sessionId), objective, budget)
      this.deps.log?.('goal: hook 未产出协议文本，宿主写初始 GOAL.json 兜底', { session: sessionId })
    }
    // 协议文本必须作为**独立的 harness 消息**发（设计 §3.4.2）：拼进用户正文里就没有
    // sender 戳 ⇒ stop hook 划不出轮次边界 ⇒ 记 full-trace 当一轮 ⇒ 扫到历史 abort
    // 就判 aborted（真机实测：有历史 abort 的会话目标永远停在第 1 轮）。
    const harnessText = protocol
      ? protocol
      : '（目标模式）持续推进这个目标直到完成；每一轮结束时读目标文件确认状态。'
    const r = await this.deps.startRun(canvasId, sessionId, objective, harnessText)
    this.deps.log?.('goal started', { session: sessionId, budget, started: r.started })
    return r
  }

  async updateGoal(
    canvasId: string,
    sessionId: string,
    patch: { objective?: string; budget?: number; deltaBudget?: number; tokensUsed?: number },
  ): Promise<GoalState | null> {
    const next = await updateGoalFile(this.deps.scratchpadOf(canvasId, sessionId), patch)
    if (next) {
      this.deps.emit?.(canvasId, sessionId, { type: 'goal_state', goal: next })
      this.deps.log?.('goal updated', { session: sessionId, budget: next.budget, round: next.round })
    }
    return next
  }

  async pauseGoal(canvasId: string, sessionId: string): Promise<boolean> {
    const moved = await this.files(canvasId, sessionId).pause()
    if (moved) {
      await this.deps.setPausedFlag(canvasId, sessionId, true)
      this.deps.log?.('goal paused', { session: sessionId })
    }
    return moved
  }

  /**
   * **结束目标**（用户口径 2026-10-09）：把 GOAL.json 与 .paused 两份都删掉，清掉暂停标记，
   * 并广播一次 `goal_state: null` 让界面把那条目标状态收掉。
   *
   * 与「暂停」的区别：暂停是挪走、随时可启动；结束是真正放弃 —— 官方循环下一轮读不到文件就自然停住。
   */
  async endGoal(canvasId: string, sessionId: string): Promise<boolean> {
    const removed = await this.files(canvasId, sessionId).end()
    await this.deps.setPausedFlag(canvasId, sessionId, false)
    this.deps.emit?.(canvasId, sessionId, { type: 'goal_state', goal: null })
    this.deps.log?.('goal ended', { session: sessionId, removed })
    return removed
  }

  /**
   * 启动：
   * 1. 文件放回（没文件 = 从没启动过目标 ⇒ 只清标记，无可启动）；
   * 2. 清宿主标记；
   * 3. **踢一脚**：跑一轮 —— 用官方 stop.mjs 的输出当下一轮输入；拿不到就用一句兜底文本
   *    （绝不因为脚本失败就让"启动"变成"点了没反应"）。
   */
  async resumeGoal(canvasId: string, sessionId: string): Promise<{ started: boolean }> {
    const files = this.files(canvasId, sessionId)
    // 先走「暂停 → 恢复」（文件在 .paused 下）。
    let restored = await files.resume()
    /**
     * 没在 .paused 里、但目标**被中止过**（`aborted` + `ended`）时也要能接着跑
     *（用户口径 2026-10-11）：那种情形文件仍以 live 名躺着，只调 resume() 什么也做不了 ——
     * 于是「启动」变成点了没反应。这里把终态标记清掉（只对 aborted 这一种，真完成的不管）。
     */
    // reopen() 自己只处理「live 名 + 未真完成」，真完成的会原样返回 false，不必在这里再判一次
    if (!restored) restored = await files.reopen()
    await this.deps.setPausedFlag(canvasId, sessionId, false)
    if (!restored) return { started: false }
    // 当前轮还在跑：等它到边界时官方循环会自己接着走（文件已经回来了），不必踢
    if (this.deps.isRunning(canvasId, sessionId)) {
      this.deps.log?.('goal resumed (already running; loop will continue)', { session: sessionId })
      return { started: true }
    }
    const nextText = await this.nextRoundText(sessionId)
    // 与 beginGoal 同口径：这段是**宿主注入的协议文本**，必须以 harness 消息发（划轮次边界），
    // 不带人类正文（这一轮没有用户新输入）。
    const r = await this.deps.startRun(canvasId, sessionId, '', nextText)
    this.deps.log?.('goal resumed', { session: sessionId, started: r.started })
    return { started: r.started }
  }

  /**
   * 暂停态下的"守住缺席"：当前轮里模型可能写回 GOAL.json —— 每轮结束后调一次。
   * 返回 true = 真收走了一个复活的文件。
   */
  async enforcePauseIfNeeded(canvasId: string, sessionId: string): Promise<boolean> {
    if (!(await this.deps.isPausedFlag(canvasId, sessionId))) return false
    return this.files(canvasId, sessionId).enforcePaused()
  }

  /** 下一轮的输入文本：优先问官方 stop.mjs（它的措辞与记账都在脚本里） */
  private async nextRoundText(sessionId: string): Promise<string> {
    try {
      const trace = await this.deps.latestTraceOf(sessionId)
      if (trace) {
        const run = this.deps.runScript ?? makeScriptRunner(this.deps.hooksDir)
        const decision = await askGoalStop(run, sessionId, trace)
        if (decision?.decision === 'continue' && decision.input) return decision.input
      }
    } catch (err) {
      this.deps.log?.('goal resume: stop.mjs 问不到下一轮文本', {
        session: sessionId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    // 兜底：让模型自己看目标文件继续（绝不让"启动"点了没反应）
    return '继续推进目标：读目标文件（GOAL.json）确认当前状态，继续未完成的工作。'
  }
}

/** 目标 hook 包的安装目录（stop.mjs 在这里；与 ensureGoalInstalled 的落点同源） */
export function goalHooksDir(agentRoot: string, projectId: string, agentId: string): string {
  return path.join(agentRoot, projectId, 'agents', agentId, 'agent_state', 'hooks', 'goal')
}

/**
 * 找一条会话**当前**的 Trace 文件（stop.mjs 要它来反推 scratchpad、并读这一轮的 token 用量）。
 *
 * 目录口径与 SDK 一致：`<tracesDir>/<YYYY-MM-DD>/<sessionId>_<NNN>.jsonl`。
 * 压缩（compaction）会让文件轮转（_001 → _002 …），所以要取**序号最大的那个**。
 * 找不到返回 null（调用方走兜底文本，不报错）。
 */
export async function findSessionTrace(tracesDir: string, sessionId: string): Promise<string | null> {
  let best: { file: string; index: number } | null = null
  let days: string[]
  try {
    days = await fs.readdir(tracesDir)
  } catch {
    return null
  }
  for (const day of days) {
    const dir = path.join(tracesDir, day)
    let files: string[]
    try {
      files = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.startsWith(sessionId + '_') || !f.endsWith('.jsonl')) continue
      const m = /_(\d+)\.jsonl$/.exec(f)
      const index = m ? Number(m[1]) : 0
      if (!best || index > best.index || (index === best.index && f > path.basename(best.file))) {
        best = { file: path.join(dir, f), index }
      }
    }
  }
  return best?.file ?? null
}

/**
 * 写一份**初始** GOAL.json（与插件 start.mjs 的输出同形）。
 *
 * 字段形状必须与插件一致：objective / status:'active' / budget / round:1 / tokens_used:0。
 * 宿主先写、再让 start.mjs 读它产出协议文本 —— 顺序颠倒的话 start.mjs 会自己写一份
 * （内容一样，但我们这次调用就白跑了）。
 */
export async function writeInitialGoal(scratchpadDir: string, objective: string, budget: number): Promise<void> {
  await fsp.mkdir(scratchpadDir, { recursive: true })
  await writeGoalFile(path.join(scratchpadDir, GOAL_FILE), {
    objective,
    status: 'active',
    // 预算口径：> 0 用给定值；否则 -1（不限）—— 与插件 start.mjs 的 Number.isFinite 判定一致
    budget: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : -1,
    round: 1,
    tokensUsed: 0,
  })
}
