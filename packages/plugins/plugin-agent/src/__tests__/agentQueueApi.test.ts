/**
 * 队列/目标的 HTTP 面（设计 §3.3 / §3.4）。
 *
 * 这层钉住的是"前端往后端打的请求形状" —— 路径、body、事件分发。
 * 真相（该不该发、发没发过）在后端，前端只管说对话。
 */
import { describe, it, expect, vi } from 'vitest'
import { AgentApi, type ChatEvent } from '../agentApi.js'

/** 造一个记录请求、可编排响应的假 fetch */
function makeFetch(responses: Array<unknown>, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const body = responses[Math.min(i, responses.length - 1)]
    i += 1
    return new Response(JSON.stringify(body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { f, calls }
}

describe('队列 HTTP 面', () => {
  it('queueOp 打到 /queue，body 原样', async () => {
    const { f, calls } = makeFetch([{ ok: true, queue: { paused: false, items: [] } }])
    const api = new AgentApi({ fetchImpl: f })
    await api.queueOp('c1', 's1', { op: 'add', text: '你好' })
    expect(calls[0].url).toBe('/api/agent/canvases/c1/sessions/s1/queue')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ op: 'add', text: '你好' })
  })

  it('七种 op 都能过（add/update/remove/close/cancel-edit/pause/resume）', async () => {
    const ops = ['add', 'update', 'remove', 'close', 'cancel-edit', 'pause', 'resume'] as const
    const { f, calls } = makeFetch([{ ok: true }])
    const api = new AgentApi({ fetchImpl: f })
    for (const op of ops) await api.queueOp('c1', 's1', { op, itemId: 'q1', text: 'x' })
    expect(calls).toHaveLength(7)
    expect(calls.map((c) => JSON.parse(String(c.init?.body)).op)).toEqual([...ops])
  })

  it('引导打到 /queue/:id/steer（id 做了 URL 编码）', async () => {
    const { f, calls } = makeFetch([{ ok: true, steered: true }])
    const api = new AgentApi({ fetchImpl: f })
    const r = await api.steerQueueItem('c1', 's1', 'q/a b')
    expect(calls[0].url).toBe('/api/agent/canvases/c1/sessions/s1/queue/q%2Fa%20b/steer')
    expect(r.steered).toBe(true)
  })

  it('目标三种 op', async () => {
    const { f, calls } = makeFetch([{ ok: true }])
    const api = new AgentApi({ fetchImpl: f })
    await api.goalOp('c1', 's1', { op: 'update', budget: 50000 })
    await api.goalOp('c1', 's1', { op: 'pause' })
    await api.goalOp('c1', 's1', { op: 'resume' })
    expect(calls.map((c) => c.url)).toEqual([
      '/api/agent/canvases/c1/sessions/s1/goal',
      '/api/agent/canvases/c1/sessions/s1/goal',
      '/api/agent/canvases/c1/sessions/s1/goal',
    ])
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ op: 'pause' })
  })

  it('sessionState 带上队列/目标/运行态（刷新恢复的那一条）', async () => {
    const payload = {
      session: { id: 's1', title: 't', turns: [] },
      running: true,
      queue: { paused: true, items: [{ id: 'q1', text: 'a', state: 'queued', createdAt: 1 }] },
      goal: { objective: 'x', status: 'active', budget: 100, round: 2, tokensUsed: 5 },
      goalPaused: false,
      seq: 12,
      lastSeq: 15,
    }
    const { f } = makeFetch([payload])
    const api = new AgentApi({ fetchImpl: f })
    const full = await api.sessionState('c1', 's1')
    expect(full.running).toBe(true)
    expect(full.queue.paused).toBe(true)
    expect(full.queue.items[0].id).toBe('q1')
    expect(full.goal?.round).toBe(2)
  })

  it('发送带 goal 的消息：body 里有 goal 字段', async () => {
    const { f, calls } = makeFetch([{}])
    const api = new AgentApi({ fetchImpl: f })
    // sendMessage 会读 res.body，假 fetch 给的是空 body —— 用 catch 忽略后续解析
    await api
      .sendMessage('c1', 's1', '目标文本', { goal: { objective: '把测试跑绿', budget: 50000 } }, () => undefined)
      .catch(() => undefined)
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.text).toBe('目标文本')
    expect(body.goal).toEqual({ objective: '把测试跑绿', budget: 50000 })
  })

  it('新的事件类型能进来（queue / run_state / goal_state / queue_idle / round_done）', () => {
    // 类型层验收：这些形状必须能赋给 ChatEvent（编不过就说明事件表漏了）
    const evs: ChatEvent[] = [
      { type: 'queue', queue: { paused: false, items: [] } },
      { type: 'run_state', running: true },
      { type: 'goal_state', goal: null },
      { type: 'queue_idle' },
      { type: 'round_done' },
    ]
    expect(evs.map((e) => e.type)).toEqual(['queue', 'run_state', 'goal_state', 'queue_idle', 'round_done'])
  })
})
