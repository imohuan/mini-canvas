/**
 * 刷新 / 切会话后，**挂起中的审批**要补成卡片。
 *
 * 真 bug（用户实测 2026-10-10）：审批只在「发生的那一刻」经 SSE 推一次，
 * 页面刷新后事件早没了，界面就把它丢了；而后台仍停在原地等这张卡片 ——
 * 这一轮永远结束不了，输入框右下角按钮永远显示「停止」，点它也没用。
 *
 * 修法：openSession 读 GET 会话返回的 approvals，补渲染成审批卡片。
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

const baseRoutes = (sessionExtra: Record<string, unknown>): Array<[string, () => Response]> => [
  [
    '/sessions/hist-1',
    () =>
      json({
        ok: true,
        session: {
          id: 'hist-1',
          title: '历史对话',
          createdAt: 1,
          updatedAt: 2,
          provider: 'p',
          modelId: 'm',
          turns: [
            { role: 'user', text: '跑个命令', ts: 1 },
            { role: 'tool', text: 'exec_command({})', tool: { id: 'c1', name: 'exec_command', arguments: '{}', card: true } },
          ],
        },
        running: true,
        queue: { paused: false, items: [] },
        ...sessionExtra,
      }),
  ],
  ['/sessions', () => json({ ok: true, sessions: [], parents: {} })],
  ['/api/agent/config', () => json({ models: [{ provider: 'p', modelId: 'm', hasKey: true }], providers: [], skills: [], mcpServers: [], catalog: [] })],
  ['/prompts', () => json({ prompts: [] })],
  ['/policy', () => json({ policy: { enabled: true, rules: [] } })],
]

async function withService(
  routes: Array<[string, () => Response]>,
  fn: (svc: ReturnType<typeof createAgentService>) => Promise<void>,
): Promise<void> {
  const orig = globalThis.fetch
  globalThis.fetch = fakeFetch(routes)
  try {
    const svc = createAgentService({ baseUrl: '' })
    await svc.refresh()
    await fn(svc)
  } finally {
    globalThis.fetch = orig
  }
}

describe('挂起审批的补渲染', () => {
  it('openSession：GET 返回 approvals ⇒ 界面上补出审批卡片（可点）', async () => {
    await withService(
      baseRoutes({ approvals: [{ id: 'ap-1', toolName: 'exec_command', arguments: '{"cmd":"ls"}', createdAt: 5 }] }),
      async (svc) => {
        await svc.openSession('hist-1')
        const cards = svc.state.turns.filter((t) => t.kind === 'approval')
        expect(cards).toHaveLength(1)
        expect(cards[0].approval).toMatchObject({ id: 'ap-1', toolName: 'exec_command' })
        // 还没决定 ⇒ 卡片上是要按钮的（界面靠 decision 判结果态）
        expect(cards[0].approval?.decision).toBeUndefined()
      },
    )
  })

  it('approvals 为空 / 缺字段：不补卡片、也不报错', async () => {
    await withService(baseRoutes({}), async (svc) => {
      await svc.openSession('hist-1')
      expect(svc.state.turns.filter((t) => t.kind === 'approval')).toHaveLength(0)
      expect(svc.state.error).toBe('')
    })
  })
})
