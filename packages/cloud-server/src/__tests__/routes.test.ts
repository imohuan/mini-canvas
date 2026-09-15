/**
 * 路由层单测 —— 直接把 Request 喂给 Hono app.fetch（不启真端口，CI 也能跑）。
 *
 * 锁的是**对外契约**，尤其是那条最容易写错的：
 * 未保存过的 key 必须返回 **404**（而不是 200 + null）—— 客户端靠它区分
 * "从未保存过"与"保存过空画布"，写错会让空画布刷新后重新长出默认节点。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server'
import { hasTopLevelExport, resolvePluginsDir, resolveUiDist } from '../static'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-' + 'routes-'))
  // 不传 ui/plugins：单测不依赖仓库里的构建产物
  srv = await createCloudServer({ dir })
})

afterEach(async () => {
  srv.stop()
  await fs.rm(dir, { recursive: true, force: true })
})

/**
 * 便捷：发一个请求，返回 { status, json, text }。
 * body 是 string / Uint8Array 时当原始字节发，其它对象自动 JSON 化。
 */
async function call(method: string, url: string, body?: unknown) {
  const isRaw = typeof body === 'string' || body instanceof Uint8Array
  const res = await srv.app.fetch(
    new Request('http://localhost' + url, {
      method,
      ...(body !== undefined ? { body: isRaw ? (body as string | Uint8Array) : JSON.stringify(body) } : {}),
      ...(body !== undefined && !isRaw
        ? { headers: { 'content-type': 'application/json' } }
        : {}),
    }),
  )
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.status, json, text, headers: res.headers }
}

describe('GET/PUT/DELETE /api/kv', () => {
  it('未保存过的 key → 404（不是 200 + null）', async () => {
    const r = await call('GET', '/api/kv/canvas/graph')
    expect(r.status).toBe(404)
  })

  it('PUT 后能 GET 回原值，并在磁盘留下 kv 文件', async () => {
    const put = await call('PUT', '/api/kv/canvas/graph', { value: [{ id: '1' }] })
    expect(put.status).toBe(200)
    expect(put.json).toEqual({ ok: true })

    const get = await call('GET', '/api/kv/canvas/graph')
    expect(get.status).toBe(200)
    expect(get.json).toEqual({ value: [{ id: '1' }] })

    // 物理文件名把 `:` 转义掉了（Windows 文件名不允许冒号）
    const onDisk = await fs.readdir(path.join(dir, 'kv'))
    expect(onDisk).toContain('canvas%3Agraph.json')
  })

  it('保存过空数组 → GET 回 200 且值是 []（与"从未保存"区分开）', async () => {
    await call('PUT', '/api/kv/canvas/graph', { value: [] })
    const r = await call('GET', '/api/kv/canvas/graph')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ value: [] })
  })

  it('DELETE 后 GET 回到 404', async () => {
    await call('PUT', '/api/kv/canvas/graph', { value: [1] })
    const del = await call('DELETE', '/api/kv/canvas/graph')
    expect(del.status).toBe(200)
    expect(del.json).toEqual({ ok: true, removed: true })
    expect((await call('GET', '/api/kv/canvas/graph')).status).toBe(404)
  })

  it('歪 type / 歪 body 被挡下（400），不会写脏数据', async () => {
    expect((await call('GET', '/api/kv/evil/x')).status).toBe(400)
    expect((await call('PUT', '/api/kv/canvas/graph', { nope: 1 })).status).toBe(400)
    expect((await call('PUT', '/api/kv/canvas/graph', 'not json')).status).toBe(400)
    // 空画布目录里不该因为上面几次失败而出现文件
    await expect(fs.readdir(path.join(dir, 'kv'))).rejects.toThrow()
  })

  it('可列某作用域下的 key（后台查看用）', async () => {
    await call('PUT', '/api/kv/canvas/graph', { value: 1 })
    await call('PUT', '/api/kv/canvas/graph-edges', { value: [] })
    await call('PUT', '/api/kv/config/theme', { value: 2 })
    const r = await call('GET', '/api/kv/canvas')
    expect(r.status).toBe(200)
    expect(r.json.keys).toEqual(['graph', 'graph-edges'])
  })

  it('?values=1 连值一起给（客户端一次读回整张画布，免掉三个 GET 里未命中那两个的 404 噪音）', async () => {
    await call('PUT', '/api/kv/canvas/graph', { value: [1, 2] })
    const r = await call('GET', '/api/kv/canvas/?values=1')
    expect(r.status).toBe(200)
    expect(r.json.keys).toEqual(['graph'])
    expect(r.json.values).toEqual({ graph: [1, 2] })
    // 只回真的存过的 key：没保存过的不出现（客户端据此当 undefined）
    expect(r.json.values['graph-edges']).toBeUndefined()
  })

  it('单项 GET 的 404 语义不受批量口影响', async () => {
    await call('PUT', '/api/kv/canvas/graph', { value: [] })
    expect((await call('GET', '/api/kv/canvas/graph')).status).toBe(200)
    expect((await call('GET', '/api/kv/canvas/graph-edges')).status).toBe(404)
  })
})

