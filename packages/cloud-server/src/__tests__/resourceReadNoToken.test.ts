/**
 * 资源读取**不要令牌**（用户口径 2026-10-22）。
 *
 * 覆盖四类，都是在真服务 + 真来源边界 + 真插件路由下跑的：
 *   1. 风格库 `/api/style-library/file`（插件后台半提供）；
 *   2. 特效库 `/api/effect-library/file`（同一个插件、另一个前缀）；
 *   3. 资源访问 `/api/canvases/:id/resources/:name`（PUT 上传拿到的那个 URL）。
 *   4. 资产文件 `/api/assets/files/:name`（上传资产拿到的 URL）。
 *
 * 为什么值得钉死：上传拿到的 URL 会一路传进 web2api / <img> / 导出，
 * 只要读路径被写白名单误拦一次，用户看到的就是「图片失效」。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server.js'
import { isAdminPath } from '../adminAuth.js'

/** 最小 PNG 头（够被 looksLikeMedia 认出来） */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let dir: string
let srv: CloudServer

afterEach(async () => {
  srv?.stop()
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

async function boot(): Promise<{ base: string; port: number }> {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'res-read-'))
  // 两个库的最小后台半（真实插件路由的行为：GET file 不需要令牌）
  const plugins = path.join(dir, 'server-plugins')
  await fs.mkdir(plugins, { recursive: true })
  await fs.writeFile(
    path.join(plugins, 'libraries.js'),
    [
      "export const name = 'libraries'",
      'export function apply(ctx) {',
      '  const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])',
      "  for (const p of ['/api/style-library', '/api/effect-library']) {",
      "    ctx.routes.get(p + '/file', (c) => c.body(png, 200, { 'content-type': 'image/png' }))",
      '  }',
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
  return { base: 'http://127.0.0.1:' + port, port }
}

describe('资源读取不需要管理令牌（用户口径）', () => {
  it('★ 写白名单里的前缀只拦写方法：GET / HEAD 永远放行', () => {
    // 这一条不依赖服务：直接查判定函数，防止有人把「读」也塞进令牌中间件。
    for (const p of [
      '/api/style-library/file',
      '/api/effect-library/file',
      '/api/canvases/default/resources/x.png',
      '/api/assets/files/x.png',
    ]) {
      expect(isAdminPath('GET', p), p).toBe(false)
      expect(isAdminPath('HEAD', p), p).toBe(false)
    }
  })

  it('风格库 / 特效库的图片：不带 x-admin-token 也能 200', async () => {
    const { base } = await boot()
    for (const prefix of ['/api/style-library', '/api/effect-library']) {
      const res = await fetch(base + prefix + '/file?name=a.png')
      expect(res.status, prefix).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/png')
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
    }
  })

  it('PUT 上传拿到的 URL：不带令牌也能读（POST 上传 → GET 读取）', async () => {
    const { base } = await boot()
    // 上传（写入口，要令牌）
    const up = await fetch(base + '/api/canvases/default/resources?name=a.png', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-admin-token': 'f'.repeat(64) },
      body: PNG,
    })
    expect(up.status).toBe(200)
    const body = (await up.json()) as { ok: boolean; url?: string; hashName?: string }
    expect(body.ok).toBe(true)
    const url = body.url ?? '/api/canvases/default/resources/' + body.hashName

    // 读取（读入口，不要令牌）—— 上传返回的地址原样请求
    const res = await fetch(base + url)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })

  it('资产文件：POST 上传 → /api/assets/files/<name> 不带令牌也能读', async () => {
    const { base } = await boot()
    const up = await fetch(base + '/api/assets?name=a.png', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: PNG,
    })
    expect(up.status).toBe(200)
    const body = (await up.json()) as { ok: boolean; asset?: { url?: string } }
    expect(body.asset?.url).toBeTruthy()
    const res = await fetch(base + body.asset!.url!)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })
})
