/**
 * `agent.setGoalImages` 必须真的存在 —— 回归测试。
 *
 * 真 bug（代码审查 + packages/ui typecheck 抓到的）：编辑运行中的目标时，组件调
 * `agent.setGoalImages(pics)`（AgentConversation.vue:465），但 AgentService 上
 * **从来没暴露过这个方法** —— 运行时抛「agent.setGoalImages is not a function」，
 * 参考图静默不落盘（界面显示新图，刷新后又没了）。
 *
 * 修法：把口子开在服务上（sendGoal 内部那条 `api.setGoalImages?.()` 保留不动）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentService } from '../agentService'

const HERE = path.dirname(fileURLToPath(import.meta.url))

describe('目标参考图的服务口子', () => {
  it('AgentService 上有 setGoalImages（组件调得到）', () => {
    const svc = createAgentService({ baseUrl: '' })
    expect(typeof svc.setGoalImages).toBe('function')
  })

  it('没有当前会话时是空操作（不炸）', async () => {
    const svc = createAgentService({ baseUrl: '' })
    ;(svc.state as { sessionId: string | null }).sessionId = null
    await expect(svc.setGoalImages(['data:image/png;base64,AAA'])).resolves.toBeUndefined()
  })

  it('有会话时打到 /goal-images（body 是 images）', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const orig = globalThis.fetch
    globalThis.fetch = f
    try {
      const svc = createAgentService({ baseUrl: '' })
      ;(svc.state as { sessionId: string | null }).sessionId = 's1'
      await svc.setGoalImages(['data:image/png;base64,AAA'])
      expect(calls[0].url).toBe('/api/agent/canvases/default/sessions/s1/goal-images')
      expect(calls[0].body).toEqual({ images: ['data:image/png;base64,AAA'] })
    } finally {
      globalThis.fetch = orig
    }
  })
})
