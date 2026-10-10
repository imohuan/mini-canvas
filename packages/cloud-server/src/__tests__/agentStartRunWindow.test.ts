/**
 * startRun 的两个坑（代码审查实测）：
 *
 * 1. **装载窗口里点停止会被丢掉**：首次在这条会话上发送时 ensureSession 会先走
 *    resumeSession（几百毫秒到几秒），而界面按下发送那一刻就把按钮变成了停止。
 *    用户在这个窗口里点停止时 hub 还没 running、runtime 还没 entry —— 没人接，
 *    装载完那一轮照跑到底（"停了没反应，随后按钮又变红"）。
 * 2. **并发发送静默丢失**：已经在跑时 startRun 返回 started:false，而旧的 startRun
 *    走的是"什么都不做"——消息不进模型、不进转录、也不进队列。
 *
 * 这里锁住 runtime 层的语义（路由落队列的部分见 agentConcurrentSendQueue）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRuntime } from '../agent/runtime.js'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { SessionHub } from '../agent/sessionHub.js'

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-window-'))
  store = new AgentSessionStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 假 SDK 会话：可控制 resume 的时长，run 一开跑就把信号记下来 */
function makeSession(opts: { resumeDelayMs?: number } = {}) {
  const seenSignals: boolean[] = []
  const session = {
    sessionId: 's1',
    provider: 'p',
    modelId: 'm',
    seenSignals,
    async *run(_messages: unknown[], runOpts?: { signal?: AbortSignal }) {
      seenSignals.push(runOpts?.signal?.aborted === true)
      yield { type: 'session_meta', payload: { session_id: 's1', model_context_window: 1000 } }
      yield { type: 'model_msg', payload: { type: 'text', text: 'done', role: 'assistant' } }
    },
  }
  const agent = {
    async createSession() {
      return session
    },
    async resumeSession() {
      if (opts.resumeDelayMs) await new Promise((r) => setTimeout(r, opts.resumeDelayMs))
      return session
    },
  }
  return { session, agent }
}

function makeRuntime(agent: unknown, hub: SessionHub) {
  return new AgentRuntime({
    root,
    store,
    agent: async () => agent as never,
    makeUserMessage: (text: string) => ({ kind: 'user', text }),
    hub,
    log: () => undefined,
  } as never)
}

describe('startRun：装载窗口里点停止不被丢掉', () => {
  it('ensureSession 装载期间 abort ⇒ 这一轮根本不跑（signal 从没被用过）', async () => {
    const { session, agent } = makeSession({ resumeDelayMs: 60 })
    const hub = new SessionHub()
    const rt = makeRuntime(agent, hub)
    // 磁盘上有转录 ⇒ 走 resumeSession（慢装载）这条路径
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })

    const started = rt.startRun('c1', { canvasId: 'c1', sessionId: 's1', text: '跑一句' })
    // 装载还没结束就点停止
    await new Promise((r) => setTimeout(r, 15))
    rt.abort('c1', 's1')
    const outcome = await started

    expect(outcome.started).toBe(false)
    // 等一会儿确认根本没有 run 被启动（有的话 seenSignals 会多一条）
    await new Promise((r) => setTimeout(r, 60))
    expect(session.seenSignals).toHaveLength(0)
  })

  it('没有下过停止 ⇒ 正常运行', async () => {
    const { session, agent } = makeSession()
    const hub = new SessionHub()
    const rt = makeRuntime(agent, hub)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const outcome = await rt.startRun('c1', { canvasId: 'c1', sessionId: 's1', text: '跑一句' })
    expect(outcome.started).toBe(true)
    for (let i = 0; i < 60 && session.seenSignals.length === 0; i++) await new Promise((r) => setTimeout(r, 10))
    expect(session.seenSignals).toHaveLength(1)
    // 这一轮跑完了（hub 空闲）
    for (let i = 0; i < 60 && hub.isRunning('c1', 's1'); i++) await new Promise((r) => setTimeout(r, 10))
    expect(hub.isRunning('c1', 's1')).toBe(false)
  })
})

describe('startRun：已经在跑返回 started:false（交给上层进队列）', () => {
  it('同一会话第二次 startRun ⇒ started:false，且不报错', async () => {
    const { agent } = makeSession()
    const hub = new SessionHub()
    const rt = makeRuntime(agent, hub)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const first = await rt.startRun('c1', { canvasId: 'c1', sessionId: 's1', text: '一' })
    expect(first.started).toBe(true)
    // 立刻再发（这时第一轮还在跑）
    for (let i = 0; i < 60 && !hub.isRunning('c1', 's1'); i++) await new Promise((r) => setTimeout(r, 5))
    const second = await rt.startRun('c1', { canvasId: 'c1', sessionId: 's1', text: '二' })
    expect(second.started).toBe(false)
    expect(second.sessionId).toBe('s1')
    // 等这一轮跑完再退出：否则 afterEach 删临时目录会和后台的转录写入抢（ENOTEMPTY）
    for (let i = 0; i < 200 && hub.isRunning('c1', 's1'); i++) await new Promise((r) => setTimeout(r, 10))
  })
})
