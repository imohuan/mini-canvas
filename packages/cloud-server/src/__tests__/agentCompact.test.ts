/**
 * 「压缩」链路（用户口径 2026-10-11）。
 *
 * 锁三件事 —— 每一件都对应一个用户真实感受：
 *  1. 跑着一轮时不能压（压了会把正在写的一轮搅乱），要**如实说**而不是静默 no-op；
 *  2. SDK 说不能压（empty / just_compacted）时要把原因说出来 —— 否则"点了没反应"；
 *  3. 能压时把 compaction_begin / end 原样串出去（界面靠它显示进度与结果）。
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-compact-'))
  store = new AgentSessionStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 假 SDK 会话：compact() 产出成对事件；compactability 可指定 */
function fakeSession(over: Record<string, unknown> = {}) {
  return {
    sessionId: 's-new',
    provider: 'p',
    modelId: 'm',
    run: async function* () {
      yield { type: 'model_msg', payload: { type: 'text', text: 'ok', role: 'assistant' } }
    },
    compact: async function* () {
      yield { type: 'event_msg', payload: { type: 'compaction_begin', reason: 'manual', mode: 'summarize', context: 1000, turns: 3 } }
      yield { type: 'event_msg', payload: { type: 'compaction_end', reason: 'manual', mode: 'summarize', status: 'completed' } }
    },
    compactability: () => 'ok',
    ...over,
  }
}

function makeRuntime(session: Record<string, unknown>) {
  const agent = { createSession: async () => session, resumeSession: async () => session }
  return new AgentRuntime({
    root,
    store,
    agent: async () => agent as never,
    makeUserMessage: (text: string) => ({ kind: 'user', text }),
    makeHarnessMessage: (text: string) => ({ kind: 'harness', text }),
    log: () => undefined,
  } as never)
}

/** 收一份 generator 的全部事件 */
async function collect(gen: AsyncGenerator<unknown>): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  for await (const ev of gen) out.push(ev as Record<string, unknown>)
  return out
}

describe('runtime.compact', () => {
  it('能压：把 compaction_begin / end 串出去', async () => {
    await store.ensure('c1', { id: 's-new', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const rt = makeRuntime(fakeSession())
    const out = await collect(rt.compact('c1', 's-new', new AbortController().signal))
    expect(out.map((e) => e.type)).toEqual(['compact', 'compact'])
    expect(out[0]).toMatchObject({ phase: 'begin', reason: 'manual' })
    expect(out[1]).toMatchObject({ phase: 'end', status: 'completed' })
  })

  it('SDK 说不能压（empty / just_compacted）⇒ 如实说原因，不产出压缩事件', async () => {
    await store.ensure('c1', { id: 's-new', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const rt = makeRuntime(fakeSession({ compactability: () => 'empty' }))
    const out = await collect(rt.compact('c1', 's-new', new AbortController().signal))
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('notice')
    expect(String(out[0].message)).toContain('不用压缩')
  })

  it('会话不支持压缩（老 SDK / 假会话）⇒ 明确报错，不假装成功', async () => {
    await store.ensure('c1', { id: 's-new', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const session = fakeSession()
    delete (session as Record<string, unknown>).compact
    const rt = makeRuntime(session)
    const out = await collect(rt.compact('c1', 's-new', new AbortController().signal))
    expect(out[0]).toMatchObject({ type: 'error' })
    expect(String(out[0].message)).toContain('不支持压缩')
  })

  it('一轮正在跑 ⇒ 拒绝并说明（SDK 只允许在轮次边界压）', async () => {
    await store.ensure('c1', { id: 's-new', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const session = fakeSession()
    const rt = makeRuntime(session)
    // 让这条会话"正在跑"：startRun 需要一个 hub，这里直接用内存态标记
    const internals = rt as unknown as { live: Map<string, { running: boolean }> }
    await rt.ensureSession('c1', { sessionId: 's-new' })
    internals.live.get('c1/s-new')!.running = true
    const out = await collect(rt.compact('c1', 's-new', new AbortController().signal))
    expect(out[0]).toMatchObject({ type: 'error' })
    expect(String(out[0].message)).toContain('等它结束')
  })
})

