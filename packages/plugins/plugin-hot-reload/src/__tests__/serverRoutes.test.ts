/**
 * 热重载插件的**后台半**：按绝对路径装/卸后台插件。
 *
 * 这条用例只验证插件自己的路由行为（用假 ctx 记录注册了什么、装了什么），
 * 不启动真实服务 —— 真实链路在 apps/server 的 e2e 里另外验证。
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../server'

interface Route {
  path: string
  auth?: string
  handler: (c: never) => Promise<Response> | Response
}

/** 一个最小的假后台 ctx：只记路由与装卸调用 */
function fakeCtx(runtime?: { install(mod: unknown): void; uninstall(n: string): boolean }) {
  const routes: Route[] = []
  const installed: Array<{ name: string }> = []
  const uninstalled: string[] = []
  const ctx = {
    routes: {
      post(p: string, handler: Route['handler'], auth?: string) {
        routes.push({ path: p, handler, auth })
      },
    },
    ...(runtime ?? {
      runtime: {
        install(mod: unknown) {
          installed.push({ name: (mod as { name: string }).name })
        },
        uninstall(n: string) {
          uninstalled.push(n)
          return n === 'probe'
        },
      },
    }),
  }
  return { ctx, routes, installed, uninstalled }
}

/** 造一个假的 hono Context：只实现路由用到的两个方法 */
function fakeHono(body: unknown) {
  let status = 200
  const c = {
    req: { json: async () => body },
    json(payload: unknown, s?: number) {
      if (s !== undefined) status = s
      return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
    },
  }
  return c
}

describe('热重载插件 · 后台半：按路径装卸', () => {
  it('装：读绝对路径 → import → 交给内核；两条路由都要 admin', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hr-server-'))
    const file = path.join(dir, 'server.js')
    await writeFile(file, `export const name = 'probe'\nexport function apply() {}\n`, 'utf8')
    try {
      const { ctx, routes, installed } = fakeCtx()
      apply(ctx as never)
      const install = routes.find((r) => r.path === '/api/hot-reload/server/install')!
      expect(install.auth).toBe('admin')
      const res = await install.handler(fakeHono({ file }) as never)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, name: 'probe' })
      expect(installed).toEqual([{ name: 'probe' }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('装：相对路径 / 文件不存在 → 明确失败，不交给内核', async () => {
    const { ctx, routes, installed } = fakeCtx()
    apply(ctx as never)
    const install = routes.find((r) => r.path === '/api/hot-reload/server/install')!
    const rel = await install.handler(fakeHono({ file: 'dist/server.js' }) as never)
    expect(rel.status).toBe(400)
    expect(((await rel.json()) as { error: string }).error).toContain('绝对路径')
    const missing = await install.handler(fakeHono({ file: 'C:/definitely/not/here.js' }) as never)
    expect(missing.status).toBe(400)
    expect(installed).toEqual([])
  })

  it('卸：按名字卸；内核里没有也算成功（目标状态已达成）', async () => {
    const { ctx, routes, uninstalled } = fakeCtx()
    apply(ctx as never)
    const uninstall = routes.find((r) => r.path === '/api/hot-reload/server/uninstall')!
    expect(uninstall.auth).toBe('admin')
    const hit = await uninstall.handler(fakeHono({ name: 'probe' }) as never)
    expect(hit.status).toBe(200)
    const miss = await uninstall.handler(fakeHono({ name: 'someone-else' }) as never)
    expect(miss.status).toBe(200)
    expect(((await miss.json()) as { ok: boolean }).ok).toBe(true)
    expect(uninstalled).toEqual(['probe', 'someone-else'])
  })

  it('没有运行期装卸能力（非本机 / 纯框架）→ 一条路由都不装', () => {
    const routes: Route[] = []
    const ctx = { routes: { post: (p: string, handler: Route['handler'], auth?: string) => void routes.push({ path: p, handler, auth }) } }
    apply(ctx as never)
    expect(routes).toEqual([])
  })
})
