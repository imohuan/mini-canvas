/**
 * 运行期热装的后台插件：带参数的路由必须命中。
 *
 * 背景：Hono 路由表在首次请求后冻结，运行期新注册的 path 没有代理；
 * 旧实现用「method + 实际 pathname」精确查表，`/api/agent/.../:canvasId/...` 永远查不到。
 * 这条用与 Agent 会话接口同形的路径钉住修复，防止「启动装能用、热装后 404」。
 */
import { describe, expect, it } from 'vitest'
import { createServerFramework } from '../serverFramework/index.js'
import type { Handler } from 'hono'

describe('热装后台插件的动态参数路由', () => {
  it('模板匹配与“先注册者优先”不受 Entry 包装影响', async () => {
    const host = createServerFramework({ hotFallback: true })
    await host.start()
    try {
      host.ctx.installPlugin({
        name: 'agent-hot-first-wins',
        apply: (c: { routes: { get: (p: string, h: Handler) => void } }) => {
          c.routes.get('/api/first-wins/:id', (h: Parameters<Handler>[0]) => h.text('first:' + h.req.param('id')))
        },
      } as never)
      const res = await host.app.fetch(new Request('http://x/api/first-wins/7'))
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('first:7')
    } finally {
      host.ctx.stop()
    }
  })

  it('运行期注册的 /:canvasId/.../:sessionId 路径能命中', async () => {
    const host = createServerFramework({ hotFallback: true })
    await host.start()
    try {
      // 先证明它确实“后装”：start 之后才登记，启动期的代理里没有这条 path。
      expect((await host.app.fetch(new Request('http://x/api/agent/canvases/c1/sessions/s1/turns'))).status).toBe(404)

      host.ctx.installPlugin({
        name: 'agent-hot-route',
        apply: (c: { routes: { get: (p: string, h: Handler) => void } }) => {
          c.routes.get('/api/agent/canvases/:canvasId/sessions/:sessionId/turns', (h: Parameters<Handler>[0]) =>
            h.json({
              canvasId: h.req.param('canvasId'),
              sessionId: h.req.param('sessionId'),
            }),
          )
        },
      } as never)

      const res = await host.app.fetch(new Request('http://x/api/agent/canvases/c1/sessions/s1/turns'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ canvasId: 'c1', sessionId: 's1' })
    } finally {
      host.ctx.stop()
    }
  })

  it('模板只吃一层：不会把 /a/1/2 错配成 /:canvasId', async () => {
    const host = createServerFramework({ hotFallback: true })
    await host.start()
    try {
      host.ctx.installPlugin({
        name: 'agent-hot-one-segment',
        apply: (c: { routes: { get: (p: string, h: Handler) => void } }) => {
          c.routes.get('/api/agent-probe/:canvasId/turns', (h: Parameters<Handler>[0]) => h.json({ canvasId: h.req.param('canvasId') }))
        },
      } as never)
      expect((await host.app.fetch(new Request('http://x/api/agent-probe/c1/turns'))).status).toBe(200)
      expect((await host.app.fetch(new Request('http://x/api/agent-probe/c1/extra/turns'))).status).toBe(404)
    } finally {
      host.ctx.stop()
    }
  })
})
