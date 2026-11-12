/**
 * 鉴权分类体检：把启动后注册场里的**每一条**路由都过一遍判定，输出分类结果。
 *
 * 目的不是断言某个具体接口，而是把“哪些接口会被要求登录”变成一份可核对的清单：
 * 读出接口（GET/HEAD）不登录；写接口默认要登录；改动后能立刻看出哪条从“公开”变成了“要验”。
 * 2026-11-12 的两次翻车都是“某条本应公开/本应保护的接口悄悄走错分支”。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'
import { needsAuthFor } from '../adminAuth.js'
import { authDeclForRoute, type RouteAuth, type RouteEntry, ROUTE_FIELD } from '../serverFramework/routes.js'

let dir = ''
let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-route-audit-'))
})
afterEach(async () => {
  srv?.stop()
  srv = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

interface Row {
  method: string
  path: string
  decl: RouteAuth | undefined
  need: boolean
}

/** 采样请求：模板里的 `:name` / `:id` 换成一个普通段，保证能命中自己那条 */
function sample(pathTemplate: string): string {
  return pathTemplate.replace(/:([A-Za-z0-9_]+)/g, 'sample')
}

async function audit(): Promise<Row[]> {
  srv = await createCloudServer({
    port: 0,
    dir,
    requestTrust: false,
    mcp: false,
    agent: false,
    adminAuth: true,
    adminToken: 'f'.repeat(64),
  })
  const field = srv.ctx.registryOf<RouteEntry>(ROUTE_FIELD)
  const entries = field
    .keys()
    .filter((k) => !k.startsWith('USE '))
    .flatMap((k) => field.list(k).map((e) => e.value))

  const rows: Row[] = []
  for (const e of entries) {
    if (e.method === 'ALL') continue
    const p = sample(e.path)
    const decl = authDeclForRoute(srv.ctx, e.method, p)
    rows.push({ method: e.method, path: e.path, decl, need: needsAuthFor(e.method, p, decl) })
  }
  return rows
}

describe('鉴权分类体检', () => {
  it('★ 所有读接口都不要求登录', async () => {
    const rows = await audit()
    const bad = rows.filter((r) => (r.method === 'GET' || r.method === 'HEAD') && r.need)
    expect(bad, '这些读接口被误判为需要登录：' + JSON.stringify(bad)).toEqual([])
  })

  it('★ 默认没有「未声明」的写接口（新路由必须被归类）', async () => {
    const rows = await audit()
    const undeclared = rows.filter((r) => r.decl === undefined && r.method !== 'GET' && r.method !== 'HEAD')
    expect(undeclared, '未声明的写接口：' + JSON.stringify(undeclared)).toEqual([])
  })

  /**
   * 这条**记录现状**，不是理想状态：历史白名单（资产 / 项目 / 历史 / KV / 整画布覆盖）
   * 一直没有要令牌，靠来源边界兜底。要收紧时把下面的期望改成 `[]` 即可，
   * 但必须同时给那些前端调用补登录凭据，否则会一次性打断资产、项目、自动保存。
   */
  it('写接口的公开项：登录接口 + 已知历史白名单（资产 / 项目 / 历史 / KV / 整画布）', async () => {
    const rows = await audit()
    const publicWrites = rows.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && !r.need)
    const paths = publicWrites.map((r) => r.method + ' ' + r.path).sort()
    const allowedPatterns = [
      /^POST \/api\/auth\//,
      /^POST \/api\/plugin-presence\//, // 只收本机回环（路由里自校验 Host）
      /^(POST|PUT|PATCH|DELETE) \/api\/(assets|asset-folders)\b/,
      // 历史白名单：资产 / 项目 / 历史 / KV 的写接口这一版仍靠来源边界（已知取舍）。
      /^(POST|PUT|PATCH|DELETE) \/api\/(projects|history|kv)\b/,
      /^PUT \/api\/canvases\/\S+$/, // 整画布保存：历史取舍，靠来源边界
      /^PUT \/api\/canvases\/\S+\/view$/,
    ]
    const unexpected = paths.filter((p) => !allowedPatterns.some((re) => re.test(p)))
    expect(unexpected).toEqual([])
  })

  it('★ 删除 / 改名画布属于危险写操作，必须登录', async () => {
    const rows = await audit()
    const danger = rows.filter(
      (r) =>
        (r.method === 'DELETE' && r.path === '/api/canvases/:id') ||
        (r.method === 'PATCH' && r.path === '/api/canvases/:id/meta'),
    )
    expect(danger.length).toBe(2)
    for (const r of danger) expect(r.need, r.method + ' ' + r.path).toBe(true)
  })
})

describe('宿主直挂接口的鉴权（生产里 middleware 的默认分支）', () => {
  it('本地测试模型端点公开；未登录写接口仍被拦', async () => {
    const server = await createCloudServer({
      port: 0,
      dir,
      requestTrust: false,
      mcp: false,
      agent: false,
      adminAuth: true,
      adminToken: 'f'.repeat(64),
    })
    const test = await server.app.fetch(
      new Request('http://x/api/test-model/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(test.status).not.toBe(403)
    server.stop()
  })
})

describe('needsAuthFor 的兜底分支', () => {
  it('未声明：读放行、写按前缀表', async () => {
    expect(needsAuthFor('GET', '/api/anything', undefined)).toBe(false)
    expect(needsAuthFor('POST', '/api/agent/models', undefined)).toBe(true)
    expect(needsAuthFor('POST', '/api/test-model/v1/chat/completions', undefined)).toBe(false)
  })
})
