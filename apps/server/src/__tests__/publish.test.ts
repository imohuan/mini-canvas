/**
 * publish 路由测试（自验证链路）：白名单拦截、dry-run、假 registry 真发。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createPublishRoutes } from '../routes/publish.js'
let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-publish-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('publish 路由', () => {
  it('白名单外的目录 → 400', async () => {
    const app = createPublishRoutes({ registry: 'http://127.0.0.1:1' })
    const res = await app.fetch(new Request('http://x/api/publish', {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: "../../etc" }),
    }))
    expect(res.status).toBe(400)
  })

  it('未配置 registry 且非 dry-run → 400', async () => {
    const app = createPublishRoutes({})
    const res = await app.fetch(new Request('http://x/api/publish', {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: "plugin-clipboard" }),
    }))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('PLUME_REGISTRY')
  })

  it('dry-run → 打包成功不推', async () => {
    const app = createPublishRoutes({})
    const res = await app.fetch(new Request('http://x/api/publish', {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: "plugin-clipboard", dryRun: true }),
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; tarball?: string }
    expect(body.ok).toBe(true)
    expect(body.tarball).toContain('.tgz')
  })

  it('真发到本地假 registry → registry 收到 PUT（npm publish 语义）', async () => {
    // 假 registry：收任意请求回 200（npm publish 会先查 packument 404 → 走 create → PUT tarball）
    const received: string[] = []
    const server = http.createServer((req, res) => {
      received.push((req.method ?? "") + " " + (req.url ?? ""))
      res.statusCode = req.method === "PUT" ? 201 : 200
      res.setHeader("content-type", "application/json")
      // npm publish 需要 put 分回包 metadata
      res.end(JSON.stringify({ ok: true, id: "x", rev: "1" }))
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const addr = server.address() as { port: number }
    const registry = "http://127.0.0.1:" + addr.port
    const app = createPublishRoutes({ registry })
    await app.fetch(new Request("http://x/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: "plugin-clipboard" }),
    }))
    // npm publish 对假 registry 可能报 doc 冲突等——只要请求到了 registry 就算链路通
    expect(received.length).toBeGreaterThan(0)
    expect(received.some((r) => r.startsWith("PUT"))).toBe(true)
    server.close()
  })
})
