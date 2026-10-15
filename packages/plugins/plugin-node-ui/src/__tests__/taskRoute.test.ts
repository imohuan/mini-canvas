/**
 * 后台任务脚本（/api/task/*）的行为测试。
 *
 * 这些用例跑**真的子进程**（这是这套设计的核心：一次调用一个进程），所以脚本都写得极短，
 * 用例本身给足超时。重点验四件事：
 *   1. 名字白名单挡得住路径穿越（画布上写什么都会原样传过来）
 *   2. 报错说人话（带上"可用的函数"，否则作者只能猜）
 *   3. 结果 / 日志 / 状态都拿得到（订阅或不订阅都行）
 *   4. 取消真的把进程收掉
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../server'
import { formatScriptList } from '../task/routes'

/**
 * 手册里那段「这台机器上有哪些脚本」的文案。
 *
 * 为什么要它：AI 拿到手册那一刻就要决定「这个界面能不能叫后台干活」。
 * 没有清单，它只能在生成的 HTML 里写一段没人验证过的调用，或者干脆不敢用。
 */
describe('手册里的脚本清单文案', () => {
  it('有脚本：一行一个，带上可调的函数名', () => {
    const text = formatScriptList([
      { name: 'demo', methods: ['echo', 'tick'] },
      { name: 'scale', methods: [] },
    ])
    expect(text).toContain('- demo（可调：echo、tick）')
    // 一个函数都没导出的脚本也要列（作者能看见自己写错了哪）
    expect(text).toContain('- scale（可调：没有导出函数）')
  })

  it('一个都没有：说清楚"怎么加"，而不是留一句"暂无"', () => {
    const text = formatScriptList([])
    expect(text).toContain('一个脚本都没有')
    expect(text).toContain('.mjs')
    expect(text).toContain('不用重启')
  })
})

/** 造一个最小的后台 ctx：收下注册的路由，供测试直接调 */
function fakeCtx(scriptsDir: string, selfOrigin?: string) {
  const routes = new Map<string, (c: unknown) => unknown>()
  /**
   * 假 doc：**默认把这些测试用到的脚本都声明上**。
   *
   * 为什么必须有它：2026-10-13 起 /api/task/call 会按节点声明核对（没声明 → 403）。
   * 于是"能跑通"这件事本身依赖"节点声明过"。清单写在这里而不是每个用例各写一次，
   * 是为了让**新增用例忘声明时会红** —— 那正是这条约束想要的提醒。
   */
  const declared = Object.fromEntries(TEST_SCRIPTS.map((n) => [n, {}]))
  const doc = {
    getNode: (id: string) => ({ id, type: 'ui', data: { uiScripts: declared } }),
    getNodes: () => [{ id: '3', type: 'ui', data: { uiScripts: declared } }],
    getEdges: () => [],
    batchNodes: async () => ({ ok: true, errors: [] }),
  }
  const ctx = {
    routes: {
      get: (p: string, h: (c: unknown) => unknown) => routes.set('GET ' + p, h),
      post: (p: string, h: (c: unknown) => unknown) => routes.set('POST ' + p, h),
    },
    mcp: { tool: () => undefined },
    tryGet: (n: string) =>
      n === 'taskScriptsDir' ? scriptsDir : n === 'doc' ? doc : n === 'selfOrigin' ? selfOrigin : undefined,
  } as never
  return { ctx, routes }
}

/** 本文件用例里会跑到的脚本名（假 doc 默认给它们声明，见 fakeCtx） */
const TEST_SCRIPTS = ['boom', 'fast', 'hello', 'long', 'loud', 'only-data', 'pick', 'scale', 'two', 'whereami']

/** 假的 Hono ctx：够路由层用（json / req.json / req.query） */
function callCtx(opts: { body?: unknown; query?: Record<string, string> } = {}) {
  const q = opts.query ?? {}
  return {
    json: (body: unknown, status = 200) => Response.json(body as never, { status }),
    req: {
      json: async () => {
        if (opts.body === undefined) throw new Error('no body')
        return opts.body
      },
      query: (n: string) => q[n],
      header: () => undefined,
      url: 'http://x/api/task',
    },
  }
}

