/**
 * 提示词「恢复默认」的数据口径（用户 2026-11-11：改坏了要能一键退回）。
 *
 * 界面上的恢复按钮读的是接口返回里的 defaultText / defaultName，所以这两个字段
 * 必须在**读**和**写**之后都在 —— 少了它们，按钮点了也没有内容可回。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentConfigService } from './config.js'
import { DEFAULT_PROMPTS } from './configTypes.js'
import { DEFAULT_POLICY } from './approval.js'
import type { AgentKvPort } from '../ports.js'

let dir: string
let svc: AgentConfigService

/** 内存 KV：和宿主 KvStore 同语义，够配置服务用 */
function memoryKv(): AgentKvPort {
  const data = new Map<string, unknown>()
  return {
    async get<T>(type: string, key: string) {
      return data.get(type + '/' + key) as T | undefined
    },
    async set(type: string, key: string, value: unknown) {
      data.set(type + '/' + key, value)
    },
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-prompt-defaults-'))
  svc = new AgentConfigService(dir, { kv: memoryKv() })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('模式提示词默认快照', () => {
  it('首次读出就带 defaultText / defaultName', async () => {
    const list = await svc.prompts()
    const general = list.find((p) => p.id === 'general')
    expect(general?.defaultText).toBe(DEFAULT_PROMPTS.find((p) => p.id === 'general')?.text)
    expect(general?.defaultName).toBe('全能创作')
  })

  it('改过再保存，返回的这一份仍然带默认快照（恢复按钮才有内容可回）', async () => {
    const before = await svc.prompts()
    const edited = before.map((p) =>
      p.id === 'general' ? { ...p, name: '改坏了', text: '改坏的正文' } : p,
    )
    const saved = await svc.savePrompts(edited)
    const general = saved.find((p) => p.id === 'general')
    expect(general?.text).toBe('改坏的正文')
    expect(general?.defaultText).toBe(DEFAULT_PROMPTS.find((p) => p.id === 'general')?.text)
    expect(general?.defaultName).toBe('全能创作')

    // 重新读也一样，不依赖刚才那次返回
    const reread = (await svc.prompts()).find((p) => p.id === 'general')
    expect(reread?.defaultText).toBeTruthy()
  })

  it('restorePrompt 只恢复这一条，别的自建项不动', async () => {
    const before = await svc.prompts()
    await svc.savePrompts([
      ...before.map((p) => (p.id === 'script' ? { ...p, name: '我的剧本', text: 'x' } : p)),
      { id: 'user-1', name: '自建', text: '保留我' },
    ])
    const after = await svc.restorePrompt('script')
    const script = after?.find((p) => p.id === 'script')
    expect(script?.name).toBe('剧本创编')
    expect(script?.text).toBe(DEFAULT_PROMPTS.find((p) => p.id === 'script')?.text)
    expect(after?.find((p) => p.id === 'user-1')?.text).toBe('保留我')
  })

  it('自建模式没有出厂版：restorePrompt 返回 undefined', async () => {
    const before = await svc.prompts()
    await svc.savePrompts([...before, { id: 'user-2', name: '自建', text: 'y' }])
    expect(await svc.restorePrompt('user-2')).toBeUndefined()
  })
})

describe('审批规则默认值', () => {
  it('四条出厂规则：执行命令 / 写入命令 / 写文件 / 改文件，全部要问', () => {
    expect(DEFAULT_POLICY.enabled).toBe(true)
    expect(DEFAULT_POLICY.rules.map((r) => r.pattern)).toEqual([
      'exec_command',
      'input_command',
      'write_file',
      'edit_file',
    ])
    expect(DEFAULT_POLICY.rules.every((r) => r.ask)).toBe(true)
  })
})
