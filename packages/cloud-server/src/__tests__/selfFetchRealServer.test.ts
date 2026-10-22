/**
 * 端到端回归（2026-10-22）：真实 cloud-server + 真来源边界 + 真后台插件路由。
 *
 * 现场：素材库点生成时，参考图是 `/api/style-library/file?name=…`，
 * web2api 报「图片不存在（已尝试 …\uploads\api\style-library\file?name=…）」。
 *
 * 根因不在 web2api：cloud-server 的「自取字节」用 `new Request(url)` 调自己的 app.fetch，
 * 而 Node 的 Request 不会补 `Host` 头 → requestTrust 判 `host-not-trusted` → 403
 * → 字节取不到、退回裸相对地址交给上游。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server.js'
import { makeFetchSelfBytes } from '../tasks/selfFetch.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let dir: string
let srv: CloudServer

afterEach(async () => {
  srv?.stop()
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

describe('真实服务：后台插件路由的字节能被内部自请求拿到', () => {
  it('/api/style-library/file 出图；selfFetch 也拿得到同一份字节（不被来源边界误杀）', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'self-fetch-real-'))
    // 最小后台插件（模拟风格库）：只提供一条返回 PNG 的 file 路由
    const pluginsDir = path.join(dir, 'server-plugins')
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.writeFile(
      path.join(pluginsDir, 'probe.js'),
      [
        "export const name = 'probe'",
        'export function apply(ctx) {',
        "  ctx.routes.get('/api/style-library/file', (c) => c.body(new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]), 200, { 'content-type': 'image/png' }))",
        '}',
      ].join('\n'),
      'utf8',
    )

    srv = await createCloudServer({
      dir,
      port: 0,
      hostname: '127.0.0.1',
      watchProviders: false,
      adminAuth: true,
      adminToken: 'f'.repeat(64),
      requestTrust: true,
    })
    const { port } = await srv.start()

    // 前端视角：这条地址能正常出图
    const direct = await fetch(`http://127.0.0.1:${port}/api/style-library/file?name=a.png`)
    expect(direct.status).toBe(200)
    expect(direct.headers.get('content-type')).toContain('image/png')

    // 自取字节：与 server.ts 同一套接线（后台 fetch → app.fetch，origin → 真实监听地址）
    const fetchSelfBytes = makeFetchSelfBytes({
      fetch: (req) => srv.app.fetch(req),
      origin: () => `http://127.0.0.1:${port}`,
    })
    const bytes = await fetchSelfBytes('/api/style-library/file?name=a.png')
    expect(bytes).toBeTruthy()
    expect(new Uint8Array(bytes!)).toEqual(PNG)
  })
})