/** 把响应读成对象 */
async function bodyOf(res: unknown): Promise<Record<string, unknown>> {
  return (await (res as Response).json()) as Record<string, unknown>
}

/** 轮询到这次调用不再是 running（测试里别用固定 sleep，慢机器上会飘） */
async function untilSettled(
  routes: Map<string, (c: unknown) => unknown>,
  runId: string,
  timeoutMs = 15000,
): Promise<Record<string, unknown>> {
  const status = routes.get('GET /api/task/status')!
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const r = await bodyOf(await status(callCtx({ query: { runId } })))
    const run = r.run as { state?: string } | undefined
    if (run && run.state !== 'running') return r
    if (Date.now() > deadline) throw new Error('等不到调用结束：' + JSON.stringify(r))
    await new Promise((res) => setTimeout(res, 50))
  }
}

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-task-test-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('任务脚本：三条路由（+ 三条配套）', () => {
  it('注册了 call / list / info / events / status / cancel 六个口（+ 调试通道三条）', () => {
    const s = fakeCtx(dir)
    apply(s.ctx)
    expect([...s.routes.keys()].sort()).toEqual([
      'GET /api/node-packages/read',
      'GET /api/node-ui/debug-events',
      'GET /api/node-ui/debug-poll',
      'GET /api/node-ui/info',
      'GET /api/task/events',
      'GET /api/task/info',
      'GET /api/task/list',
      'GET /api/task/status',
      'POST /api/node-packages/build',
      // 导出到本机下载目录（用户 2026-10-14）
      'POST /api/node-packages/export',
      'POST /api/node-packages/import',
      'POST /api/node-packages/inspect',
      'POST /api/node-packages/save',
      'POST /api/node-ui/debug-accept',
      'POST /api/node-ui/debug-result',
      'POST /api/task/call',
      'POST /api/task/cancel',
    ])
  })

  it('list：目录不存在 → 空清单（不是错误）', async () => {
    const s = fakeCtx(path.join(dir, '没有这个目录'))
    apply(s.ctx)
    const r = await bodyOf(await s.routes.get('POST /api/task/call')!(callCtx({ body: { type: 'list' } })))
    expect(r.ok).toBe(true)
    expect(r.scripts).toEqual([])
  })

  it('list：列出脚本名与它导出的函数；lib/ 与 _ 开头的文件不算', async () => {
    await fs.writeFile(path.join(dir, 'scale.mjs'), 'export const run = () => 1\nexport const probe = () => 2\n')
    await fs.writeFile(path.join(dir, 'only-data.mjs'), 'export const VALUE = 1\n')
    await fs.writeFile(path.join(dir, '_hidden.mjs'), 'export const run = () => 1\n')
    await fs.mkdir(path.join(dir, 'lib'))
    await fs.writeFile(path.join(dir, 'lib', 'util.mjs'), 'export const x = 1\n')
    await fs.writeFile(path.join(dir, 'README.txt'), 'x')

    const s = fakeCtx(dir)
    apply(s.ctx)
    const r = (await bodyOf(await s.routes.get('POST /api/task/call')!(callCtx({ body: { type: 'list' } })))) as {
      scripts: Array<{ name: string; methods: string[] }>
    }
    expect(r.scripts.map((x) => x.name)).toEqual(['only-data', 'scale'])
    expect(r.scripts.find((x) => x.name === 'scale')?.methods).toEqual(['probe', 'run'])
    // 只有数据、没有函数的脚本：函数列空（说明它不是一个"任务"）
    expect(r.scripts.find((x) => x.name === 'only-data')?.methods).toEqual([])
  })

  it('名字白名单：路径穿越被挡住，且**不**起进程', async () => {
    const s = fakeCtx(dir)
    apply(s.ctx)
    for (const name of ['../../evil', 'a/b', 'a b', '.hidden', 'x'.repeat(65)]) {
      const r = (await bodyOf(
        await s.routes.get('POST /api/task/call')!(callCtx({ body: { type: 'call', name, methods: 'run', args: [] } })),
      )) as { ok: boolean; error: string }
      expect(r.ok, name).toBe(false)
      expect(r.error, name).toContain('非法脚本名')
    }
  })

  it('跑一个脚本：拿得到 runId，结果与日志都能查回来', async () => {
    await fs.writeFile(
      path.join(dir, 'hello.mjs'),
      [
        'export async function run(who, ctx) {',
        '  ctx.log("开始 " + who)',
        '  ctx.progress(0.5)',
        '  return { hi: who, workspace: ctx.workspace, nodeId: ctx.nodeId }',
        '}',
      ].join('\n'),
    )
    const s = fakeCtx(dir)
    apply(s.ctx)
    const started = (await bodyOf(
      await s.routes.get('POST /api/task/call')!(
        callCtx({ body: { type: 'call', name: 'hello', methods: 'run', args: ['世界'], nodeId: '3' } }),
      ),
    )) as { ok: boolean; runId: string }
    expect(started.ok).toBe(true)
    expect(started.runId).toBeTruthy()

    const settled = (await untilSettled(s.routes, started.runId)) as {
      run: { state: string; result: Record<string, unknown>; tail: string[]; progress?: number }
    }
    expect(settled.run.state).toBe('done')
    expect(settled.run.result.hi).toBe('世界')
    expect(settled.run.result.nodeId).toBe('3')
    expect(settled.run.tail.join('\n')).toContain('开始 世界')
    expect(settled.run.progress).toBe(0.5)
    // 工作目录真的建了（脚本能往里写东西）
    expect(typeof settled.run.result.workspace).toBe('string')
  })

  it('脚本里没有那个函数 → 报错带上"可用的函数"', async () => {
    await fs.writeFile(path.join(dir, 'pick.mjs'), 'export const run = () => 1\nexport const other = () => 2\n')
    const s = fakeCtx(dir)
    apply(s.ctx)
    // 起调用是异步的（回 runId 就返回），所以"函数不存在"这件事在**结果**里体现，
    // 不在 HTTP 状态码里 —— 调用方要么等 wait:true，要么订阅 events / 查 status。
    const started = (await bodyOf(
      await s.routes.get('POST /api/task/call')!(
      callCtx({ body: { type: 'call', name: 'pick', methods: 'ruuun', args: [], nodeId: '3' } }),
      ),
    )) as { ok: boolean; runId: string }
    expect(started.ok).toBe(true)

    const settled = (await untilSettled(s.routes, started.runId)) as { run: { state: string; error: string } }
    expect(settled.run.state).toBe('error')
    // 报错必须把"可用的有哪些"带上，否则作者只能猜自己写错了哪个字母
    expect(settled.run.error).toContain('ruuun')
    expect(settled.run.error).toContain('other')
    expect(settled.run.error).toContain('run')

    // 路由侧也提供一份现查的清单（调用方想在发请求前先确认时用）
    const info = (await bodyOf(await s.routes.get('GET /api/task/info')!(callCtx({ query: { name: 'pick' } })))) as {
      methods: string[]
    }
    expect(info.methods).toEqual(['other', 'run'])
  })

  it('脚本自己抛错 → 状态是 error，错误文案回得来', async () => {
    await fs.writeFile(path.join(dir, 'boom.mjs'), 'export const run = async () => { throw new Error("炸了") }\n')
    const s = fakeCtx(dir)
    apply(s.ctx)
    const started = (await bodyOf(
    await s.routes.get('POST /api/task/call')!(
      callCtx({ body: { type: 'call', name: 'boom', methods: 'run', args: [], nodeId: '3' } }),
    ),
    )) as { runId: string }
    const settled = (await untilSettled(s.routes, started.runId)) as { run: { state: string; error: string } }
    expect(settled.run.state).toBe('error')
    expect(settled.run.error).toContain('炸了')
  })

  it('args 不是数组 / 缺 methods → 明确报错', async () => {
    const s = fakeCtx(dir)
    apply(s.ctx)
    const noArgs = (await bodyOf(
      await s.routes.get('POST /api/task/call')!(callCtx({ body: { type: 'call', name: 'x', methods: 'run', args: 'nope' } })),
    )) as { error: string }
    expect(noArgs.error).toContain('args')
    const noMethod = (await bodyOf(
      await s.routes.get('POST /api/task/call')!(callCtx({ body: { type: 'call', name: 'x', args: [] } })),
    )) as { error: string }
    expect(noMethod.error).toContain('methods')
  })

  it('ctx.baseUrl 带进脚本（回写画布要靠它拼绝对地址）', async () => {
    // 为什么钉这条：脚本跑完常要把结果交回节点，而"画布接口在哪"以前只能靠 ctx.dir 推数据根、
    // 自己拼 URL（用户的 video-grid.mjs 就绕了这一圈）。给了 baseUrl，这一步就不必再猜。
    await fs.writeFile(
      path.join(dir, 'whereami.mjs'),
      'export const run = async (ctx) => ({ baseUrl: ctx.baseUrl, canvasId: ctx.canvasId, nodeId: ctx.nodeId })\n',
    )
    const s = fakeCtx(dir, 'http://127.0.0.1:9999')
    apply(s.ctx)
    const started = (await bodyOf(
      await s.routes.get('POST /api/task/call')!(
        callCtx({ body: { type: 'call', name: 'whereami', methods: 'run', args: [], nodeId: '3' } }),
      ),
    )) as { runId: string }
    const settled = (await untilSettled(s.routes, started.runId)) as {
      run: { result: { baseUrl: string; canvasId: string; nodeId: string } }
    }
    expect(settled.run.result.baseUrl).toBe('http://127.0.0.1:9999')
    expect(settled.run.result.canvasId).toBe('default')
    expect(settled.run.result.nodeId).toBe('3')
  })

  it('type 只认 call / list', async () => {
    const s = fakeCtx(dir)
    apply(s.ctx)
    const r = (await bodyOf(await s.routes.get('POST /api/task/call')!(callCtx({ body: { type: 'delete' } })))) as {
      ok: boolean
      error: string
    }
    expect(r.ok).toBe(false)
    expect(r.error).toContain('list')
  })

  it('info：问一个脚本有哪些函数', async () => {
    await fs.writeFile(path.join(dir, 'two.mjs'), 'export const a = () => 1\nexport async function b() {}\nexport const K = 2\n')
    const s = fakeCtx(dir)
    apply(s.ctx)
    const r = (await bodyOf(await s.routes.get('GET /api/task/info')!(callCtx({ query: { name: 'two' } })))) as {
      methods: string[]
    }
    expect(r.methods).toEqual(['a', 'b'])
    const bad = (await bodyOf(await s.routes.get('GET /api/task/info')!(callCtx({ query: { name: 'nope' } })))) as {
      ok: boolean
    }
    expect(bad.ok).toBe(false)
  })

  it('取消：把调用收掉，状态变 cancelled', async () => {
    await fs.writeFile(
      path.join(dir, 'long.mjs'),
      'export const run = async (ctx) => { await new Promise((r) => setTimeout(r, 30000)); return "never" }\n',
    )
    const s = fakeCtx(dir)
    apply(s.ctx)
    const started = (await bodyOf(
    await s.routes.get('POST /api/task/call')!(
      callCtx({ body: { type: 'call', name: 'long', methods: 'run', args: [], nodeId: '3' } }),
    ),
    )) as { runId: string }

    const cancel = (await bodyOf(
      await s.routes.get('POST /api/task/cancel')!(callCtx({ body: { runId: started.runId } })),
    )) as { ok: boolean }
    expect(cancel.ok).toBe(true)

    const status = (await bodyOf(await s.routes.get('GET /api/task/status')!(callCtx({ query: { runId: started.runId } })))) as {
      run: { state: string }
    }
    expect(status.run.state).toBe('cancelled')
    // 再取消一次：已经结束了
    const again = (await bodyOf(
      await s.routes.get('POST /api/task/cancel')!(callCtx({ body: { runId: started.runId } })),
    )) as { ok: boolean }
    expect(again.ok).toBe(false)
  })

  it('events：订阅来晚了也看得到已经发生的输出，并在结束时收尾', async () => {
    await fs.writeFile(
      path.join(dir, 'loud.mjs'),
      'export const run = async (ctx) => { ctx.log("第一行"); ctx.log("第二行"); return "ok" }\n',
    )
    const s = fakeCtx(dir)
    apply(s.ctx)
    const started = (await bodyOf(
    await s.routes.get('POST /api/task/call')!(
      callCtx({ body: { type: 'call', name: 'loud', methods: 'run', args: [], nodeId: '3' } }),
    ),
    )) as { runId: string }
    // 等它跑完再订阅 —— 故意"来晚"
    await untilSettled(s.routes, started.runId)
    const res = (await s.routes.get('GET /api/task/events')!(callCtx({ query: { runId: started.runId } }))) as Response
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await new Response(res.body as ReadableStream<Uint8Array>).text()
    expect(text).toContain('第一行')
    expect(text).toContain('第二行')
    expect(text).toContain('"type":"done"')
  })

  it('events / status / cancel：runId 不认识就 404（不静默给空）', async () => {
    const s = fakeCtx(dir)
    apply(s.ctx)
    const ev = (await s.routes.get('GET /api/task/events')!(callCtx({ query: { runId: 'nope' } }))) as Response
    expect(ev.status).toBe(404)
    const st = (await s.routes.get('GET /api/task/status')!(callCtx({ query: { runId: 'nope' } }))) as Response
    expect(st.status).toBe(404)
    const cc = (await s.routes.get('POST /api/task/cancel')!(callCtx({ body: { runId: 'nope' } }))) as Response
    expect(cc.status).toBe(404)
  })

  it('wait: true 时直接把结果给出来（脚本几百毫秒就完事时不必再订阅）', async () => {
    await fs.writeFile(path.join(dir, 'fast.mjs'), 'export const run = async (n) => ({ doubled: n * 2 })\n')
    const s = fakeCtx(dir)
    apply(s.ctx)
    const r = (await bodyOf(
      await s.routes.get('POST /api/task/call')!(
        callCtx({ body: { type: 'call', name: 'fast', methods: 'run', args: [21], wait: true, nodeId: '3' } }),
      ),
    )) as { ok: boolean; state: string; result: { doubled: number } }
    expect(r.ok).toBe(true)
    expect(r.state).toBe('done')
    expect(r.result.doubled).toBe(42)
  })

  /**
   * 授权这一关（2026-10-13 用户拍板的强制约束）。
   *
   * 用**没有声明**的节点跑一次，必须 403、且**连进程都不该起**（拿不到 runId）。
   * 这是整套"声明"能立住的关键：AI 忘了声明，界面就真的调不动，
   * 而不是"声明写了但没人看"。
   */
  describe('调用授权：没声明就不让跑', () => {
    /** 造一个"什么都没声明"的 doc */
    function bareCtx(scriptsDir: string) {
      const routes = new Map<string, (c: unknown) => unknown>()
      const doc = {
        getNode: (id: string) => ({ id, type: 'ui', data: {} }),
        getNodes: () => [{ id: '3', type: 'ui', data: {} }],
        getEdges: () => [],
        batchNodes: async () => ({ ok: true, errors: [] }),
      }
      const ctx = {
        routes: {
          get: (p: string, h: (c: unknown) => unknown) => routes.set('GET ' + p, h),
          post: (p: string, h: (c: unknown) => unknown) => routes.set('POST ' + p, h),
        },
        mcp: { tool: () => undefined },
        tryGet: (n: string) => (n === 'taskScriptsDir' ? scriptsDir : n === 'doc' ? doc : undefined),
      } as never
      return { ctx, routes }
    }

    it('节点没声明这个脚本 → 403，并且**不给 runId**（进程都没起）', async () => {
      await fs.writeFile(path.join(dir, 'nosuchdecl.mjs'), 'export const run = () => 1\n')
      const s = bareCtx(dir)
      apply(s.ctx)
      const res = (await s.routes.get('POST /api/task/call')!(
        callCtx({ body: { type: 'call', name: 'nosuchdecl', methods: 'run', args: [], nodeId: '3' } }),
      )) as Response
      expect(res.status).toBe(403)
      const body = (await bodyOf(res)) as { ok: boolean; error: string; runId?: string }
      expect(body.ok).toBe(false)
      expect(body.runId).toBeUndefined()
      // 报错要能让 AI 自愈：说清缺什么、该改哪个字段
      expect(body.error).toContain('nosuchdecl')
      expect(body.error).toContain('uiScripts')
    })

    it('缺 nodeId → 403（nodeId 是调用方自己填的，不能拿它当后门）', async () => {
      const s = bareCtx(dir)
      apply(s.ctx)
      const res = (await s.routes.get('POST /api/task/call')!(
        callCtx({ body: { type: 'call', name: 'whatever', methods: 'run', args: [] } }),
      )) as Response
      expect(res.status).toBe(403)
    })

    it('节点不存在 → 403（不静默放行）', async () => {
      await fs.writeFile(path.join(dir, 'x.mjs'), 'export const run = () => 1\n')
      const s = bareCtx(dir)
      apply(s.ctx)
      const res = (await s.routes.get('POST /api/task/call')!(
        callCtx({ body: { type: 'call', name: 'x', methods: 'run', args: [], nodeId: '不存在的节点' } }),
      )) as Response
      expect(res.status).toBe(403)
    })
  })

  /**
   * 导入这两条会**往服务器写可执行脚本**，所以跨源必须先挡（审查发现的缺口：
   * 注释写了"同源检查"，代码里其实没有）。
   * MCP / 命令行那条路不带 Origin，必须照样能过 —— 所以判据是"带了就必须对"。
   */
  describe('导入口的跨源拦截', () => {
    function originCtx(selfOrigin: string) {
      const routes = new Map<string, (c: unknown) => unknown>()
      const ctx = {
        routes: {
          get: (p: string, h: (c: unknown) => unknown) => routes.set('GET ' + p, h),
          post: (p: string, h: (c: unknown) => unknown) => routes.set('POST ' + p, h),
        },
        mcp: { tool: () => undefined },
        tryGet: (n: string) => (n === 'taskScriptsDir' ? dir : n === 'selfOrigin' ? selfOrigin : undefined),
      } as never
      return { ctx, routes }
    }
    /** 带 Origin 的假 Hono ctx（arrayBuffer 给一段垃圾字节就够） */
    function withOrigin(origin?: string) {
      const headers: Record<string, string> = {}
      if (origin) headers.origin = origin
      return {
        json: (body: unknown, status = 200) => Response.json(body as never, { status }),
        req: {
          arrayBuffer: async () => new TextEncoder().encode('PK-not-a-real-pack').buffer,
          json: async () => ({}),
          header: (n: string) => headers[n.toLowerCase()],
          url: 'http://x/api/node-packages/import',
        },
      }
    }

    it('别的源的浏览器请求 → 403', async () => {
      const s = originCtx('http://127.0.0.1:8865')
      apply(s.ctx)
      const res = (await s.routes.get('POST /api/node-packages/import')!(withOrigin('http://evil.example'))) as Response
      expect(res.status).toBe(403)
    })

    it('同源 → 放行（接着按包内容报错，不再是 403）', async () => {
      const s = originCtx('http://127.0.0.1:8865')
      apply(s.ctx)
      const res = (await s.routes.get('POST /api/node-packages/import')!(withOrigin('http://127.0.0.1:8865'))) as Response
      expect(res.status).not.toBe(403)
    })

    it('不带 Origin（MCP / 命令行）→ 放行', async () => {
      const s = originCtx('http://127.0.0.1:8865')
      apply(s.ctx)
      const res = (await s.routes.get('POST /api/node-packages/import')!(withOrigin())) as Response
      expect(res.status).not.toBe(403)
    })
  })
})
