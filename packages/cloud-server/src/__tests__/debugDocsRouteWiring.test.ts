/**
 * 带参数的新路由（`POST /api/canvases/:canvasId/debug-docs`）在**启动期装载**时要真的能命中。
 *
 * 为什么单独测一条：后台路由是"启动时把注册场翻成 Hono 代理"（见 serverFramework/routes.ts），
 * 运行期热装的新 path 没有代理，只有 catch-all 的**精确匹配**兜底 —— 带参数的路由
 * 只能在启动期装载才可用。plugin-node-ui 走的是 server-plugins 目录，正是启动期。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

let dir = ''
let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-debug-wiring-'))
})

afterEach(async () => {
  srv?.stop()
  srv = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

describe('启动期装载的后台插件：带参数路由能命中', () => {
  it('★ POST /api/canvases/:canvasId/debug-docs 真的进到插件处理器', async () => {
    const pluginsDir = path.join(dir, 'server-plugins')
    await fs.mkdir(pluginsDir, { recursive: true })
    // 最小外挂插件：形状与 plugin-node-ui 里那条一致（同一个路径、同一个参数名）
    await fs.writeFile(
      path.join(pluginsDir, 'probe.js'),
      [
        'export const name = "debug-docs-probe"',
        'export function apply(ctx) {',
        '  ctx.routes.post("/api/canvases/:canvasId/debug-docs", (c) =>',
        '    c.json({ ok: true, canvasId: c.req.param("canvasId"), body: c.req.method }))',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
    srv = await createCloudServer({
      dir,
      port: 0,
      hostname: '127.0.0.1',
      watchProviders: false,
      agent: false,
      serverPluginsDir: pluginsDir,
    })
    const started = await srv.start()
    const res = await fetch(started.url + '/api/canvases/c9/debug-docs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': srv.adminToken },
      body: JSON.stringify({ nodeId: '7', html: '<p>x</p>' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, canvasId: 'c9' })
  })
})
