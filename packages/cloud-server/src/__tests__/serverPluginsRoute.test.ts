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

describe('server-plugins 安装路由（安全收口）', () => {
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
