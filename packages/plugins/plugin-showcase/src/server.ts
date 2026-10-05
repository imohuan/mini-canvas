/**
 * plugin-showcase · 后台半 —— 「插件展示」示例服务插件（NPM 插件市场的演示样板）。
 *
 * ## 它是什么
 *
 * 一个**标准结构的外挂后台插件**：src/server.ts（本文件）经 esbuild 打成单文件
 * dist/server.js，放进 cloud-server 的 server-plugins 目录（或经 NPM 安装）即生效。
 * 与内置插件的唯一区别是装载方式（外挂 = 重启生效）；API 能力完全一致。
 *
 * ## 它演示什么（对应计划附录 A：6 组 20 条端点）
 *
 * - meta（2）：插件自描述 + 端点索引（前端在线测试台的唯一布局依据，动态下发）
 * - routes（6）：ctx.routes 的 get/post/put/delete —— todos CRUD 全链
 * - store（4）：ctx.store.namespace —— 插件私有 KV（跨重启保留、卸载即清）
 * - jobs（3）：ctx.jobs.every —— 心跳打点（内存定时器 + store 账本 = 两种生命周期的对照）
 * - mcp（2）：ctx.mcp.tool —— 给 AI 注册 showcase.add 工具
 * - agent（3）：ctx.agent.use —— Agent pre-turn 中间件的注册/查询/注销
 *
 * 每条响应统一带 demo 字段（前端面板按它分组展示 = "测试即文档"）。
 *
 * ## 生效时机（写清，防误解）
 *
 * - 路由**必须在 apply() 里同步注册**：Hono 首次请求后路由表冻结（见 serverFramework/routes.ts）。
 * - 外挂形态重启生效：loader 在服务启动时 import 本文件并调 apply。
 */
import type { PluginModule } from '@mini-canvas/kernel'

const PLUGIN_NAME = 'showcase'
const STARTED_AT = new Date().toISOString()

const GROUPS = ['meta', 'routes', 'store', 'jobs', 'mcp', 'agent'] as const

/** 模块级状态（内存态演示载体；重启即失 —— 这本身就是一个演示点） */
const state = {
  heartbeat: null as null | { cancel(): void; intervalMs: number },
  agentMwActive: false,
  mcpRegistered: false,
}

interface Todo {
  id: string
  title: string
  done: boolean
}

export const name = PLUGIN_NAME

/**
 * 取当前已登记的后台插件名（自省能力演示）。
 *
 * 为什么这样取：插件拿到的 ctx 是**作用域 ctx**，没有 inspectPlugins；内核把"注册了什么"
 * 放在事件总线上（ctx:lifecycle-change）。这里退回一个稳定可得的来源：本进程装载过的
 * 外挂插件名由宿主在启动时广播 —— 拿不到就回空数组（演示不该因自省失败而报错）。
 */
function listRegisteredPluginNames(ctx: { tryGet<T>(n: string): T | undefined }): string[] {
  const names = ctx.tryGet<string[]>('serverPluginsLoaded')
  return Array.isArray(names) ? [...names] : []
}

