/**
 * agentService 回归测试：在历史会话 / 分支上继续对话**不能**静默新建会话。
 *
 * 背景（实测 bug 2026-10-06）：打开历史会话时 sessionPromptText=''（提示词未知），
 * ensurePromptFresh 把「未知 != 当前选择的提示词」误判成「提示词变了」→ newSession()，
 * 用户看到「在分支上继续对话，却给我新开了一个对话」。
 */
import { describe, it, expect, vi } from 'vitest'
import { createAgentService } from '../agentService'

/** 造一个最小的假 fetch：按 URL 返回固定 JSON / SSE */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    for (const [key, make] of Object.entries(routes)) {
      if (url.includes(key)) return make()
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const sse = (frames: string[]): Response => {
  const enc = new TextEncoder()
  const chunks = frames.map((f) => enc.encode(f))
  let i = 0
  return new Response(
    new ReadableStream({
      pull(ctrl) {
        if (i >= chunks.length) { ctrl.close(); return }
        ctrl.enqueue(chunks[i++])
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('在历史会话上继续对话', () => {
  it('提示词未知时不换会话：消息发给当前这条（不调 createSession）', async () => {
    let created = 0
    let sentTo = ''
    const fetchImpl = fakeFetch({
      '/fork': () => json({ ok: true, sessionId: 'new-s', parentId: 'old-s', copied: 1 }),
      '/messages': () => { return sse(['data: {"type":"text","text":"好","final":true}\n\n', 'data: {"type":"done"}\n\n']) },
      '/branch-info': () => json({ ok: true, points: [] }),
      '/sessions/hist-1': () => json({
        ok: true,
        session: {
          id: 'hist-1', title: '历史对话', createdAt: 1, updatedAt: 2,
          provider: 'p', modelId: 'm', turns: [{ role: 'user', text: '早先的话', ts: 1 }],
        },
      }),
      '/sessions': (() => { return json({ ok: true, sessions: [{ id: 'hist-1', title: '历史对话', createdAt: 1, updatedAt: 2 }], parents: {} }) }) as never,
      '/api/agent/config': () => json({ models: [{ provider: 'p', modelId: 'm', hasKey: true }], providers: [], skills: [], mcpServers: [], catalog: [] }),
      '/prompts': () => json({ prompts: [{ id: 'x', name: '全能创作', text: '你是全能创作助手' }] }),
      '/policy': () => json({ policy: { enabled: true, rules: [] } }),
    })
    // createSession 走 POST /sessions（上面已给）；用计数器包一层
    const wrapped: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/sessions') && (init?.method ?? 'GET') === 'POST') created++
      if (url.includes('/messages')) sentTo = url
      return fetchImpl(input, init)
    }
    const svc = createAgentService({ baseUrl: '' })
    // 通过真实 API 替换 fetch
    ;(svc as unknown as { __setFetch?: unknown }).__setFetch
    // agentService 内部自建 AgentApi：直接注入 fetchImpl 不可行 —— 改用真实接口打桩
    // 这里用 monkey patch globalThis.fetch
    const orig = globalThis.fetch
    globalThis.fetch = wrapped
    try {
      await svc.refresh()
      await svc.openSession('hist-1')
      expect(svc.state.sessionId).toBe('hist-1')
      await svc.send('继续聊')
      // 核心断言：没有新建会话，消息发给了 hist-1
      expect(created).toBe(0)
      expect(sentTo).toContain('/sessions/hist-1/messages')
      expect(svc.state.sessionId).toBe('hist-1')
    } finally {
      globalThis.fetch = orig
    }
  })
})

