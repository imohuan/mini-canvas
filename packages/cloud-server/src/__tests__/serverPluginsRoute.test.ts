/**
 * 后台插件的安装/卸载/清单路由（Task 7）。
 *
 * ⚠️ 这是本计划**攻击面最大**的地方：install 路由等于"把下载到的 JS 当服务端代码执行"。
 * 所以每条安全约束都要有测试：
 *   - 缺 confirm → 400（界面必须显式确认）
 *   - 跨源 URL → 拒绝
 *   - sha256 不符 → 拒绝
 *   - 合法安装 → 落到 server-plugins 目录 + 能列出
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServerFramework } from '../serverFramework/index.js'
import { createServerPluginsRoutes } from '../routes/serverPlugins.js'
import { createHash } from 'node:crypto'
import type { AuditAppendInput } from '../audit.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-sp-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const SRC = 'export const name = "ext"\nexport function apply() {}\n'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

function boot(routes: ReturnType<typeof createServerPluginsRoutes>) {
  const host = createServerFramework()
  host.ctx.routes.adopt(routes)
  return host
}

/**
 * 造一个"可信哈希来源"：只认一个 id，返回给定哈希。
 * 对应生产里"服务端扫插件目录得到的清单"（审查明确要求校验锚点必须在服务端，
 * 不能是调用方现算的哈希）。
 */
const trusted = (id: string, hash: string) => async (want: string) => (want === id ? hash : undefined)

/** 假审计出口：收集写进来的条目，用来断言 attempt 一定有结局。 */
function collector() {
  const entries: AuditAppendInput[] = []
  return { entries, audit: async (e: AuditAppendInput) => void entries.push(e) }
}

