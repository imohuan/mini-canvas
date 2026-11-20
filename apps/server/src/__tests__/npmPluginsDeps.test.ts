/**
 * npmPlugins 依赖解析接入测试（发布体系 Task 4）。
 *
 * 装带 dependencies 的包 → 提供者先落盘；
 * 卸载被依赖的提供者 → 409 拒绝并列出依赖者。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServerFramework } from '../serverFramework/index.js'
import { createNpmPluginsRoutes } from '../routes/npmPlugins.js'

const run = promisify(execFile)

let dir: string
let pluginsDir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-npm-deps-'))
  pluginsDir = path.join(dir, "plugins")
  await fs.mkdir(pluginsDir, { recursive: true })
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

interface FakeRegistry { url: string; close(): void }

async function startFakeRegistry(packuments: Record<string, unknown>, tarballs: Record<string, string>): Promise<FakeRegistry> {
  const server = http.createServer((req, res) => {
    const tgz = tarballs[req.url ?? ""]
    if (tgz) {
      void fs.readFile(tgz).then((b) => {
        res.setHeader("content-type", "application/octet-stream")
        res.end(b)
      })
      return
    }
    // /<name> → packument（按包名匹配）
    const name = decodeURIComponent((req.url ?? "").replace(/^\//, ""))
    const pk = packuments[name]
    if (!pk) { res.statusCode = 404; res.end(JSON.stringify({ error: "not found" })); return }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(pk))
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const addr = server.address() as { port: number }
  return { url: "http://127.0.0.1:" + addr.port, close: () => server.close() }
}

/** 造一个最小插件 tgz */
async function makePkg(
  workDir: string,
  opts: { name: string; provides?: string[]; dependencies?: string[] },
): Promise<string> {
  const webRel = "dist/web.js"
  const webFile = path.join(workDir, "payload", webRel)
  await fs.mkdir(path.dirname(webFile), { recursive: true })
  await fs.writeFile(webFile, "(function(e,t){t(e.PlumePluginX={})})(this,function(e){e.name=\"x\";e.apply=function(){}})", "utf8")
  const mini: Record<string, unknown> = { pluginName: "x", web: { entry: webRel } }
  if (opts.provides) mini.provides = opts.provides
  if (opts.dependencies) mini.dependencies = opts.dependencies
  await fs.writeFile(path.join(workDir, "payload", "package.json"), JSON.stringify({ name: opts.name, version: "1.0.0", plume: mini }), "utf8")
  const stage = path.join(workDir, "stage")
  await fs.rm(stage, { recursive: true, force: true })
  await fs.cp(path.join(workDir, "payload"), path.join(stage, "package"), { recursive: true })
  const tgz = path.join(workDir, "pkg.tgz")
  await run("tar", ["-czf", tgz, "-C", stage, "package"])
  return tgz
}

async function boot(registryUrl: string) {
  const routes = createNpmPluginsRoutes({
    registry: registryUrl,
    pluginsDir,
    recordFile: path.join(dir, ".npm-installed.json"),
    scopeAllowlist: ["@plume-canvas/"],
  })
  const host = createServerFramework({ root: dir })
  host.ctx.routes.adopt(routes)
  await host.start()
  return host
}

import type { Hono } from 'hono'
const call = (host: { app: Hono }, p: string, method?: string, body?: unknown) =>
  host.app.fetch(new Request("http://x" + p, {
    method: method ?? "GET",
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  }))
const j = async (r: Response) => (await r.json()) as Record<string, unknown>

/** 包名 → 落盘目录名（与 npmPlugins.ts 的 dirNameOf 一致） */
const dirNameOf = (pkg: string): string => pkg.replace(/^@/, "").replace("/", "__")

