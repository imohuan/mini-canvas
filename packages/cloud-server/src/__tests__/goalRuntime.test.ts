/**
 * GoalRuntime（设计 §3.4.4）：暂停 / 启动 / 改预算 / 守住缺席。
 *
 * 用户口径的方案：**不碰 stop hook、不改 manifest** —— 暂停 = 把 GOAL.json 改名挪走
 * （官方循环下一轮结束时读不到文件 ⇒ 静默退出 ⇒ 停住）；启动 = 放回 + 踢一脚。
 * 这层测试就按这个语义钉住：
 * 1. 暂停真的把文件挪走（内容原样），并记宿主标记；
 * 2. 暂停态下"文件复活"会被守住（模型在那一轮里写回来也不让循环继续）；
 * 3. 启动把文件放回、清标记、并**踢一脚**（起一轮）；
 * 4. 启动时拿不到 stop.mjs 的下一轮文本 ⇒ 用兜底文本，绝不"点了没反应"；
 * 5. 改预算两种口径（总预算 / 再跑多少）写进文件，下一轮生效（文件是唯一真相）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GoalRuntime, writeInitialGoal, findSessionTrace } from '../agent/goalRuntime.js'
import { readGoalState } from '../agent/goalState.js'

let root: string
let scratch: string
let started: string[]
let startedHarness: Array<string | undefined>
let running: boolean
let pausedFlag: boolean

function makeRuntime(over: Partial<ConstructorParameters<typeof GoalRuntime>[0]> = {}) {
  return new GoalRuntime({
    scratchpadOf: () => scratch,
    hooksDir: path.join(root, 'hooks'),
    latestTraceOf: async () => null, // 默认没有 trace：走兜底文本
    startRun: async (_c, _s, text, harnessText) => {
      started.push(text)
      startedHarness.push(harnessText)
      return { started: true }
    },
    isRunning: () => running,
    emit: vi.fn(),
    setPausedFlag: async (_c, _s, v) => {
      pausedFlag = v
    },
    isPausedFlag: async () => pausedFlag,
    log: vi.fn(),
    ...over,
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-rt-'))
  scratch = path.join(root, 'scratchpad', 's1')
  await writeInitialGoal(scratch, '把测试跑绿', 50000)
  started = []
  startedHarness = []
  running = false
  pausedFlag = false
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('GoalRuntime', () => {
  it('暂停：文件改名挪走（内容原样）+ 记宿主标记', async () => {
    const rt = makeRuntime()
    const ok = await rt.pauseGoal('c1', 's1')
    expect(ok).toBe(true)
    expect(pausedFlag).toBe(true)
    // 原名不在、.paused 在
    const live = await fs.stat(path.join(scratch, 'GOAL.json')).catch(() => null)
    const paused = await fs.stat(path.join(scratch, 'GOAL.json.paused')).catch(() => null)
    expect(live).toBeNull()
    expect(paused).not.toBeNull()
    // 内容原样（readGoalState 两个形态都能读）
    const state = await readGoalState(scratch)
    expect(state).toMatchObject({ objective: '把测试跑绿', budget: 50000, round: 1 })
  })

  it('守住缺席：暂停态下模型写回文件，再挪走一次（循环不会继续）', async () => {
    const rt = makeRuntime()
    await rt.pauseGoal('c1', 's1')
    // 模拟：当前轮里模型自己又写了一份 GOAL.json（比如它认为完成了）
    await writeInitialGoal(scratch, '把测试跑绿', 50000)
    const again = await rt.enforcePauseIfNeeded('c1', 's1')
    expect(again).toBe(true)
    const live = await fs.stat(path.join(scratch, 'GOAL.json')).catch(() => null)
    expect(live).toBeNull() // 又收走了
    // 非暂停态：不碰文件
    pausedFlag = false
    await writeInitialGoal(scratch, '把测试跑绿', 50000)
    const noop = await rt.enforcePauseIfNeeded('c1', 's1')
    expect(noop).toBe(false)
  })

  it('启动：放回文件 + 清标记 + 踢一脚（起一轮）', async () => {
    const rt = makeRuntime()
    await rt.pauseGoal('c1', 's1')
    const r = await rt.resumeGoal('c1', 's1')
    expect(r.started).toBe(true)
    expect(pausedFlag).toBe(false)
    expect(await fs.stat(path.join(scratch, 'GOAL.json')).then(() => true)).toBe(true)
    expect(started).toHaveLength(1) // 踢了一脚
    // 没有 trace / 脚本 ⇒ 走兜底文本；这一脚**不带人类正文**，文本走 harness 通道
    // （resume 起的是「无用户新输入」的一轮：正文空、协议文本以 harness 消息发）
    expect(started[0]).toBe('')
    expect(startedHarness[0]).toContain('继续推进目标')
  })

  it('启动时没装 stop.mjs / 没有 trace ⇒ 用兜底文本（不出现"点了没反应"）', async () => {
    const rt = makeRuntime()
    await rt.pauseGoal('c1', 's1')
    await rt.resumeGoal('c1', 's1')
    expect(started).toHaveLength(1)
    expect(startedHarness[0]).toContain('继续推进目标')
  })

  it('启动时正在跑 ⇒ 不重复踢（等当前轮到边界自己接上）', async () => {
    const rt = makeRuntime()
    await rt.pauseGoal('c1', 's1')
    running = true
    const r = await rt.resumeGoal('c1', 's1')
    expect(r.started).toBe(true)
    expect(started).toHaveLength(0) // 没踢
    expect(pausedFlag).toBe(false)
  })

  it('改预算：总预算直接写', async () => {
    const rt = makeRuntime()
    const g = await rt.updateGoal('c1', 's1', { budget: 120000 })
    expect(g?.budget).toBe(120000)
    expect((await readGoalState(scratch))?.budget).toBe(120000)
  })

  it('改「已用」：tokensUsed 也能被人工纠偏写回（用户口径 2026-10-09 运行中左右都可改）', async () => {
    const rt = makeRuntime()
    const g = await rt.updateGoal('c1', 's1', { tokensUsed: 3700 })
    expect(g?.tokensUsed).toBe(3700)
    expect((await readGoalState(scratch))?.tokensUsed).toBe(3700)
    // 负数不合法：按 0（已用不可能是负的）
    await rt.updateGoal('c1', 's1', { tokensUsed: -5 })
    expect((await readGoalState(scratch))?.tokensUsed).toBe(0)
  })

  it('改预算：再跑多少 = 已用 + N（人话口径）', async () => {
    const rt = makeRuntime()
    // 先把 tokens_used 改成 12000（模拟跑了几轮）
    const file = path.join(scratch, 'GOAL.json')
    const cur = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
    await fs.writeFile(file, JSON.stringify({ ...cur, tokens_used: 12000 }), 'utf8')
    const g = await rt.updateGoal('c1', 's1', { deltaBudget: 30000 })
    expect(g?.budget).toBe(42000) // 12000 + 30000
  })

  it('暂停态下也能改预算（写的是 .paused 那份，不破坏缺席）', async () => {
    const rt = makeRuntime()
    await rt.pauseGoal('c1', 's1')
    const g = await rt.updateGoal('c1', 's1', { budget: 70000 })
    expect(g?.budget).toBe(70000)
    // 关键：改名状态没被破坏（还是"缺席"）
    const live = await fs.stat(path.join(scratch, 'GOAL.json')).catch(() => null)
    expect(live).toBeNull()
    expect((await readGoalState(scratch))?.budget).toBe(70000)
  })

  it('改目标内容（objective）', async () => {
    const rt = makeRuntime()
    const g = await rt.updateGoal('c1', 's1', { objective: '新的目标' })
    expect(g?.objective).toBe('新的目标')
  })

  it('没有目标时改预算 ⇒ null（不是错误）', async () => {
    await fs.rm(scratch, { recursive: true, force: true })
    const rt = makeRuntime()
    expect(await rt.updateGoal('c1', 's1', { budget: 1 })).toBeNull()
  })

  it('beginGoal：写初始 GOAL.json + 起第 1 轮（带目标原文）', async () => {
    await fs.rm(scratch, { recursive: true, force: true }) // 从零开始
    // 新语义：beginGoal 经 **SDK 的 runUserPromptHook** 跑官方 start.mjs
    //（它写 GOAL.json + 返回协议文本）。测试里给一个假 hook 模拟官方行为。
    const rt = makeRuntime({
      runUserPromptHook: async (_c, _s, name, prompt, extras) => {
        expect(name).toBe('goal')
        expect(prompt).toBe('写一份 README')
        expect(extras).toEqual({ budget: 30000 })
        // 与官方 start.mjs 同形：写文件 + 返回协议文本
        await writeInitialGoal(scratch, prompt, Number(extras?.budget ?? -1))
        return { context: '（goal 协议文本，测试桩）' }
      },
    })
    const r = await rt.beginGoal('c1', 's1', '写一份 README', 30000)
    expect(r.started).toBe(true)
    const state = await readGoalState(scratch)
    expect(state).toMatchObject({ objective: '写一份 README', status: 'active', budget: 30000, round: 1 })
    expect(started[0]).toContain('写一份 README')
    // 第 1 轮的输入：用户正文 = 目标原文；协议文本走**独立的 harness 消息**
    // （拼进正文就没有 sender 戳，stop hook 划不出轮次边界 —— 真机实测的洞）
    expect(started[0]).toBe('写一份 README')
    expect(started[0]).not.toContain('goal 协议文本')
    expect(startedHarness[0]).toContain('goal 协议文本')
  })

  it('beginGoal：hook 缺席（runUserPromptHook 返回 null）⇒ 宿主兜底写 GOAL.json，绝不"点了没反应"', async () => {
    await fs.rm(scratch, { recursive: true, force: true })
    const rt = makeRuntime({ runUserPromptHook: async () => null })
    const r = await rt.beginGoal('c1', 's1', '兜底目标', 12345)
    expect(r.started).toBe(true)
    const state = await readGoalState(scratch)
    expect(state).toMatchObject({ objective: '兜底目标', budget: 12345 })
    expect(started[0]).toContain('兜底目标')
    // hook 缺席也要有 harness 兜底文本（否则 stop hook 划不出边界）
    expect(startedHarness[0]).toBeTruthy()
  })
})

describe('findSessionTrace', () => {
  it('取序号最大的那份（compaction 轮转后是 _002）', async () => {
    const traces = path.join(root, 'traces')
    await fs.mkdir(path.join(traces, '2026-10-08'), { recursive: true })
    await fs.mkdir(path.join(traces, '2026-10-07'), { recursive: true })
    await fs.writeFile(path.join(traces, '2026-10-08', 's1_001.jsonl'), '')
    await fs.writeFile(path.join(traces, '2026-10-08', 's1_002.jsonl'), '')
    await fs.writeFile(path.join(traces, '2026-10-07', 's1_001.jsonl'), '')
    await fs.writeFile(path.join(traces, '2026-10-08', 'other_001.jsonl'), '')
    const f = await findSessionTrace(traces, 's1')
    expect(f).toContain('s1_002.jsonl')
  })

  it('找不到时返回 null（调用方走兜底，不报错）', async () => {
    expect(await findSessionTrace(path.join(root, 'nope'), 's1')).toBeNull()
  })
})
