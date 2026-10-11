/**
 * 「被中止的目标要能接着跑」（用户口径 2026-10-11）—— 回归测试。
 *
 * 真 bug：用户点「终止」后，插件的 stop hook 把 GOAL.json 写成
 * `status:'aborted' + ended:true`（= 这一轮结束、别再自动续轮），文件仍以 **live 名**躺着。
 * 而 resumeGoal 只认 `.paused`（暂停才有），于是「启动」点了没反应 —— 目标看起来无法恢复。
 *
 * 修法：resumeGoal 在 .paused 找不到时，再看一眼 live 那份；是「中止」就 reopen()
 *（清掉 ended、status 回 active），让它能接着跑。真完成 / 受阻 / 预算用尽**不**复活。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GoalFiles } from '../agent/goal.js'
import { GOAL_FILE } from '../agent/goalState.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-reopen-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writeLive(state: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(dir, GOAL_FILE), JSON.stringify(state, null, 2) + '\n', 'utf8')
}

const readLive = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(path.join(dir, GOAL_FILE), 'utf8'))

describe('GoalFiles.reopen：把「被中止」的目标重新打开', () => {
  it('aborted + ended ⇒ 清掉 ended、status 回 active（可续跑）', async () => {
    await writeLive({ objective: 'x', status: 'aborted', budget: 1000, round: 3, tokens_used: 500, ended: true })
    expect(await new GoalFiles(dir).reopen()).toBe(true)
    const next = await readLive()
    expect(next.status).toBe('active')
    expect(next.ended).toBeUndefined()
    // 轮次 / 记账原样接上（不清零）
    expect(next.round).toBe(3)
    expect(next.tokens_used).toBe(500)
  })

  it('真完成的三种**不**复活（complete / blocked / budget_limited）', async () => {
    for (const s of ['complete', 'blocked', 'budget_limited']) {
      await writeLive({ objective: 'x', status: s, budget: 1000, round: 1, tokens_used: 1, ended: true })
      expect(await new GoalFiles(dir).reopen(), s).toBe(false)
      expect((await readLive()).status, s).toBe(s)
    }
  })

  it('没有文件 / 只有 .paused ⇒ 不动 live（暂停那条路走 resume）', async () => {
    expect(await new GoalFiles(dir).reopen()).toBe(false)
    await fs.writeFile(path.join(dir, GOAL_FILE + '.paused'), '{"status":"active"}', 'utf8')
    expect(await new GoalFiles(dir).reopen()).toBe(false)
  })
})
