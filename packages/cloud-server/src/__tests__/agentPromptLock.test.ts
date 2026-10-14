/**
 * withSystemPrompt 的两条硬口径：
 *
 * 1. **互斥**：并发建会话不能互相覆盖 AGENTS.md。
 *    它是「读旧值 → 写新模式 → 建会话 → 还原旧值」四步，中间那步（建会话）是 SDK
 *    真正读 AGENTS.md 的时刻，所以锁必须一直握到还原。没有锁时两个并发会交错，
 *    最终 AGENTS.md 可能停在模式提示词上（把用户的系统提示词盖掉）。
 *
 * 2. **合并而不是替换**（2026-10-14 用户实测的真 bug）：
 *    从前这里是 `写模式提示词` —— 于是选着模式时，「Agent 提示词」里写的**一个字都进不去模型**。
 *    真机表现：「设置里改了 Agent 提示词，AI 毫无反应」。
 *    现在写的是 `用户原文 + 模式提示词`，两者都进 `{{AGENTS_MD}}` 那个位置。
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
        seen.push(await readAgentsMd()) // 此刻应是「原文 + 自己的模式」
      } finally {
        await restore()
      }
    }
    await Promise.all([run('模式A'), run('模式B')])

    // 每一次都看到自己那份（没有交错），且都保住了用户原文
    expect(seen.sort()).toEqual(['原始系统提示词\n\n模式A', '原始系统提示词\n\n模式B'])
    expect(await readAgentsMd()).toBe('原始系统提示词')
  })

  it('还原后锁释放：后续调用照常进行', async () => {
    await svc.setSystemPrompt('原始')
    const r1 = await svc.withSystemPrompt('一次')
    await r1()
    const r2 = await svc.withSystemPrompt('二次')
    expect(await readAgentsMd()).toBe('原始\n\n二次')
    await r2()
    expect(await readAgentsMd()).toBe('原始')
  })
})

describe('withSystemPrompt 是「合并」而不是「替换」', () => {
  it('用户自己的 Agent 提示词在选着模式时也进模型（真机 bug 的回归守卫）', async () => {
    await svc.setSystemPrompt('用户写的常驻指令：回答用中文')
    const restore = await svc.withSystemPrompt('模式提示词：先出剧本')
    const onDisk = await readAgentsMd()
    // 两边都在 —— 少任何一边都是回归
    expect(onDisk).toContain('用户写的常驻指令：回答用中文')
    expect(onDisk).toContain('模式提示词：先出剧本')
    // 用户原文在前（它是主体，模式是附加）
    expect(onDisk.indexOf('用户写的常驻指令')).toBeLessThan(onDisk.indexOf('模式提示词'))
    await restore()
  })

  it('用户没写 Agent 提示词时，落盘内容就是模式提示词本身（不留多余分隔）', async () => {
    await svc.setSystemPrompt('')
    const restore = await svc.withSystemPrompt('只有模式')
    expect(await readAgentsMd()).toBe('只有模式')
    await restore()
  })

  it('用户 Agent 提示词带首尾空白时不留空段落（trim 后再拼）', async () => {
    await svc.setSystemPrompt('  前后有空行  \n\n')
    const restore = await svc.withSystemPrompt('模式')
    expect(await readAgentsMd()).toBe('前后有空行\n\n模式')
    await restore()
  })
})
