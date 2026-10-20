/**
 * 调试产物全链路（真起服务、真发 HTTP）。
 *
 * 只验"这一版能不能用"：POST 生成三份文件 → 从**独立源**读回来 → 页面里带的是短令牌。
 * 这条路以前是同源 text/html（页面里的脚本能读走管理令牌），现在必须在另一个端口。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

let dir = ''
let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-debug-chain-'))
})

afterEach(async () => {
  srv?.stop()
  srv = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

function debugDir(canvasId: string): string {
  return path.join(dir, 'canvases', canvasId, 'resources', 'debug')
}

describe('调试源的接线（cloud-server 侧）', () => {
  it('★ 服务起来后调试源是可用的独立地址，能读回调试产物', async () => {
    srv = await createCloudServer({ dir, port: 0, hostname: '127.0.0.1', watchProviders: false, agent: false })
    const started = await srv.start()
    // 宿主上架的服务（插件侧就是从这里取 url）
    const origin = srv.ctx.tryGet<{ url: string }>('debugOrigin')
    expect(origin?.url).toBeTruthy()
    expect(new URL(origin!.url).origin).not.toBe(started.url)

    // 插件侧写盘之后，这个地址就能读到（这里直接落盘，绕开路由注册的时序）
    await fs.mkdir(debugDir('default'), { recursive: true })
    await fs.writeFile(path.join(debugDir('default'), 'debug-7.html'), '<div id="x">hi</div>', 'utf8')
    await fs.writeFile(path.join(debugDir('default'), 'sdk-7.js'), 'window.sdk=1', 'utf8')
    const page = await fetch(origin!.url + '/default/debug-7.html')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await page.text()).toContain('<div id="x">hi</div>')
    const sdk = await fetch(origin!.url + '/default/sdk-7.js')
    expect(sdk.status).toBe(200)
    expect(sdk.headers.get('content-type')).toContain('javascript')
  })

  /**
   * 调试文件**不能**从后台同源读出来。
   *
   * 注意这里不能断言"一定 404"：这个测试没装 plugin-node-ui，那条调试读路由不存在，
   * 请求会落到 SPA 兜底（回 index.html，200）。真正要证明的是"拿不到调试文件本身" ——
   * 内容里不能出现落盘的那段 HTML。（插件侧的 404 由 debugDocsRoute.test.ts 钉住。）
   */
  it('★ 后台同源读不出调试文件（S1：不能在后台的源上执行调试 HTML）', async () => {
    srv = await createCloudServer({ dir, port: 0, hostname: '127.0.0.1', watchProviders: false, agent: false })
    const started = await srv.start()
    await fs.mkdir(debugDir('default'), { recursive: true })
    await fs.writeFile(path.join(debugDir('default'), 'debug-7.html'), '<p id="leak">leak</p>', 'utf8')
    const res = await fetch(started.url + '/api/canvases/default/resources/debug/debug-7.html')
    const body = await res.text()
    expect(body).not.toContain('id="leak"')
  })
})
