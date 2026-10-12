/**
 * 压缩与其它动作的互斥（code review 2026-10-11 抓到的并发窗口）。
 *
 * SDK 原话：compact 只能在 Task 边界调用。runtime 侧用 entry.compacting 标记
 * 这一窗口 —— run() 看到它就拒绝（否则两条模型请求并发读写同一份上下文）；
 * compact() 自己的 finally 保证标记一定被清掉（中途出错 / 调用方 abort 都不能卡死会话）。
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-compact-mutex-'))
  store = new AgentSessionStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 慢压缩：挂住直到外部放行，观察并发窗口 */
function fakeSession(hold: { promise: Promise<void>; open: () => void }) {
  return {
    sessionId: 's-new',
    provider: 'p',
    modelId: 'm',
    run: async function* () {
      yield { type: 'model_msg', payload: { type: 'text', text: 'ok', role: 'assistant' } }
    },
    compactability: () => 'ok',
    compact: async function* () {
      yield { type: 'event_msg', payload: { type: 'compaction_begin', reason: 'manual', mode: 'summarize' } }
      await hold.promise
      yield { type: 'event_msg', payload: { type: 'compaction_end', reason: 'manual', mode: 'summarize', status: 'completed' } }
    },
  }
}

function makeRuntime(session: unknown) {
  const agent = { createSession: async () => session, resumeSession: async () => session }
  return new AgentRuntime({
    root,
    store,
    agent: async () => agent as never,
    makeUserMessage: (text: string) => ({ kind: 'user', text }),
    log: () => undefined,
  } as never)
}

async function collect(gen: AsyncGenerator<unknown>): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = []
  for await (const ev of gen) out.push(ev as Record<string, unknown>)
  return out
}

describe('压缩与发消息互斥', () => {
  it('压缩进行中发消息 ⇒ 被拒绝（SDK 只允许在 Task 边界压）', async () => {
    await store.ensure('c1', { id: 's-new', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    let open!: () => void
    const hold = new Promise<void>((r) => { open = r })
    const rt = makeRuntime(fakeSession({ promise: hold, open }))
    await rt.ensureSession('c1', { sessionId: 's-new' })
    const compacting = collect(rt.compact('c1', 's-new', new AbortController().signal))
    // 等 compact 进入（begin 已产出，卡在 hold）
    await new Promise((r) => setTimeout(r, 30))
    expect(rt.isCompactActive('c1', 's-new')).toBe(true)
    // 此时发一轮：必须被拒，而不是并发开跑
    const runs = await collect(rt.run('c1', { canvasId: 'c1', sessionId: 's-new', text: 'hi' } as never, new AbortController().signal))
    expect(runs.some((e) => e.type === 'error' && String(e.message).includes('正在压缩'))).toBe(true)
    open()
    await compacting
    // 收尾后标记一定清掉（finally 兜底）
    expect(rt.isCompactActive('c1', 's-new')).toBe(false)
  })
})

