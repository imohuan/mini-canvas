/**
 * 目标状态文件的读写（设计 §3.4）。
 *
 * 目标是插件 `@penguinharness/goal` 驱动的一套**文件协议**：状态就是一个 JSON 文件
 * `<scratchpad>/<sessionId>/GOAL.json`（objective/status/budget/round/tokens_used）。
 * 本项目只做两件事：**读它**（渲染界面状态）、**改它**（编辑预算/目标，暂停时挪走）。
 *
 * 字段所有权（插件的约定，见 goal 插件的 hooks/lib.mjs）：
 * - `objective`：宿主写一次（启动目标时）；
 * - `status`：**只有模型能改**（改成 complete / blocked）；宿主不要碰（写了会被判成坏通道）；
 * - `budget`：宿主可改（本文件提供入口）；
 * - `round` / `tokens_used`：插件自己维护。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 目标状态文件的内容形状（容错读，字段缺失按默认值兜） */
export interface GoalState {
  objective: string
  status: string
  budget: number
  round: number
  tokensUsed: number
  /** 目标已终结（插件在结束后写 ended: true；终结后不再续轮） */
  ended?: boolean
}

/** 目标状态文件的两种存在形态 */
export const GOAL_FILE = 'GOAL.json'
/** 暂停时的挪走名（内容原样；启动时改回来） */
export const GOAL_FILE_PAUSED = 'GOAL.json.paused'
/** 插件把坏文件挪到这个名字（见 goal 插件 stop.mjs） */
export const GOAL_FILE_BROKEN = 'GOAL.json.broken'

/** 从磁盘读：两个形态都试；都不在返回 null */
export async function readGoalState(scratchpadDir: string): Promise<GoalState | null> {
  for (const name of [GOAL_FILE, GOAL_FILE_PAUSED]) {
    const parsed = await readGoalFile(path.join(scratchpadDir, name))
    if (parsed) return parsed
  }
  return null
}

/**
 * 暂停：把 GOAL.json 改名挪走（内容原样保留）。
 * 效果（已实测插件代码）：下一轮结束时插件 readGoal 读不到文件 ⇒ 什么都不输出 ⇒
 * SDK 的自动连播自然停住 —— **不打断当前轮、也不多跑一轮**。
 */
export async function pauseGoalFile(scratchpadDir: string): Promise<boolean> {
  const live = path.join(scratchpadDir, GOAL_FILE)
  const paused = path.join(scratchpadDir, GOAL_FILE_PAUSED)
  if (!(await exists(live))) return false
  // 已有旧的 .paused（重复暂停）时先清掉，避免 rename 覆盖歧义
  await fs.rm(paused, { force: true })
  await fs.rename(live, paused)
  return true
}

/** 启动：把文件改回原名（恢复 status/round/tokens_used 的连续性） */
export async function resumeGoalFile(scratchpadDir: string): Promise<boolean> {
  const live = path.join(scratchpadDir, GOAL_FILE)
  const paused = path.join(scratchpadDir, GOAL_FILE_PAUSED)
  if (!(await exists(paused))) return false
  await fs.rm(live, { force: true })
  await fs.rename(paused, live)
  return true
}

 /**
 * 结束目标：把 live 与 .paused 两份状态文件都删掉（用户口径 2026-10-09）。
 *
 * 与「暂停」的区别：暂停只是把文件挪成 .paused，随时能再启动；**结束**是真正放弃这个目标，
 * 界面上的目标状态随之消失。返回 true = 确实清掉了某个文件（幂等，两份都不在时返回 false）。
 */
export async function endGoalFile(scratchpadDir: string): Promise<boolean> {
  const live = path.join(scratchpadDir, GOAL_FILE)
  const paused = path.join(scratchpadDir, GOAL_FILE_PAUSED)
  const hadLive = await exists(live)
  const hadPaused = await exists(paused)
  await fs.rm(live, { force: true })
  await fs.rm(paused, { force: true })
  return hadLive || hadPaused
}

/**
 * 改预算 / 目标内容（**下一轮生效**：插件的 stop.mjs 每轮重新读这个文件）。
 *
 * 两种填法（设计 §3.4.3）：
 * - 传 `budget` ⇒ 直接写总预算（-1 = 不限）；
 * - 传 `deltaBudget` ⇒ 总预算 = 已用 + delta（"再跑多少"的人话口径）。
 *
 * 暂停态下也能改：写的是 .paused 那份（保持"文件缺席"的状态不被破坏）。
 */
export async function updateGoalFile(
  scratchpadDir: string,
  patch: { objective?: string; budget?: number; deltaBudget?: number; tokensUsed?: number },
): Promise<GoalState | null> {
  const livePath = path.join(scratchpadDir, GOAL_FILE)
  const pausedPath = path.join(scratchpadDir, GOAL_FILE_PAUSED)
  const target = (await exists(livePath)) ? livePath : (await exists(pausedPath)) ? pausedPath : null
  if (!target) return null
  const current = (await readGoalFile(target)) ?? {
    objective: '',
    status: 'active',
    budget: -1,
    round: 0,
    tokensUsed: 0,
  }
  const next: GoalState = { ...current }
  if (typeof patch.objective === 'string' && patch.objective.trim()) next.objective = patch.objective.trim()
  // 「已用」也能被用户改（用户口径 2026-10-09：运行中的 已用/总预算 左右各自可点着改）。
  // 注意：正常情况下它由插件每轮记账；这里是**人工纠偏**的口子，写进去后下一轮记账会接着它走。
  if (typeof patch.tokensUsed === 'number' && Number.isFinite(patch.tokensUsed)) {
    // 已用不可能是负的：负数一律按 0（与前端 formatToken 同口径）
    next.tokensUsed = Math.max(0, Math.round(patch.tokensUsed))
  }
  if (typeof patch.deltaBudget === 'number' && Number.isFinite(patch.deltaBudget)) {
    // "再跑多少"：从**已用**往前加（用户口径：填的是还能再花多少）
    next.budget = Math.max(0, Math.round(next.tokensUsed + patch.deltaBudget))
  } else if (typeof patch.budget === 'number' && Number.isFinite(patch.budget)) {
    next.budget = patch.budget > 0 ? Math.round(patch.budget) : -1
  }
  await writeGoalFile(target, next)
  return next
}

/** 读单个文件（容错：坏 JSON / 不存在都返回 null） */
async function readGoalFile(file: string): Promise<GoalState | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return {
      objective: typeof parsed.objective === 'string' ? parsed.objective : '',
      status: typeof parsed.status === 'string' ? parsed.status : 'blocked',
      budget: Number.isFinite(parsed.budget) ? Number(parsed.budget) : -1,
      round: Number.isFinite(parsed.round) ? Number(parsed.round) : 0,
      tokensUsed: Number.isFinite(parsed.tokens_used) ? Number(parsed.tokens_used) : 0,
      ...(parsed.ended === true ? { ended: true } : {}),
    }
  } catch {
    return null
  }
}

/** 写回（原子：先临时文件再 rename；与项目其它存储同一套做法） */
export async function writeGoalFile(file: string, state: GoalState): Promise<void> {
  const payload: Record<string, unknown> = {
    objective: state.objective,
    status: state.status,
    budget: state.budget,
    round: state.round,
    tokens_used: state.tokensUsed,
    ...(state.ended ? { ended: true } : {}),
  }
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, file)
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}
