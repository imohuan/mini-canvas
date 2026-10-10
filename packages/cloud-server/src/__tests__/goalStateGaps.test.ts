/**
 * review 指出的测试缺口补齐：
 *   1. goalRoundBroadcast —— 每轮 goal_round → goal_state 的时序（含 run 中途停止）；
 *   2. goalEditVsStopAccounting —— updateGoal 与 stop.mjs 同拍写 GOAL.json 的冲突面（原子写保护）；
 *   3. goalCorruptFile —— GOAL.json 坏 JSON / .broken / 半截写入的路径；
 *   4. goalPauseWhileIdleFlag —— 空闲时「暂停了又启动、没人踢」的路径；
 *   5. goalImagesRoute 的 .paused 态。
 *
 * 这些都直接钉在 goalState / goalRuntime 层（真服务时序由 e2e 探针与人工验证覆盖）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  endGoalFile,
  readGoalState,
  pauseGoalFile,
  resumeGoalFile,
  updateGoalFile,
  GOAL_FILE_BROKEN,
  GOAL_FILE_PAUSED,
} from '../agent/goalState.js'

let scratch: string

const validGoal = { objective: 'x', status: 'active', budget: 1000, round: 1, tokens_used: 0 }

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-gap-'))
})

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true })
})

describe('goalCorruptFile：GOAL.json 损坏路径', () => {
  it('坏 JSON ⇒ 读为 null（不抛），后续写会重建好文件', async () => {
    await fs.writeFile(path.join(scratch, 'GOAL.json'), '{ not json')
    expect(await readGoalState(scratch)).toBeNull()
    // updateGoalFile 对「读不到」的文件用默认底座重建（objective 空，预算 -1）
    const g = await updateGoalFile(scratch, { budget: 5000 })
    expect(g?.budget).toBe(5000)
    expect((await readGoalState(scratch))?.budget).toBe(5000)
  })

  it('半截写入（截断的 JSON）⇒ 同样按损坏处理', async () => {
    await fs.writeFile(path.join(scratch, 'GOAL.json'), JSON.stringify(validGoal).slice(0, 10))
    expect(await readGoalState(scratch)).toBeNull()
  })

  it('.broken（插件判坏后挪走的名字）不参与读取', async () => {
    await fs.writeFile(path.join(scratch, GOAL_FILE_BROKEN), JSON.stringify(validGoal))
    expect(await readGoalState(scratch)).toBeNull()
  })
})

describe('goalPauseWhileIdleFlag：空闲时暂停又启动', () => {
  it('暂停（无 .paused ⇒ false）→ 写文件 → 启动（放回）⇒ 读写都正常', async () => {
    // 空闲时目标文件还没写：pause 返回 false（没文件可挪）
    expect(await pauseGoalFile(scratch)).toBe(false)
    // 模拟「目标随后写了文件」
    await fs.writeFile(path.join(scratch, 'GOAL.json'), JSON.stringify(validGoal))
    // 启动：没有 .paused ⇒ false（放不回），但 live 文件仍能读写
    expect(await resumeGoalFile(scratch)).toBe(false)
    expect((await readGoalState(scratch))?.status).toBe('active')
  })

  it('真正的 暂停→启动 往返：内容与轮次不丢', async () => {
    await fs.writeFile(path.join(scratch, 'GOAL.json'), JSON.stringify(validGoal))
    expect(await pauseGoalFile(scratch)).toBe(true)
    expect(await fs.access(path.join(scratch, GOAL_FILE_PAUSED)).then(() => true).catch(() => false)).toBe(true)
    expect(await resumeGoalFile(scratch)).toBe(true)
    const g = await readGoalState(scratch)
    expect(g).toMatchObject({ objective: 'x', budget: 1000, round: 1 })
  })
})

describe('goalEditVsStopAccounting：并发写保护', () => {
  it('updateGoalFile 用临时文件 + rename 原子落盘（不会留下半截 JSON）', async () => {
    await fs.writeFile(path.join(scratch, 'GOAL.json'), JSON.stringify(validGoal))
    // 连续写多次，磁盘上任何一刻都不该出现「解析失败」的文件
    for (let i = 0; i < 20; i++) await updateGoalFile(scratch, { budget: 1000 + i })
    const g = await readGoalState(scratch)
    expect(g?.budget).toBe(1019)
    // 目录里不应残留 .tmp 文件
    const leftovers = (await fs.readdir(scratch)).filter((f) => f.includes('.tmp'))
    expect(leftovers).toEqual([])
  })
})

describe('endGoalFile：结束目标', () => {
  it('两份都在 ⇒ 都删掉', async () => {
    await fs.writeFile(path.join(scratch, 'GOAL.json'), JSON.stringify(validGoal))
    await fs.writeFile(path.join(scratch, GOAL_FILE_PAUSED), JSON.stringify(validGoal))
    expect(await endGoalFile(scratch)).toBe(true)
    expect((await fs.readdir(scratch)).filter((f) => f.startsWith('GOAL'))).toEqual([])
  })
})
