/**
 * 结束目标（用户口径 2026-10-09）：「目标那一栏……没有删除按钮」。
 *
 * 与「暂停」的区别：暂停是把文件挪走、可以再启动；**结束**是真的清掉这个目标
 * （live 与 .paused 两份都删），界面那条目标状态从此消失。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { endGoalFile } from '../agent/goalState'

let scratch: string

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-end-'))
})

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true })
})

const exists = (f: string) => fs.access(f).then(() => true).catch(() => false)
const write = (name: string) =>
  fs.writeFile(path.join(scratch, name), JSON.stringify({ objective: 'x', status: 'active', budget: 1, round: 1, tokens_used: 0 }))

describe('endGoalFile', () => {
  it('live 文件在 ⇒ 删掉，返回 true', async () => {
    await write('GOAL.json')
    expect(await endGoalFile(scratch)).toBe(true)
    expect(await exists(path.join(scratch, 'GOAL.json'))).toBe(false)
  })

  it('只有 .paused（暂停中）⇒ 也删掉，返回 true', async () => {
    await write('GOAL.json.paused')
    expect(await endGoalFile(scratch)).toBe(true)
    expect(await exists(path.join(scratch, 'GOAL.json.paused'))).toBe(false)
  })

  it('两份都不在 ⇒ 返回 false（幂等，不是错误）', async () => {
    expect(await endGoalFile(scratch)).toBe(false)
  })
})

