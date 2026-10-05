/**
 * NPM 插件路由全流程测试（Task 4 Step 3）：本地假 registry + 真实 tgz 打包/解包。
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
let serverPluginsDir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-npm-'))
  pluginsDir = path.join(dir, 'plugins')
  serverPluginsDir = path.join(dir, 'server-plugins')
  await fs.mkdir(pluginsDir, { recursive: true })
  await fs.mkdir(serverPluginsDir, { recursive: true })
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

interface FakeRegistry { url: string; close(): void }

/** 假 registry：按 url 精确匹配 tarball；其余路径回 packument JSON */
async function startFakeRegistry(
  packument: unknown,
  tarballs: Record<string, string>,
): Promise<FakeRegistry> {
  const server = http.createServer((req, res) => {
    const tgz = tarballs[req.url ?? '']
    if (tgz) {
      void fs.readFile(tgz).then((b) => {
        res.setHeader('content-type', 'application/octet-stream')
        res.end(b)
      })
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(packument))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  return { url: 'http://127.0.0.1:' + addr.port, close: () => server.close() }
}

/** 造包 payload（package.json + dist/）并打成顶层 package/ 的 tgz */
async function makePkg(
  workDir: string,
  opts: { installable: boolean; withServer: boolean; version: string },
): Promise<string> {
  const dist = path.join(workDir, 'payload', 'dist')
  await fs.mkdir(dist, { recursive: true })
  await fs.writeFile(path.join(dist, 'plugin-demo.js'), '/* demo web half */', 'utf8')
  const serverCode = 'export const name = "demo"' + String.fromCharCode(10) + 'export function apply() {}'
  if (opts.withServer) await fs.writeFile(path.join(dist, 'server.js'), serverCode, 'utf8')
  const mini: Record<string, unknown> = { title: 'Demo', pluginName: 'demo' }
  if (opts.installable) mini.installable = true
  // 结构上"是个插件"：有 pluginName + web 入口（现在的判定看结构，不看 installable）
  mini.web = { entry: 'dist/plugin-demo.js' }
  if (opts.withServer) mini.server = { entry: 'dist/server.js' }
  const pkgJson = { name: '@mini-canvas/plugin-demo', version: opts.version, miniCanvas: mini }
  await fs.writeFile(path.join(workDir, 'payload', 'package.json'), JSON.stringify(pkgJson), 'utf8')
  const stage = path.join(workDir, 'stage')
  await fs.rm(stage, { recursive: true, force: true })
  await fs.cp(path.join(workDir, 'payload'), path.join(stage, 'package'), { recursive: true })
  const tgz = path.join(workDir, 'pkg.tgz')
  await run('tar', ['-czf', tgz, '-C', stage, 'package'])
  return tgz
}

async function boot(registryUrl: string) {
  const routes = createNpmPluginsRoutes({
    registry: registryUrl,
    pluginsDir,
    serverPluginsDir,
    recordFile: path.join(dir, '.npm-installed.json'),
    // 测试用 @mini-canvas/ 前缀（默认白名单是 @imohuan/ + mini-canvas-）
    scopeAllowlist: ['@mini-canvas/'],
  })
  const host = createServerFramework({ root: dir })
  host.ctx.routes.adopt(routes)
  await host.start()
  return host
}

import type { Hono } from 'hono'
const call = (host: { app: Hono }, p: string, method?: string, body?: unknown) =>
  host.app.fetch(new Request('http://x' + p, {
    method: method ?? 'GET',
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  }))

const j = async (r: Response) => (await r.json()) as Record<string, unknown>

describe('NPM 插件路由（假 registry 全流程）', () => {
  it('browse：按前缀列出全部可安装插件（不传搜索词也能列）', async () => {
    const tgz = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const packument = { name: '@mini-canvas/plugin-demo', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    registry = await startFakeRegistry(packument, {})
    ;(packument.versions as Record<string, unknown>)['1.0.0'] = {
      version: '1.0.0',
      dist: { tarball: registry.url + '/demo.tgz' },
      miniCanvas: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' } },
    }
    registry.close()
    registry = await startFakeRegistry(packument, { '/demo.tgz': tgz })
    const host = await boot(registry.url)
    const res = await host.app.fetch(new Request('http://x/api/npm-plugins/browse'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; results: Array<{ pkg: string }> }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.results)).toBe(true)
    host.stop()
  })
  let registry: FakeRegistry | undefined
  afterEach(() => { registry?.close(); registry = undefined })

  it('安全三闸：缺 confirm 400 / 非白名单前缀 400 / 非插件（缺 pluginName）400', async () => {
    const tgz = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const tgzPlain = await makePkg(dir + '-p', { installable: false, withServer: false, version: '1.0.0' })
    const packument = {
      name: '@mini-canvas/plugin-demo',
      'dist-tags': { latest: '1.0.0' },
      versions: {},
    }
    // 先起 registry（tarball 映射一并给出），再用它的端口填 URL
    registry = await startFakeRegistry(packument, { '/plain.tgz': tgz, '/plain2.tgz': tgzPlain })
    const ver = (packument.versions as Record<string, unknown>)
    ver['1.0.0'] = {
      version: '1.0.0',
      dist: { tarball: registry.url + '/plain.tgz' },
      miniCanvas: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' } },
    }
    ver['2.0.0'] = { version: '2.0.0', dist: { tarball: registry.url + '/plain2.tgz' }, miniCanvas: {} }

    const host = await boot(registry.url)
    const noConfirm = await call(host, '/api/npm-plugins/install', 'POST', { package: '@mini-canvas/plugin-demo' })
    expect(noConfirm.status).toBe(400)
    const badScope = await call(host, '/api/npm-plugins/install', 'POST', { package: '@evil/x', confirm: true })
    expect(badScope.status).toBe(400)
    const notPlugin = await call(host, '/api/npm-plugins/install', 'POST', { package: '@mini-canvas/plugin-demo', version: '2.0.0', confirm: true })
    expect(notPlugin.status).toBe(400)
    host.stop()
  })

  it('install → installed → update(已是最新) → uninstall 全流程', async () => {
    const tgz = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const packument = { name: '@mini-canvas/plugin-demo', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    // 先起 registry（拿到端口），再用它填 tarball URL —— 顺序反了会指向未监听的端口
    registry = await startFakeRegistry(packument, { '/demo.tgz': tgz })
    ;(packument.versions as Record<string, unknown>)['1.0.0'] = {
      version: '1.0.0',
      dist: { tarball: registry.url + '/demo.tgz' },
      miniCanvas: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' } },
    }

    const host = await boot(registry.url)
    const inst = await j(await call(host, '/api/npm-plugins/install', 'POST', { package: '@mini-canvas/plugin-demo', confirm: true }))
    expect(inst.ok).toBe(true)
    expect(inst.hasServer).toBe(true)
    await expect(fs.access(path.join(pluginsDir, 'mini-canvas__plugin-demo', 'dist', 'plugin-demo.js'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(serverPluginsDir, 'mini-canvas__plugin-demo.js'))).resolves.toBeUndefined()

    const list = await j(await call(host, '/api/npm-plugins/installed'))
    expect((list.plugins as Array<{ pkg: string; version: string }>)[0]).toMatchObject({ pkg: '@mini-canvas/plugin-demo', version: '1.0.0' })

    const upd = await j(await call(host, '/api/npm-plugins/update', 'POST', { package: '@mini-canvas/plugin-demo', confirm: true }))
    expect(upd.updated).toBe(false)

    const un = await call(host, '/api/npm-plugins/uninstall', 'POST', { package: '@mini-canvas/plugin-demo' })
    expect(un.status).toBe(200)
    const list2 = await j(await call(host, '/api/npm-plugins/installed'))
    expect(list2.plugins).toEqual([])
    host.stop()
  })

  it('update 升级到新版本并覆盖记录', async () => {
    const tgzV1 = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const dir2 = dir + '-v11'
    await fs.mkdir(dir2, { recursive: true })
    const tgzV11 = await makePkg(dir2, { installable: true, withServer: true, version: '1.1.0' })
    const packument = { name: '@mini-canvas/plugin-demo', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    registry = await startFakeRegistry(packument, { '/v1.tgz': tgzV1, '/v11.tgz': tgzV11 })
    ;(packument.versions as Record<string, unknown>)['1.0.0'] = { version: '1.0.0', dist: { tarball: registry.url + '/v1.tgz' }, miniCanvas: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' } } }
    ;(packument.versions as Record<string, unknown>)['1.1.0'] = { version: '1.1.0', dist: { tarball: registry.url + '/v11.tgz' }, miniCanvas: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' } } }

    const host = await boot(registry.url)
    await call(host, '/api/npm-plugins/install', 'POST', { package: '@mini-canvas/plugin-demo', version: '1.0.0', confirm: true })
    packument['dist-tags'].latest = '1.1.0'
    const upd = await j(await call(host, '/api/npm-plugins/update', 'POST', { package: '@mini-canvas/plugin-demo', confirm: true }))
    expect(upd.updated).toBe(true)
    expect(upd.to).toBe('1.1.0')
    const list = await j(await call(host, '/api/npm-plugins/installed'))
    expect((list.plugins as Array<{ version: string }>)[0].version).toBe('1.1.0')
    host.stop()
  })
})
