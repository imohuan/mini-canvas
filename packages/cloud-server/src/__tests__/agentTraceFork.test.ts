import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { seedForkTrace, tracesDirOf } from '../agent/traceFork'
import { AgentSessionStore } from '../agent/sessionStore'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-tracefork-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function writeParentTrace(sessionId: string, provider = 'local', model = 'deepseek-auto') {
  const date = sessionId.slice('session-'.length, 'session-2026-10-06'.length)
  const dirPath = path.join(tracesDirOf(dir), date)
  await fs.mkdir(dirPath, { recursive: true })
  const file = path.join(dirPath, sessionId + '_001.jsonl')
  const meta = {
    timestamp: '2026-10-06T00:00:00.000Z',
    type: 'session_meta',
    payload: {
      session_id: sessionId,
      provider,
      model_id: model,
      model_context_window: 1048576,
      system_prompt: '你是 mini-canvas 画布助手。',
    },
  }
  const msg = {
    timestamp: '2026-10-06T00:00:01.000Z',
    type: 'model_msg',
    payload: { type: 'text', role: 'user', text: '你好', stop_reason: 'completed' },
  }
  await fs.writeFile(file, JSON.stringify(meta) + '\n' + JSON.stringify(msg) + '\n', 'utf8')
}

async function readLines(sessionId: string) {
  const date = sessionId.slice('session-'.length, 'session-2026-10-06'.length)
  const file = path.join(tracesDirOf(dir), date, sessionId + '_001.jsonl')
  const text = await fs.readFile(file, 'utf8')
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>)
}

describe('seedForkTrace', () => {
  it('父 Trace 存在：session_meta 从父拷贝（改 session_id），回合按 OmniMessage 形态落盘', async () => {
    const parent = 'session-2026-10-06-10-00-00-aaaa0000'
    const fork = 'session-2026-10-06-11-00-00-bbbb0000'
    await writeParentTrace(parent)
    const store = new AgentSessionStore(dir)
    await store.ensure('c1', { id: fork, title: 't', createdAt: 1, provider: 'local', modelId: 'deepseek-auto' })
    await store.appendTurn('c1', fork, { role: 'user', text: '第一条', ts: 1 })
    await store.appendTurn('c1', fork, { role: 'assistant', text: '答一', ts: 2 })
    await store.appendTurn('c1', fork, { role: 'tool', text: 't()', ts: 3, tool: { id: 'call_x', name: 'canvas_get', arguments: '{}', output: '{"ok":true}' } })
    const turns = (await store.get('c1', fork))?.turns ?? []

    const file = await seedForkTrace(dir, { parentSessionId: parent, forkSessionId: fork, canvasId: 'c1', turns })
    expect(file.endsWith(fork + '_001.jsonl')).toBe(true)

    const lines = await readLines(fork)
    expect(lines[0].type).toBe('session_meta')
    expect(lines[0].payload.session_id).toBe(fork)
    // meta 其余字段从父拷贝
    expect(lines[0].payload.model_context_window).toBe(1048576)
    expect(lines[0].payload.system_prompt).toBe('你是 mini-canvas 画布助手。')
    const kinds = lines.slice(1).map((l) => l.payload.type)
    // 结构：user → begin → user?(无) → …（回合包裹后 type 序列）
    expect(kinds).toEqual(['text', 'request_begin', 'text', 'tool_call', 'tool_call_output', 'request_end'])
    const call = lines.find((l) => l.payload.type === 'tool_call')
    expect(call?.payload.tool_call_id).toBe('call_x')
    const out = lines.find((l) => l.payload.type === 'tool_call_output')
    expect(out?.payload.tool_call_id).toBe('call_x')
    expect(out?.payload.output).toBe('{"ok":true}')
  })

  it('父 Trace 缺失：降级写最小合法 meta，回合照写（fork 不被打断）', async () => {
    const parent = 'session-2026-10-06-10-00-00-missing1'
    const fork = 'session-2026-10-06-11-00-00-bbbb0001'
    const store = new AgentSessionStore(dir)
    await store.ensure('c1', { id: fork, title: 't', createdAt: 1, provider: 'local', modelId: 'deepseek-auto' })
    await store.appendTurn('c1', fork, { role: 'user', text: '第一条', ts: 1 })
    const turns = (await store.get('c1', fork))?.turns ?? []

    await seedForkTrace(dir, {
      parentSessionId: parent,
      forkSessionId: fork,
      canvasId: 'c1',
      turns,
      provider: 'local',
      modelId: 'deepseek-auto',
    })
    const lines = await readLines(fork)
    expect(lines[0].type).toBe('session_meta')
    expect(lines[0].payload.session_id).toBe(fork)
    expect(lines[0].payload.provider).toBe('local')
    expect(lines[0].payload.model_id).toBe('deepseek-auto')
    expect(lines[1].payload.type).toBe('text')
    expect(lines[1].payload.text).toBe('第一条')
  })

  it('已存在同名 Trace：报错不覆盖（wx）', async () => {
    const parent = 'session-2026-10-06-10-00-00-cccc0002'
    const fork = 'session-2026-10-06-11-00-00-dddd0002'
    await writeParentTrace(fork) // 预先占位
    await expect(
      seedForkTrace(dir, { parentSessionId: parent, forkSessionId: fork, canvasId: 'c1', turns: [] }),
    ).rejects.toThrow()
  })

  it('工具记录缺少 id（老数据）：只跳过该条，不炸整个种子', async () => {
    const parent = 'session-2026-10-06-10-00-00-eeee0003'
    const fork = 'session-2026-10-06-11-00-00-ffff0003'
    const store = new AgentSessionStore(dir)
    await store.ensure('c1', { id: fork, title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    await store.appendTurn('c1', fork, { role: 'user', text: 'u', ts: 1 })
    // 无 tool.id 的老记录：turnToMessage 返回 null，种子跳过
    await store.appendTurn('c1', fork, { role: 'tool', text: '旧记录', ts: 2, tool: { id: '', name: 'n', arguments: '{}' } })
    const turns = (await store.get('c1', fork))?.turns ?? []

    await seedForkTrace(dir, { parentSessionId: parent, forkSessionId: fork, canvasId: 'c1', turns })
    const lines = await readLines(fork)
    const types = lines.slice(1).map((l) => l.payload.type)
    // user → begin → end（无 assistant 输出）
    expect(types).toEqual(['text', 'request_begin', 'request_end'])
  })
})

describe('seedForkTrace 的回合结构（resumeTrace 可读）', () => {
  it('user 开回合、request_begin/end 包裹 assistant 输出 —— 与 penguin-core 的 Trace 格式一致', async () => {
    const { resumeTrace } = await import('../agent/traceFork.probe')
    const parent = 'session-2026-10-06-10-00-00-gggg0004'
    const fork = 'session-2026-10-06-11-00-00-hhhh0004'
    const store = new AgentSessionStore(dir)
    await store.ensure('c1', { id: fork, title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    await store.appendTurn('c1', fork, { role: 'user', text: '你好', ts: 1 })
    await store.appendTurn('c1', fork, { role: 'assistant', text: '你好呀', ts: 2 })
    const turns = (await store.get('c1', fork))?.turns ?? []
    await seedForkTrace(dir, { parentSessionId: parent, forkSessionId: fork, canvasId: 'c1', turns })

    const file = path.join(tracesDirOf(dir), '2026-10-06', fork + '_001.jsonl')
    const msgs = await resumeTrace(file)
    expect(msgs.map((m: any) => m.payload.role + ':' + m.payload.type)).toEqual([
      'user:text',
      'assistant:text',
    ])
  })
})
