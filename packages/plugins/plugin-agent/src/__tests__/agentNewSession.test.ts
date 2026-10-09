/**
 * newSession（用户口径 2026-10-09）：「新建对话」后上一个会话的**目标条还挂着**。
 *
 * 真机复现：打开一个带目标的会话（界面显示「目标第 5 轮 · 3.7k / 400k」），点「新建对话」，
 * 消息清空了，但目标条原样留在新对话的输入区里 —— 目标本该属于**那一条会话**，不该跟着新对话。
 * 根因：newSession() 只清 model / sessionId / title，没清 goal / goalPaused / queue / running，
 * 也没断开旧会话的常驻流（那条流还会把旧会话的 goal_state 推回来）。
 */
import { describe, it, expect } from 'vitest'
import { createAgentService } from '../agentService'

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function fakeFetch(routes: Array<[string, () => Response]>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const [key, make] of routes) if (url.includes(key)) return make()
    return json({ ok: true })
  }) as typeof fetch
}

describe('新建对话清空会话级状态（目标 / 队列 / 运行态）', () => {
  it('newSession 后 goal / goalPaused / queue / running 全部归零', async () => {
    const fetchImpl = fakeFetch([
      ['/sessions', () => json({ ok: true, sessions: [], parents: {} })],
      ['/api/agent/config', () => json({ models: [], providers: [], skills: [], mcpServers: [], catalog: [] })],
      ['/prompts', () => json({ prompts: [] })],
      ['/policy', () => json({ policy: { enabled: true, rules: [] } })],
    ])
    const orig = globalThis.fetch
    globalThis.fetch = fetchImpl
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.refresh()
      // 模拟「上一条会话正带着目标在跑」
      const s = svc.state as unknown as Record<string, unknown>
      s.goal = { objective: '上一会话的目标', status: 'active', budget: 400000, round: 5, tokensUsed: 3700 }
      s.goalPaused = true
      s.queue = { paused: true, items: [{ id: 'q1', text: 'x', state: 'queued', createdAt: 1 }] }
      s.running = true
      s.goalMark = { objective: '草稿目标', budget: 50000 }

      await svc.newSession()

      expect(s.goal).toBeNull()
      expect(s.goalPaused).toBe(false)
      expect(s.queue).toEqual({ paused: false, items: [] })
      expect(s.running).toBe(false)
      expect(s.goalMark).toBeNull()
      expect(s.sessionId).toBeNull()
    } finally {
      globalThis.fetch = orig
    }
  })
})
