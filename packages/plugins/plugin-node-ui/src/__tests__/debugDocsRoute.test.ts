/**
 * 调试产物的生成入口（审查 S1 / S5 的接线）。
 *
 * 两件事必须钉住：
 *   1. 返回给浏览器的**页面 URL** 走独立调试源，不是后台同源；
 *   2. 页面里的写产物地址仍指向**后台**，且带的是短令牌而不是管理令牌。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../server'

let dataRoot = ''

interface FakeOpts {
  /** 调试源地址（undefined = 老宿主没注入） */
  debugUrl?: string
  /** 能不能签短令牌 */
  tokens?: boolean
}

/** 最小后台 ctx：只上架调试这条链用得到的服务 */
function fakeCtx(opts: FakeOpts = {}) {
  const routes = new Map<string, (c: unknown) => unknown>()
  const nodes = [
    { id: '7', type: 'ui', data: { uiHtml: '<div>hi</div>', uiInputs: { n: 1 }, uiUpstream: [] } },
  ]
  const store = {
    dataRoot: () => dataRoot,
    list: async () => [],
    readCanvas: async () => ({ nodes, edges: [] }),
    writeCanvas: async () => undefined,
  }
  const ctx = {
    routes: {
      get: (p: string, h: (c: unknown) => unknown) => routes.set('GET ' + p, h),
      post: (p: string, h: (c: unknown) => unknown) => routes.set('POST ' + p, h),
    },
    mcp: { tool: () => undefined },
    tryGet: (n: string) => {
      if (n === 'canvasStore') return store
      if (n === 'doc') return { getNodes: () => nodes, getEdges: () => [], batchNodes: async () => ({ ok: true }) }
      if (n === 'selfOrigin') return 'http://127.0.0.1:8865'
      if (n === 'debugOrigin') return opts.debugUrl ? { url: opts.debugUrl } : undefined
      if (n === 'taskTokens') {
        return opts.tokens === false ? undefined : { issue: () => 'tok-123' }
      }
      return undefined
    },
  }
  return { ctx: ctx as never, routes, nodes }
}

/** 调一条路由：包一个最小 c（json / req.json / param 都用真的形状） */
async function post(route: (c: unknown) => unknown, params: Record<string, string>, body: unknown) {
  const c = {
    req: {
      param: (n: string) => params[n],
      json: async () => {
        if (body === undefined) throw new Error('no body')
        return body
      },
    },
    json: (data: unknown, status?: number) => Response.json(data, { status: status ?? 200 }),
  }
  return (await route(c)) as Response
}

beforeEach(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-debug-docs-'))
})

afterEach(async () => {
  await fs.rm(dataRoot, { recursive: true, force: true })
})

function debugDir(canvasId: string): string {
  return path.join(dataRoot, 'canvases', canvasId, 'resources', 'debug')
}

