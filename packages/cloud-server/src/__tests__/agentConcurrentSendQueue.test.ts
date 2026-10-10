/**
 * 并发发送不再静默丢失：已经在跑 ⇒ 进队列（设计 G2）—— 回归测试。
 *
 * 真缺陷（代码审查实测）：runtime.startRun 在"已经在跑"时返回 started:false，
 * 而路由把它当成"已 steer"直接回 `{steered:true}` —— 其实这一句
 * 既没进模型、也没进转录、也没进队列，凭空消失。多标签页 / 双客户端 / 常驻流断线
 * 期间的并发发送都会命中。
 *
 * 修法：`started:false` ⇒ 落进队列（与"跑着发普通消息"同一条路），并给调度器一次机会。
 */
import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'

it('已经在跑时再发普通消息 ⇒ 进队列（不静默丢）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'concurrent-send-'))
  try {
    const store = new AgentSessionStore(root)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    // runtime 说"起不来"（已经有 run 在跑）—— 这正是要覆盖的分支
    const runtime = {
      isRunning: () => true,
      isSteerable: () => false,
      steerInto: async () => false,
      pendingApprovals: () => [],
      abort: () => undefined,
      forget: () => undefined,
      startRun: async () => ({ started: false, sessionId: 's1' }),
    }
    const pushed: Array<Record<string, unknown>> = []
    const hub = {
      append: (_c: string, _s: string, ev: Record<string, unknown>) => { pushed.push(ev) },
      subscribe: () => ({ unsubscribe: () => undefined }),
      isRunning: () => true,
      commitSeq: () => 0,
      lastSeq: () => 0,
    }
    let ticked = 0
    const app = new Hono()
    app.route('/', agentSessionRoutes(
      store, runtime as never, { dataDir: root, modelContextWindow: async () => undefined } as never,
      undefined, undefined, hub as never,
      () => { ticked++ },
      undefined, undefined,
    ))

    const res = await app.request('/api/agent/canvases/c1/sessions/s1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '并发的那一句' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ok: true, queued: true })
    // 条目真的进了队列（不丢）
    const q = await store.getQueue('c1', 's1')
    expect(q.items).toHaveLength(1)
    expect(q.items[0]).toMatchObject({ text: '并发的那一句', state: 'queued' })
    // 广播 + 调度机会都给了
    expect(pushed.some((e) => e.type === 'queue')).toBe(true)
    expect(ticked).toBeGreaterThan(0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
