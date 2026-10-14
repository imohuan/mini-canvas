/**
 * routes —— 三条（外加两条配套的）HTTP 口。**这是节点里那段 HTML 唯一要认识的东西。**
 *
 * ```
 * POST /api/task/call      { type, name, methods, args, canvasId?, nodeId? }
 *                          type: "call" 跑函数（回 runId）；"list" 列脚本
 * GET  /api/task/list      列脚本（名字 + 每个脚本导出的函数）
 * GET  /api/task/info      某个脚本导出了哪些函数
 * GET  /api/task/events    订阅某次调用的输出（SSE；先回放已发生的，再接新的）
 * GET  /api/task/status    查一次调用现在的样子（不必订阅也能拿结果）
 * POST /api/task/cancel    { runId } 取消（杀整棵进程树）
 * ```
 *
 * ## 为什么"先回放再接新的"
 *
 * 调用方拿到 runId 到真正连上之间，脚本可能已经跑出好几行日志了。不回放，开头永远看不到。
 * 所以每个 runId 有一个**事件缓冲**（日志最多留 MAX_TAIL_LINES 行），订阅时先把缓冲灌下去，
 * 之后接着推新的。
 *
 * ## 为什么 SSE 也要手写
 *
 * 本文件最终被打成**单文件后台插件**、用 `import(data:text/javascript)` 加载 ——
 * data: URL 里解析不了裸模块名，所以既不能用 `hono/streaming`，也不能用 `hono` 本身。
 * 返回一个 `Response` + `ReadableStream` 就够了，SSE 本来就是普通 HTTP。
 */
import path from 'node:path'
import { listScripts, runScript, scriptMethods, getTaskRuns } from './runs.js'
import type { ScriptInfo } from './runs.js'
import { isSafeScriptName } from './scripts.js'
import { authorizeScriptCall } from './authorize.js'
import type { TaskEvent } from './runner.js'

/**
 * 手册里那段「这台机器上有哪些脚本」。
 *
 * 为什么要塞进手册（而不是只写一句「你可以 GET /api/task/list」）：
 * AI 拿到手册那一刻就要决定「这个界面能不能真的干活、能叫后台做什么」。
 * 不给清单，它只能在生成的 HTML 里写一段没人验证过的调用，或者干脆不敢用 ——
 * 而「有什么可调」只有后台知道（脚本是用户往目录里放的文件，AI 无法预知）。
 */
export function formatScriptList(scripts: readonly ScriptInfo[]): string {
  if (!scripts.length) {
    return (
      '（这台机器上**一个脚本都没有**）\n' +
      '要加：往数据根下的 task-scripts/ 目录放一个 .mjs（文件名就是脚本名，' +
      '里面 export 的函数就是能调的动作），不用重启后台，放完再列一次就有。'
    )
  }
  return scripts
    .map((s) => '- ' + s.name + '（可调：' + (s.methods.length ? s.methods.join('、') : '没有导出函数') + '）')
    .join('\n')
}

/** 一条事件缓冲最多留多少条（日志会刷得快，其它事件很少） */
const MAX_BUFFERED = 400

/** 心跳间隔（与项目里两处 SSE 同口径：低于常见的 30 秒空闲超时） */
const PING_INTERVAL_MS = 25_000

/** 这次调用能等多久（`wait: true` 时用；超过它就只回 runId） */
const WAIT_CAP_MS = 10 * 60 * 1000

interface Channel {
  events: TaskEvent[]
  /** 端子事件已经进来（客户端排空后可以收尾） */
  ended: boolean
  /** 有人等着新事件时挂在这里 */
  wake: (() => void) | null
}

/** runId → 事件缓冲。模块级：同一次调用无论谁订阅都看同一份 */
const channels = new Map<string, Channel>()

function channelOf(runId: string): Channel {
  let ch = channels.get(runId)
  if (!ch) {
    ch = { events: [], ended: false, wake: null }
    channels.set(runId, ch)
  }
  return ch
}

/** 收下一条事件（来自 runner 的回调），叫醒正在等的订阅者 */
function publish(runId: string, e: TaskEvent): void {
  const ch = channelOf(runId)
  ch.events.push(e)
  if (ch.events.length > MAX_BUFFERED) ch.events.splice(0, ch.events.length - MAX_BUFFERED)
  if (e.type === 'done' || e.type === 'error' || e.type === 'cancelled') ch.ended = true
  ch.wake?.()
  ch.wake = null
}

function sseFrame(e: TaskEvent): string {
  return 'data: ' + JSON.stringify(e) + '\n\n'
}

