/**
 * 未注册的 /api/* 必须回 404 JSON，不能落到 SPA 兜底。
 *
 * 为什么重要：插件卸载 / 调试开关没开时，前端请求那个接口会拿到 200 的 index.html，
 * 解析 JSON 直接炸，报错信息与真实原因完全对不上（真机踩过）。
 */
import { describe, expect, it } from 'vitest'
import { createServerFramework } from '../serverFramework/index.js'

describe('api-not-found 兜底', () => {
  it('未注册的 GET/POST /api/* → 404 JSON 且带路径', async () => {
    // hotFallback：真实 cloud-server 开的就是这个（见 createServerFramework 的说明）
    const host = createServerFramework({ hotFallback: true })
    await host.start()
    try {
      for (const [method, path] of [
        ['GET', '/api/nope'],
        ['POST', '/api/plugin-presence/heartbeat'],
      ] as const) {
        const res = await host.app.fetch(new Request('http://x' + path, { method }))
        expect(res.status, method + ' ' + path).toBe(404)
        const body = (await res.json()) as { ok?: boolean; error?: string }
        expect(body.ok).toBe(false)
        expect(String(body.error)).toContain(path)
      }
    } finally {
      host.ctx.stop()
    }
  })

  it('页面路由不受影响（仍然落到外层 SPA，不 404）', async () => {
    const host = createServerFramework({ hotFallback: true })
    await host.start(() => {
      host.app.get('*', (c) => c.html('<html>spa</html>'))
    })
    try {
      const res = await host.app.fetch(new Request('http://x/canvas/abc'))
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('spa')
    } finally {
      host.ctx.stop()
    }
  })
})
