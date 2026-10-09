/**
 * 目标的 end op（用户口径 2026-10-09）：「目标那一栏……没有删除按钮」。
 *
 * 路由层的守卫：end 与 pause/resume 一样**不需要正文**，少列一个 op 就会被挡成 400。
 * 这里用假 goalRuntime 验「路由确实把 end 转给了运行时，并把结果回给界面」。
 */
import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'

const fakeRuntime = () => ({
  isRunning: () => false,
  isSteerable: () => false,
  steerInto: async () => false,
  pendingApprovals: () => [],
  abort: () => undefined,
  forget: () => undefined,
})

it('goal op=end ⇒ 调运行时 endGoal 并回 {ended:true}', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-end-route-'))
  try {
    const store = new AgentSessionStore(root)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    let called = 0
    const goalRuntime = {
      beginGoal: async () => ({ started: true }),
      updateGoal: async () => null,
      pauseGoal: async () => true,
      resumeGoal: async () => ({ started: false }),
      endGoal: async () => { called++; return true },
    }
    const app = new Hono()
    app.route('/', agentSessionRoutes(
      store,
      fakeRuntime() as never,
      { dataDir: root, modelContextWindow: async () => undefined } as never,
      undefined, undefined, undefined, undefined, undefined, goalRuntime as never,
    ))
    const res = await app.request('/api/agent/canvases/c1/sessions/s1/goal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'end' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, ended: true })
    expect(called).toBe(1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
