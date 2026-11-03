import type { GoalStateView, SendOptions } from '../agentApi.js'
import type { AgentServiceContext, AgentServiceDeps } from './context.js'

/** 目标（设计 §3.4）：标记 / 改预算 / 暂停 / 启动 / 结束 / 目标发送 */
export function createGoalDomain(ctx: AgentServiceContext, deps: AgentServiceDeps) {
  const { state, api, model } = ctx
  const { canvasId, sync, setError } = ctx
  const abort = ctx.abortRef
  const lastAppliedSeq = ctx.seqRef

  function setGoalMark(objective: string, budget: number): void {
    state.goalMark = { objective: objective.trim(), budget }
  }

  function clearGoalMark(): void {
    state.goalMark = null
  }

  /** 改进行中目标的预算 / 内容（下一轮生效） */
  async function updateGoal(patch: {
    objective?: string
    budget?: number
    deltaBudget?: number
    tokensUsed?: number
  }): Promise<void> {
    const sid = ctx.currentSessionId()
    if (!sid) return
    const r = await api.goalOp(canvasId(), sid, { op: 'update', ...patch })
    if (r.goal) state.goal = r.goal as GoalStateView
  }

  /** 暂停目标：把 GOAL.json 收走 —— 官方循环跑到边界自己停住（不打断当前轮） */
  async function pauseGoal(): Promise<void> {
    const sid = ctx.currentSessionId()
    if (!sid) return
    await api.goalOp(canvasId(), sid, { op: 'pause' })
    state.goalPaused = true
  }

  /** 启动目标：文件放回 + 踢一脚（后端负责） */
  async function resumeGoal(): Promise<void> {
    const sid = ctx.currentSessionId()
    if (!sid) return
    await api.goalOp(canvasId(), sid, { op: 'resume' })
    state.goalPaused = false
  }

  /**
   * 结束目标（用户口径 2026-10-09）：目标状态条上的 ✕ —— 与「暂停」不同，这是**真删掉**，
   * 不再能启动回来。本地立刻清空目标状态（后端也会广播 goal_state: null）。
   */
  async function endGoal(): Promise<void> {
    const sid = ctx.currentSessionId()
    if (!sid) return
    await api.goalOp(canvasId(), sid, { op: 'end' })
    state.goal = null
    state.goalPaused = false
  }

  /**
   * 写当前目标的参考图（编辑运行中目标时用；空数组 = 清掉）。
   *
   * 失败静默：参考图是可选装饰，写不进去不该打断"改目标"这件事。
   * 本地 state 先更新的那一份由调用方负责（组件里改了 s.goalImages）。
   */
  async function setGoalImages(images: string[]): Promise<void> {
    const sid = ctx.currentSessionId()
    if (!sid) return
    await api.setGoalImages(canvasId(), sid, images).catch(() => undefined)
  }

  /**
   * **带目标发送**：把标记里的目标一起送出去（走后端 startRun 的目标分支）。
   *
   * 与普通 send 的分工：目标消息不带队列语义（未跑时直接起），跑着时由组件层走 sendToQueue
   * （条目里带 goal，轮到它时调度器调 startGoal）。
   */
  async function sendGoal(text: string, images?: string[]): Promise<void> {
    const mark = state.goalMark
    if (!mark) return
    const sid = await deps.ensureSession()
    if (!sid) return
    const value = text.trim() || mark.objective
    // 目标的参考图：落进宿主记录（目标行迷你预览用；与 GOAL.json 分开，见 sessionStore 注释）
    void api.setGoalImages?.(canvasId(), sid, images ?? []).catch(() => undefined)
    state.goalImages = images ?? []
    model.send(value, images)
    sync()
    state.running = true
    state.goalMark = null
    const ac = new AbortController()
    abort.value = ac
    try {
      // 同上（sendGoal）：send 响应与常驻流是同一条通道，必须一起按 seq 去重
      await api.sendMessage(
        canvasId(),
        sid,
        value,
        {
          ...deps.sendOptions(),
          ...(images?.length ? { images } : {}),
          goal: { objective: mark.objective || value, budget: mark.budget },
        } as SendOptions,
        deps.applyEvent,
        ac.signal,
        {
          acceptSeq: deps.acceptSeq,
          onSeq: (n) => {
            if (n > lastAppliedSeq.value) lastAppliedSeq.value = n
          },
        },
      )
    } catch (err) {
      if (!ac.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err))
        deps.applyEvent({ type: 'error', message: String(err) })
      }
    } finally {
      state.running = false
      abort.value = null
      deps.applyEvent({ type: 'done' })
      await deps.listSessions()
    }
  }


  return {
    setGoalMark,
    clearGoalMark,
    updateGoal,
    pauseGoal,
    resumeGoal,
    endGoal,
    sendGoal,
    setGoalImages,
  }
}



