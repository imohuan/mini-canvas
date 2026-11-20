/**
 * bootstrap —— 启动初始化测试（发布体系 Task 5）。
 *
 * 假 registry + 临时数据目录：装清单插件、装 UI、写 version.json；
 * 全部失败不拦启动（返回 failed 数组）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runBootstrap } from '../updater/bootstrap.js'

const run = promisify(execFile)

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-bootstrap-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

interface FakeRegistry { url: string; close(): void }

async function startFakeRegistry(packuments: Record<string, unknown>, tarballs: Record<string, string>): Promise<FakeRegistry> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? ""
    const tgz = tarballs[url]
    if (tgz) {
      void fs.readFile(tgz).then((b) => { res.setHeader("content-type", "application/octet-stream"); res.end(b) })
      return
    }
    if (url.startsWith("/-/v1/search")) {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ objects: [] }))
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
  return { url: "http://127.0.0.1:" + addr.port, close: () => server.close() }
}

/** 造一个最小插件 tgz */
async function makePkg(workDir: string, name: string): Promise<string> {
  const webFile = path.join(workDir, "payload", "dist", "web.js")
  await fs.mkdir(path.dirname(webFile), { recursive: true })
  await fs.writeFile(webFile, "(function(e,t){t(e.PlumePluginX={})})(this,function(e){e.name=\"x\";e.apply=function(){}})", "utf8")
  await fs.writeFile(path.join(workDir, "payload", "package.json"), JSON.stringify({
    name, version: "1.0.0",
    plume: { pluginName: "x", web: { entry: "dist/web.js" } },
  }), "utf8")
  const stage = path.join(workDir, "stage")
  await fs.rm(stage, { recursive: true, force: true })
  await fs.cp(path.join(workDir, "payload"), path.join(stage, "package"), { recursive: true })
  const tgz = path.join(workDir, "pkg.tgz")
  await run("tar", ["-czf", tgz, "-C", stage, "package"])
  return tgz
}

/** 造一个 UI tgz（只有静态文件） */
async function makeUiPkg(workDir: string, version: string): Promise<string> {
  await fs.mkdir(path.join(workDir, "payload"), { recursive: true })
  await fs.writeFile(path.join(workDir, "payload", "index.html"), "<html>ui " + version + "</html>", "utf8")
  await fs.writeFile(path.join(workDir, "payload", "package.json"), JSON.stringify({ name: "@plume-canvas/ui", version }), "utf8")
  const stage = path.join(workDir, "stage")
  await fs.rm(stage, { recursive: true, force: true })
  await fs.cp(path.join(workDir, "payload"), path.join(stage, "package"), { recursive: true })
  const tgz = path.join(workDir, "ui.tgz")
  await run("tar", ["-czf", tgz, "-C", stage, "package"])
  return tgz
}