describe('POST /api/files + GET /uploads', () => {
  it('上传 → 返回同源 url，回读字节完全一致', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const up = await call('POST', '/api/files?name=a.png', bytes)
    expect(up.status).toBe(200)
    expect(up.json.url).toMatch(/^\/uploads\/[0-9a-f]{16}\.png$/)
    expect(up.json.mime).toBe('image/png')
    expect(up.json.size).toBe(bytes.byteLength)

    const res = await srv.app.fetch(new Request('http://localhost' + up.json.url))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it('没给文件名时用 Content-Type 反推扩展名', async () => {
    const res = await srv.app.fetch(
      new Request('http://localhost/api/files', {
        method: 'POST',
        body: new Uint8Array([1, 2, 3]),
        headers: { 'content-type': 'image/webp' },
      }),
    )
    const json: any = await res.json()
    expect(json.id.endsWith('.webp')).toBe(true)
  })

  it('白名单外扩展名不按原名存（.html 挡掉，防同源 XSS）', async () => {
    const up = await call('POST', '/api/files?name=evil.html', new Uint8Array([60, 104, 49, 62]))
    expect(up.json.id).not.toMatch(/\.html$/)
    expect(up.json.mime).toBe('application/octet-stream')
  })

  it('空文件 400；不存在的 uploads 404', async () => {
    expect((await call('POST', '/api/files', new Uint8Array([]))).status).toBe(400)
    expect((await srv.app.fetch(new Request('http://localhost/uploads/0123456789abcdef.png'))).status).toBe(404)
  })

  it('同内容上传两次 → 只有一份文件', async () => {
    const bytes = new Uint8Array([5, 5, 5])
    const a = await call('POST', '/api/files?name=x.png', bytes)
    const b = await call('POST', '/api/files?name=x.png', bytes)
    expect(a.json.id).toBe(b.json.id)
    expect(await fs.readdir(path.join(dir, 'uploads'))).toHaveLength(1)
  })
})

describe('健康检查与静态兜底', () => {
  it('/health 可用', async () => {
    const r = await call('GET', '/health')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ ok: true })
  })

  it('没构建 ui 时根路径给人话提示（不是白屏/500）', async () => {
    // 空目录当 ui 产物：找不到 index.html → 出提示页
    const emptyUi = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-ui-'))
    const s = await createCloudServer({ dir, uiDist: emptyUi })
    try {
      const res = await s.app.fetch(new Request('http://localhost/'))
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('还没构建画布界面')
    } finally {
      s.stop()
      await fs.rm(emptyUi, { recursive: true, force: true })
    }
  })

  it('托管 ui 产物：静态文件按 MIME 返回，未知路径回落 index.html（SPA 路由）', async () => {
    const uiDist = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-ui-'))
    await fs.mkdir(path.join(uiDist, 'assets'), { recursive: true })
    await fs.writeFile(path.join(uiDist, 'index.html'), '<div id="app"></div>')
    await fs.writeFile(path.join(uiDist, 'assets', 'index.js'), 'console.log(1)')
    const s = await createCloudServer({ dir, uiDist })
    try {
      const js = await s.app.fetch(new Request('http://localhost/assets/index.js'))
      expect(js.headers.get('content-type')).toContain('text/javascript')

      // 前端路由路径（磁盘上没有）→ 回落 index.html，而不是 404
      const spa = await s.app.fetch(new Request('http://localhost/some/deep/route'))
      expect(spa.status).toBe(200)
      expect(await spa.text()).toContain('<div id="app">')

      // 路径穿越被挡下
      const evil = await s.app.fetch(new Request('http://localhost/../../package.json'))
      expect(await evil.text()).not.toContain('"name": "mini-canvas"')
    } finally {
      s.stop()
      await fs.rm(uiDist, { recursive: true, force: true })
    }
  })
})

