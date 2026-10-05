/**
 * showcase 外挂形态的端到端测试（标准结构库包 → loader 装载 → 真实请求）。
 *
 * 链路：dist/server.js（真实构建产物）→ 临时 server-plugins 目录 →
 * loadServerPluginsFromDir（真 loader，data: URL import）→ createServerFramework.start() →
 * fetch 直测六组端点。这就是「第三方后台插件」从文件到生效的完整路径。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServerFramework } from '../serverFramework/index.js'
import { loadServerPluginsFromDir } from '../serverFramework/pluginLoader.js'

let dir: string
let pluginsDir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-showcase-ext-'))
  pluginsDir = path.join(dir, 'server-plugins')
  await fs.mkdir(pluginsDir, { recursive: true })
  // 拷**真实构建产物**（不是测试替身）—— 产物坏了这里立刻炸
  await fs.copyFile(
    path.resolve(__dirname, '../../..', 'plugins', 'plugin-showcase', 'dist', 'server.js'),
    path.join(pluginsDir, 'showcase.js'),
  )
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('showcase 外挂形态（真实产物 → loader → 路由生效）', () => {
  it('六组端点全部可达且 demo 字段正确', async () => {
    const { modules, failures } = await loadServerPluginsFromDir(pluginsDir)
    expect(failures).toEqual([])
    expect(modules.map((m) => m.name)).toEqual(['showcase'])

    const host = createServerFramework({ root: dir })
    for (const m of modules) host.ctx.plugin(m)
    await host.start()

    const get = async (p: string, init?: RequestInit) =>
      host.app.fetch(new Request('http://x' + p, init))

    // meta 组
    const meta = (await (await get('/api/showcase/meta')).json()) as { demo: string; name: string; version: string }
    expect(meta).toMatchObject({ demo: 'meta', name: 'showcase', version: '1.0.0' })
    const idx = (await (await get('/api/showcase/endpoints')).json()) as { groups: unknown[] }
    expect(idx.groups).toHaveLength(5)

    // routes 组：echo + todos CRUD
    // hello 要回"当前已登记的后台插件列表"（附录 A.2；顺势演示自省能力）
    const hello = (await (await get('/api/showcase/hello')).json()) as { message: string; plugins: string[] }
    expect(typeof hello.message).toBe('string')
    expect(Array.isArray(hello.plugins), 'hello 应带 plugins 数组').toBe(true)
    const echo = (await (await get('/api/showcase/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: 1 }),
    })).json()) as { demo: string; echoed: { ping: number } }
    expect(echo).toMatchObject({ demo: 'routes', echoed: { ping: 1 } })

    const created = (await (await get('/api/showcase/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '外挂演示' }),
    })).json()) as { todo: { id: string; title: string } }
    expect(created.todo.title).toBe('外挂演示')
    const id = created.todo.id
    const upd = (await (await get('/api/showcase/todos/' + id, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true }),
    })).json()) as { todo: { done: boolean } }
    expect(upd.todo.done).toBe(true)
    expect((await get('/api/showcase/todos/' + id, { method: 'DELETE' })).status).toBe(200)

    // store 组：写读删
    await get('/api/showcase/store/notes/k1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 42 }),
    })
    const got = (await (await get('/api/showcase/store/notes/k1')).json()) as { value: { v: number } }
    expect(got.value.v).toBe(42)

    // jobs 组：启动 → 状态 → 停止
    expect(((await (await get('/api/showcase/jobs/heartbeat', { method: 'POST' })).json()) as { running: boolean }).running).toBe(true)
    expect(((await (await get('/api/showcase/jobs/heartbeat')).json()) as { running: boolean }).running).toBe(true)
    expect(((await (await get('/api/showcase/jobs/heartbeat', { method: 'DELETE' })).json()) as { running: boolean }).running).toBe(false)

    // mcp / agent 组
    expect(((await (await get('/api/showcase/mcp/tools', { method: 'POST' })).json()) as { registered: boolean }).registered).toBe(true)
    expect(((await (await get('/api/showcase/agent/middleware', { method: 'POST' })).json()) as { registered: boolean }).registered).toBe(true)

    host.stop()
  })
})