describe('runBootstrap', () => {
  it('清单里的插件未装 → 从 registry 装上并记来源；UI 装到 .plume/ui/<版本>', async () => {
    const pluginSub = path.join(dir, "p")
    await fs.mkdir(pluginSub, { recursive: true })
    const pluginTgz = await makePkg(pluginSub, "@plume-canvas/plugin-demo")
    const uiSub = path.join(dir, "u")
    await fs.mkdir(uiSub, { recursive: true })
    const uiTgz = await makeUiPkg(uiSub, "0.1.0")
    const uiPackument = {
      name: "@plume-canvas/ui",
      "dist-tags": { latest: "0.1.0" },
      versions: {},
      time: {},
    }
    const registry = await startFakeRegistry({ "@plume-canvas/ui": uiPackument }, { "/ui.tgz": uiTgz })
    ;(uiPackument.versions as Record<string, unknown>)["0.1.0"] = { version: "0.1.0", dist: { tarball: registry.url + "/ui.tgz" } }
    // 插件 packument
    const pluginPk = {
      name: "@plume-canvas/plugin-demo",
      "dist-tags": { latest: "1.0.0" },
      versions: {},
      time: {},
    }
    // 假 registry 按 URL 匹配 packument：/＠plume-canvas%2Fplugin-demo 需要额外加
    // 简化：bootstrap 内部用 packument(pkg) 查，路径 = "/" + encodeURIComponent(name)
    ;(pluginPk.versions as Record<string, unknown>)["1.0.0"] = { version: "1.0.0", dist: { tarball: registry.url + "/plugin.tgz" } }
    // 把 plugin packument 也挂进去（再起一个 registry 太绕——直接把 packument 对象加进 maps 再起一次）
    registry.close()
    const tarballs2: Record<string, string> = {
        ["/" + encodeURIComponent("@plume-canvas/plugin-demo") + ".tgz"]: pluginTgz,
      "/plugin.tgz": pluginTgz,
      "/ui.tgz": uiTgz,
    }
    const packuments2: Record<string, unknown> = {
      "@plume-canvas/ui": uiPackument,
      "@plume-canvas/plugin-demo": pluginPk,
    }
    const reg2 = await startFakeRegistry(packuments2, tarballs2)
    ;(pluginPk.versions as Record<string, unknown>)["1.0.0"] = { version: "1.0.0", dist: { tarball: reg2.url + "/plugin.tgz" }, plume: { pluginName: "x", web: { entry: "dist/web.js" } } }
    ;(uiPackument.versions as Record<string, unknown>)["0.1.0"] = { version: "0.1.0", dist: { tarball: reg2.url + "/ui.tgz" } }

    const dataDir = path.join(dir, "data")
    const manifestPath = path.join(dir, "builtin-manifest.json")
    await fs.writeFile(manifestPath, JSON.stringify({ plugins: { "@plume-canvas/plugin-demo": "latest" } }))

    const result = await runBootstrap({
      dataDir,
      manifestPath,
      registry: reg2.url,
      serverPkgName: "@plume-canvas/server",
      uiPkgName: "@plume-canvas/ui",
      currentServerVersion: "0.1.0",
    })
    expect(result.installed).toContain("@plume-canvas/plugin-demo")
    // 插件落盘到 data/plugins
    const pluginDir = path.join(dataDir, "plugins", "plume-canvas__plugin-demo")
    await expect(fs.access(path.join(pluginDir, "package.json"))).resolves.toBeUndefined()
    // UI 落盘 + version.json
    const uiVersionFile = path.join(dataDir, "ui", "version.json")
    const uiVersion = JSON.parse(await fs.readFile(uiVersionFile, "utf8")) as { version: string }
    expect(uiVersion.version).toBe("0.1.0")
    await expect(fs.access(path.join(dataDir, "ui", "0.1.0", "index.html"))).resolves.toBeUndefined()
    reg2.close()
  })

  it('插件已装 → skipped；registry 挂了 → failed 不抛', async () => {
    const dataDir = path.join(dir, "data")
    const pluginsDir = path.join(dataDir, "plugins")
    await fs.mkdir(pluginsDir, { recursive: true })
    const haveDir = path.join(pluginsDir, "plume-canvas__plugin-demo")
    await fs.mkdir(haveDir, { recursive: true })
    await fs.writeFile(path.join(haveDir, "package.json"), JSON.stringify({ name: "@plume-canvas/plugin-demo", plume: { pluginName: "x" } }))
    const manifestPath = path.join(dir, "builtin-manifest.json")
    await fs.writeFile(manifestPath, JSON.stringify({ plugins: { "@plume-canvas/plugin-demo": "latest" } }))
    const result = await runBootstrap({
      dataDir,
      manifestPath,
      registry: "http://127.0.0.1:1",
      serverPkgName: "@plume-canvas/server",
      uiPkgName: "@plume-canvas/ui",
      currentServerVersion: "0.1.0",
    })
    expect(result.skipped).toContain("@plume-canvas/plugin-demo")
    // UI 下载失败 → failed 不抛（错误键不要求，只要不炸）
    expect(result.uiVersion).toBeUndefined()
  })
})
