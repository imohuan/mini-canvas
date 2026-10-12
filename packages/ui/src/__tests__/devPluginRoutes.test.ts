/**
 * dev 插件路由守卫 —— 锁住「ui 单独起 dev 时，宿主也要能装到外部插件」。
 *
 * 背景（真实踩到）：生产形态下 /plugin-manifest.json 由 cloud-server 提供，应用冷启动靠它
 * 装载后台客户端 plugin-cloud-client。而在 dev（vite :5288）里只有 /plugin-catalog.json 与
 * /plugins/**，缺这条清单 —— 请求回落到 index.html，宿主把 HTML 当 JSON 解析失败 → 拿到空清单
 * → **云端客户端永远装不上**，表现为「改了前端看到的是连不上后台的画布」，只能整包重来。
 *
 * 这类"路由少了一条"的缺陷靠肉眼看代码守不住（缺的是一条 anyone 都不会碰的路径），
 * 所以把口径钉成测试：dev 的清单判定必须与 cloud-server 的 buildManifest 一致
 * （只收非自带、且是 ESM 的产物；自带件与 UMD 产物都不进）。
 */
import { describe, it, expect } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error -- 本包 vite 插件是 .mjs（无类型声明）；这里按它的真实运行时口径断言
import { buildManifest, catalogPlugin } from '../../catalogPlugin.mjs'

/** catalogPlugin.mjs 的清单条目（无类型声明，这里按实际形状收口） */
interface ManifestEntry {
  id: string
  url: string
}

const here = dirname(fileURLToPath(import.meta.url))
const PLUGINS_DIR = resolve(here, '../../../plugins')

/** 起一个只收中间件的假 dev server，返回"请求 → 响应"的探针 */
function probe(pluginsDir: string) {
  const plugin = catalogPlugin({ pluginsDir })
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | undefined
  const server = {
    middlewares: { use: (fn: typeof handler) => { handler = fn } },
  }
  plugin.configureServer(server as never)

  return function request(url: string): Promise<{ status: number; type?: string; body: string; fellThrough: boolean }> {
    return new Promise((done) => {
      const headers: Record<string, string> = {}
      let status = 200
      let body = ''
      const res = {
        setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v },
        set statusCode(v: number) { status = v },
        get statusCode() { return status },
        end: (chunk?: unknown) => { if (chunk !== undefined) body = String(chunk); done({ status, type: headers['content-type'], body, fellThrough: false }) },
      }
      handler?.({ url }, res, () => done({ status, type: headers['content-type'], body, fellThrough: true }))
    })
  }
}

describe('dev 插件路由（packages/ui 的 catalogPlugin）', () => {
  it('清单只收非自带、且是 ESM 的产物（与 cloud-server 的 buildManifest 同口径）', async () => {
    const entries = (await buildManifest(PLUGINS_DIR)) as ManifestEntry[]
    const ids = entries.map((e) => e.id)

    // 后台客户端必须在内：它是"dev 也能连后台"的唯一入口，少它这条链就断
    expect(ids).toContain('plugin-cloud-client')

    // 自带件不进外部清单：它们由应用源码冷启动装配，产物多 external 掉 @mini-canvas/*，
    // 走 data: URL 装会在浏览器里直接炸（"Failed to resolve module specifier"）
    expect(ids).not.toContain('plugin-node-text')
    expect(ids).not.toContain('plugin-theme-default')

    // UMD 产物不进：没有顶层 export，靠 <script> 全局注入，data: URL 加载必失败。
    // 样例用**仍是可装卸**的插件（align-guide 未改自带）—— 早前这里是 multi-select，
    // 它 2026-10-12 改成自带件后，这条断言即便成立也不再是"UMD 被拒"的证据了。
    expect(ids).not.toContain('plugin-align-guide')

    // 每条都得带一个同源产物地址，宿主才能 fetch 到
    for (const e of entries) {
      expect(e.url.startsWith('/plugins/'), e.id + ' 的地址不是 /plugins/ 下').toBe(true)
    }
  })

  it('GET /plugin-manifest.json 直接回清单 JSON（不回落到 index.html）', async () => {
    const request = probe(PLUGINS_DIR)
    const res = await request('/plugin-manifest.json')

    expect(res.fellThrough, '这条请求必须被本插件接管，否则 dev 下会被 SPA 回落吃掉').toBe(false)
    expect(res.type).toContain('application/json')
    const parsed = JSON.parse(res.body) as { plugins: Array<{ id: string; url: string }> }
    expect(Array.isArray(parsed.plugins)).toBe(true)
    expect(parsed.plugins.map((p) => p.id)).toContain('plugin-cloud-client')
  })

  it('带查询串也认（宿主可能加时间戳破缓存）', async () => {
    const request = probe(PLUGINS_DIR)
    const res = await request('/plugin-manifest.json?t=123')
    expect(res.fellThrough).toBe(false)
    expect(res.type).toContain('application/json')
  })

  it('cdn/其它路径不被劫持（照常交给后续中间件）', async () => {
    const request = probe(PLUGINS_DIR)
    expect((await request('/src/main.ts')).fellThrough).toBe(true)
    expect((await request('/api/kv/config')).fellThrough).toBe(true)
  })
})
