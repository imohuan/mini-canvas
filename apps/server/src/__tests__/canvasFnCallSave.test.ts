/**
 * 真机形状：`canvas_fn_call` 跑一个会 `ctx.save` 的脚本，产物要真的落到用户节点。
 *
 * ## 这条用例盯的是 2026-11-25 报的那个 403
 *
 * 背景：MCP 的 `canvas_fn_call` 直接起脚本子进程。子进程里只有 `ctx.taskToken`，
 * 没有登录 cookie、也没有管理令牌。早先这里**没签发**短时令牌，于是 `ctx.save`
 * POST `/api/canvases/:id/resources` 时拿到 403「需要登录」，用户看到的是
 * 「像素运算都跑通了，但保存失败」。
 *
 * 所以这里不测 handler 返回值，而是**验磁盘上的结果**：资源文件真的出现、节点字段真的写上、
 * 审计里没有一条 `auth-failed`。只断言返回值的话，令牌空了也能伪造出"成功"。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCloudServer } from '../server.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_SERVER_JS = path.resolve(HERE, '../../../../packages/plugins/plugin-node-ui/dist/server.js')
const ADMIN = 'b'.repeat(64)

let dir = ''
let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined
let built = false

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plume-fncall-save-'))
  built = await fs
    .access(PLUGIN_SERVER_JS)
    .then(() => true)
    .catch(() => false)
})

afterEach(async () => {
  srv?.stop()
  srv = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

/** 走一次 MCP 握手 + tools/call，拿回工具返回里的 JSON */
async function mcpCall(app: { fetch: (r: Request) => Response | Promise<Response> }, name: string, args: Record<string, unknown>) {
  const post = (body: unknown) =>
    app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      }),
    )
  await (
    await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    })
  ).text()
  const text = await (
    await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })
  ).text()
  const line = text.split('\n').find((l) => l.startsWith('data:')) ?? text
  const json = JSON.parse(line.replace(/^data:\s*/, ''))
  return json.result ? JSON.parse(json.result.content[0].text) : json
}

/** 读画布文件（MCP 工具走的是同一个 store） */
async function canvasOf(id: string): Promise<{ nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }> }> {
  return JSON.parse(await fs.readFile(path.join(dir, 'canvases', id, 'canvas.json'), 'utf8'))
}

