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
import type { AuditAppendInput } from '../audit.js'

const run = promisify(execFile)

let dir: string
let pluginsDir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-npm-'))
  pluginsDir = path.join(dir, 'plugins')
  await fs.mkdir(pluginsDir, { recursive: true })
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
  opts: {
    installable: boolean
    withServer: boolean
    version: string
    /** 自定义入口（第三方不按我们的命名规范时用），缺省 dist/plugin-demo.js */
    webEntry?: string
    serverEntry?: string
  },
): Promise<string> {
  const webRel = opts.webEntry ?? 'dist/plugin-demo.js'
  const webFile = path.join(workDir, 'payload', webRel)
  await fs.mkdir(path.dirname(webFile), { recursive: true })
    // 真实插件产物是 UMD（有 PlumePlugin* 全局）；测试数据也要给一份可识别的
    await fs.writeFile(
      webFile,
      '(function(e,t){t(e.PlumePluginDemo={})})(this,function(e){e.name="demo";e.apply=function(){}})',
      'utf8',
    )
  const serverCode = 'export const name = "demo"' + String.fromCharCode(10) + 'export function apply() {}'
  const serverRel = opts.serverEntry ?? 'dist/server.js'
  if (opts.withServer) {
    const serverFile = path.join(workDir, 'payload', serverRel)
    await fs.mkdir(path.dirname(serverFile), { recursive: true })
    await fs.writeFile(serverFile, serverCode, 'utf8')
  }
  const mini: Record<string, unknown> = { title: 'Demo', pluginName: 'demo' }
  if (opts.installable) mini.installable = true
  // 结构上"是个插件"：有 pluginName + web 入口（现在的判定看结构，不看 installable）
  mini.web = { entry: webRel }
  if (opts.withServer) mini.server = { entry: serverRel }
  const pkgJson = { name: '@plume-canvas/plugin-demo', version: opts.version, plume: mini }
  await fs.writeFile(path.join(workDir, 'payload', 'package.json'), JSON.stringify(pkgJson), 'utf8')
  const stage = path.join(workDir, 'stage')
  await fs.rm(stage, { recursive: true, force: true })
  await fs.cp(path.join(workDir, 'payload'), path.join(stage, 'package'), { recursive: true })
  const tgz = path.join(workDir, 'pkg.tgz')
  await run('tar', ['-czf', tgz, '-C', stage, 'package'])
  return tgz
}

/** 假审计出口：收集写进来的条目，用来断言 attempt 一定有结局。 */
function collector() {
  const entries: AuditAppendInput[] = []
  return { entries, audit: async (e: AuditAppendInput) => void entries.push(e) }
}

