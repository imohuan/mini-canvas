/**
 * **决定性验证：路由真的由插件系统接管了。**
 *
 * 为什么需要它：`builtinBehavior.test.ts` 只证明了「请求返回 200」，
 * 但那可能只是 ui 的 SPA 兜底在应答 —— 证明不了「这条路由是插件提供的」。
 * 本文件用**卸载插件**来区分：真由插件提供 → 卸载后消失；
 * 只是被兜底应答 → 卸载后仍然 200（那就是坏的）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-takeover-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('路由由插件系统接管（卸载即失效）', () => {
  it('卸载 actions 插件后，/api/actions 不再返回它的清单', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const ok = await srv.app.fetch(new Request('http://x/api/actions'))
    expect(ok.status).toBe(200)
    expect((await ok.json()) as { ok?: boolean }).toMatchObject({ ok: true })

    expect(srv.ctx.uninstallPlugin('actions')).toBe(true)
    const after = await srv.app.fetch(new Request('http://x/api/actions'))
    // 兜底是 ui 的 SPA（本测试无 ui dist → 给人话 HTML），关键断言是「不再是 JSON 清单」
    const text = await after.text()
    expect(text).not.toContain('"actions"')
    srv.stop()
  })

  it('卸载 health 插件后 /health 不再返回它的 JSON（被 ui 兜底接住）', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const before = await srv.app.fetch(new Request('http://x/health'))
    expect(await before.json()).toEqual({ ok: true })

    expect(srv.ctx.uninstallPlugin('health')).toBe(true)
    const after = await srv.app.fetch(new Request('http://x/health'))
    // ⚠️ 注意：**不能**断言 404。ui 的 SPA 兜底（get('*')）会接住任何未匹配路径、
    // 返回 200 的 HTML —— 这是既有的、正确的行为（无 ui dist 时给人话提示页）。
    // 真正的断言是「不再是 health 的 JSON」。
    expect(after.headers.get('content-type') ?? '').not.toContain('application/json')
    srv.stop()
  })

  it('卸载一个插件不影响别组路由（作用域隔离）', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    srv.ctx.uninstallPlugin('health')
    const r = await srv.app.fetch(new Request('http://x/api/actions'))
    expect(r.headers.get('content-type') ?? '').toContain('json')
    srv.stop()
  })
})
