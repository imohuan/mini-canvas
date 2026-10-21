/**
 * 「服务端真把令牌交给页面」的接线测试。
 *
 * 为什么单独一条：`uiRoutes` 自己的注入逻辑有测试，但**没有用例经过真实的
 * `createCloudServer`**。审查时把 server.ts 的 `() => adminAuth.token` 改成
 * `() => undefined`，49 条相关用例照样全绿 —— 这条接线坏了没人发现。
 *
 * 这里起真服务、真发 HTTP，断言首页里确实带着这台后台的令牌。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server.js'

const TOKEN = 'c'.repeat(64)
let dir = ''
let srv: CloudServer | undefined
let uiDir = ''

afterEach(async () => {
  srv?.stop()
  srv = undefined
  for (const d of [dir, uiDir]) if (d) await fs.rm(d, { recursive: true, force: true })
  dir = ''
  uiDir = ''
})

describe('服务端接线：本机打开托管页时带上令牌', () => {
  it('★ createCloudServer + 真 HTTP → 首页含这台后台的令牌', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-wire-'))
    uiDir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-ui-'))
    await fs.writeFile(
      path.join(uiDir, 'index.html'),
      '<!doctype html><html><head><title>t</title></head><body></body></html>',
      'utf8',
    )
    srv = await createCloudServer({
      dir,
      port: 0,
      uiDist: uiDir,
      watchProviders: false,
      adminAuth: true,
      adminToken: TOKEN,
      requestTrust: true,
    })
    const { port } = await srv.start()
    // 本机直连（对端回环 + Host 回环、无转发头）
    const res = await fetch('http://127.0.0.1:' + port + '/')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('__MC_ADMIN_TOKEN__')
    expect(html).toContain(TOKEN)
    // 宿主标记仍在（cloud-client 靠它开机直接启动）
    expect(html).toContain('mini-canvas-host')
  })

  it('★ 关掉鉴权时页面里不该有令牌', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-wire-'))
    uiDir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-ui-'))
    await fs.writeFile(path.join(uiDir, 'index.html'), '<!doctype html><html><head></head><body></body></html>', 'utf8')
    srv = await createCloudServer({
      dir,
      port: 0,
      uiDist: uiDir,
      watchProviders: false,
      adminAuth: false,
      requestTrust: false,
    })
    const { port } = await srv.start()
    const html = await (await fetch('http://127.0.0.1:' + port + '/')).text()
    expect(html).not.toContain('__MC_ADMIN_TOKEN__')
  })
})

