/**
 * 真 NPM 只读端到端（网络可用时跑）：搜索端点 + packument 404 语义。
 * 不做安装（包未发布时 404 是预期；发布后由发布流程验证）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-npmreal-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('NPM 路由 · 真 registry（只读）', () => {
  it('搜索端点连通且只回白名单前缀内的包（可能为空，但结构必须对）', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const res = await srv.app.fetch(new Request('http://x/api/npm-plugins/search?q=mini-canvas'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; results: Array<{ pkg: string }> }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.results)).toBe(true)
    // 过滤语义：所有结果的包名都在白名单前缀内（默认 @imohuan/ 与 mini-canvas-）
    for (const r of body.results) {
      expect(r.pkg.startsWith('@imohuan/') || r.pkg.startsWith('mini-canvas-')).toBe(true)
    }
    srv.stop()
  }, 30_000)

  it('install 未发布的包 → 404（packument 查无此包）', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const res = await srv.app.fetch(new Request('http://x/api/npm-plugins/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: 'mini-canvas-plugin-not-exist-xyz', confirm: true }),
    }))
    expect(res.status).toBe(404)
    srv.stop()
  }, 30_000)
})