describe('server-plugins 安装路由（安全收口）', () => {
  it('审计成对：缺 confirm 的安装有 attempt + rejected', async () => {
    const { entries, audit } = collector()
    const host = boot(
      createServerPluginsRoutes({ dir, origin: 'http://x', trustedShaOf: trusted('ext', sha256(SRC)), audit }),
    )
    await host.start()
    await host.app.fetch(
      new Request('http://x/api/server-plugins/install', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext', code: SRC, sha256: sha256(SRC) }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(entries.map((e) => e.result)).toEqual(['attempt', 'rejected'])
    expect(entries[1].reason).toContain('confirm')
    expect(entries.every((e) => e.id === 'ext')).toBe(true)
    host.ctx.stop()
  })

  it('审计成对：卸载非法 id 也有 rejected（不再只有 attempt）', async () => {
    const { entries, audit } = collector()
    const host = boot(createServerPluginsRoutes({ dir, audit }))
    await host.start()
    const res = await host.app.fetch(
      new Request('http://x/api/server-plugins/uninstall', {
        method: 'POST',
        body: JSON.stringify({ id: '../evil' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    expect(entries.map((e) => e.result)).toEqual(['attempt', 'rejected'])
    expect(entries[1].reason).toBe('非法插件 id')
    host.ctx.stop()
  })

  it('审计成对：热装失败仍记 ok，并把失败原因写进 reason', async () => {
    const { entries, audit } = collector()
    const host = boot(
      createServerPluginsRoutes({
        dir,
        origin: 'http://x',
        trustedShaOf: trusted('ext', sha256(SRC)),
        hotInstall: async () => ({ ok: false, error: 'import 炸了' }),
        audit,
      }),
    )
    await host.start()
    const res = await host.app.fetch(
      new Request('http://x/api/server-plugins/install', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext', code: SRC, sha256: sha256(SRC), confirm: true }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(200)
    expect(entries.map((e) => e.result)).toEqual(['attempt', 'ok'])
    expect(entries[1].reason).toContain('import 炸了')
    expect(entries[1].sha256).toBe(sha256(SRC))
    host.ctx.stop()
  })

  it('缺 confirm → 400', async () => {
    const host = boot(
      createServerPluginsRoutes({ dir, origin: 'http://x', trustedShaOf: trusted('ext', sha256(SRC)) }),
    )
    await host.start()
    const res = await host.app.fetch(
      new Request('http://x/api/server-plugins/install', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext', code: SRC, sha256: sha256(SRC) }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    host.ctx.stop()
  })

  it('sha256 与清单不符 → 拒绝（锚点是服务端可信源，不是调用方声明）', async () => {
    // 可信源说 ext 的哈希是 sha256(SRC)；调用方送来不一样的字节 → 必须拒
    const host = boot(
      createServerPluginsRoutes({ dir, origin: 'http://x', trustedShaOf: trusted('ext', sha256(SRC)) }),
    )
    await host.start()
    const res = await host.app.fetch(
      new Request('http://x/api/server-plugins/install', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext', code: 'export const name="evil";export function apply(){}', sha256: sha256(SRC), confirm: true }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(String(body.error)).toContain('sha256')
    host.ctx.stop()
  })

  it('非法 id（路径穿越）→ 400', async () => {
    const host = boot(
      createServerPluginsRoutes({ dir, origin: 'http://x', trustedShaOf: trusted('ext', sha256(SRC)) }),
    )
    await host.start()
    const res = await host.app.fetch(
      new Request('http://x/api/server-plugins/install', {
        method: 'POST',
        body: JSON.stringify({ id: '../evil', code: SRC, sha256: sha256(SRC), confirm: true }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    host.ctx.stop()
  })

  it('合法安装：写进目录 + 能列出 + 能卸载', async () => {
    const host = boot(
      createServerPluginsRoutes({ dir, origin: 'http://x', trustedShaOf: trusted('ext', sha256(SRC)) }),
    )
    await host.start()
    const install = await host.app.fetch(
      new Request('http://x/api/server-plugins/install', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext', code: SRC, sha256: sha256(SRC), confirm: true }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(install.status).toBe(200)
    // 文件真的落盘了
    expect(await fs.readFile(path.join(dir, 'ext.js'), 'utf8')).toBe(SRC)

    const list = await host.app.fetch(new Request('http://x/api/server-plugins'))
    const body = (await list.json()) as { plugins?: Array<{ id: string }> }
    expect(body.plugins?.map((p) => p.id)).toEqual(['ext'])

    const del = await host.app.fetch(
      new Request('http://x/api/server-plugins/uninstall', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(del.status).toBe(200)
    expect(await fs.readdir(dir)).toEqual([])
    host.ctx.stop()
  })

  it('GET 清单带 loaded（本次启动已登记的外挂插件名，运行时观测面）', async () => {
    const host = boot(createServerPluginsRoutes({ dir, loaded: ['my-ext', 'other'] }))
    await host.start()
    const res = await host.app.fetch(new Request('http://x/api/server-plugins'))
    const body = (await res.json()) as { loaded?: string[] }
    expect(body.loaded).toEqual(['my-ext', 'other'])
    host.ctx.stop()
  })

  it('没有可信哈希来源 → 拒绝安装（不假装校验过）', async () => {
    const host = boot(createServerPluginsRoutes({ dir, origin: 'http://x' }))
    await host.start()
    const res = await host.app.fetch(
      new Request('http://x/api/server-plugins/install', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext', code: SRC, sha256: sha256(SRC), confirm: true }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(String(body.error)).toContain('可信哈希')
    host.ctx.stop()
  })

  it('可信源不认识这个 id → 拒绝（未列入清单不许装）', async () => {
    const host = boot(
      createServerPluginsRoutes({ dir, origin: 'http://x', trustedShaOf: trusted('other', sha256(SRC)) }),
    )
    await host.start()
    const res = await host.app.fetch(
      new Request('http://x/api/server-plugins/install', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext', code: SRC, sha256: sha256(SRC), confirm: true }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
    host.ctx.stop()
  })
})

describe('server-plugins：调试用的按路径安装（install-from-path）', () => {
  /** 在允许的根目录里写一个后台产物，返回它的绝对路径 */
  async function writeArtifact(root: string, rel: string, code: string): Promise<string> {
    const abs = path.join(root, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, code, 'utf8')
    return abs
  }

  /** 走真实 Host（本机回环），否则会被 403 拦掉 */
  function loopback(pathname: string, body: unknown): Request {
    return new Request('http://127.0.0.1:8865' + pathname, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', host: '127.0.0.1:8865' },
    })
  }

  it('没配 debugInstall → 路由不存在（生产默认关闭）', async () => {
    const allowed = path.join(dir, 'allowed')
    const file = await writeArtifact(allowed, 'server.js', SRC)
    const host = boot(createServerPluginsRoutes({ dir: path.join(dir, 'sp') }))
    await host.start()
    const res = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: 'ext', path: file, confirm: true }))
    expect(res.status).toBe(404)
    host.ctx.stop()
  })

  it('合法：读磁盘文件 → 落盘到 server-plugins → 先卸同名再热装', async () => {
    const allowed = path.join(dir, 'allowed')
    const spDir = path.join(dir, 'sp')
    const file = await writeArtifact(allowed, 'server.js', SRC)
    const events: string[] = []
    const host = boot(
      createServerPluginsRoutes({
        dir: spDir,
        debugInstall: { allowRoots: [allowed] },
        hotUninstall: async (id) => {
          events.push('uninstall:' + id)
          return { ok: true }
        },
        hotInstall: async (id) => {
          events.push('install:' + id)
          return { ok: true }
        },
      }),
    )
    await host.start()
    const res = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: 'ext', path: file, confirm: true }))
    expect(res.status).toBe(200)
    expect(await fs.readFile(path.join(spDir, 'ext.js'), 'utf8')).toBe(SRC)
    // 关键顺序：先卸载旧同名，再装新 —— 否则内核同名会拒装（= 文件新、内存旧）
    expect(events).toEqual(['uninstall:ext', 'install:ext'])
    host.ctx.stop()
  })

  it('同名卸载失败 → 停止安装（不能两个版本同时跑）', async () => {
    const allowed = path.join(dir, 'allowed')
    const file = await writeArtifact(allowed, 'server.js', SRC)
    const host = boot(
      createServerPluginsRoutes({
        dir: path.join(dir, 'sp'),
        debugInstall: { allowRoots: [allowed] },
        hotUninstall: async () => ({ ok: false, error: 'dispose 炸了' }),
        hotInstall: async () => ({ ok: true }),
      }),
    )
    await host.start()
    const res = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: 'ext', path: file, confirm: true }))
    expect(res.status).toBe(409)
    host.ctx.stop()
  })

  it('第一次装（内核里没有）→ 卸载报"没有该插件"不算失败，照常安装', async () => {
    const allowed = path.join(dir, 'allowed')
    const file = await writeArtifact(allowed, 'server.js', SRC)
    let installed = false
    const host = boot(
      createServerPluginsRoutes({
        dir: path.join(dir, 'sp'),
        debugInstall: { allowRoots: [allowed] },
        hotUninstall: async () => ({ ok: false, error: '内核里没有该插件（可能从未装载）：ext' }),
        hotInstall: async () => {
          installed = true
          return { ok: true }
        },
      }),
    )
    await host.start()
    const res = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: 'ext', path: file, confirm: true }))
    expect(res.status).toBe(200)
    expect(installed).toBe(true)
    host.ctx.stop()
  })

  it('路径不在允许的根目录内 → 403（不能变成任意读盘）', async () => {
    const allowed = path.join(dir, 'allowed')
    await fs.mkdir(allowed, { recursive: true })
    const outside = await writeArtifact(path.join(dir, 'outside'), 'evil.js', SRC)
    const host = boot(
      createServerPluginsRoutes({ dir: path.join(dir, 'sp'), debugInstall: { allowRoots: [allowed] } }),
    )
    await host.start()
    const res = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: 'ext', path: outside, confirm: true }))
    expect(res.status).toBe(403)
    host.ctx.stop()
  })

  it('用 .. 穿越出允许目录 → 403', async () => {
    const allowed = path.join(dir, 'allowed')
    await fs.mkdir(allowed, { recursive: true })
    await writeArtifact(path.join(dir, 'outside'), 'evil.js', SRC)
    const host = boot(
      createServerPluginsRoutes({ dir: path.join(dir, 'sp'), debugInstall: { allowRoots: [allowed] } }),
    )
    await host.start()
    const sneaky = path.join(allowed, '..', 'outside', 'evil.js')
    const res = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: 'ext', path: sneaky, confirm: true }))
    expect(res.status).toBe(403)
    host.ctx.stop()
  })

  it('非本机 Host → 403（局域网/反代过来的请求不能读本机文件）', async () => {
    const allowed = path.join(dir, 'allowed')
    const file = await writeArtifact(allowed, 'server.js', SRC)
    const host = boot(
      createServerPluginsRoutes({ dir: path.join(dir, 'sp'), debugInstall: { allowRoots: [allowed] } }),
    )
    await host.start()
    const res = await host.app.fetch(
      new Request('http://evil.example/api/server-plugins/install-from-path', {
        method: 'POST',
        body: JSON.stringify({ id: 'ext', path: file, confirm: true }),
        headers: { 'content-type': 'application/json', host: 'evil.example' },
      }),
    )
    expect(res.status).toBe(403)
    host.ctx.stop()
  })

  it('缺 confirm / 非法 id / 非 js 后缀 → 400', async () => {
    const allowed = path.join(dir, 'allowed')
    const file = await writeArtifact(allowed, 'server.js', SRC)
    const txt = await writeArtifact(allowed, 'notes.txt', 'hi')
    const host = boot(
      createServerPluginsRoutes({ dir: path.join(dir, 'sp'), debugInstall: { allowRoots: [allowed] } }),
    )
    await host.start()
    const noConfirm = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: 'ext', path: file }))
    const badId = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: '../evil', path: file, confirm: true }))
    const badExt = await host.app.fetch(loopback('/api/server-plugins/install-from-path', { id: 'ext', path: txt, confirm: true }))
    expect([noConfirm.status, badId.status, badExt.status]).toEqual([400, 400, 400])
    host.ctx.stop()
  })
})