async function boot(registryUrl: string, audit?: (e: AuditAppendInput) => Promise<void>) {
  const routes = createNpmPluginsRoutes({
    registry: registryUrl,
    pluginsDir,
    recordFile: path.join(dir, '.npm-installed.json'),
    // 测试用 @plume-canvas/ 前缀（默认白名单是 @imohuan/ + plume-canvas-）
    scopeAllowlist: ['@plume-canvas/'],
    ...(audit ? { audit } : {}),
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
  it('审计成对：install 缺 confirm → attempt + rejected', async () => {
    const { entries, audit } = collector()
    const host = await boot('http://127.0.0.1:1', audit)
    const res = await call(host, '/api/npm-plugins/install', 'POST', { package: '@plume-canvas/plugin-demo' })
    expect(res.status).toBe(400)
    expect(entries.map((e) => e.result)).toEqual(['attempt', 'rejected'])
    expect(entries[1].reason).toBe('missing-confirm')
    host.stop()
  })

  it('审计成对：update 未安装 → 404 + rejected；已是最新 → ok', async () => {
    const tgz = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const packument = { name: '@plume-canvas/plugin-demo', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    registry = await startFakeRegistry(packument, { '/demo.tgz': tgz })
    ;(packument.versions as Record<string, unknown>)['1.0.0'] = {
      version: '1.0.0',
      dist: { tarball: registry.url + '/demo.tgz' },
      plume: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' }, server: { entry: 'dist/server.js' } },
    }

    const { entries, audit } = collector()
    const host = await boot(registry.url, audit)
    const missing = await call(host, '/api/npm-plugins/update', 'POST', {
      package: '@plume-canvas/plugin-demo',
      confirm: true,
    })
    expect(missing.status).toBe(404)
    expect(entries.map((e) => e.result)).toEqual(['attempt', 'rejected'])
    expect(entries[1].reason).toBe('not-installed')

    entries.length = 0
    await call(host, '/api/npm-plugins/install', 'POST', { package: '@plume-canvas/plugin-demo', confirm: true })
    const same = await call(host, '/api/npm-plugins/update', 'POST', { package: '@plume-canvas/plugin-demo', confirm: true })
    expect(same.status).toBe(200)
    // 第二条是 install 的 ok，之后是 update 的 attempt + ok
    expect(entries.map((e) => e.action + ':' + e.result)).toEqual([
      'npm-plugin/install:attempt',
      'npm-plugin/install:ok',
      'npm-plugin/update:attempt',
      'npm-plugin/update:ok',
    ])
    host.stop()
  })

  it('审计成对：install 下载异常也有 rejected（不会留下悬空的 attempt）', async () => {
    const { entries, audit } = collector()
    // 没有 registry 在跑：packument 请求会失败 → doInstall 返回 502
    const host = await boot('http://127.0.0.1:1', audit)
    const res = await call(host, '/api/npm-plugins/install', 'POST', {
      package: '@plume-canvas/plugin-demo',
      confirm: true,
    })
    expect(res.status).toBe(502)
    expect(entries.map((e) => e.result)).toEqual(['attempt', 'rejected'])
    expect(entries[1].reason).toBe('status-502')
    host.stop()
  })

  it('browse：按前缀列出全部可安装插件（不传搜索词也能列）', async () => {
    const tgz = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const packument = { name: '@plume-canvas/plugin-demo', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    registry = await startFakeRegistry(packument, {})
    ;(packument.versions as Record<string, unknown>)['1.0.0'] = {
      version: '1.0.0',
      dist: { tarball: registry.url + '/demo.tgz' },
      plume: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' }, server: { entry: 'dist/server.js' } },
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

  it('搜索：无关词（乱输入）不返回任何结果；包名含词才返回', async () => {
    const tgz = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const packument = { name: '@plume-canvas/plugin-demo', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    registry = await startFakeRegistry(packument, { '/demo.tgz': tgz })
    ;(packument.versions as Record<string, unknown>)['1.0.0'] = {
      version: '1.0.0',
      dist: { tarball: registry.url + '/demo.tgz' },
      plume: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' }, server: { entry: 'dist/server.js' } },
    }
    const host = await boot(registry.url)
    const search = async (q: string) =>
      (await (await host.app.fetch(new Request('http://x/api/npm-plugins/search?q=' + encodeURIComponent(q)))).json()) as {
        results: Array<{ pkg: string }>
      }
    // 无关词 → 空（用户实测的 bug：搜乱七八糟的东西下面照样有数据）
    expect((await search('乱七八糟zzz')).results).toEqual([])
    // 包名含词 → 命中
    expect((await search('plugin-demo')).results.map((r) => r.pkg)).toEqual(['@plume-canvas/plugin-demo'])
    host.stop()
  })
  let registry: FakeRegistry | undefined
  afterEach(() => { registry?.close(); registry = undefined })

  it('安全三闸：缺 confirm 400 / 非白名单前缀 400 / 非插件（缺 pluginName）400', async () => {
    const tgz = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const tgzPlain = await makePkg(dir + '-p', { installable: false, withServer: false, version: '1.0.0' })
    const packument = {
      name: '@plume-canvas/plugin-demo',
      'dist-tags': { latest: '1.0.0' },
      versions: {},
    }
    // 先起 registry（tarball 映射一并给出），再用它的端口填 URL
    registry = await startFakeRegistry(packument, { '/plain.tgz': tgz, '/plain2.tgz': tgzPlain })
    const ver = (packument.versions as Record<string, unknown>)
    ver['1.0.0'] = {
      version: '1.0.0',
      dist: { tarball: registry.url + '/plain.tgz' },
      plume: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' } },
    }
    ver['2.0.0'] = { version: '2.0.0', dist: { tarball: registry.url + '/plain2.tgz' }, plume: {} }

    const host = await boot(registry.url)
    const noConfirm = await call(host, '/api/npm-plugins/install', 'POST', { package: '@plume-canvas/plugin-demo' })
    expect(noConfirm.status).toBe(400)
    const badScope = await call(host, '/api/npm-plugins/install', 'POST', { package: '@evil/x', confirm: true })
    expect(badScope.status).toBe(400)
    const notPlugin = await call(host, '/api/npm-plugins/install', 'POST', { package: '@plume-canvas/plugin-demo', version: '2.0.0', confirm: true })
    expect(notPlugin.status).toBe(400)
    host.stop()
  })

  it('install → installed → update(已是最新) → uninstall 全流程', async () => {
    const tgz = await makePkg(dir, { installable: true, withServer: true, version: '1.0.0' })
    const packument = { name: '@plume-canvas/plugin-demo', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    // 先起 registry（拿到端口），再用它填 tarball URL —— 顺序反了会指向未监听的端口
    registry = await startFakeRegistry(packument, { '/demo.tgz': tgz })
    ;(packument.versions as Record<string, unknown>)['1.0.0'] = {
      version: '1.0.0',
      dist: { tarball: registry.url + '/demo.tgz' },
      plume: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' }, server: { entry: 'dist/server.js' } },
    }

    const host = await boot(registry.url)
    const inst = await j(await call(host, '/api/npm-plugins/install', 'POST', { package: '@plume-canvas/plugin-demo', confirm: true }))
    expect(inst.ok).toBe(true)
    expect(inst.hasServer).toBe(true)
    // 落盘保持包里的相对结构，入口按 package.json 的配置读（不统一改名）
    const installed = path.join(pluginsDir, 'plume-canvas__plugin-demo')
    await expect(fs.access(path.join(installed, 'dist', 'plugin-demo.js'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(installed, 'dist', 'server.js'))).resolves.toBeUndefined()
    const pj = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8')) as {
      plume: { web: { entry: string }; server: { entry: string } }
    }
    expect(pj.plume.web.entry).toBe('dist/plugin-demo.js')
    expect(pj.plume.server.entry).toBe('dist/server.js')

    const list = await j(await call(host, '/api/npm-plugins/installed'))
    expect((list.plugins as Array<{ pkg: string; version: string }>)[0]).toMatchObject({ pkg: '@plume-canvas/plugin-demo', version: '1.0.0' })

    const upd = await j(await call(host, '/api/npm-plugins/update', 'POST', { package: '@plume-canvas/plugin-demo', confirm: true }))
    expect(upd.updated).toBe(false)

    const un = await call(host, '/api/npm-plugins/uninstall', 'POST', { package: '@plume-canvas/plugin-demo' })
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
    const packument = { name: '@plume-canvas/plugin-demo', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    registry = await startFakeRegistry(packument, { '/v1.tgz': tgzV1, '/v11.tgz': tgzV11 })
    ;(packument.versions as Record<string, unknown>)['1.0.0'] = { version: '1.0.0', dist: { tarball: registry.url + '/v1.tgz' }, plume: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' }, server: { entry: 'dist/server.js' } } }
    ;(packument.versions as Record<string, unknown>)['1.1.0'] = { version: '1.1.0', dist: { tarball: registry.url + '/v11.tgz' }, plume: { pluginName: 'demo', web: { entry: 'dist/plugin-demo.js' }, server: { entry: 'dist/server.js' } } }

    const host = await boot(registry.url)
    await call(host, '/api/npm-plugins/install', 'POST', { package: '@plume-canvas/plugin-demo', version: '1.0.0', confirm: true })
    packument['dist-tags'].latest = '1.1.0'
    const upd = await j(await call(host, '/api/npm-plugins/update', 'POST', { package: '@plume-canvas/plugin-demo', confirm: true }))
    expect(upd.updated).toBe(true)
    expect(upd.to).toBe('1.1.0')
    const list = await j(await call(host, '/api/npm-plugins/installed'))
    expect((list.plugins as Array<{ version: string }>)[0].version).toBe('1.1.0')
    host.stop()
  })

  it('★ 第三方用自定义文件名：按 package.json 的 entry 落盘与读取，不按文件名猜', async () => {
    // 用户口径：我们自家插件保持 dist/web.js / dist/server.js 规范，但**加载方只认配置**。
    // 第三方作者写成 build/bundle.js、server/entry.js 也照样能装、能加载。
    const tgz = await makePkg(dir, {
      installable: true,
      withServer: true,
      version: '3.0.0',
      webEntry: 'build/bundle.js',
      serverEntry: 'server/entry.js',
    })
    const packument = { name: '@plume-canvas/plugin-demo', 'dist-tags': { latest: '3.0.0' }, versions: {} }
    registry = await startFakeRegistry(packument, { '/demo.tgz': tgz })
    ;(packument.versions as Record<string, unknown>)['3.0.0'] = {
      version: '3.0.0',
      dist: { tarball: registry.url + '/demo.tgz' },
      plume: {
        pluginName: 'demo',
        web: { entry: 'build/bundle.js' },
        server: { entry: 'server/entry.js' },
      },
    }
    const host = await boot(registry.url)
    const inst = await j(await call(host, '/api/npm-plugins/install', 'POST', { package: '@plume-canvas/plugin-demo', confirm: true }))
    expect(inst.ok, String(inst.error)).toBe(true)
    expect(inst.hasServer).toBe(true)
    const installed = path.join(pluginsDir, 'plume-canvas__plugin-demo')
    // 原样落盘（不改名），配置也原样保留
    await expect(fs.access(path.join(installed, 'build', 'bundle.js'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(installed, 'server', 'entry.js'))).resolves.toBeUndefined()
    const pj = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8')) as {
      plume: { web: { entry: string }; server: { entry: string } }
    }
    expect(pj.plume.web.entry).toBe('build/bundle.js')
    expect(pj.plume.server.entry).toBe('server/entry.js')
    host.stop()
  })
})
