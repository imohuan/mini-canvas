/**
 * withSystemPrompt 的**互斥**：并发建会话不能互相覆盖 AGENTS.md。
 *
 * 它是「读旧值 → 写模式提示词 → 建会话 → 还原旧值」四步，中间那步（建会话）是 SDK
 * 真正读 AGENTS.md 的时刻，所以锁必须一直握到还原。没有锁时两个并发会交错，
 * 最终 AGENTS.md 可能停在模式提示词上（把用户的系统提示词盖掉）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentConfigService } from '../agent/config'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot } from '../agent/agentPaths'

let dir: string
let svc: AgentConfigService

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-prompt-lock-'))
  svc = new AgentConfigService(dir)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** 当前 AGENTS.md 内容 */
async function readAgentsMd(): Promise<string> {
  const p = path.join(agentRoot(dir), AGENT_PROJECT_ID, 'agents', AGENT_ID, 'agent_state', 'AGENTS.md')
  return fs.readFile(p, 'utf8').catch(() => '')
}

describe('withSystemPrompt 互斥', () => {
  it('两个并发：各自看到自己的提示词，最终还原回原值', async () => {
    await svc.setSystemPrompt('原始系统提示词')

    const seen: string[] = []
    // 模拟「建会话时 SDK 读 AGENTS.md」这一步：在锁持有期间读文件
    const run = async (text: string): Promise<void> => {
      const restore = await svc.withSystemPrompt(text)
      try {
        seen.push(await readAgentsMd()) // 此刻应是自己的 text
      } finally {
        await restore()
      }
    }
    await Promise.all([run('模式A'), run('模式B')])

    // 每一次都读到自己那份（没有交错），且最终回到原值
    expect(seen.sort()).toEqual(['模式A', '模式B'])
    expect(await readAgentsMd()).toBe('原始系统提示词')
  })

  it('还原后锁释放：后续调用照常进行', async () => {
    await svc.setSystemPrompt('原始')
    const r1 = await svc.withSystemPrompt('一次')
    await r1()
    const r2 = await svc.withSystemPrompt('二次')
    expect(await readAgentsMd()).toBe('二次')
    await r2()
    expect(await readAgentsMd()).toBe('原始')
  })
})
