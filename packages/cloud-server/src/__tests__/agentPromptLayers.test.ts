/**
 * **系统提示词三层，谁都不许顶掉谁**（2026-10-14 用户实测的真 bug）。
 *
 * 用户拿后台拦截到的**真实请求**做了判据：请求里 `messages[0]`（system prompt）虽然有
 * 模式提示词（「铁律」在），但用户在设置页写的「Agent 提示词」一个字都没有。
 * 根因：`withSystemPrompt` 把 AGENTS.md **整份替换**成了模式提示词。
 *
 * 三层的关系（也是设置页三个页签的名字，别再改混）：
 *   ① Agent 提示词    = AGENTS.md，用户写的常驻指令 → 灌进模板的 {{AGENTS_MD}}
 *   ② 模式提示词      = 每套模式一段，选着哪套就附加哪段（**附加，不是替换**）
 *   ③ 系统提示词模板  = system_config.yaml 里的容器（决定上面两样摆在哪）
 *
 * 这一条用 SDK 真的 `assembleSystemPrompt` 组装一遍，断言三者都在最终结果里 ——
 * 比只测「盘上文件写对了」更硬：它证明的正是模型会看到的东西。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assembleSystemPrompt, loadAgentState } from '@prismshadow/penguin-core'
import { AgentConfigService } from '../agent/config'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot } from '../agent/agentPaths'

let dir: string
let svc: AgentConfigService

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-three-layers-'))
  svc = new AgentConfigService(dir)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** 按 SDK 的口径组装一次系统提示词（= 模型真正拿到的那一份） */
async function assemble(): Promise<string> {
  const state = await loadAgentState({
    agentId: AGENT_ID,
    projectId: AGENT_PROJECT_ID,
    root: agentRoot(dir),
  })
  return assembleSystemPrompt(state, {
    sessionId: 's1',
    cwd: 'C:/ws',
    agentId: AGENT_ID,
    projectDir: 'C:/data',
    provider: 'p',
    modelId: 'm',
    platform: 'win32',
    osVersion: 'Windows 11',
    shell: 'pwsh',
    date: '2026-10-14',
  } as never)
}

describe('系统提示词三层都在最终结果里', () => {
  it('Agent 提示词 + 模式提示词 + 模板：三者同时进模型（真机 bug 的回归守卫）', async () => {
    await svc.setSystemPrompt('用户写的常驻指令：回答用中文')
    const restore = await svc.withSystemPrompt('模式提示词：先把剧本写出来')
    try {
      const sp = await assemble()
      // ① Agent 提示词（这就是从前丢掉的那一份）
      expect(sp).toContain('用户写的常驻指令：回答用中文')
      // ② 模式提示词
      expect(sp).toContain('模式提示词：先把剧本写出来')
      // ③ 模板：{{AGENTS_MD}} 被替换掉，且它所在的那一段（developer_instructions）还在
      expect(sp).not.toContain('{{AGENTS_MD}}')
      expect(sp).toContain('[developer_instructions]')
      // 模板里的运行时值也确实替换了（证明整个模板机制有效，不是只塞了一段）
      expect(sp).toContain('CWD: C:/ws')
      expect(sp).toContain('Session ID: s1')
    } finally {
      await restore()
    }
  })

  it('还原之后盘上只剩用户原文（模式提示词不会黏住）', async () => {
    await svc.setSystemPrompt('用户原文')
    const restore = await svc.withSystemPrompt('模式A')
    await restore()
    const sp = await assemble()
    expect(sp).toContain('用户原文')
    expect(sp).not.toContain('模式A')
  })
})