describe('★ canvas_fn_call：产物写进真实节点（403 修复）', () => {
  it('脚本 ctx.save 成功落盘，节点字段与声明都写回，审计里没有 auth-failed', async () => {
    if (!built) {
      // 没跑过 build:server 的机器上跳过（不假装通过）
      console.warn('[skip] 没有 ' + PLUGIN_SERVER_JS + '，先跑 pnpm -C packages/plugins/plugin-node-ui build:server')
      return
    }
    const pluginsDir = path.join(dir, 'plugins')
    await fs.mkdir(path.join(pluginsDir, 'plugin-node-ui', 'dist'), { recursive: true })
    await fs.writeFile(
      path.join(pluginsDir, 'plugin-node-ui', 'package.json'),
      JSON.stringify({ name: '@plume-canvas/plugin-node-ui', plume: { pluginName: 'node-ui', server: { entry: 'dist/server.js' } } }),
    )
    await fs.copyFile(PLUGIN_SERVER_JS, path.join(pluginsDir, 'plugin-node-ui', 'dist', 'server.js'))

    // 一张真画布 + 一个可视化节点（就是用户截图里那种）
    const CANVAS = '90da8d5cbf06424d'
    await fs.mkdir(path.join(dir, 'canvases', CANVAS), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'canvases', CANVAS, 'canvas.json'),
      JSON.stringify({
        nodes: [{ id: '6', type: 'ui', position: { x: 0, y: 0 }, data: { label: '可视化 1' } }],
        edges: [],
      }),
      'utf8',
    )

    // 任务脚本：算一张 2×2 的 PNG，然后走 ctx.save（与 _pixelize 同一条保存路径）
    const scriptsDir = path.join(dir, 'task-scripts')
    await fs.mkdir(scriptsDir, { recursive: true })
    await fs.writeFile(
      path.join(scriptsDir, 'stamp.mjs'),
      [
        'export async function run(ctx) {',
        '  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])',
        '  const saved = await ctx.save(bytes, "out.png")',
        '  return { saved, canvasId: ctx.canvasId, nodeId: ctx.nodeId }',
        '}',
        '',
      ].join('\n'),
    )

    srv = await createCloudServer({
      dir,
      port: 0,
      hostname: '127.0.0.1',
      watchProviders: false,
      agent: false,
      pluginsDir,
      adminToken: ADMIN,
      // ★ 必须显式打开：vitest 里 `adminAuthEnabled` 默认是关的（`opts.adminAuth ?? !testEnv`），
      //   关着的时候 `verify()` 永远 ok —— 令牌是空串也能存进去，这条用例就白测了。
      adminAuth: true,
    })
    await srv.start()

    const r = await mcpCall(srv.app, 'canvas_fn_call', {
      script: 'stamp',
      fn: 'run',
      canvasId: CANVAS,
      nodeId: '6',
    })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.canvasId).toBe(CANVAS)
    expect(r.nodeId).toBe('6')
    expect(r.declaredScripts).toEqual(['stamp'])

    // ① 资源文件真的落在节点自己的槽位（不是草稿画布）
    const slot = path.join(dir, 'canvases', CANVAS, 'resources', 'slot-6.png')
    const bytes = await fs.readFile(slot)
    expect([...bytes]).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    // 不再出现草稿画布
    const canvases = await fs.readdir(path.join(dir, 'canvases'))
    expect(canvases.some((id) => id.startsWith('fn-probe-'))).toBe(false)

    // ② 节点字段与声明都写回
    const node = (await canvasOf(CANVAS)).nodes.find((n) => n.id === '6')!
    expect(String(node.data?.imageUrl)).toContain('/api/canvases/' + CANVAS + '/resources/slot-6.png')
    expect(String(node.data?.uiOutputUrl)).toContain('slot-6.png')
    expect(node.data?.uiOutputType).toBe('image')
    expect(Object.keys((node.data?.uiScripts ?? {}) as Record<string, unknown>)).toContain('stamp')

    // ③ 审计里不该有一条 auth-failed（那就是 403）
    const audit = await fs.readFile(path.join(dir, 'audit.log'), 'utf8')
    const failed = audit
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { action?: string; path?: string })
      .filter((e) => e.action === 'auth-failed')
    expect(failed, JSON.stringify(failed)).toEqual([])
  }, 60_000)

  it('★ 不给画布与节点：只验脚本也能保存（落到草稿画布，不碰用户画布）', async () => {
    if (!built) {
      console.warn('[skip] 没有 ' + PLUGIN_SERVER_JS + '，先跑 pnpm -C packages/plugins/plugin-node-ui build:server')
      return
    }
    const pluginsDir = path.join(dir, 'plugins')
    await fs.mkdir(path.join(pluginsDir, 'plugin-node-ui', 'dist'), { recursive: true })
    await fs.writeFile(
      path.join(pluginsDir, 'plugin-node-ui', 'package.json'),
      JSON.stringify({ name: '@plume-canvas/plugin-node-ui', plume: { pluginName: 'node-ui', server: { entry: 'dist/server.js' } } }),
    )
    await fs.copyFile(PLUGIN_SERVER_JS, path.join(pluginsDir, 'plugin-node-ui', 'dist', 'server.js'))

    // 用户自己的一张画布：这轮调用**不该碰它**
    const CANVAS = '90da8d5cbf06424d'
    await fs.mkdir(path.join(dir, 'canvases', CANVAS), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'canvases', CANVAS, 'canvas.json'),
      JSON.stringify({ nodes: [{ id: '6', type: 'ui', position: { x: 0, y: 0 }, data: { label: '可视化 1' } }], edges: [] }),
      'utf8',
    )

    const scriptsDir = path.join(dir, 'task-scripts')
    await fs.mkdir(scriptsDir, { recursive: true })
    await fs.writeFile(
      path.join(scriptsDir, 'stamp.mjs'),
      [
        'export async function run(ctx) {',
        '  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7, 7])',
        '  const saved = await ctx.save(bytes, "out.png")',
        '  return { saved, canvasId: ctx.canvasId, nodeId: ctx.nodeId }',
        '}',
        '',
      ].join('\n'),
    )

    srv = await createCloudServer({
      dir,
      port: 0,
      hostname: '127.0.0.1',
      watchProviders: false,
      agent: false,
      pluginsDir,
      adminToken: ADMIN,
      adminAuth: true,
    })
    await srv.start()

    const r = await mcpCall(srv.app, 'canvas_fn_call', { script: 'stamp', fn: 'run' })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.virtualCanvasId).toBe('fn-probe-default')
    expect(r.nodeId).toBe('probe')

    // ① 产物落在草稿画布，保存真的成功了（这就是以前那个 403）
    const probeSlot = path.join(dir, 'canvases', 'fn-probe-default', 'resources', 'slot-probe.png')
    expect([...await fs.readFile(probeSlot)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 7, 7])
    // ② 用户画布既没产物也没被改
    const userResources = await fs.readdir(path.join(dir, 'canvases', CANVAS, 'resources')).catch(() => [])
    expect(userResources).toEqual([])
    const userNode = (await canvasOf(CANVAS)).nodes.find((n) => n.id === '6')!
    expect(userNode.data?.uiScripts).toBeUndefined()
    // ③ 审计里同样不该有 403
    const audit = await fs.readFile(path.join(dir, 'audit.log'), 'utf8')
    const failed = audit.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as { action?: string }).filter((e) => e.action === 'auth-failed')
    expect(failed).toEqual([])
  }, 60_000)
})
