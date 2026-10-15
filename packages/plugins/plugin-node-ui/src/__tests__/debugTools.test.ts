import { describe, it, expect } from 'vitest'
import { apply } from '../server'
import { UI_DEBUG_INVITE_KEY } from '../debugSession'
import os from 'node:os'
import path from 'node:path'

/** 空脚本目录（与 serverLogic.test 同口径：不指会让手册列出环境相关的样例） */
const EMPTY_SCRIPTS_DIR = path.join(os.tmpdir(), 'mc-node-ui-debug-empty')

/** 最小后台 ctx：收工具 / 路由 / 写入；节点可从 nodes 里换出 */
function fakeCtx(opts: { nodes?: Array<Record<string, unknown>> } = {}) {
  const tools = new Map<string, { name: string; handler: (a: Record<string, unknown>) => unknown }>()
  const routes = new Map<string, (c: unknown) => unknown>()
  const nodes = opts.nodes ?? []
  const writes: Array<Record<string, unknown>> = []
  const doc = {
    getNodes: () => nodes,
    getEdges: () => [],
    batchNodes: async (input: { update?: Array<{ id: string; data: Record<string, unknown> }> }) => {
      for (const u of input.update ?? []) writes.push(u)
      return { ok: true, errors: [] }
    },
  }
  const ctx = {
    routes: {
      get: (p: string, h: (c: unknown) => unknown) => routes.set(p, h),
      post: (p: string, h: (c: unknown) => unknown) => routes.set(p, h),
    },
    mcp: { tool: (def: { name: string }) => tools.set(def.name, def as never) },
    tryGet: (n: string) => (n === 'doc' ? doc : n === 'taskScriptsDir' ? EMPTY_SCRIPTS_DIR : undefined),
  } as never
  return { ctx, tools, routes, writes }
}