export function apply(ctx: Parameters<NonNullable<PluginModule['apply']>>[0]): void {
  // ============================================================
  // meta 组（2 条）
  // ============================================================
  ctx.routes.get('/api/showcase/meta', (c) =>
    c.json({
      ok: true,
      demo: 'meta',
      name: PLUGIN_NAME,
      title: '插件展示',
      description: '演示 routes/store/jobs/mcp/agent 五个后台能力的示例插件',
      version: '1.0.0',
      startedAt: STARTED_AT,
      capabilities: GROUPS,
    }),
  )

  // 端点索引：前端面板的唯一布局依据（面板不写死端点 —— 加端点只改这里）
  ctx.routes.get('/api/showcase/endpoints', (c) =>
    c.json({
      ok: true,
      demo: 'meta',
      groups: [
        {
          id: 'routes',
          label: '路由注册',
          description: 'ctx.routes.get/post/put/delete —— 后台新增接口 = 装一个插件',
          endpoints: [
            { method: 'GET', path: '/api/showcase/hello' },
            { method: 'POST', path: '/api/showcase/echo' },
            { method: 'GET', path: '/api/showcase/todos' },
            { method: 'POST', path: '/api/showcase/todos' },
            { method: 'PUT', path: '/api/showcase/todos/:id' },
            { method: 'DELETE', path: '/api/showcase/todos/:id' },
          ],
        },
        {
          id: 'store',
          label: '私有存储',
          description: 'ctx.store.namespace —— 插件私有 KV，卸载即清、重启保留',
          endpoints: [
            { method: 'GET', path: '/api/showcase/store/notes' },
            { method: 'PUT', path: '/api/showcase/store/notes/:key' },
            { method: 'GET', path: '/api/showcase/store/notes/:key' },
            { method: 'DELETE', path: '/api/showcase/store/notes/:key' },
          ],
        },
        {
          id: 'jobs',
          label: '定时任务',
          description: 'ctx.jobs.every —— 心跳打点；内存定时器重启即失、账本（store）保留',
          endpoints: [
            { method: 'POST', path: '/api/showcase/jobs/heartbeat' },
            { method: 'GET', path: '/api/showcase/jobs/heartbeat' },
            { method: 'DELETE', path: '/api/showcase/jobs/heartbeat' },
          ],
        },
        {
          id: 'mcp',
          label: 'MCP 工具',
          description: 'ctx.mcp.tool —— 给 AI 注册可调用工具（卸载即摘）',
          endpoints: [
            { method: 'POST', path: '/api/showcase/mcp/tools' },
            { method: 'GET', path: '/api/showcase/mcp/tools' },
          ],
        },
        {
          id: 'agent',
          label: 'Agent 中间件',
          description: 'ctx.agent.use —— 拦截/加工 Agent 对话轮次',
          endpoints: [
            { method: 'POST', path: '/api/showcase/agent/middleware' },
            { method: 'GET', path: '/api/showcase/agent/middleware' },
            { method: 'DELETE', path: '/api/showcase/agent/middleware' },
          ],
        },
      ],
    }),
  )

  // ============================================================
  // routes 组（6 条）：todos CRUD 全链（内存态 —— 与 store 的"持久"对照）
  // ============================================================
  ctx.routes.get('/api/showcase/hello', (c) =>
    c.json({
      ok: true,
      demo: 'routes',
      message: '你好，这是 showcase 插件的第一个路由',
      // 附录 A.2 要求：回「当前已登记的后台插件列表」—— 顺势展示 ctx.registry 的自省能力
      plugins: listRegisteredPluginNames(ctx),
      at: new Date().toISOString(),
    }),
  )

  ctx.routes.post('/api/showcase/echo', async (c) => {
    const body = await c.req.json().catch(() => undefined)
    if (typeof body !== 'object' || body === null) {
      return c.json({ ok: false, demo: 'routes', error: 'body 不是 JSON 对象' }, 400)
    }
    return c.json({ ok: true, demo: 'routes', echoed: body, at: new Date().toISOString() })
  })

  const todos = new Map<string, Todo>()
  let todoSeq = 0

  ctx.routes.get('/api/showcase/todos', (c) =>
    c.json({ ok: true, demo: 'routes', todos: [...todos.values()], total: todos.size }),
  )

  ctx.routes.post('/api/showcase/todos', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { title?: unknown } | undefined
    if (typeof body?.title !== 'string' || !body.title.trim()) {
      return c.json({ ok: false, demo: 'routes', error: '需要非空 title 字符串' }, 400)
    }
    todoSeq += 1
    const todo: Todo = { id: 't' + todoSeq, title: body.title.trim(), done: false }
    todos.set(todo.id, todo)
    return c.json({ ok: true, demo: 'routes', todo }, 201)
  })

  ctx.routes.put('/api/showcase/todos/:id', async (c) => {
    const id = c.req.param('id')
    const todo = todos.get(id)
    if (!todo) return c.json({ ok: false, demo: 'routes', error: 'todo 不存在：' + id }, 404)
    const body = (await c.req.json().catch(() => undefined)) as Partial<Todo> | undefined
    if (typeof body?.title === 'string' && body.title.trim()) todo.title = body.title.trim()
    if (typeof body?.done === 'boolean') todo.done = body.done
    return c.json({ ok: true, demo: 'routes', todo })
  })

  ctx.routes.delete('/api/showcase/todos/:id', (c) => {
    const id = c.req.param('id')
    if (!todos.delete(id)) return c.json({ ok: false, demo: 'routes', error: 'todo 不存在：' + id }, 404)
    return c.json({ ok: true, demo: 'routes', deleted: true })
  })

  // ============================================================
  // store 组（4 条）：插件私有 KV（notes 命名空间）
  // ============================================================
  const notes = ctx.store.namespace('notes')

  ctx.routes.get('/api/showcase/store/notes', async (c) => {
    const keys = await notes.keys()
    return c.json({ ok: true, demo: 'store', keys, total: keys.length })
  })

  ctx.routes.get('/api/showcase/store/notes/:key', async (c) => {
    const key = c.req.param('key')
    const value = await notes.get(key)
    if (value === undefined) return c.json({ ok: false, demo: 'store', error: '键不存在：' + key }, 404)
    return c.json({ ok: true, demo: 'store', key, value })
  })

  ctx.routes.put('/api/showcase/store/notes/:key', async (c) => {
    const key = c.req.param('key')
    const value = await c.req.json().catch(() => undefined)
    if (value === undefined) return c.json({ ok: false, demo: 'store', error: 'body 不是合法 JSON' }, 400)
    await notes.set(key, value)
    return c.json({ ok: true, demo: 'store', key, value })
  })

  ctx.routes.delete('/api/showcase/store/notes/:key', async (c) => {
    const key = c.req.param('key')
    const deleted = await notes.delete(key)
    if (!deleted) return c.json({ ok: false, demo: 'store', error: '键不存在：' + key }, 404)
    return c.json({ ok: true, demo: 'store', deleted: true })
  })

  // ============================================================
  // jobs 组（3 条）：心跳（内存定时器 + store 账本）
  // ============================================================
  // ticks 语义（附录 A 定稿）：POST 启动不清零旧计数，新 tick 续着旧值累加。
  const jobs = ctx.jobs
  const readHeartbeat = async (): Promise<{
    ticks: number
    lastTickAt?: string
    recent: Array<{ at: string; tick: number }>
  }> => {
    const saved = (await notes.get('heartbeat')) as
      | { ticks?: number; lastTickAt?: string; recent?: Array<{ at: string; tick: number }> }
      | undefined
    return { ticks: saved?.ticks ?? 0, lastTickAt: saved?.lastTickAt, recent: saved?.recent ?? [] }
  }

  ctx.routes.post('/api/showcase/jobs/heartbeat', async (c) => {
    if (state.heartbeat) {
      return c.json({ ok: false, demo: 'jobs', error: 'showcase/already-running（先 DELETE 再启动）' }, 409)
    }
    const body = (await c.req.json().catch(() => ({}))) as { intervalMs?: unknown }
    const intervalMs = typeof body.intervalMs === 'number' && body.intervalMs > 0 ? body.intervalMs : 5000
    const handle = jobs.every(intervalMs, () => {
      void (async () => {
        const hb = await readHeartbeat()
        const tick = hb.ticks + 1
        const at = new Date().toISOString()
        const recent = [...hb.recent, { at, tick }].slice(-20)
        await notes.set('heartbeat', { ticks: tick, lastTickAt: at, recent })
      })()
    })
    state.heartbeat = { cancel: handle.cancel, intervalMs }
    const hb = await readHeartbeat()
    return c.json({ ok: true, demo: 'jobs', running: true, intervalMs, ticks: hb.ticks })
  })

  ctx.routes.get('/api/showcase/jobs/heartbeat', async (c) => {
    const hb = await readHeartbeat()
    return c.json({
      ok: true,
      demo: 'jobs',
      running: state.heartbeat !== null,
      ...(state.heartbeat ? { intervalMs: state.heartbeat.intervalMs } : {}),
      ticks: hb.ticks,
      ...(hb.lastTickAt ? { lastTickAt: hb.lastTickAt } : {}),
      recent: hb.recent,
    })
  })

  ctx.routes.delete('/api/showcase/jobs/heartbeat', (c) => {
    if (!state.heartbeat) return c.json({ ok: false, demo: 'jobs', error: 'showcase/not-running' }, 404)
    state.heartbeat.cancel()
    state.heartbeat = null
    return c.json({ ok: true, demo: 'jobs', running: false })
  })

  // ============================================================
  // mcp 组（2 条）
  // ============================================================
  ctx.routes.post('/api/showcase/mcp/tools', (c) => {
    if (state.mcpRegistered) {
      return c.json({ ok: false, demo: 'mcp', error: 'showcase/already-registered' }, 409)
    }
    ctx.mcp.tool({
      name: 'showcase.add',
      description: '把两个数相加（showcase 插件注册的演示工具）',
      input: { a: 'number', b: 'number' },
      required: ['a', 'b'],
      handler: (args) => ({ sum: (args.a as number) + (args.b as number), demo: 'mcp' }),
    })
    state.mcpRegistered = true
    return c.json({ ok: true, demo: 'mcp', registered: true, tool: 'showcase.add' })
  })

  ctx.routes.get('/api/showcase/mcp/tools', (c) =>
    c.json({ ok: true, demo: 'mcp', registered: state.mcpRegistered, tool: 'showcase.add' }),
  )

  // ============================================================
  // agent 组（3 条）：pre-turn 中间件（注册/查询/注销）
  // ============================================================
  // 语义（附录 A 定稿）：DELETE = 置 inactive 并跳过加工；注册场条目仍在场，卸载才真正摘除。
  ctx.routes.post('/api/showcase/agent/middleware', (c) => {
    if (state.agentMwActive) {
      return c.json({ ok: false, demo: 'agent', error: 'showcase/already-registered' }, 409)
    }
    ctx.agent.use(async (_turn, next) => {
      const r = await next()
      return r
    })
    state.agentMwActive = true
    return c.json({ ok: true, demo: 'agent', registered: true })
  })

  ctx.routes.get('/api/showcase/agent/middleware', (c) =>
    c.json({ ok: true, demo: 'agent', registered: state.agentMwActive }),
  )

  ctx.routes.delete('/api/showcase/agent/middleware', (c) => {
    if (!state.agentMwActive) return c.json({ ok: false, demo: 'agent', error: 'showcase/not-found' }, 404)
    state.agentMwActive = false
    return c.json({ ok: true, demo: 'agent', unregistered: true })
  })
}
