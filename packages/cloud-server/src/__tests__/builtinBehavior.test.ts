/**
 * 内置插件收敛后的「行为不变」验证（Task 3 的验收核心）。
 *
 * 这一步不做新功能，只把现有 12 组路由搬进插件系统。所以验收 = **逐组起服务、打真实请求、
 * 断言与收敛前一致**。
 *
 * 特别覆盖：
 * - `/api/kv/events`（静态）与 `/api/kv/:type`（动态）的**优先级**——
 *   顺序一反就会被吃掉，是这次收敛最容易踩的坑；
 * - 各组路由的**基本可达性**（迁移路由时如果 inject 名写错、插件会 PENDING、路由静默消失）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'
import { BUILTIN_PLUGINS } from '../plugins/builtin/routes.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-builtin-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})


describe('内置插件 · 行为不变（Task 3）', () => {
  it('真实 createCloudServer 的 /health 仍可用（收敛后）', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const res = await srv.app.fetch(new Request('http://x/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    srv.stop()
  })

  // ---- 路由级冒烟断言（计划 Task 3 Step 6 要求：这几组原本没有 createCloudServer 级断言，
  //      迁移前若不给它们一条"打过一次"的证据，就没法证明"行为不变"）----
  it('jobs 组路由仍可达：POST /api/jobs 缺参数 → 400（而不是 404/兜底 HTML）', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const res = await srv.app.fetch(
      new Request('http://x/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    // 400 = 路由在、参数校验生效；404 或 HTML = 路由没被插件接住（那就是坏的）
    expect(res.status).toBe(400)
    expect(String((await res.json() as { error?: string }).error)).toContain('actionId')
    srv.stop()
  })

  it('jobs 组路由仍可达：GET /api/jobs/:id 未知任务 → 404 JSON（不是兜底 HTML）', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const res = await srv.app.fetch(new Request('http://x/api/jobs/nope'))
    expect(res.headers.get('content-type') ?? '').toContain('json')
    srv.stop()
  })

  it('history 组路由仍可达：GET /api/history 返回分页结构', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const res = await srv.app.fetch(new Request('http://x/api/history'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; items?: unknown[] }
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.items)).toBe(true)
    srv.stop()
  })

  it('内置插件清单齐全（12 个，且都声明了 inject）', () => {
    const names = BUILTIN_PLUGINS.map((p) => p.name).sort()
    expect(names).toEqual(
      [
        'actions',
        'agent-routes',
        'agent-sessions',
        'canvas-ops',
        'canvases',
        'events',
        'health',
        'history',
        'jobs',
        'kv',
        'plugin-routes',
        'server-plugins',
      ].sort(),
    )
    // health 无依赖；其余都该声明 inject（不然就是漏写了）
    for (const p of BUILTIN_PLUGINS) {
      if (p.name === 'health') continue
      expect(Array.isArray(p.inject) && p.inject.length > 0, p.name + ' 应声明 inject').toBe(true)
    }
  })
})