describe('调试连接 · 后台半（邀请标记 + 回执路由）', () => {
  const uiNode: { id: string; type: string; data: Record<string, unknown> } = {
    id: '7',
    type: 'ui',
    data: { label: '面板', uiHtml: '<p>x</p>' },
  }

  /** 调路由：包一个最小 c（json() 用真 Response，与 hono 一致） */
  async function callRoute(route: (c: unknown) => unknown, body: unknown) {
    const c = {
      req: { json: async () => body },
      json: (data: unknown, status?: number) => Response.json(data, { status: status ?? 200 }),
    }
    return (await route(c)) as Response
  }

  it('canvas_ui_connect：给节点放邀请标记（合并写，不碰别的字段），返回 session', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const connect = s.tools.get('canvas_ui_connect')!
    expect(connect).toBeTruthy()
    const res = (await connect.handler({ nodeId: '7' })) as { ok: boolean; session?: string }
    expect(res.ok).toBe(true)
    expect(res.session).toBeTruthy()
    // 落到节点 data 上的就是邀请标记本身（session 对得上）
    const update = s.writes.find((w) => (w as { id: string }).id === '7') as { data: Record<string, unknown> }
    expect(update.data[UI_DEBUG_INVITE_KEY]).toEqual({ session: res.session, at: expect.any(Number) })
  })

  it('connect：节点不存在要报人话错误', async () => {
    const s = fakeCtx({ nodes: [] })
    apply(s.ctx)
    const res = (await s.tools.get('canvas_ui_connect')!.handler({ nodeId: '404' })) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toContain('404')
  })

  it('debug-accept 路由：回执配得上邀请才收（session / nodeId 对得上）', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const connect = s.tools.get('canvas_ui_connect')!
    const res = (await connect.handler({ nodeId: '7' })) as { ok: boolean; session: string }
    const route = s.routes.get('/api/node-ui/debug-accept')!
    expect(route).toBeTruthy()
    // 先放一个邀请进节点（模拟前端看到的标记）
    uiNode.data[UI_DEBUG_INVITE_KEY] = { session: res.session, at: Date.now() }
    const json = await callRoute(route, { session: res.session, nodeId: '7', canvasId: 'default' })
    expect(json.status).toBe(200)
    const body = (await json.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('debug-accept：session 对不上 / 邀请已被清 → 409 拒绝', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const route = s.routes.get('/api/node-ui/debug-accept')!
    // 没有任何邀请 → 409
    const r1 = await callRoute(route, { session: 'x', nodeId: '7', canvasId: 'default' })
    expect(r1.status).toBe(409)
    // 邀请在但 session 不对 → 409
    uiNode.data[UI_DEBUG_INVITE_KEY] = { session: 'real', at: Date.now() }
    const r2 = await callRoute(route, { session: 'wrong', nodeId: '7', canvasId: 'default' })
    expect(r2.status).toBe(409)
  })

  it('eval 全链路：SDK 挂 SSE → 工具投 eval → 回包 → MCP 调用拿到结果；disconnect 后报错', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    // 1. 发邀请 + 模拟用户确认
    const connect = s.tools.get('canvas_ui_connect')!
    const res = (await connect.handler({ nodeId: '7' })) as { ok: boolean; session: string }
    uiNode.data[UI_DEBUG_INVITE_KEY] = { session: res.session, at: Date.now() }
    const acceptRoute = s.routes.get('/api/node-ui/debug-accept')!
    await callRoute(acceptRoute, { session: res.session, nodeId: '7', canvasId: 'default' })

    // 2. SDK 侧：挂 SSE（读流）——fake c 提供 query 与 req.raw（无 signal）
    const eventsRoute = s.routes.get('/api/node-ui/debug-events')!
    const stream = (await eventsRoute({
      req: { query: (n: string) => (n === 'session' ? res.session : undefined) },
      json: (d: unknown, st?: number) => Response.json(d, { status: st ?? 200 }),
    })) as Response
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    // 读第一块（eval 命令会在这里出现）
    const readChunk = async (): Promise<string> => {
      const { value } = await reader.read()
      return decoder.decode(value)
    }

    // 3. MCP 调 eval（不等它 —— 先让投递发生）
    const evalTool = s.tools.get('canvas_ui_debug_eval')!
    const evalPromise = evalTool.handler({ canvasId: 'default', code: '1+1' }) as Promise<{ ok: boolean; result?: unknown }>
    const chunk = await readChunk()
    expect(chunk).toContain('"code":"1+1"')
    const evalId = JSON.parse(chunk.slice('data: '.length)) as { id: string }

    // 4. SDK 侧回包（模拟执行结果）
    const resultRoute = s.routes.get('/api/node-ui/debug-result')!
    const back = await callRoute(resultRoute, { session: res.session, id: evalId.id, ok: true, result: 2 })
    expect(back.status).toBe(200)
    const evalRes = (await evalPromise) as { ok: boolean; result?: unknown }
    expect(evalRes.ok).toBe(true)
    expect(evalRes.result).toBe(2)
    // 流还挂着（没 stop）—— 收尾关掉
    await reader.cancel()

    // 5. disconnect 后：eval 再调 → 明确报错
    const disc = s.tools.get('canvas_ui_disconnect')!
    const dRes = (await disc.handler({ canvasId: 'default' })) as { ok: boolean }
    expect(dRes.ok).toBe(true)
    const after = (await evalTool.handler({ canvasId: 'default', code: 'x' })) as { ok: boolean; error?: string }
    expect(after.ok).toBe(false)
    expect(after.error).toContain('没有挂着的调试会话')
  })

  it('eval：没有会话 / SDK 未连上 → 人话报错，不挂死', async () => {
    const s = fakeCtx({ nodes: [uiNode] })
    apply(s.ctx)
    const evalTool = s.tools.get('canvas_ui_debug_eval')!
    const r1 = (await evalTool.handler({ canvasId: 'default', code: 'x' })) as { ok: boolean; error?: string }
    expect(r1.ok).toBe(false)
    // 有会话但 SDK 没拨 SSE → 也报错
    await (s.tools.get('canvas_ui_connect')!.handler({ nodeId: '7' }))
    const r2 = (await evalTool.handler({ canvasId: 'default', code: 'x' })) as { ok: boolean; error?: string }
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('SDK')
  })
})
