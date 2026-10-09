/**
 * 发消息的 SSE 响应**只收这一轮的事件**（不重放通道里的历史）—— 回归测试。
 *
 * 真 bug（代码审查 + 探针实测）：send 响应是「订阅这一会话的常驻通道」，起点却写成
 * `Number(query.since ?? 0)` —— 前端发消息时不带 since ⇒ 恒为 0 ⇒ 每次都把缓冲里的
 * **全部历史事件**重放一遍。实测：第 2 条消息的响应帧数从 11 涨到 21，正文变成
 * 「回复甲回复甲回复乙回复乙」，界面上冒出重复的用户气泡、run_state 还会中途闪回 false；
 * 缓冲越满重放越大（O(n²)）。
 *
 * 另外锁住：每帧带 `id: <seq>`（前端靠它把重连水位推新 + 去重，见 agentApi.consumeSse）。
 */
import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { SessionHub } from '../agent/sessionHub.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'

/** 订阅通道里已经有历史事件时，send 响应不该把它们重放给本次调用方 */
it('send 响应只收这一轮的事件（不重放通道缓冲里的历史）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'send-replay-'))
  try {
    const store = new AgentSessionStore(root)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const hub = new SessionHub()
    // 先灌一段"上一轮遗留"的历史事件（真实场景：常驻通道从没清过）
    hub.append('c1', 's1', { type: 'notice', message: '上一轮的历史事件' })
    hub.append('c1', 's1', { type: 'text', text: '上一轮的正文', final: true })

    // 假 runtime.startRun：把"这一轮"的事件写进 hub（模拟后台开跑）
    const runtime = {
      isRunning: () => false,
      isSteerable: () => false,
      steerInto: async () => false,
      pendingApprovals: () => [],
      abort: () => undefined,
      forget: () => undefined,
      startRun: async (): Promise<{ started: boolean; sessionId: string }> => {
        hub.append('c1', 's1', { type: 'run_state', running: true })
        hub.append('c1', 's1', { type: 'text', text: '这一轮的正文', final: true })
        hub.append('c1', 's1', { type: 'run_state', running: false })
        return { started: true, sessionId: 's1' }
      },
    }
    const app = new Hono()
    app.route('/', agentSessionRoutes(
      store, runtime as never, { dataDir: root, modelContextWindow: async () => undefined } as never,
      undefined, undefined, hub, undefined, undefined,
    ))

    const res = await app.request('/api/agent/canvases/c1/sessions/s1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '新的一句' }),
    })
    expect(res.status).toBe(200)
    const body = await res.text()
    // 这一轮的正文在
    expect(body).toContain('这一轮的正文')
    // 历史一条都不该重放
    expect(body).not.toContain('上一轮的历史事件')
    expect(body).not.toContain('上一轮的正文')
    // 每帧带 id: <seq>（前端重连水位 + 去重用）。
    // 注意 Hono 的 SSE 顺序是 `data:` 在前、`id:` 在后 —— 客户端解析要按行找，
    // 不能假设 id 在 data 之前（见 agentApi.consumeSse）。
    expect(body).toMatch(/data: \{[^\n]*\}\nid: \d+/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
