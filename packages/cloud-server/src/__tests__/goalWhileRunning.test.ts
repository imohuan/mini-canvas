/**
 * 会话**正在跑**时发一个目标 ⇒ 进队列，不假装"已插队" —— 回归测试。
 *
 * 真 bug（代码审查发现的竞态）：跑着的时候直接 `beginGoal`，它先让 start.mjs 写好
 * GOAL.json，再调 startRun —— 而 startRun 在"已经在跑"时返回 `{started:false}`，
 * 这一步就白写了：目标文件躺在那儿、当前轮的 stop hook 下一拍就会读它开始续轮，
 * 可用户的 objective 文本**从没作为消息发出去**（第 1 轮协议文本也一起丢）。
 * 旧实现还回一句 `{steered:true}` —— 其实什么都没送进去，用户看到的是"目标没反应"。
 *
 * 修法：与"跑着时发普通消息"完全一致 —— 进队列（条目带 goal），轮到它时由调度器
 * 走 startGoal（设计 §3.3.3 / G2）。
 */
import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'

const fakeRuntime = () => ({
  isRunning: () => true,
  isSteerable: () => true,
  steerInto: async () => true,
  pendingApprovals: () => [],
  abort: () => undefined,
  forget: () => undefined,
  startRun: async () => ({ started: false }),
})

it('在跑的会话上发目标 ⇒ 进队列（带 goal），不调 beginGoal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-running-'))
  try {
    const store = new AgentSessionStore(root)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    let began = 0
    const goalRuntime = {
      beginGoal: async () => { began++; return { started: true } },
      updateGoal: async () => null,
      pauseGoal: async () => true,
      resumeGoal: async () => ({ started: false }),
      endGoal: async () => true,
    }
    const pushed: Array<Record<string, unknown>> = []
    const hub = {
      append: (_c: string, _s: string, ev: Record<string, unknown>) => { pushed.push(ev) },
      subscribe: () => ({ unsubscribe: () => undefined }),
      // 正在跑 —— 这正是本用例要覆盖的那条分支
      isRunning: () => true,
      commitSeq: () => 0,
      lastSeq: () => 0,
    }
    let ticked = 0
    const app = new Hono()
    app.route('/', agentSessionRoutes(
      store, fakeRuntime() as never, { dataDir: root, modelContextWindow: async () => undefined } as never,
      undefined, undefined, hub as never,
      () => { ticked++ },
      undefined,
      goalRuntime as never,
    ))

    const res = await app.request('/api/agent/canvases/c1/sessions/s1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '把测试跑绿', goal: { objective: '把测试跑绿', budget: 5000 } }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, queued: true, goal: true })
    // 没有直接 beginGoal（那一步会写一份没人用的 GOAL.json）
    expect(began).toBe(0)
    // 条目真的进了队列，且带 goal
    const q = await store.getQueue('c1', 's1')
    expect(q.items).toHaveLength(1)
    expect(q.items[0]).toMatchObject({
      text: '把测试跑绿',
      state: 'queued',
      goal: { objective: '把测试跑绿', budget: 5000 },
    })
    // 队列变化广播出去了 + 给了调度器一次机会
    expect(pushed.some((e) => e.type === 'queue')).toBe(true)
    expect(ticked).toBeGreaterThan(0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
