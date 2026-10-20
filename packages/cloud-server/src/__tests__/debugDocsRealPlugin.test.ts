/**
 * 真机形状的端到端：**装载 plugin-node-ui 编译产物**（dist/server.js），
 * 走 HTTP 生成调试页、从独立源打开、再模拟浏览器从调试源跨源写产物。
 *
 * 为什么值得多一条：其它用例要么只测插件内部（假 ctx），要么只测调试源本身。
 * 这条把「外挂后台插件 + 真实路由 + 独立源 + 跨源 CORS + 短令牌」串在一起 ——
 * 任何一环没接上，用户点「调试」就是白屏或 Failed to fetch。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCloudServer } from '../server.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_SERVER_JS = path.resolve(HERE, '../../../plugins/plugin-node-ui/dist/server.js')
/** 固定的管理令牌（64 位 hex，与真实格式一致） */
const ADMIN = 'a'.repeat(64)

let dir = ''
let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined
let built = false

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-debug-real-'))
  built = await fs
    .access(PLUGIN_SERVER_JS)
    .then(() => true)
    .catch(() => false)
})

afterEach(async () => {
  srv?.stop()
  srv = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

describe('真机形状：外挂后台插件 + 独立调试源', () => {
  it('★ 生成 → 打开 → 跨源保存，一条都不缺', async () => {
    if (!built) {
      // 没跑过 build:server 的机器上跳过（不假装通过）
      console.warn('[skip] 没有 ' + PLUGIN_SERVER_JS + '，先跑 pnpm -C packages/plugins/plugin-node-ui build:server')
      return
    }
    const pluginsDir = path.join(dir, 'server-plugins')
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.copyFile(PLUGIN_SERVER_JS, path.join(pluginsDir, 'plugin-node-ui.js'))

    srv = await createCloudServer({
      dir,
      port: 0,
      hostname: '127.0.0.1',
      watchProviders: false,
      agent: false,
      serverPluginsDir: pluginsDir,
      // 固定令牌：下面要断言"管理令牌没进调试页"，空串会让这条断言永远失败（'' 出现在任何文本里）
      adminToken: ADMIN,
    })
    const { url: backend } = await srv.start()
    const debugUrl = (srv.ctx.tryGet<{ url: string }>('debugOrigin') ?? { url: '' }).url
    expect(debugUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    // ① 画布点「调试」：生成三份产物
    const res = await fetch(backend + '/api/canvases/default/debug-docs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': srv.adminToken },
      body: JSON.stringify({ nodeId: '7', html: '<div id="hello">hi</div>', inputs: { a: 1 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      urls: { html: string; context: string; sdk: string }
      token: string
    }
    expect(body.ok).toBe(true)
    expect(body.token).toBeTruthy()

    // ② 页面在独立源、能读、带短令牌、没有管理令牌
    expect(new URL(body.urls.html).origin).toBe(debugUrl)
    const page = await fetch(body.urls.html)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('<div id="hello">hi</div>')
    expect(html).toContain('debugToken')
    expect(html).not.toContain(ADMIN)
    const ctxJs = await fetch(body.urls.context)
    expect(await ctxJs.text()).toContain(body.token)

    // ③ 模拟调试页跨源保存（浏览器会带 Origin: <调试源>）
    const up = await fetch(backend + '/api/canvases/default/resources?slot=7&name=out.png', {
      method: 'POST',
      headers: { origin: debugUrl, 'content-type': 'image/png', 'x-task-token': body.token },
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    })
    expect(up.status).toBe(200)
    expect(up.headers.get('access-control-allow-origin')).toBe(debugUrl)
    expect(((await up.json()) as { ok: boolean }).ok).toBe(true)

    // ④ 同源那条老通道不给（文件在磁盘上也不给）
    const leak = await fetch(backend + '/api/canvases/default/resources/debug/debug-7.html')
    expect(await leak.text()).not.toContain('id="hello"')
  })
})
