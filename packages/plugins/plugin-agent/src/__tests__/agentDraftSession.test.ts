/**
 * 「新建对话」之后再打开面板 / 引用节点，**不能**被打回上一条历史会话。
 *
 * 用户口径（2026-10-12 真机）：面板默认选中最后一条历史对话；点「新建对话」清空后，
 * 右键节点「引用到 Agent」（命令内部走 service.show()），右侧面板又跳回那条老对话。
 *
 * 根因：newSession() 只把 state.sessionId 置空，没有留下「我现在就是要一条空白新会话」的
 * 标记；而 show() / refresh() 都会走 restoreCurrentSession()，它见到 sessionId 为空就取
 * sessions[0]（最近一条历史）装载 —— 用户刚点的「新对话」被当成了「刷新页面，接着看老对话」。
 */
import { describe, it, expect } from 'vitest'
import { createAgentService } from '../agentService'

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const SESSIONS = [{ id: 'hist-1', title: '老对话', createdAt: 1, updatedAt: 9, preview: '老对话的开头' }]

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    // 必须有**带密钥**的模型，否则 ensureSession 直接以「还没配置模型」退出（见 service.needsModel）
    if (url.includes('/api/agent/config')) {
      return json({ models: [{ provider: 'p', modelId: 'm', hasKey: true }], providers: [], skills: [], mcpServers: [], catalog: [] })
    }
    if (url.includes('/prompts')) return json({ prompts: [] })
    if (url.includes('/policy')) return json({ policy: { enabled: true, rules: [] } })
    if (url.includes('/branch-info')) return json({ ok: true, points: [] })
    if (url.includes('/sessions/hist-1')) {
      return json({
        session: { id: 'hist-1', title: '老对话', createdAt: 1, updatedAt: 9, turns: [{ role: 'user', text: '老话', ts: 1 }] },
        running: false,
        queue: { paused: false, items: [] },
      })
    }
    if (url.includes('/sessions')) return json({ ok: true, sessions: SESSIONS, parents: {} })
    return json({ ok: true })
  }) as typeof fetch
}

/** 等 refresh() 那条 fire-and-forget 的链跑完（假 fetch 不碰真实计时器，几轮宏任务足够） */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('新建对话的空白态不被历史会话顶掉', () => {
  it('点「新建对话」后 refresh()（打开面板会调）不再装载最近一条历史', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = fakeFetch()
    try {
      const svc = createAgentService({ baseUrl: '' })
      // ① 首次打开面板：默认装载最近一条历史（既有行为，必须保留）
      await svc.refresh()
      expect(svc.state.sessionId).toBe('hist-1')
      // 回放一条用户消息 = 用户那条 + 它下面的助手落点，共 2 条
      expect(svc.state.turns.length).toBe(2)

      // ② 用户点「新建对话」
      await svc.newSession()
      expect(svc.state.sessionId).toBeNull()

      // ③ 再刷新一次（= show() / 面板重新打开都会走这条路）
      await svc.refresh()
      expect(svc.state.sessionId).toBeNull()
      expect(svc.state.title).toBe('新会话')
      expect(svc.state.turns).toEqual([])
    } finally {
      globalThis.fetch = orig
    }
  })

  it('右键「引用到 Agent」（service.show()）之后仍是空白新会话', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = fakeFetch()
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.refresh()
      await svc.newSession()

      svc.requestNodeRefs(['n1'])
      svc.show()
      await settle()

      expect(svc.state.open).toBe(true)
      expect(svc.state.sessionId).toBeNull()
      expect(svc.state.turns).toEqual([])
      expect(svc.state.pendingNodeRefs).toEqual(['n1'])
    } finally {
      globalThis.fetch = orig
    }
  })

  it('回归：主动打开某条历史会话后，刷新仍停在那条（不被空白态挡住）', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = fakeFetch()
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.refresh()
      await svc.newSession()
      await svc.openSession('hist-1')
      expect(svc.state.sessionId).toBe('hist-1')

      await svc.refresh()
      expect(svc.state.sessionId).toBe('hist-1')
      expect(svc.state.turns.length).toBe(2)
    } finally {
      globalThis.fetch = orig
    }
  })

  it('空白新会话里发出第一句话后：绑定新建的会话，刷新停在那条（draft 已结束）', async () => {
    const orig = globalThis.fetch
    const base = fakeFetch()
    const enc = new TextEncoder()
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      // 建会话
      if (url.endsWith('/sessions') && (init?.method ?? 'GET') === 'POST') return json({ ok: true, id: 'new-1' })
      // 这一轮的 SSE 流
      if (url.includes('/messages')) {
        return new Response(
          new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(enc.encode('data: {"type":"text","text":"好","final":true}\n\n'))
              ctrl.enqueue(enc.encode('data: {"type":"done"}\n\n'))
              ctrl.close()
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        )
      }
      if (url.includes('/sessions/new-1')) {
        return json({
          session: { id: 'new-1', title: '新会话', createdAt: 5, updatedAt: 5, turns: [{ role: 'user', text: '你好', ts: 5 }] },
          running: false,
          queue: { paused: false, items: [] },
        })
      }
      return base(input, init)
    }) as typeof fetch
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.refresh()
      await svc.newSession()
      expect(svc.state.draft).toBe(true)

      await svc.send('你好')
      expect(svc.state.sessionId).toBe('new-1')
      expect(svc.state.draft).toBe(false)

      // 再刷新：停在新建的这条，不会因为历史列表里还有老对话而回到第一条
      await svc.refresh()
      expect(svc.state.sessionId).toBe('new-1')
    } finally {
      globalThis.fetch = orig
    }
  })
})
