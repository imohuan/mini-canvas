/**
 * 令牌注入的**真实连接**测试（不是假 ctx）。
 *
 * 为什么必须真连：判断「这次请求是不是本机」只能看 TCP 对端地址。
 * 一旦去看 `Host` 头，`--host 0.0.0.0` 时局域网机器伪造 `Host: 127.0.0.1`
 * 就能拿到首页 —— 也就拿到管理令牌。这个漏洞审查时真机复现过，
 * 所以这里用真 socket 钉住：**远程连接 + 伪造 Host 也不许注入**。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { uiRoutes } from '../static.js'

const TOKEN = 'b'.repeat(64)
let dir = ''
let srv: ReturnType<typeof serve> | undefined

async function boot() {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-token-real-'))
  await fs.writeFile(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>t</title></head><body></body></html>',
    'utf8',
  )
  const app = uiRoutes(dir, () => TOKEN)
  // 绑 0.0.0.0：这样从本机连 127.0.0.1 时，对端地址是回环；
  // 从网卡地址连时，对端地址不是回环（模拟局域网机器）。
  srv = serve({ fetch: app.fetch, port: 0, hostname: '0.0.0.0' })
  await new Promise<void>((r) => srv!.once('listening', () => r()))
  const port = (srv!.address() as AddressInfo).port
  return port
}

afterEach(async () => {
  srv?.close()
  srv = undefined
  if (dir) await fs.rm(dir, { recursive: true, force: true })
  dir = ''
})

/** 用指定 Host 头发一次 GET（连到 urlHost 那个地址），返回正文 */
function get(
  port: number,
  urlHost: string,
  hostHeader: string,
  extra: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = httpRequest(
      { host: urlHost, port, path: '/', method: 'GET', headers: { host: hostHeader, ...extra } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (d) => chunks.push(d as Buffer))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      },
    )
    r.on('error', reject)
    r.end()
  })
}

describe('令牌注入：只认真实对端地址', () => {
  it('★ 本机回环连接 → 注入', async () => {
    const port = await boot()
    const html = await get(port, '127.0.0.1', '127.0.0.1:' + port)
    expect(html).toContain(TOKEN)
  })

  /**
   * ★★ 同机反代：nginx 与服务跑在同一台机器上，对端也是 127.0.0.1，
   * 但外面访问的人 Host 是域名。只看对端地址会把令牌发给所有走反代来的人。
   */
  it('★★ 对端是本机但 Host 是域名（同机反代）→ 不注入', async () => {
    const port = await boot()
    const html = await get(port, '127.0.0.1', 'mycanvas.example.com:' + port)
    expect(html).not.toContain(TOKEN)
    expect(html).not.toContain('__MC_ADMIN_TOKEN__')
    // 页面本身照常打开
    expect(html).toContain('mini-canvas-host')
  })

  /**
   * ★★ 局域网机器连接 + 伪造 Host: 127.0.0.1 → 不注入。
   *
   * （这一条正是审查时复现出来的漏洞：只要看 Host 就会被绕过。）
   */
  it('★★ 远程连接 + 伪造 Host: 127.0.0.1 → 不注入', async () => {
    const port = await boot()
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((n) => n && n.family === 'IPv4' && !n.internal)?.address
    if (!lan) {
      // 没有非回环网卡（CI 沙箱）：这条测不了，跳过而不是假装通过
      expect(true).toBe(true)
      return
    }
    const html = await get(port, lan, '127.0.0.1:' + port)
    expect(html).not.toContain(TOKEN)
    expect(html).not.toContain('__MC_ADMIN_TOKEN__')
    expect(html).toContain('mini-canvas-host')
  })

  /**
   * ★★ 同机反代：nginx 默认会把 Host 改写成 $proxy_host（回环地址），
   * 于是「对端回环 + Host 回环」两个条件同时成立，但请求其实来自公网。
   *
   * 分界是**转发头**：反代一定会留下 X-Forwarded-For / X-Real-IP / Forwarded，
   * 本机浏览器直连不会带。有任意一个就不注入。
   */
  it('★★ 对端回环 + Host 回环，但带 X-Forwarded-For（同机反代）→ 不注入', async () => {
    const port = await boot()
    const html = await get(port, '127.0.0.1', '127.0.0.1:' + port, { 'x-forwarded-for': '203.0.113.9' })
    expect(html).not.toContain(TOKEN)
    expect(html).not.toContain('__MC_ADMIN_TOKEN__')
    expect(html).toContain('mini-canvas-host')
  })

  it('★★ X-Real-IP / Forwarded 同样挡住（不只认 X-Forwarded-For）', async () => {
    const port = await boot()
    const cases: Array<[string, string]> = [
      ['x-real-ip', '203.0.113.9'],
      ['forwarded', 'for=203.0.113.9'],
      ['x-forwarded-host', 'public.example'],
    ]
    for (const [k, v] of cases) {
      const html = await get(port, '127.0.0.1', '127.0.0.1:' + port, { [k]: v })
      expect(html, k).not.toContain(TOKEN)
    }
  })
})