/** 把一条事件缓冲做成 SSE 响应（先回放，再等新的；端子事件后收尾） */
function sseResponse(runId: string): Response {
  const ch = channelOf(runId)
  const encoder = new TextEncoder()
  let closed = false
  let ping: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (text: string): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          closed = true
        }
      }
      const finish = (): void => {
        if (closed) return
        closed = true
        if (ping) clearInterval(ping)
        try {
          controller.close()
        } catch {
          /* 已经关了 */
        }
      }

      void (async () => {
        // ① 先回放：从订阅者拿到的 runId 到真正连上之间发生的事
        while (!closed) {
          if (ch.events.length > 0) {
            for (const e of ch.events.splice(0, ch.events.length)) push(sseFrame(e))
            if (ch.ended && ch.events.length === 0) return finish()
            continue
          }
          if (ch.ended) return finish()
          // ② 没事件就睡着，等 publish 叫醒（一个订阅者一条挂起的 promise，不空转）
          await new Promise<void>((resolve) => {
            ch.wake = resolve
          })
        }
      })()

      ping = setInterval(() => push(': ping\n\n'), PING_INTERVAL_MS)
    },
    cancel() {
      closed = true
      if (ping) clearInterval(ping)
      ch.wake?.()
      ch.wake = null
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      connection: 'keep-alive',
      // 沙箱页（不透明源）来订阅，跨源那一层由服务端全局的 cors() 管，这里不重复
    },
  })
}

/**
 * 脚本目录：优先用宿主上架的 `taskScriptsDir`；没有就按"server-plugins 的上一级"推。
 *
 * 为什么可以推：server-plugins 就在数据根下（`<数据根>/server-plugins`），
 * 而脚本目录与它并列（`<数据根>/task-scripts`）。这样即使在没有任何配置的环境里
 * 这个能力也能用 —— 而不是"必须先去改 server.ts"。
 *
 * ⚠️ 还有一条**从画布存储推**的兜底（2026-10-13 补）：有些宿主（cloud-server 的外挂
 * 后台插件）拿不到上面两个名字，于是脚本目录落到 `process.cwd()/task-scripts` ——
 * **那个目录根本不存在**，表现为"非默认画布里的节点一个脚本都扫不到、因此永远没有声明"。
 * 画布存储知道自己在哪个数据根下（读到的路径里有 `canvases`），从它往上推就一定能找到。
 */
export function resolveTaskScriptsDir(ctx: TaskServerCtx): string {
  const explicit = ctx.tryGet<string>('taskScriptsDir')
  if (typeof explicit === 'string' && explicit) return explicit
  const serverPluginsDir = ctx.tryGet<string>('serverPluginsDir')
  if (typeof serverPluginsDir === 'string' && serverPluginsDir) {
    return path.join(path.dirname(serverPluginsDir), 'task-scripts')
  }
  // 从画布存储问数据根（`<数据根>/canvases/<id>` 的上一级）—— 脚本目录与 canvases 并列。
  // 这条兜底很重要：没有它，上面两个名字都拿不到的宿主会把脚本目录落到进程当前目录
  // （那个目录不存在），于是**非默认画布里的节点永远扫不到脚本、也就永远没有声明**。
  const dataRoot = ctx.tryGet<{ dataRoot?(): string }>('canvasStore')?.dataRoot?.()
  if (typeof dataRoot === 'string' && dataRoot) return path.join(dataRoot, 'task-scripts')
  // 两条都没有（极简宿主 / 单元测试）：落进程当前目录，至少不崩
  return path.join(process.cwd(), 'task-scripts')
}

/** 本文件用到的 Hono 处理函数形状（就地声明，不 import 工作区包 —— 见 server.ts 文件头） */
export interface TaskServerCtx {
  routes: {
    get(path: string, handler: (c: Ctx) => Response | Promise<Response>): void
    post(path: string, handler: (c: Ctx) => Response | Promise<Response>): void
  }
  tryGet<T = unknown>(name: string): T | undefined
}

interface Ctx {
  json(body: unknown, status?: number): Response
  body?(data: Uint8Array, status?: number, headers?: Record<string, string>): Response
  req: {
    json(): Promise<unknown>
    arrayBuffer?(): Promise<ArrayBuffer>
    query?(name: string): string | undefined
    header(name: string): string | undefined
    url: string
  }
}

/** 脚本目录：优先用宿主上架的 taskScriptsDir，其次 canvasStore.dataRoot()，最后 cwd */


