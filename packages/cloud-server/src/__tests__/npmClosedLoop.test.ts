/**
 * NPM 闭环端到端（计划 Task 6 的自动化替身，真包发布前的最强证据）。
 *
 * 用**真实 npm pack 产物**（plugin-showcase 的 3 文件包）走完整链路：
 *   npm pack → 假 registry（packument + 真 tgz）→ /api/npm-plugins/install
 *   → 前端半落 catalog 目录（可被 buildPluginCatalog 扫到）
 *   → 后台半落 server-plugins（能被真 loader 装载）→ 起服务 → /api/showcase/* 真实可调
 *   → uninstall → 两半都消失。
 *
 * 这证明「装 NPM 包 = 插件真的活了」，而不只是文件到位。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createNpmPluginsRoutes } from '../routes/npmPlugins.js'
import { buildPluginCatalog } from '../plugins/catalog.js'
import { createServerFramework } from '../serverFramework/index.js'
import { loadServerPluginsFromDir } from '../serverFramework/pluginLoader.js'

const run = promisify(execFile)
const REPO_ROOT = path.resolve(__dirname, '../../..')
const SHOWCASE_DIR = path.join(REPO_ROOT, 'plugins', 'plugin-showcase')

/** 跑 npm pack，拿到真实产物 tgz 路径 */
async function npmPackReal(): Promise<string> {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pack-'))
  // Windows 上 npm 是 .cmd，execFile 需要 shell 才能起（与 build-assets-parallel.mjs 同处理）
  const { stdout } = await run('npm', ['pack', '--pack-destination', outDir], {
    cwd: SHOWCASE_DIR,
    shell: process.platform === 'win32',
  })
  // stdout 最后一行是文件名（可能含前导 notice 行）
  const file = stdout.trim().split(/\r?\n/).filter((l) => l.endsWith('.tgz')).pop()
  if (!file) throw new Error('npm pack 没产出 tgz：' + stdout)
  return path.join(outDir, file)
}

/** npm tgz 的顶层是 package/，其内是 package.json + dist/ */
async function readPackedPackageJson(tgz: string): Promise<Record<string, unknown>> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'peek-'))
  await run('tar', ['-xzf', tgz, '-C', tmp, '--strip-components=1', 'package/package.json'])
  return JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8'))
}

describe('NPM 闭环：真 pack 产物 → 安装 → 插件真的活 → 卸载', () => {
  let dir: string
  let pluginsDir: string
  let serverPluginsDir: string
  let registryUrl: string
  let server: http.Server
  let packuments: Record<string, unknown>
  let tarballs: Record<string, string>
  let tgz: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-loop-'))
    pluginsDir = path.join(dir, 'plugins')
    serverPluginsDir = path.join(dir, 'server-plugins')
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.mkdir(serverPluginsDir, { recursive: true })

    tgz = await npmPackReal()
    const pkgJson = await readPackedPackageJson(tgz)
    const name = String(pkgJson.name)
    const version = String(pkgJson.version)
    packuments = {
      [name]: {
        name,
        'dist-tags': { latest: version },
        versions: {
          [version]: { version, dist: { tarball: 'TARBALL_PLACEHOLDER' }, miniCanvas: pkgJson.miniCanvas },
        },
      },
    }
    // tarball 映射：以 packument 里约定的文件名做键
    tarballs = { '/pkg.tgz': tgz }

    server = http.createServer((req, res) => {
      const url = req.url ?? ''
      if (tarballs[url]) {
        void fs.readFile(tarballs[url]!).then((b) => {
          res.setHeader('content-type', 'application/octet-stream')
          res.end(b)
        })
        return
      }
      const pkg = packuments[decodeURIComponent(url.replace(/^\//, ''))]
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(pkg ?? {}))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    registryUrl = 'http://127.0.0.1:' + (server.address() as { port: number }).port
    // 用真端口回填 tarball 地址
    for (const p of Object.values(packuments) as Array<{ versions: Record<string, { dist: { tarball: string } }> }>) {
    for (const v of Object.values(p.versions)) v.dist.tarball = registryUrl + '/pkg.tgz'
    }
    // 真跑 npm pack：并发下单次可能 >10s（默认 hook 超时），给它放宽
  }, 60_000)

  afterAll(async () => {
    // beforeAll 若失败（如并发下 npm pack 超时），这里要能安全收尾
    if (server) await new Promise<void>((r) => server.close(() => r()))
    if (dir) await fs.rm(dir, { recursive: true, force: true })
    if (tgz) await fs.rm(path.dirname(tgz), { recursive: true, force: true })
  })

  it('安装 → 前端半进 catalog → 后台半被 loader 装载 → /api/showcase 可调 → 卸载即清', async () => {
    // ---- 1) 安装 ----
    const routes = createNpmPluginsRoutes({
      registry: registryUrl,
      pluginsDir,
      serverPluginsDir,
      recordFile: path.join(dir, '.npm-installed.json'),
    })
    const host = createServerFramework({ root: dir })
    host.ctx.routes.adopt(routes)
    await host.start()
    const res = await host.app.fetch(new Request('http://x/api/npm-plugins/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: '@imohuan/plugin-showcase', confirm: true }),
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; hasServer: boolean; version: string }
    expect(body.ok).toBe(true)
    expect(body.hasServer).toBe(true)
    host.stop()

    // ---- 2) 前端半被 catalog 扫到（管理页能列出、前端能装载）----
    const catalog = await buildPluginCatalog(pluginsDir)
    const entry = catalog.plugins.find((p) => p.id === 'imohuan__plugin-showcase')
    expect(entry, '装进来的前端半应被 catalog 收录').toBeTruthy()
    expect(entry!.globalName).toBe('MiniCanvasPluginShowcase')
    expect(entry!.server?.sha256).toMatch(/^[0-9a-f]{64}$/)

    // ---- 3) 后台半被真 loader 装载，服务真的能调 ----
    const loaded = await loadServerPluginsFromDir(serverPluginsDir)
    expect(loaded.failures).toEqual([])
    expect(loaded.modules.map((m) => m.name)).toContain('showcase')

    const live = createServerFramework({ root: dir })
    for (const m of loaded.modules) live.ctx.plugin(m)
    await live.start()
    const meta = await live.app.fetch(new Request('http://x/api/showcase/meta'))
    expect(meta.status).toBe(200)
    expect(((await meta.json()) as { name: string }).name).toBe('showcase')
    const hello = await live.app.fetch(new Request('http://x/api/showcase/hello'))
    expect(hello.status).toBe(200)
    live.stop()

    // ---- 4) 卸载 → 两半文件都清掉 ----
    const host2 = createServerFramework({ root: dir })
    host2.ctx.routes.adopt(createNpmPluginsRoutes({
      registry: registryUrl,
      pluginsDir,
      serverPluginsDir,
      recordFile: path.join(dir, '.npm-installed.json'),
    }))
    await host2.start()
    const del = await host2.app.fetch(new Request('http://x/api/npm-plugins/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: '@imohuan/plugin-showcase' }),
    }))
    expect(del.status).toBe(200)
    host2.stop()
    await expect(fs.access(path.join(serverPluginsDir, 'imohuan__plugin-showcase.js'))).rejects.toThrow()
    await expect(fs.access(path.join(pluginsDir, 'imohuan__plugin-showcase'))).rejects.toThrow()
  }, 60_000)
})
