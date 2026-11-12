/**
 * **端到端：Agent 中间件真的挂在真实对话路由上。**
 *
 * `agentMiddleware.test.ts` 只证明中间件链本身能跑；
 * 这条证明它被**接进了真实 SSE 端点** —— 用拦截中间件打真实
 * `/api/agent/canvases/:id/sessions/:sid/messages`，断言没进模型就回了拦截响应。
 *
 * 之所以能在"没配模型"时也验证：拦截发生在调模型**之前**（pre-turn）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-agentmw-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('Agent 中间件接在真实对话路由上（E2E）', () => {
  it('拦截中间件让 /messages 不进模型、直接回它的响应', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    // 热装一个"永远拦截"的插件（ctx 已 start → 用 installPlugin）
    srv.ctx.installPlugin({
      name: 'blocker',
      apply: (c) => {
        c.agent.use(async () => ({ blocked: true, response: { type: 'notice', message: '被插件拦下了' } }))
      },
    })
    const res = await srv.app.fetch(
      new Request('http://x/api/agent/canvases/default/sessions/s1/messages', {
        method: 'POST',
        body: JSON.stringify({ text: '你好' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('被插件拦下了')
    expect(body).toContain('done')
    srv.stop()
  })
})
