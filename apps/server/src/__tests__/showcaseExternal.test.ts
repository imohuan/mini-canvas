/**
 * 外挂后台插件的端到端测试（标准目录结构 → loader 装载 → 真实请求）。
 *
 * 链路：dist/server.js（单文件产物）→ 临时 plugins 目录 →
 * loadServerPluginsFromDir（真 loader，data: URL import）→ createServerFramework.start() →
 * fetch 直测五种能力段。这就是「第三方后台插件」从文件到生效的完整路径。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServerFramework } from '../serverFramework/index.js'
import { loadServerPluginsFromPluginDirs } from '../serverFramework/pluginLoader.js'

let dir: string
let pluginsDir: string

/**
 * 现造一个覆盖五种能力段的后台插件产物。
 *
 * 不引用仓库里任何真实插件：这条测试要钉的是「loader + 能力段」本身，
 * 真实插件删掉/改名不该让它红。
 */
const SEED_SERVER = `
const state = { heartbeat: null, mcpRegistered: false, agentMwActive: false }
export const name = 'seed'
export function apply(ctx) {
  ctx.routes.get('/api/seed/meta', (c) =>
    c.json({ demo: 'meta', name: 'seed', version: '1.0.0' }))
  ctx.routes.get('/api/seed/endpoints', (c) =>
    c.json({ groups: ['meta', 'routes', 'store', 'jobs', 'mcp'] }))
  ctx.routes.get('/api/seed/hello', (c) =>
    c.json({ message: 'hello', plugins: ctx.tryGet('serverPluginsLoaded') ?? [] }))
  ctx.routes.post('/api/seed/echo', async (c) => {
    const body = await c.req.json().catch(() => undefined)
    if (!body || typeof body !== 'object') return c.json({ ok: false }, 400)
    return c.json({ demo: 'routes', echoed: body })
  })
  const todos = new Map()
  let seq = 0
  ctx.routes.post('/api/seed/todos', async (c) => {
    const body = await c.req.json().catch(() => undefined)
    if (!body || typeof body.title !== 'string' || !body.title.trim()) return c.json({ ok: false }, 400)
    seq += 1
    const todo = { id: 't' + seq, title: body.title.trim(), done: false }
    todos.set(todo.id, todo)
    return c.json({ todo }, 201)
  })
  ctx.routes.put('/api/seed/todos/:id', async (c) => {
    const todo = todos.get(c.req.param('id'))
    const body = await c.req.json().catch(() => undefined)
    if (!todo || typeof body?.done !== 'boolean') return c.json({ ok: false }, 404)
    todo.done = body.done
    return c.json({ todo })
  })
  ctx.routes.delete('/api/seed/todos/:id', (c) => c.json({ ok: true, deleted: todos.delete(c.req.param('id')) }))
  const notes = ctx.store.namespace('notes')
  ctx.routes.put('/api/seed/store/notes/:key', async (c) => {
    const value = await c.req.json().catch(() => undefined)
    await notes.set(c.req.param('key'), value)
    return c.json({ value })
  })
  ctx.routes.get('/api/seed/store/notes/:key', async (c) =>
    c.json({ value: await notes.get(c.req.param('key')) }))
  ctx.routes.post('/api/seed/jobs/heartbeat', (c) => {
    if (state.heartbeat) return c.json({ running: true }, 409)
    state.heartbeat = ctx.jobs.every(1000, () => {})
    return c.json({ running: true })
  })
  ctx.routes.get('/api/seed/jobs/heartbeat', (c) => c.json({ running: state.heartbeat !== null }))
  ctx.routes.delete('/api/seed/jobs/heartbeat', (c) => {
    state.heartbeat?.cancel()
    state.heartbeat = null
    return c.json({ running: false })
  })
  ctx.routes.post('/api/seed/mcp/tools', (c) => {
    ctx.mcp.tool({ name: 'seed.add', description: '相加', input: { a: 'number', b: 'number' }, required: ['a', 'b'], handler: (a) => ({}) })
    state.mcpRegistered = true
    return c.json({ registered: true })
  })
  ctx.routes.post('/api/seed/agent/middleware', (c) => {
    ctx.agent.use(async (_turn, next) => next())
    state.agentMwActive = true
    return c.json({ registered: true })
  })
}
`

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-external-ext-'))
  // 新布局：一个插件一个目录，入口由 package.json 声明
  pluginsDir = path.join(dir, 'plugins')
  await fs.mkdir(path.join(pluginsDir, 'seed-plugin', 'dist'), { recursive: true })
  await fs.writeFile(
    path.join(pluginsDir, 'seed-plugin', 'package.json'),
    JSON.stringify({ name: '@plume-canvas/plugin-seed', plume: { pluginName: 'seed', server: { entry: 'dist/server.js' } } }),
  )
  await fs.writeFile(path.join(pluginsDir, 'seed-plugin', 'dist', 'server.js'), SEED_SERVER, 'utf8')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('外挂形态（单文件产物 → loader → 路由生效）', () => {
  it('五种能力段全部可达', async () => {
    const { modules, failures } = await loadServerPluginsFromPluginDirs(pluginsDir)
    expect(failures).toEqual([])
    expect(modules.map((m) => m.name)).toEqual(['seed'])

    const host = createServerFramework({ root: dir })
    for (const m of modules) host.ctx.plugin(m)
    await host.start()

    const get = async (p: string, init?: RequestInit) =>
      host.app.fetch(new Request('http://x' + p, init))

    // meta 组
    const meta = (await (await get('/api/seed/meta')).json()) as { demo: string; name: string; version: string }
    expect(meta).toMatchObject({ demo: 'meta', name: 'seed', version: '1.0.0' })
    const idx = (await (await get('/api/seed/endpoints')).json()) as { groups: unknown[] }
    expect(idx.groups).toHaveLength(5)

    // routes 组：echo + todos CRUD
    // hello 要回"当前已登记的后台插件列表"（附录 A.2；顺势演示自省能力）
    const hello = (await (await get('/api/seed/hello')).json()) as { message: string; plugins: string[] }
    expect(typeof hello.message).toBe('string')
    expect(Array.isArray(hello.plugins), 'hello 应带 plugins 数组').toBe(true)
    const echo = (await (await get('/api/seed/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: 1 }),
    })).json()) as { demo: string; echoed: { ping: number } }
    expect(echo).toMatchObject({ demo: 'routes', echoed: { ping: 1 } })

    const created = (await (await get('/api/seed/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '外挂演示' }),
    })).json()) as { todo: { id: string; title: string } }
    expect(created.todo.title).toBe('外挂演示')
    const id = created.todo.id
    const upd = (await (await get('/api/seed/todos/' + id, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true }),
    })).json()) as { todo: { done: boolean } }
    expect(upd.todo.done).toBe(true)
    expect((await get('/api/seed/todos/' + id, { method: 'DELETE' })).status).toBe(200)

    // store 组：写读删
    await get('/api/seed/store/notes/k1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 42 }),
    })
    const got = (await (await get('/api/seed/store/notes/k1')).json()) as { value: { v: number } }
    expect(got.value.v).toBe(42)

    // jobs 组：启动 → 状态 → 停止
    expect(((await (await get('/api/seed/jobs/heartbeat', { method: 'POST' })).json()) as { running: boolean }).running).toBe(true)
    expect(((await (await get('/api/seed/jobs/heartbeat')).json()) as { running: boolean }).running).toBe(true)
    expect(((await (await get('/api/seed/jobs/heartbeat', { method: 'DELETE' })).json()) as { running: boolean }).running).toBe(false)

    // mcp / agent 组
    expect(((await (await get('/api/seed/mcp/tools', { method: 'POST' })).json()) as { registered: boolean }).registered).toBe(true)
    expect(((await (await get('/api/seed/agent/middleware', { method: 'POST' })).json()) as { registered: boolean }).registered).toBe(true)

    host.stop()
  })
})
