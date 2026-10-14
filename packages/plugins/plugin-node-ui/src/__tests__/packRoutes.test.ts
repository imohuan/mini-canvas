/**
 * 打包路由 —— 取节点与"缺声明"的提示（2026-10-13 用户实测暴露的两条）。
 *
 * 用户看到的是「导出失败 400（Bad Request）」。两条真原因：
 *   ① 取节点只看**默认画布**的文档 —— 别的画布（画布 4 这类）直接"没有这个节点"；
 *   ② 那些节点**没有依赖声明**（它们写在"双保险"之前），包里会一个脚本都不带。
 * 第二条现在**不静默放行**，改成给一句能照做的提示。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../server'

let dir = ''

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-packroutes-'))
  await fs.writeFile(path.join(dir, 'scale.mjs'), 'export const run = () => 1\n')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** 假后台 ctx：默认画布的 doc 与别的画布的 canvasStore 各给一份 */
function fakeCtx(opt: {
  defaultNode?: Record<string, unknown> | undefined
  storedNode?: Record<string, unknown> | undefined
}) {
  const routes = new Map<string, (c: unknown) => unknown>()
  const doc = {
    read: async () => ({ nodes: opt.defaultNode ? [opt.defaultNode] : [] }),
    getNodes: () => (opt.defaultNode ? [opt.defaultNode] : []),
    getEdges: () => [],
    batchNodes: async () => ({ ok: true, errors: [] }),
  }
  const canvasStore = {
    readCanvas: async () => ({ nodes: opt.storedNode ? [opt.storedNode] : [], edges: [] }),
    writeCanvas: async () => undefined,
    list: async () => ['default'],
    dataRoot: () => '/tmp/mc-root',
  }
  const ctx = {
    routes: {
      get: (p: string, h: (c: unknown) => unknown) => routes.set('GET ' + p, h),
      post: (p: string, h: (c: unknown) => unknown) => routes.set('POST ' + p, h),
    },
    mcp: { tool: () => undefined },
    tryGet: (n: string) =>
      n === 'taskScriptsDir' ? dir : n === 'doc' ? doc : n === 'canvasStore' ? canvasStore : undefined,
  } as never
  return { ctx, routes }
}

/** 假 Hono ctx */
function callCtx(body: unknown) {
  return {
    json: (b: unknown, status = 200) => Response.json(b as never, { status }),
    body: (data: Uint8Array, status = 200, headers: Record<string, string> = {}) =>
      new Response(data as unknown as BodyInit, { status, headers }),
    req: {
      json: async () => body,
      arrayBuffer: async () => new ArrayBuffer(0),
      query: () => undefined,
      header: () => undefined,
      url: 'http://x/api/node-packages/build',
    },
  }
}

const uiNode = (over: Record<string, unknown> = {}) => ({
  id: 'grid1',
  type: 'ui',
  data: { label: '视频转宫格图', uiHtml: '<script>fetch(0,{body:JSON.stringify({name:"scale"})})</script>', ...over },
})

describe('打包路由：取节点', () => {
  it('★ 非默认画布也能取到（第一版只看默认画布 → 用户导出画布 4 时 400）', async () => {
    // 默认画布里**没有**这个节点，画布存储里有
    const s = fakeCtx({ storedNode: uiNode({ uiScripts: { scale: {} } }) })
    apply(s.ctx)
    const res = (await s.routes.get('POST /api/node-packages/build')!(
      callCtx({ canvasId: 'c-other', nodeId: 'grid1' }),
    )) as Response
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('mini-canvas-node')
    expect(res.headers.get('x-pack-scripts')).toBe('scale')
  })

  it('真的不存在的节点 → 明确 400（不假装成功）', async () => {
    const s = fakeCtx({})
    apply(s.ctx)
    const res = (await s.routes.get('POST /api/node-packages/build')!(
      callCtx({ canvasId: 'default', nodeId: '没有这个' }),
    )) as Response
    expect(res.status).toBe(400)
  })
})

describe('打包路由：缺依赖声明的提示（用户那句"规则没提供"）', () => {
  it('★ 界面里调了脚本但没声明 → 400 + 说清怎么补（不静默打个空包）', async () => {
    const s = fakeCtx({ storedNode: uiNode() }) // 没有 uiScripts
    apply(s.ctx)
    const res = (await s.routes.get('POST /api/node-packages/build')!(
      callCtx({ canvasId: 'c-other', nodeId: 'grid1' }),
    )) as Response
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('没有声明')
    expect(body.error).toContain('uiScripts')
    expect(body.error).toContain('canvas_ui_write')
  })

  it('界面里压根没调脚本 → 没有声明也照常导出（不是所有节点都需要脚本）', async () => {
    const s = fakeCtx({ storedNode: uiNode({ uiHtml: '<div>只是显示</div>' }) })
    apply(s.ctx)
    const res = (await s.routes.get('POST /api/node-packages/build')!(
      callCtx({ canvasId: 'c-other', nodeId: 'grid1' }),
    )) as Response
    expect(res.status).toBe(200)
    expect(res.headers.get('x-pack-scripts')).toBe('')
  })
})

