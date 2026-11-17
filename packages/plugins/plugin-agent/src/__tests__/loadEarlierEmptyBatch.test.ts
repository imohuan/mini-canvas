/**
 * 顶部「加载更早」拿到**空批次**时必须收手。
 *
 * 用户 2026-11-17 报：界面一直显示「向上滚动查看更早的对话」，滚到顶却什么也不发生。
 * 根因在后端切页（已修），但前端也不该在后端返回空页时反复重试、白耗请求 ——
 * 空批次等于「没有更多」，标记要立刻清掉。
 */
import { describe, it, expect } from 'vitest'
import { createAgentService } from '../service/agentService'

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

function fakeFetch(routes: Array<[string, () => Response]>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const [key, make] of routes) if (url.includes(key)) return make()
    return json({ ok: true })
  }) as typeof fetch
}

describe('加载更早：空批次', () => {
  it('后端回空 turns ⇒ 清掉「还有更早」，不再反复拉', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = fakeFetch([
      [
        '/sessions/hist-1',
        () =>
          json({
            ok: true,
            session: {
              id: 'hist-1',
              title: '长对话',
              createdAt: 1,
              updatedAt: 2,
              provider: 'p',
              modelId: 'm',
              turns: [
                { role: 'user', text: '新问题', ts: 10 },
                { role: 'assistant', text: '新回答', ts: 11 },
              ],
            },
            running: false,
            turnsTotal: 40,
            turnsHaveBefore: true,
            queue: { paused: false, items: [] },
          }),
      ],
      ['/sessions', () => json({ ok: true, sessions: [], parents: {} })],
      ['/api/agent/config', () => json({ models: [], providers: [], skills: [], mcpServers: [], catalog: [] })],
      ['/prompts', () => json({ prompts: [] })],
      ['/policy', () => json({ policy: { enabled: true, rules: [] } })],
    ])
    try {
      const svc = createAgentService({ baseUrl: '' })
      await svc.refresh()
      await svc.openSession('hist-1')
      expect(svc.state.turnsHaveBefore).toBe(true)

      // 第二个请求（带 turnsBefore）返回空页：旧的切页 bug 就是这种形状
      globalThis.fetch = fakeFetch([
        [
          '/sessions/hist-1',
          () =>
            json({
              ok: true,
              session: { id: 'hist-1', turns: [] },
              running: false,
              turnsTotal: 40,
              turnsHaveBefore: true,
              queue: { paused: false, items: [] },
            }),
        ],
        ['/sessions', () => json({ ok: true, sessions: [], parents: {} })],
      ])
      const more = await svc.loadEarlierTurns()
      expect(more).toBe(false)
      expect(svc.state.turnsHaveBefore).toBe(false)
      expect(svc.state.turnsLoadingEarlier).toBe(false)
    } finally {
      globalThis.fetch = orig
    }
  })
})
