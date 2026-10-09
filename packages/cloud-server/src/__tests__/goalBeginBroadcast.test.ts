/**
 * 目标「开始跑」要广播 goal_state（真机实测的洞）。
 *
 * 现象：在这一页刚发起的那个目标，界面一直不显示目标行（切一下会话才出现）。
 * 根因：目标行靠 goal_state 事件驱动，而此前只有「改预算/暂停/恢复」才广播；
 * 「开始跑」没广播 ⇒ 前端不知道有这个目标。
 */
import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'
import { agentRoot, sessionScratchpadPath } from '../agent/agentPaths.js'

const fakeRuntime = () => ({
  isRunning: () => false,
  isSteerable: () => false,
  steerInto: async () => false,
  pendingApprovals: () => [],
  abort: () => undefined,
  forget: () => undefined,
  startRun: async () => ({ started: true }),
})

it('beginGoal 之后：推一条 goal_state（界面据此画出目标行）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-begin-bcast-'))
  try {
    const store = new AgentSessionStore(root)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const pushed: Array<Record<string, unknown>> = []
    const hub = {
      append: (_c: string, _s: string, ev: Record<string, unknown>) => { pushed.push(ev) },
      subscribe: () => ({ unsubscribe: () => undefined }),
      isRunning: () => false,
      commitSeq: () => 0,
      lastSeq: () => 0,
    }
    const goalRuntime = {
      beginGoal: async () => {
        // 与真实实现一致：先把自己那份 GOAL.json 写到 SDK root 位置
        const scratch = sessionScratchpadPath(agentRoot(root), 's1')
        await fs.mkdir(scratch, { recursive: true })
        await fs.writeFile(
          path.join(scratch, 'GOAL.json'),
          JSON.stringify({ objective: '数到三', status: 'active', budget: 1000, round: 1, tokens_used: 0 }),
        )
        return { started: true }
      },
      updateGoal: async () => null,
      pauseGoal: async () => true,
      resumeGoal: async () => ({ started: false }),
      endGoal: async () => true,
    }
    const app = new Hono()
    app.route('/', agentSessionRoutes(
      store,
      fakeRuntime() as never,
      { dataDir: root, modelContextWindow: async () => undefined } as never,
      undefined, undefined, hub as never, undefined, goalRuntime as never,
    ))
    const res = await app.request('/api/agent/canvases/c1/sessions/s1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '数到三', goal: { objective: '数到三', budget: 1000 } }),
    })
    // 只要没报错（SSE 会挂着；这里不消费流，看广播即可）
    expect(res.status).toBe(200)
    // 等一次微任务（广播是 beginGoal 之后的 then）
    await new Promise((r) => setTimeout(r, 50))
    const goalEv = pushed.find((e) => e.type === 'goal_state')
    expect(goalEv, '应推一条 goal_state').toBeTruthy()
    expect((goalEv!.goal as { objective?: string })?.objective).toBe('数到三')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