describe('npmPlugins 依赖解析（Task 4）', () => {
  it('装带依赖的包 → 提供者先落盘，两个都装上', async () => {
    const providerTgz = await makePkg(dir, { name: "@plume-canvas/plugin-provider", provides: ["svc-x"] })
    const targetTgz = await makePkg(dir, { name: "@plume-canvas/plugin-target", dependencies: ["svc-x"] })
    // 造完两个包后重打（makePkg 共用 payload 目录，逐个来）
    const providerPkg2 = await makePkg(dir, { name: "@plume-canvas/plugin-provider", provides: ["svc-x"] })
    const packuments: Record<string, unknown> = {
      "@plume-canvas/plugin-provider": {
        name: "@plume-canvas/plugin-provider",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { version: "1.0.0", dist: { tarball: "TBD" }, plume: { pluginName: "provider", web: { entry: "dist/web.js" }, provides: ["svc-x"] } } },
        time: {},
      },
      "@plume-canvas/plugin-target": {
        name: "@plume-canvas/plugin-target",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { version: "1.0.0", dist: { tarball: "TBD" }, plume: { pluginName: "target", web: { entry: "dist/web.js" }, dependencies: ["svc-x"] } } },
        time: {},
      },
    }
    void providerTgz; void targetTgz; void providerPkg2
    // tarball 路径在 registry 起来后才能填（需要 url）——先起一个占位再替换
    // 简化：先起 registry（tarball URL 先空着），起完再改 packuments 里的 tarball 地址
    const registry = await startFakeRegistry(packuments, {})
    ;(packuments["@plume-canvas/plugin-provider"] as Record<string, any>).versions["1.0.0"].dist.tarball = registry.url + "/provider.tgz"
    ;(packuments["@plume-canvas/plugin-target"] as Record<string, any>).versions["1.0.0"].dist.tarball = registry.url + "/target.tgz"
    // 重新造两个 tgz 到固定名（makePkg 每次覆盖 payload，这里分开目录造）
    const sub1 = path.join(dir, "p1")
    await fs.mkdir(sub1, { recursive: true })
    const pTgz = await makePkg(sub1, { name: "@plume-canvas/plugin-provider", provides: ["svc-x"] })
    const sub2 = path.join(dir, "p2")
    await fs.mkdir(sub2, { recursive: true })
    const tTgz = await makePkg(sub2, { name: "@plume-canvas/plugin-target", dependencies: ["svc-x"] })
    await fs.cp(pTgz, path.join(dir, "provider.tgz"), { recursive: true })
    await fs.cp(tTgz, path.join(dir, "target.tgz"), { recursive: true })
    // search 端点：假 registry 不支持 /-/v1/search → depsResolver 的 findProvider 走 search 失败
    // 但我们的 resolver 也允许 packument 直查：这里靠 packument 里 provides 命中。
    // 需要让 resolver 能发现 provider —— search 失败时 fallback：直接试"前缀+服务名"包名。
    // 这里测试走 resolver 的 search 路径会失败，所以 resolver 需要 fallback 逻辑（实现时补）。
    // 为让测试成立，给 registry 加 search 支持：
    registry.close()
    const server = http.createServer((req, res) => {
      const url = req.url ?? ""
      const tgzMap: Record<string, string> = {
        "/provider.tgz": path.join(dir, "provider.tgz"),
        "/target.tgz": path.join(dir, "target.tgz"),
      }
      if (tgzMap[url]) {
        void fs.readFile(tgzMap[url]).then((b) => { res.end(b) })
        return
      }
      if (url.startsWith("/-/v1/search")) {
        res.setHeader("content-type", "application/json")
        res.end(JSON.stringify({ objects: [{ package: { name: "@plume-canvas/plugin-provider", description: "", version: "1.0.0", date: "", links: {} } }] }))
        return
      }
      const name = decodeURIComponent(url.replace(/^\//, ""))
      const pk = packuments[name]
      if (!pk) { res.statusCode = 404; res.end("{}"); return }
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify(pk))
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const addr = server.address() as { port: number }
    const reg2 = { url: "http://127.0.0.1:" + addr.port, close: () => server.close() }
    ;(packuments["@plume-canvas/plugin-provider"] as Record<string, any>).versions["1.0.0"].dist.tarball = reg2.url + "/provider.tgz"
    ;(packuments["@plume-canvas/plugin-target"] as Record<string, any>).versions["1.0.0"].dist.tarball = reg2.url + "/target.tgz"

    const host = await boot(reg2.url)
    const res = await call(host, "/api/npm-plugins/install", "POST", { package: "@plume-canvas/plugin-target", confirm: true })
    expect(res.status).toBe(200)
    const body = await j(res)
    expect(body.ok).toBe(true)
    // 两个目录都落盘
    const providerDir = path.join(pluginsDir, dirNameOf("@plume-canvas/plugin-provider"))
    const targetDir = path.join(pluginsDir, dirNameOf("@plume-canvas/plugin-target"))
    await expect(fs.access(path.join(providerDir, "package.json"))).resolves.toBeUndefined()
    await expect(fs.access(path.join(targetDir, "package.json"))).resolves.toBeUndefined()
    // 来源记录两条都在
    const recs = JSON.parse(await fs.readFile(path.join(dir, ".npm-installed.json"), "utf8")) as Record<string, { pkg: string }>
    expect(Object.keys(recs)).toContain("@plume-canvas/plugin-provider")
    expect(Object.keys(recs)).toContain("@plume-canvas/plugin-target")
    host.stop()
    reg2.close()
  })

  it('卸载被依赖的提供者 → 409 + 列出依赖者', async () => {
    // 先手动落一个 provider 副本（package.json 带 provides）+ target 副本（dependencies 引用它）+ 来源记录
    const providerDir = path.join(pluginsDir, dirNameOf("@plume-canvas/plugin-provider"))
    await fs.mkdir(providerDir, { recursive: true })
    await fs.writeFile(path.join(providerDir, "package.json"), JSON.stringify({
      name: "@plume-canvas/plugin-provider",
      plume: { pluginName: "provider", provides: ["svc-x"], npmInstalled: true },
    }))
    const targetDir = path.join(pluginsDir, dirNameOf("@plume-canvas/plugin-target"))
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, "package.json"), JSON.stringify({
      name: "@plume-canvas/plugin-target",
      plume: { pluginName: "target", dependencies: ["svc-x"], npmInstalled: true },
    }))
    await fs.writeFile(path.join(dir, ".npm-installed.json"), JSON.stringify({
      "@plume-canvas/plugin-provider": { pkg: "@plume-canvas/plugin-provider", version: "1.0.0", installedAt: "2026-01-01" },
      "@plume-canvas/plugin-target": { pkg: "@plume-canvas/plugin-target", version: "1.0.0", installedAt: "2026-01-01" },
    }))
    const registry = await startFakeRegistry({}, {})
    const host = await boot(registry.url)
    const res = await call(host, "/api/npm-plugins/uninstall", "POST", { package: "@plume-canvas/plugin-provider" })
    expect(res.status).toBe(409)
    const body = await j(res)
    expect(JSON.stringify(body)).toContain('plugin-target')
    // 目录没被删
    await expect(fs.access(path.join(providerDir, "package.json"))).resolves.toBeUndefined()
    host.stop()
    registry.close()
  })
})
