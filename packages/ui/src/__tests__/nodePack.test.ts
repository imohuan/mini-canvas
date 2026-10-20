/**
 * nodePack —— 成品应用这一侧的打包辅助（纯逻辑，注入假 fetch）。
 *
 * 这里钉的是"与后台之间那条缝"：地址怎么定、字节怎么拿、名字怎么拼。
 * 真正的打包逻辑在后台（那里有脚本文件），所以这儿的测试全是"接口约定"。
 */
import { describe, it, expect, vi } from 'vitest'
import { base64ToBytes, buildPack, importPack, packFileName, resolvePackBase, PACK_EXT } from '../composables/nodePack'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 后缀常量在两边各有一份（前端不能跨包 import 后台那侧，否则把 node 逻辑拖进浏览器包）。
 * 「各写一份」不报错，漂了只表现成"拖进去没反应"——所以拿后台源码当尺子量一次。
 */
describe('PACK_EXT 与后台保持一致（防悄悄漂移）', () => {
  it('前端那份 == 后台 pack.ts 那份', () => {
    const src = readFileSync(
      path.join(__dirname, '../../../plugins/plugin-node-ui/src/task/pack.ts'),
      'utf8',
    )
    const m = /export const PACK_EXT = '([^']+)'/.exec(src)
    expect(m, '后台 pack.ts 里应当有 export const PACK_EXT').not.toBeNull()
    expect(PACK_EXT).toBe(m![1])
  })
})

describe('resolvePackBase —— 先问后台，问不到回落同源', () => {
  it('配置里给了就用配置（去掉尾部斜杠）', async () => {
    expect(await resolvePackBase('http://x:1/')).toBe('http://x:1')
  })
  it('没配 → 问后台；问到了用它', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ ok: true, origin: 'http://127.0.0.1:8865' }) }))
    expect(await resolvePackBase(undefined, 'http://localhost:5288/#/canvas/default')).toBe('http://127.0.0.1:8865')
    vi.unstubAllGlobals()
  })
  it('问不到 → 回落页面同源（生产形态本来就这样）', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    expect(await resolvePackBase(undefined, 'http://localhost:5288/#/canvas/default')).toBe('http://localhost:5288')
    vi.unstubAllGlobals()
  })
})

describe('buildPack —— 拿后台打好的字节', () => {
  /**
   * ★ 两条路都要带管理令牌。
   *
   * `/api/node-packages/` 整段在受保护清单里（build 能读脚本源码、import 会往后台写脚本文件）。
   * 漏了的表现就是「导出节点包」「导入包」点下去 403，而这在单测里不报错 —— 只能靠断言头。
   */
  it('★ build / import 都带 x-admin-token（漏了就是 403）', async () => {
    const g = globalThis as { localStorage?: unknown }
    g.localStorage = {
      m: new Map<string, string>([['mc_admin_token', 'tok-123']]),
      getItem(k: string) { return (this as unknown as { m: Map<string, string> }).m.get(k) ?? null },
      setItem(k: string, v: string) { (this as unknown as { m: Map<string, string> }).m.set(k, v) },
      removeItem(k: string) { (this as unknown as { m: Map<string, string> }).m.delete(k) },
    }
    const calls: Array<{ url: string; headers?: Record<string, string> }> = []
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers })
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/x-mini-canvas-node' },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
        json: async () => ({ ok: true }),
      }
    }
    await buildPack({ base: 'http://x', canvasId: 'default', nodeId: '2' }, { fetchImpl })
    await importPack({ base: 'http://x', bytes: new Uint8Array([1]) }, { fetchImpl })
    expect(calls.map((c) => c.headers?.['x-admin-token'])).toEqual(['tok-123', 'tok-123'])
    expect(calls[0]!.url).toContain('/api/node-packages/build')
    expect(calls[1]!.url).toContain('/api/node-packages/import')
    delete g.localStorage
  })

  it('二进制响应：原样转成 Uint8Array', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const r = await buildPack(
      { base: 'http://x', canvasId: 'default', nodeId: '2' },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: { get: () => 'application/x-mini-canvas-node' },
          arrayBuffer: async () => bytes.buffer.slice(0),
        }),
      },
    )
    expect([...r.bytes]).toEqual([1, 2, 3, 4])
  })

  it('名字与脚本清单从**响应头**带回（字节响应没有 JSON 体放它们）', async () => {
    // 少了这条，收藏时预填名字只能回落成"节点包.mcnode"，用户每次都得手改
    const bytes = new Uint8Array([1])
    const head: Record<string, string> = {
      'content-type': 'application/x-mini-canvas-node',
      'x-pack-name': encodeURIComponent('视频可视化'),
      'x-pack-scripts': 'scale,crop',
      'x-pack-missing': 'gone',
    }
    const r = await buildPack(
      { base: 'http://x', canvasId: 'default', nodeId: '2' },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: { get: (n: string) => head[n.toLowerCase()] ?? null },
          arrayBuffer: async () => bytes.buffer.slice(0),
        }),
      },
    )
    expect(r.name).toBe('视频可视化')
    expect(r.scripts).toEqual(['scale', 'crop'])
    expect(r.missing).toEqual(['gone'])
  })

  it('后台回 base64 JSON 也认（没有 c.body 的极简宿主）', async () => {
    const b64 = btoa(String.fromCharCode(9, 8, 7))
    const r = await buildPack(
      { base: 'http://x', canvasId: 'default', nodeId: '2' },
      { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ ok: true, name: '包', base64: b64 }) }) },
    )
    expect([...r.bytes]).toEqual([9, 8, 7])
    expect(r.name).toBe('包')
  })

  it('后台报错 → 抛出（不返回空包冒充成功）', async () => {
    await expect(
      buildPack(
        { base: 'http://x', canvasId: 'default', nodeId: '2' },
        { fetchImpl: async () => ({ ok: false, status: 400, headers: { get: () => 'application/json' }, json: async () => ({ ok: false, error: '节点还没有界面内容' }) }) },
      ),
    ).rejects.toThrow(/400/)
  })

  it('地址拼对：POST 到 /api/node-packages/build 并带上 canvasId/nodeId', async () => {
    let seen: { url: string; body?: unknown } | null = null
    await buildPack(
      { base: 'http://x:9', canvasId: 'c1', nodeId: 'n9' },
      {
        fetchImpl: async (url, init) => {
          seen = { url, body: init?.body }
          return { ok: true, status: 200, headers: { get: () => 'x/binary' }, arrayBuffer: async () => new ArrayBuffer(0) }
        },
      },
    )
    expect(seen!.url).toBe('http://x:9/api/node-packages/build')
    expect(JSON.parse(String(seen!.body))).toEqual({ canvasId: 'c1', nodeId: 'n9' })
  })
})

describe('小工具', () => {
  it('base64ToBytes 往返', () => {
    const src = new Uint8Array([0, 127, 128, 255])
    const b64 = btoa(String.fromCharCode(...src))
    expect([...base64ToBytes(b64)]).toEqual([...src])
  })
  it('packFileName：没有后缀就补，有了不重复加', () => {
    expect(packFileName('视频可视化')).toBe('视频可视化' + PACK_EXT)
    expect(packFileName('x' + PACK_EXT)).toBe('x' + PACK_EXT)
    expect(packFileName('')).toBe('节点包' + PACK_EXT)
  })
})