describe('插件清单与产物', () => {
  it('扫描插件目录：只有带 dist/*.js 的插件进清单', async () => {
    const pluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-plugins-'))
    // a：ESM 产物 → 进清单；b：没 dist → 不进；c：dist 里没 js → 不进；d：UMD 产物 → 不进
    await fs.mkdir(path.join(pluginsDir, 'plugin-a', 'dist'), { recursive: true })
    await fs.writeFile(path.join(pluginsDir, 'plugin-a', 'dist', 'plugin-a.js'), 'const n="a";export{n as name};')
    await fs.writeFile(
      path.join(pluginsDir, 'plugin-a', 'package.json'),
      JSON.stringify({ name: '@mini-canvas/plugin-a' }),
    )
    await fs.mkdir(path.join(pluginsDir, 'plugin-b', 'src'), { recursive: true })
    await fs.mkdir(path.join(pluginsDir, 'plugin-c', 'dist'), { recursive: true })
    await fs.writeFile(path.join(pluginsDir, 'plugin-c', 'dist', 'readme.txt'), 'x')
    // d：UMD 产物（仓库里多数插件就是这种，给 <script> 用）——按 URL import 会在加载时炸，不能列
    await fs.mkdir(path.join(pluginsDir, 'plugin-d', 'dist'), { recursive: true })
    await fs.writeFile(
      path.join(pluginsDir, 'plugin-d', 'dist', 'plugin-d.js'),
      '(function(){var name="d";window.MiniCanvasPluginD={name:name}})();',
    )

    const s = await createCloudServer({ dir, pluginsDir })
    try {
      const res = await s.app.fetch(new Request('http://localhost/plugin-manifest.json'))
      const json: any = await res.json()
      expect(json.plugins).toEqual([
        { id: 'plugin-a', url: '/plugins/plugin-a/plugin-a.js' },
      ])

      // 产物可被画布 fetch
      const js = await s.app.fetch(new Request('http://localhost/plugins/plugin-a/plugin-a.js'))
      expect(js.status).toBe(200)
      expect(js.headers.get('content-type')).toContain('text/javascript')
      expect(await js.text()).toContain('export{n as name}')

      // 路径穿越/不存在的插件都拿不到东西
      // （穿越路径不会命中插件路由；即便落到静态层也只会拿到 index.html）
      const evil = await s.app.fetch(new Request('http://localhost/plugins/plugin-a/../package.json'))
      expect(await evil.text()).not.toContain('@mini-canvas/plugin-a')
      expect((await s.app.fetch(new Request('http://localhost/plugins/plugin-a/nope.js'))).status).toBe(404)
    } finally {
      s.stop()
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('把某插件的 dist 删掉后，它从清单里消失（清单是每次都扫盘，不是启动时快照）', async () => {
    const pluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyn-plugins-'))
    await fs.mkdir(path.join(pluginsDir, 'plugin-x', 'dist'), { recursive: true })
    await fs.writeFile(path.join(pluginsDir, 'plugin-x', 'dist', 'plugin-x.js'), 'const n="x";export{n as name};')

    const s = await createCloudServer({ dir, pluginsDir })
    try {
      const first = (await (await s.app.fetch(new Request('http://localhost/plugin-manifest.json'))).json()) as any
      expect(first.plugins.map((p: { id: string }) => p.id)).toEqual(['plugin-x'])

      // 删掉产物 → 再问一次应该就没有了（不需要重启服务）
      await fs.rm(path.join(pluginsDir, 'plugin-x', 'dist'), { recursive: true, force: true })
      const second = (await (await s.app.fetch(new Request('http://localhost/plugin-manifest.json'))).json()) as any
      expect(second.plugins).toEqual([])

      // 产物也没了 → 直接取它应当是 404（而不是拿到陈旧内容）
      expect((await s.app.fetch(new Request('http://localhost/plugins/plugin-x/plugin-x.js'))).status).toBe(404)
    } finally {
      s.stop()
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })
})

describe('ui / 插件目录探测顺序', () => {
  it('手写的单文件插件（export const name）也要被认出来', async () => {
    const pluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drop-plugins-'))
    // 这是最常见的"手写小插件"开头。早先的检测只认 `export {` / `export default`，
    // 把这种漏掉了 —— 用户把 js 丢进插件目录却怎么刷都不出现。
    await fs.writeFile(
      path.join(pluginsDir, 'my-plugin.js'),
      "export const name = 'my-plugin'\nexport function apply(ctx) {}",
    )
    const s = await createCloudServer({ dir, pluginsDir })
    try {
      const json: any = await (await s.app.fetch(new Request('http://localhost/plugin-manifest.json'))).json()
      expect(json.plugins).toEqual([{ id: 'my-plugin', url: '/plugins/my-plugin.js' }])
      // 产物也要取得到
      const js = await s.app.fetch(new Request('http://localhost/plugins/my-plugin.js'))
      expect(js.status).toBe(200)
      expect(await js.text()).toContain("name = 'my-plugin'")
    } finally {
      s.stop()
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('目录下直接放的 js 与 <包>/dist 两种形态可以共存', async () => {
    const pluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'both-plugins-'))
    await fs.writeFile(path.join(pluginsDir, 'flat.js'), 'export const name = "flat"')
    await fs.mkdir(path.join(pluginsDir, 'packed', 'dist'), { recursive: true })
    await fs.writeFile(path.join(pluginsDir, 'packed', 'dist', 'packed.js'), 'const n="p";export{n as name};')
    const s = await createCloudServer({ dir, pluginsDir })
    try {
      const json: any = await (await s.app.fetch(new Request('http://localhost/plugin-manifest.json'))).json()
      expect(json.plugins.map((p: { id: string }) => p.id).sort()).toEqual(['flat', 'packed'])
    } finally {
      s.stop()
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('UMD 产物仍然被拒（它走 data: URL 加载会炸）', async () => {
    const pluginsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'umd-plugins-'))
    await fs.writeFile(path.join(pluginsDir, 'umd.js'), '(function(){window.X={name:"u"}})();')
    const s = await createCloudServer({ dir, pluginsDir })
    try {
      const json: any = await (await s.app.fetch(new Request('http://localhost/plugin-manifest.json'))).json()
      expect(json.plugins).toEqual([])
    } finally {
      s.stop()
      await fs.rm(pluginsDir, { recursive: true, force: true })
    }
  })

  it('hasTopLevelExport 认得各种 ESM 写法，且不被注释/字符串骗过', () => {
    // 该认的
    expect(hasTopLevelExport("export const name = 'x'")).toBe(true)
    expect(hasTopLevelExport('export function apply() {}')).toBe(true)
    expect(hasTopLevelExport('export default { name: "x" }')).toBe(true)
    expect(hasTopLevelExport('const a = 1; export { a };')).toBe(true)
    expect(hasTopLevelExport('export * from "./x"')).toBe(true)
    expect(hasTopLevelExport('export class P {}')).toBe(true)
    expect(hasTopLevelExport('export async function a() {}')).toBe(true)
    // 不该认的
    expect(hasTopLevelExport('(function(){ window.X = {} })();')).toBe(false)
    expect(hasTopLevelExport('// export const name = "x"')).toBe(false)
    expect(hasTopLevelExport('const s = "export const name"')).toBe(false)
    expect(hasTopLevelExport('/* export default 1 */')).toBe(false)
  })

  it('仓库内路径优先于随包 assets（改了 ui 就该看到新产物，不被旧副本挡住）', async () => {
    // 本仓库里 packages/ui/dist 是存在的（构建过），探测应命中它而不是包内 assets
    const ui = await resolveUiDist()
    expect(ui).toBeTruthy()
    expect(ui!.replace(/\\/g, '/')).not.toContain('/assets/ui')

    const plugins = await resolvePluginsDir()
    expect(plugins!.replace(/\\/g, '/')).not.toContain('/assets/plugins')
  })

  it('显式给了目录就用它；目录不存在时响亮报错（不静默回落）', async () => {
    await expect(resolveUiDist('D:/definitely/not/here/xyz')).rejects.toThrow('--ui 指定的目录不存在')
    await expect(resolvePluginsDir('D:/definitely/not/here/xyz')).rejects.toThrow('--plugins 指定的目录不存在')
  })
})

describe('MCP 与网页共用一个服务', () => {
  it('缺省就带 MCP 端点（POST 一次 initialize 能拿到服务端信息）', async () => {
    const res = await srv.app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
        }),
      }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('mini-canvas-cloud')
  })

  it('服务里报告了 MCP 开着、并列出工具', () => {
    expect(srv.mcpEnabled).toBe(true)
    expect(srv.tools.map((t) => t.name)).toContain('canvas.batch_nodes')
  })

  it('--no-mcp（opts.mcp=false）时端点不存在，但网页与 KV 接口照常', async () => {
    const s = await createCloudServer({ dir, mcp: false })
    try {
      expect(s.mcpEnabled).toBe(false)
      expect(s.tools).toEqual([])
      const mcp = await s.app.fetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        }),
      )
      // 没有 MCP 路由时，请求会落到静态兜底（SPA 回落给 index.html），不会是 JSON-RPC 响应
      const text = await mcp.text()
      expect(text).not.toContain('mini-canvas-cloud')
      // KV 接口不受影响
      expect((await s.app.fetch(new Request('http://localhost/health'))).status).toBe(200)
    } finally {
      s.stop()
    }
  })
})