describe('POST /api/canvases/:canvasId/debug-docs', () => {
  it('★ 页面 URL 走独立调试源，写入地址指向后台 + 短令牌', async () => {
    const s = fakeCtx({ debugUrl: 'http://127.0.0.1:9123' })
    apply(s.ctx)
    const route = s.routes.get('POST /api/canvases/:canvasId/debug-docs')!
    expect(route).toBeTruthy()
    const res = await post(route, { canvasId: 'c1' }, { nodeId: '7', html: '<div>x</div>', inputs: { a: 1 } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      urls: { html: string; context: string; sdk: string }
      token: string
      files: { html: string; context: string; sdk: string }
    }
    expect(body.ok).toBe(true)
    // 页面在独立源
    expect(body.urls.html).toBe('http://127.0.0.1:9123/c1/debug-7.html')
    expect(body.urls.context).toBe('http://127.0.0.1:9123/c1/context-7.js')
    expect(body.urls.sdk).toBe('http://127.0.0.1:9123/c1/sdk-7.js')
    expect(body.token).toBe('tok-123')
    // 三份文件都落盘了
    for (const name of Object.values(body.files)) {
      await expect(fs.readFile(path.join(debugDir('c1'), name), 'utf8')).resolves.toBeTruthy()
    }
  })

  it('★ sdk 里的写入地址仍是后台（产物要写回画布），令牌写进 HTML', async () => {
    const s = fakeCtx({ debugUrl: 'http://127.0.0.1:9123' })
    apply(s.ctx)
    const route = s.routes.get('POST /api/canvases/:canvasId/debug-docs')!
    await post(route, { canvasId: 'c1' }, { nodeId: '7', html: '<div>x</div>' })
    const html = await fs.readFile(path.join(debugDir('c1'), 'debug-7.html'), 'utf8')
    const context = await fs.readFile(path.join(debugDir('c1'), 'context-7.js'), 'utf8')
    const sdk = await fs.readFile(path.join(debugDir('c1'), 'sdk-7.js'), 'utf8')
    // baseUrl 给的是后台（页面自己拿它拼 /api）
    expect(context).toContain('http://127.0.0.1:8865')
    // 独立源只出现在"从哪儿拉数据"这一处，不该混进 baseUrl
    expect(context).toContain('__CANVAS_CONTEXT_URL__')
    expect(context.match(/http:\/\/127\.0\.0\.1:9123/g)?.length).toBe(1)
    // 短令牌在页面里，且 sdk 会带 x-task-token
    expect(html).toContain('tok-123')
    expect(html).toContain('debugToken')
    // ★ 令牌也必须在 context.js 里：页面每 5 秒重载它，它会整体重写 __CANVAS_UI__
    expect(context).toContain('tok-123')
    expect(sdk).toContain('x-task-token')
    // 绝不下发管理令牌
    expect(html).not.toContain('x-admin-token')
    expect(sdk).not.toContain('x-admin-token')
    // 页面引用的 sdk / context 都是调试源地址
    expect(html).toContain('http://127.0.0.1:9123/c1/sdk-7.js')
  })

  it('没注入调试源 → 退回后台同源，并在 warnings 里明说风险', async () => {
    const s = fakeCtx({})
    apply(s.ctx)
    const route = s.routes.get('POST /api/canvases/:canvasId/debug-docs')!
    const res = await post(route, { canvasId: 'c1' }, { nodeId: '7', html: '<div>x</div>' })
    const body = (await res.json()) as { ok: boolean; urls: { html: string }; warnings?: string[] }
    expect(body.ok).toBe(true)
    expect(body.urls.html).toBe('http://127.0.0.1:8865/api/canvases/c1/resources/debug/debug-7.html')
    expect((body.warnings ?? []).join(' ')).toContain('管理令牌')
  })

  it('签不出短令牌 → 页面照常生成，但警告 + 空令牌', async () => {
    const s = fakeCtx({ debugUrl: 'http://127.0.0.1:9123', tokens: false })
    apply(s.ctx)
    const route = s.routes.get('POST /api/canvases/:canvasId/debug-docs')!
    const res = await post(route, { canvasId: 'c1' }, { nodeId: '7', html: '<div>x</div>' })
    const body = (await res.json()) as { ok: boolean; token: string; warnings?: string[] }
    expect(body.ok).toBe(true)
    expect(body.token).toBe('')
    expect((body.warnings ?? []).join(' ')).toContain('CanvasUI.save')
  })

  it('html 为空 / 缺 nodeId → 400 人话错误', async () => {
    const s = fakeCtx({ debugUrl: 'http://127.0.0.1:9123' })
    apply(s.ctx)
    const route = s.routes.get('POST /api/canvases/:canvasId/debug-docs')!
    const empty = await post(route, { canvasId: 'c1' }, { nodeId: '7', html: '   ' })
    expect(empty.status).toBe(400)
    expect(((await empty.json()) as { error: string }).error).toContain('空的')
    const noNode = await post(route, { canvasId: 'c1' }, { html: '<p>x</p>' })
    expect(noNode.status).toBe(400)
    expect(((await noNode.json()) as { error: string }).error).toContain('nodeId')
    const badJson = await post(route, { canvasId: 'c1' }, undefined)
    expect(badJson.status).toBe(400)
  })

  it('非法 nodeId（穿越 / 奇怪字符）→ 400，不落盘', async () => {
    const s = fakeCtx({ debugUrl: 'http://127.0.0.1:9123' })
    apply(s.ctx)
    const route = s.routes.get('POST /api/canvases/:canvasId/debug-docs')!
    const res = await post(route, { canvasId: 'c1' }, { nodeId: '../evil', html: '<p>x</p>' })
    expect(res.status).toBe(400)
    await expect(fs.readdir(debugDir('c1'))).rejects.toBeTruthy()
  })
})

describe('旧的同源调试文件通道', () => {
  /** 调 GET 路由（这条只用 param + json） */
  async function getFile(route: (c: unknown) => unknown, canvasId: string, file: string) {
    const c = {
      req: { param: (n: string) => (n === 'canvasId' ? canvasId : file), url: 'http://x/' },
      json: (data: unknown, status?: number) => Response.json(data, { status: status ?? 200 }),
    }
    return (await route(c)) as Response
  }

  it('★ 独立调试源在的时候，同源通道必须 404（否则页面里的脚本又能读走令牌）', async () => {
    const s = fakeCtx({ debugUrl: 'http://127.0.0.1:9123' })
    apply(s.ctx)
    await fs.mkdir(debugDir('c1'), { recursive: true })
    await fs.writeFile(path.join(debugDir('c1'), 'debug-7.html'), '<p>x</p>', 'utf8')
    const route = s.routes.get('GET /api/canvases/:canvasId/resources/debug/:file')!
    const res = await getFile(route, 'c1', 'debug-7.html')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toContain('独立源')
  })

  it('老宿主没调试源时才回读（降级路径）', async () => {
    const s = fakeCtx({})
    apply(s.ctx)
    await fs.mkdir(debugDir('c1'), { recursive: true })
    await fs.writeFile(path.join(debugDir('c1'), 'debug-7.html'), '<p>x</p>', 'utf8')
    const route = s.routes.get('GET /api/canvases/:canvasId/resources/debug/:file')!
    const res = await getFile(route, 'c1', 'debug-7.html')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<p>x</p>')
  })
})