async function readBody(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json()
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function nodeDataOf(ctx: TaskServerCtx, canvasId: string, nodeId: string): Promise<{ exists: boolean; data: unknown }> {
  if (canvasId === 'default') {
    const doc = ctx.tryGet<{ getNode(id: string): { data?: unknown } | undefined }>('doc')
    if (doc && typeof doc.getNode === 'function') {
      const n = doc.getNode(nodeId)
      return { exists: !!n, data: n?.data }
    }
  }
  const store = ctx.tryGet<{
    readCanvas(cid: string): Promise<{ nodes?: Array<{ id: string; data?: unknown }> } | undefined>
  }>('canvasStore')
  if (store && typeof store.readCanvas === 'function') {
    const snap = await store.readCanvas(canvasId)
    const n = (snap?.nodes ?? []).find((x) => String(x.id) === nodeId)
    return { exists: !!n, data: n?.data }
  }
  return { exists: false, data: undefined }
}

export function registerTaskRoutes(ctx: TaskServerCtx, dir: string): void {
  ctx.routes.post('/api/task/call', async (c) => {
    const body = await readBody(c)
    if (body.type === 'list') {
      return c.json({ ok: true, scripts: await listScripts(dir) })
    }
    if (body.type !== undefined && body.type !== 'call') {
      return c.json({ ok: false, error: 'type 只认 "call" 或 "list"，收到：' + String(body.type) }, 400)
    }
    const canvasId = typeof body.canvasId === 'string' && body.canvasId ? body.canvasId : 'default'
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId : ''
    const scriptName = typeof body.name === 'string' ? body.name : ''
    const shapeOk =
      isSafeScriptName(scriptName) &&
      typeof body.methods === 'string' &&
      body.methods !== '' &&
      Array.isArray(body.args ?? [])
    if (shapeOk) {
      const node = await nodeDataOf(ctx, canvasId, nodeId)
      const verdict = authorizeScriptCall({
        scriptName,
        nodeData: node.data,
        nodeExists: node.exists,
        canvasId,
        nodeId,
      })
      if (!verdict.ok) return c.json({ ok: false, error: verdict.error }, 403)
    }
    const wait = body.wait === true
    let waiter: ((run: { state: string; result?: unknown; error?: string }) => void) | undefined
    const started = await runScript({
      dir,
      name: body.name,
      methods: body.methods,
      args: (body.args ?? []) as unknown[],
      baseUrl: ctx.tryGet<string>('selfOrigin') ?? '',
      dataRoot: ctx.tryGet<{ dataRoot?(): string }>('canvasStore')?.dataRoot?.() ?? '',
      canvasId,
      nodeId,
      onEvent: (runId, e) => publish(runId, e),
      ...(wait
        ? {
            onFinish: (run) => {
              waiter?.({ state: run.state, ...(run.result === undefined ? {} : { result: run.result }), ...(run.error === undefined ? {} : { error: run.error }) })
              waiter = undefined
            },
          }
        : {}),
    })
    if (!started.ok) {
      const available = await scriptMethods(dir, body.name)
      return c.json({ ok: false, error: started.error, ...(available ? { methods: available } : {}) }, 400)
    }
    const run = started.run
    if (!wait) return c.json({ ok: true, runId: run.runId, state: run.state })
    const outcome = await new Promise<{ state: string; result?: unknown; error?: string } | undefined>(
      (resolve) => {
        waiter = resolve
        setTimeout(() => resolve(undefined), 600000)
      },
    )
    if (!outcome) return c.json({ ok: true, runId: run.runId, state: 'running' })
    return c.json({ ok: outcome.state !== 'error', runId: run.runId, ...outcome })
  })

  ctx.routes.get('/api/task/list', async (c) => c.json({ ok: true, scripts: await listScripts(dir) }))

  ctx.routes.get('/api/task/info', async (c) => {
    const name = c.req.query?.('name') ?? ''
    const methods = await scriptMethods(dir, name)
    if (!methods) return c.json({ ok: false, error: '拿不到脚本的方法（不存在 / 加载失败 / 名字非法）：' + name }, 404)
    return c.json({ ok: true, name, methods })
  })

  ctx.routes.get('/api/task/events', (c) => {
    const runId = c.req.query?.('runId') ?? ''
    if (!getTaskRuns().get(runId)) return c.json({ ok: false, error: '没有这次调用：' + runId }, 404)
    return sseResponse(runId)
  })

  ctx.routes.get('/api/task/status', (c) => {
    const runId = c.req.query?.('runId') ?? ''
    const run = getTaskRuns().get(runId)
    if (!run) return c.json({ ok: false, error: '没有这次调用：' + runId }, 404)
    return c.json({ ok: true, run })
  })

  ctx.routes.post('/api/task/cancel', async (c) => {
    const body = await readBody(c)
    const runId = typeof body.runId === 'string' ? body.runId : ''
    if (!runId) return c.json({ ok: false, error: '缺少 runId' }, 400)
    const hit = getTaskRuns().cancel(runId)
    if (!hit) return c.json({ ok: false, error: '这个调用已经结束了，或者根本不存在：' + runId }, 404)
    return c.json({ ok: true, runId })
  })
}

