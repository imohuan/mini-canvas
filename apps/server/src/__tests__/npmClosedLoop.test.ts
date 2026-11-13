/**
 * NPM 闭环端到端（计划 Task 6 的自动化替身，真包发布前的最强证据）。
 *
 * 用**真实 npm pack 产物**（测试现造的最小插件包）走完整链路：
 *   npm pack → 假 registry（packument + 真 tgz）→ /api/npm-plugins/install
 *   → 前端半落 catalog 目录（可被 buildPluginCatalog 扫到）
 *   → 后台半落在插件目录（能被真 loader 装载）→ 起服务 → /api/loop/* 真实可调
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
import { loadServerPluginsFromPluginDirs } from '../serverFramework/pluginLoader.js'

const run = promisify(execFile)

const PKG_NAME = '@plume-canvas/plugin-loop'
const DIR_NAME = 'plume-canvas__plugin-loop'

/** 现造一个最小可装卸插件包：UMD 前端半 + 单文件后台半 + package.json */
async function makePluginPkg(workDir: string): Promise<string> {
  const pkgDir = path.join(workDir, 'pkg')
  await fs.mkdir(path.join(pkgDir, 'dist'), { recursive: true })
  await fs.writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: PKG_NAME,
      version: '1.0.0',
      plume: {
        title: '闭环样板',
        pluginName: 'loop',
        web: { entry: 'dist/plugin-loop.js' },
        server: { entry: 'dist/server.js' },
      },
    }),
    'utf8',
  )
  await fs.writeFile(
    path.join(pkgDir, 'dist', 'plugin-loop.js'),
    '(function(e,t){t(e.PlumePluginLoop={})})(this,function(e){e.name="loop";e.apply=function(){}})',
    'utf8',
  )
  await fs.writeFile(
    path.join(pkgDir, 'dist', 'server.js'),
    [
      'export const name = "loop"',
      'export function apply(ctx) {',
      '  ctx.routes.get("/api/loop/meta", (c) => c.json({ name: "loop" }))',
      '  ctx.routes.get("/api/loop/hello", (c) => c.json({ ok: true }))',
      '}',
    ].join('\n'),
    'utf8',
  )
  return pkgDir
}

/** 跑 npm pack，拿到真实产物 tgz 路径 */
async function npmPackReal(pkgDir: string): Promise<string> {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pack-'))
  // 输出用 JSON，免得 npm notice 混进文件名
  const { stdout } = await run('npm', ['pack', '--json', '--pack-destination', outDir], {
    cwd: pkgDir,
    shell: process.platform === 'win32',
  })
  const parsed = JSON.parse(stdout) as Array<{ filename?: string }> | { filename?: string }
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  if (!first?.filename) throw new Error('npm pack 没产出 tgz：' + stdout)
  return path.join(outDir, path.basename(first.filename))
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
  let registryUrl: string
  let server: http.Server
  let packuments: Record<string, unknown>
  let tarballs: Record<string, string>
  let tgz: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-loop-'))
    pluginsDir = path.join(dir, 'plugins')
    await fs.mkdir(pluginsDir, { recursive: true })

    tgz = await npmPackReal(await makePluginPkg(dir))
    const pkgJson = await readPackedPackageJson(tgz)
    const name = String(pkgJson.name)
    const version = String(pkgJson.version)
    packuments = {
      [name]: {
        name,
        'dist-tags': { latest: version },
        versions: {
          [version]: { version, dist: { tarball: 'TARBALL_PLACEHOLDER' }, plume: pkgJson.plume },
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

  it('安装 → 前端半进 catalog → 后台半被 loader 装载 → /api/loop 可调 → 卸载即清', async () => {
    // ---- 1) 安装 ----
    const routes = createNpmPluginsRoutes({
      registry: registryUrl,
      pluginsDir,
      recordFile: path.join(dir, '.npm-installed.json'),
    })
    const host = createServerFramework({ root: dir })
    host.ctx.routes.adopt(routes)
    await host.start()
    const res = await host.app.fetch(new Request('http://x/api/npm-plugins/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: PKG_NAME, confirm: true }),
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; hasServer: boolean; version: string }
    expect(body.ok).toBe(true)
    expect(body.hasServer).toBe(true)
    host.stop()

    // ---- 2) 前端半被 catalog 扫到（管理页能列出、前端能装载）----
    const catalog = await buildPluginCatalog(pluginsDir)
    // 落盘目录名 = 包名去 @、/ 换 __（见 npmPlugins.ts 的 dirNameOf）
    const entry = catalog.plugins.find((p) => p.id === DIR_NAME)
    expect(entry, '装进来的前端半应被 catalog 收录').toBeTruthy()
    expect(entry!.globalName).toBe('PlumePluginLoop')
    expect(entry!.server?.sha256).toMatch(/^[0-9a-f]{64}$/)

    // ---- 3) 后台半被真 loader 装载，服务真的能调 ----
    const loaded = await loadServerPluginsFromPluginDirs(pluginsDir)
    expect(loaded.failures).toEqual([])
    expect(loaded.modules.map((m) => m.name)).toContain('loop')

    const live = createServerFramework({ root: dir })
    for (const m of loaded.modules) live.ctx.plugin(m)
    await live.start()
    const meta = await live.app.fetch(new Request('http://x/api/loop/meta'))
    expect(meta.status).toBe(200)
    expect(((await meta.json()) as { name: string }).name).toBe('loop')
    const hello = await live.app.fetch(new Request('http://x/api/loop/hello'))
    expect(hello.status).toBe(200)
    live.stop()

    // ---- 4) 卸载 → 两半文件都清掉 ----
    const host2 = createServerFramework({ root: dir })
    host2.ctx.routes.adopt(createNpmPluginsRoutes({
      registry: registryUrl,
      pluginsDir,
      recordFile: path.join(dir, '.npm-installed.json'),
    }))
    await host2.start()
    const del = await host2.app.fetch(new Request('http://x/api/npm-plugins/uninstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: PKG_NAME }),
    }))
    expect(del.status).toBe(200)
    host2.stop()
    await expect(fs.access(path.join(pluginsDir, DIR_NAME))).rejects.toThrow()
  }, 60_000)
})
