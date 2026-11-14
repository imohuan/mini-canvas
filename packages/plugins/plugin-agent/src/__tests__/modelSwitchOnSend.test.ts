/**
 * 切模型的**时机**（用户 2026-11-14 口径）。
 *
 * 现象：只是在输入区挑了一个模型、一句话都没说，历史里就多出一条分支；同一栏里冒出两个
 * 分页器，对话被切得七零八落。用户要求：**切了模型并且真的发消息**，才算换到新分支。
 *
 * 这里锁三件事：
 *   1. 只调 setModel（不发送）→ 后端**一次 switch-model 都不能有**；
 *   2. 选完模型发一条消息 → 恰好一次 switch-model，并且消息发到**新会话**上；
 *   3. 选的模型与当前会话一致时发送 → 不切会话（不给用户平白长分支）。
 */
import { describe, expect, it } from 'vitest'
import { createAgentService } from '../service/agentService'

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function makeFetch(state: { switchCalls: string[]; sends: string[] }): typeof fetch {
  const sessions = [{ id: 's1', title: '会话', createdAt: 1, updatedAt: 1, provider: 'p', modelId: 'm1' }]
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/api/agent/config')) {
      return json({
        models: [
          { provider: 'p', modelId: 'm1', hasKey: true, isDefault: true },
          { provider: 'p', modelId: 'm2', hasKey: true },
        ],
        providers: [], skills: [], mcpServers: [], catalog: [],
      })
    }
    if (url.includes('/prompts')) return json({ prompts: [] })
    if (url.includes('/policy')) return json({ policy: { enabled: true, rules: [] } })
    if (url.includes('/branch-info')) return json({ ok: true, points: [] })
    if (url.includes('/switch-model')) {
      state.switchCalls.push(url)
      return json({ ok: true, sessionId: 's2', parentId: 's1', copied: 2, point: 'turn:2' })
    }
    if (url.includes('/messages')) {
      state.sends.push(url)
      return new Response('', { status: 204 })
    }
    if (url.includes('/sessions/s2')) {
      return json({ session: { id: 's2', title: '会话', createdAt: 1, updatedAt: 1, turns: [], provider: 'p', modelId: 'm2' }, running: false, queue: { paused: false, items: [] } })
    }
    if (url.includes('/sessions/s1')) {
      return json({ session: { id: 's1', title: '会话', createdAt: 1, updatedAt: 1, turns: [{ role: 'user', text: 'hi', ts: 1 }, { role: 'assistant', text: 'yo', ts: 2 }], provider: 'p', modelId: 'm1' }, running: false, queue: { paused: false, items: [] } })
    }
    if (url.includes('/sessions') && method === 'GET') return json({ ok: true, sessions, parents: {} })
    return json({ ok: true })
  }) as typeof fetch
}

describe('切模型只在真正发消息时建分支', () => {
  it('只选模型不发送：不产生 switch-model', async () => {
    const orig = globalThis.fetch
    const state = { switchCalls: [] as string[], sends: [] as string[] }
    globalThis.fetch = makeFetch(state)
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.openSession('s1')
      await svc.setModel('p', 'm2')
      expect(svc.state.model).toEqual({ provider: 'p', modelId: 'm2' })
      expect(state.switchCalls).toEqual([])
    } finally {
      globalThis.fetch = orig
    }
  })

  it('选完模型再发消息：切一次会话，消息发到新会话', async () => {
    const orig = globalThis.fetch
    const state = { switchCalls: [] as string[], sends: [] as string[] }
    globalThis.fetch = makeFetch(state)
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.openSession('s1')
      await svc.setModel('p', 'm2')
      expect(state.switchCalls).toHaveLength(0)
      await svc.send('接着聊')
      expect(state.switchCalls).toHaveLength(1)
      expect(state.sends).toHaveLength(1)
      expect(state.sends[0]).toContain('/s2/')
    } finally {
      globalThis.fetch = orig
    }
  })

  it('选的模型就是当前会话的模型：发送不切会话', async () => {
    const orig = globalThis.fetch
    const state = { switchCalls: [] as string[], sends: [] as string[] }
    globalThis.fetch = makeFetch(state)
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.openSession('s1')
      await svc.send('同样的模型')
      expect(state.switchCalls).toHaveLength(0)
      expect(state.sends[0]).toContain('/s1/')
    } finally {
      globalThis.fetch = orig
    }
  })
})
