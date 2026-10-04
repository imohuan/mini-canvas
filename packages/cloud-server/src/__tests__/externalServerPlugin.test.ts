/**
 * **端到端：丢一个 .js 进 server-plugins 目录 → 后台多一个接口（Task 4）。**
 *
 * 这是「后台也能像前端那样丢文件扩展」的最终证明：
 * 写一个插件文件 → 起服务 → 它的路由真的通了。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-extplugin-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('外挂后台插件（丢文件即生效）', () => {
  it('server-plugins 目录里的 .js 定义的路由，在真实服务里能访问', async () => {
    const pluginsDir = path.join(dir, 'server-plugins')
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.writeFile(
      path.join(pluginsDir, 'hello-plugin.js'),
      [
        'export const name = "hello-plugin"',
        'export function apply(ctx) {',
        '  ctx.routes.get("/api/hello", (c) => c.json({ from: "external-plugin" }))',
        '}',
      ].join('\n'),
    )
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const res = await srv.app.fetch(new Request('http://x/api/hello'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ from: 'external-plugin' })
    srv.stop()
  })

  it('外挂插件也能注册 Agent 中间件（并拦下对话）', async () => {
    const pluginsDir = path.join(dir, 'server-plugins')
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.writeFile(
      path.join(pluginsDir, 'mw-plugin.js'),
      [
        'export const name = "mw-plugin"',
        'export function apply(ctx) {',
        '  ctx.agent.use(async () => ({ blocked: true, response: { type: "notice", message: "外挂插件拦截" } }))',
        '}',
      ].join('\n'),
    )
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const res = await srv.app.fetch(
      new Request('http://x/api/agent/canvases/default/sessions/s1/messages', {
        method: 'POST',
        body: JSON.stringify({ text: 'hi' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    const body = await res.text()
    expect(body).toContain('外挂插件拦截')
    srv.stop()
  })
})
