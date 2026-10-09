/**
 * AgentRuntime 的目标相关接线（设计 §3.4.2）—— 锁两个真机实测的洞：
 *
 * 1. runUserPromptHook 在会话**还没进内存**时也要能跑（服务重启后 / 这条会话本次
 *    进程第一次被用到）：先 ensureSession 装载，否则 hook 恒返回 null，
 *    官方 start.mjs 的协议文本永远拿不到（日志里一直是「hook 未产出协议文本」）。
 * 2. harnessText 必须以**独立的 harness 消息**进到 run() 的输入里（SDK 靠 sender
 *    戳划轮次边界）；它不该混进用户消息，正文为空时也不该落成空白用户回合。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRuntime } from '../agent/runtime.js'
import { AgentSessionStore } from '../agent/sessionStore.js'

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-goal-'))
  store = new AgentSessionStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 假 SDK 会话：记下 run 收到的消息；带一个 runUserPromptHook */
function fakeSession() {
  const runs: unknown[][] = []
  return {
    sessionId: 's-new',
    provider: 'p',
    modelId: 'm',
    runs,
    run: async function* (messages: unknown[]) {
      runs.push(messages)
      yield { type: 'session_meta', payload: { session_id: 's-new', model_context_window: 1000 } }
      yield { type: 'model_msg', payload: { type: 'text', text: 'ok', role: 'assistant' } }
    },
    runUserPromptHook: async () => ({ context: 'PROTOCOL' }),
  }
}

function makeRuntime(session: ReturnType<typeof fakeSession>, over: Record<string, unknown> = {}) {
  const agent = {
    createSession: async () => session,
    resumeSession: async () => session,
  }
  return new AgentRuntime({
    root,
    store,
    agent: async () => agent as never,
    makeUserMessage: (text: string) => ({ kind: 'user', text }),
    makeHarnessMessage: (text: string) => ({ kind: 'harness', text }),
    log: () => undefined,
    ...over,
  } as never)
}

describe('runUserPromptHook：会话不在内存时先装载', () => {
  it('没有 live 条目时也能跑 hook（否则返回 null）', async () => {
    const session = fakeSession()
    const rt = makeRuntime(session)
    await store.ensure('c1', { id: 's-new', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const r = await rt.runUserPromptHook('c1', 's-new', 'goal', '目标', { budget: 100 })
    expect(r?.context).toBe('PROTOCOL')
  })

  it('会话装不上（建/续都抛错）⇒ 返回 null（调用方走兜底）', async () => {
    const agent = {
      createSession: async () => { throw new Error('no creds') },
      resumeSession: async () => { throw new Error('no creds') },
    }
    const rt = new AgentRuntime({
      root,
      store,
      agent: async () => agent as never,
      makeUserMessage: (text: string) => ({ kind: 'user', text }),
      makeHarnessMessage: (text: string) => ({ kind: 'harness', text }),
      log: () => undefined,
    } as never)
    expect(await rt.runUserPromptHook('c1', 's-ghost', 'goal', 'x')).toBeNull()
  })
})

describe('harnessText 进 run 的输入', () => {
  it('正文之外多一条 harness 消息（不是拼进正文）', async () => {
    const session = fakeSession()
    const rt = makeRuntime(session)
    await store.ensure('c1', { id: 's-new', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    for await (const ev of rt.run('c1', { canvasId: 'c1', sessionId: 's-new', text: '正文', harnessText: 'PROTOCOL' }, new AbortController().signal)) {
      void ev
    }
    const sent = session.runs[0]
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual({ kind: 'user', text: '正文' })
    expect(sent[1]).toEqual({ kind: 'harness', text: 'PROTOCOL' })
  })

  it('正文为空（resume 那种）+ harnessText ⇒ 不落用户回合', async () => {
    const session = fakeSession()
    const rt = makeRuntime(session)
    await store.ensure('c1', { id: 's-new', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    for await (const ev of rt.run('c1', { canvasId: 'c1', sessionId: 's-new', text: '', harnessText: 'PROTOCOL' }, new AbortController().signal)) {
      void ev
    }
    const rec = await store.get('c1', 's-new')
    expect(rec!.turns.filter((t) => t.role === 'user')).toHaveLength(0)
  })
})
