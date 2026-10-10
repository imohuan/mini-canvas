/**
 * 「服务器自己把画布里的地址取回来」（tasks/selfFetch）单测 —— 用户实测的第三次同类 bug。
 *
 * 现场：参考图里混进了一条**风格库地址** `/api/style-library/file?name=xxx.png`，
 * 而解析器当时只认画布资源 + 上传资产两种前缀 → 这条落进"原样返回"，
 * 裸相对地址被发给 web2api —— 它当自己 uploads 目录下的相对文件找，报「图片不存在」（4002）。
 *
 * 用户口径：**不要再枚举地址类型**（枚举就会漏，已经漏了三次）。地址不全就用本服务地址拼全，
 * 然后不管它是哪条路由，自己去请求、把字节取回来。
 *
 * 这里锁两端：
 *   ① selfFetch 本体：相对地址拼全、只认自己的 host:port（SSRF 边界）、取不到不抛；
 *   ② resolver 接线：风格库那种地址真的能被翻成 data URL（用假 fetch 模拟自请求）。
 */
import { describe, it, expect } from 'vitest'
import { makeFetchSelfBytes } from '../tasks/selfFetch'
import { makeResolveResourceUrl, fileNameOf } from '../tasks/resourceResolver'
import { CanvasResourceStore } from '../store/canvasResources'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SELF = 'http://127.0.0.1:8865'

/** 假 app.fetch：记录收到的 URL，按路径回字节 */
function fakeApp(routes: Record<string, { status?: number; body?: Uint8Array }>) {
  const seen: string[] = []
  return {
    seen,
    fetch: (req: Request): Response => {
      const u = new URL(req.url)
      seen.push(u.pathname + u.search)
      const hit = routes[u.pathname]
      if (!hit) return new Response('not found', { status: 404 })
      return new Response(hit.body ?? PNG, { status: hit.status ?? 200 })
    },
  }
}

describe('selfFetch：把本服务自己的地址取回字节', () => {
  it('相对地址 → 用本服务 origin 拼全后请求（风格库那种带查询串的也照取）', async () => {
    const app = fakeApp({ '/api/style-library/file': {} })
    const fetchSelfBytes = makeFetchSelfBytes({ fetch: app.fetch, origin: () => SELF })
    const bytes = await fetchSelfBytes('/api/style-library/file?name=821707893_e3f8d738aefc41d6b3368b2df39cadd6.png')
    expect(bytes).toBeTruthy()
    expect(new Uint8Array(bytes!)).toEqual(PNG)
    // 拼全后带上了查询串（查询串是路由参数，丢了就取错文件）
    expect(app.seen[0]).toBe('/api/style-library/file?name=821707893_e3f8d738aefc41d6b3368b2df39cadd6.png')
  })

  it('同 host:port 的绝对地址也认（换端口就不认）', async () => {
    const app = fakeApp({ '/api/effect-library/file': {} })
    const fetchSelfBytes = makeFetchSelfBytes({ fetch: app.fetch, origin: () => SELF })
    expect(await fetchSelfBytes(SELF + '/api/effect-library/file?name=a.mp4')).toBeTruthy()
    // 别的端口 = 不是本服务 → 不请求（SSRF 边界）
    expect(await fetchSelfBytes('http://127.0.0.1:9999/api/effect-library/file')).toBeUndefined()
  })

  /**
   * 本机别名要互相等价（实测踩到）：前端存进画布的完整地址可能是
   * `http://localhost:8865/...`，而服务自报 origin 是 `http://127.0.0.1:8865` ——
   * 只按字符串比 hostname 会把它当"别人"，参考图又退回裸地址发出去。
   */
  it('localhost ≡ 127.0.0.1 ≡ ::1（同一台机器，都认）；别的 host 仍不认', async () => {
    const app = fakeApp({ '/api/style-library/file': {} })
    const fetchSelfBytes = makeFetchSelfBytes({ fetch: app.fetch, origin: () => SELF }) // origin = 127.0.0.1:8865
    // localhost 指同一台机器同一端口 → 认
    expect(await fetchSelfBytes('http://localhost:8865/api/style-library/file?name=a.png')).toBeTruthy()
    // ::1 同理
    expect(await fetchSelfBytes('http://[::1]:8865/api/style-library/file?name=a.png')).toBeTruthy()
    // 反向：origin 是 localhost、地址写 127.0.0.1 → 也认
    const fetch2 = makeFetchSelfBytes({ fetch: app.fetch, origin: () => 'http://localhost:8865' })
    expect(await fetch2('http://127.0.0.1:8865/api/style-library/file?name=a.png')).toBeTruthy()
    // 端口不同仍然拒（同机不同服务不是"自己"）
    expect(await fetchSelfBytes('http://localhost:9999/api/x')).toBeUndefined()
    // 别的 host 一律拒
    expect(await fetchSelfBytes('http://my-nas.local:8865/api/x')).toBeUndefined()
  })

  it('别的域名一律不碰（SSRF 边界）：外部图床 / 内网地址都拒绝', async () => {
    const app = fakeApp({})
    const fetchSelfBytes = makeFetchSelfBytes({ fetch: app.fetch, origin: () => SELF })
    for (const bad of [
      'https://cdn.example.com/a.png',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/api/x',
    ]) {
      expect(await fetchSelfBytes(bad), bad).toBeUndefined()
    }
    // localhost 单独验：它**算自己**（本机别名），但要同端口才认 —— 见下一条用例
    expect(await fetchSelfBytes('http://localhost:9999/api/x')).toBeUndefined()
    // 一条都没真发出去
    expect(app.seen.length).toBe(0)
  })

  it('取不到 / 非 2xx / 空体 → undefined（不抛）', async () => {
    const app = fakeApp({ '/api/empty': { body: new Uint8Array(0) }, '/api/boom': { status: 500 } })
    const fetchSelfBytes = makeFetchSelfBytes({ fetch: app.fetch, origin: () => SELF })
    expect(await fetchSelfBytes('/api/missing')).toBeUndefined()
    expect(await fetchSelfBytes('/api/empty')).toBeUndefined()
    expect(await fetchSelfBytes('/api/boom')).toBeUndefined()
    // 不认识的形态（data: / 裸文件名）也不碰
    expect(await fetchSelfBytes('data:image/png;base64,AAAA')).toBeUndefined()
    expect(await fetchSelfBytes('abc.png')).toBeUndefined()
  })

  it('fetch 抛异常（超时 / 网络错）→ undefined，不把异常抛给调用方', async () => {
    const fetchSelfBytes = makeFetchSelfBytes({
      fetch: () => {
        throw new Error('boom')
      },
      origin: () => SELF,
    })
    expect(await fetchSelfBytes('/api/whatever')).toBeUndefined()
  })
})

describe('fileNameOf：给 mime 嗅探用，查询串里的 name 要认', () => {
  it('风格库形态：从 ?name= 里取（只按路径会得到 "file"）', () => {
    expect(fileNameOf('/api/style-library/file?name=821707893_e3f8d738aefc41d6b3368b2df39cadd6.png')).toBe(
      '821707893_e3f8d738aefc41d6b3368b2df39cadd6.png',
    )
  })
  it('路径式：取最后一段', () => {
    expect(fileNameOf('/api/canvases/c1/resources/abc.jpeg')).toBe('abc.jpeg')
    expect(fileNameOf('http://127.0.0.1:8865/api/assets/files/x.png')).toBe('x.png')
  })
})

describe('resolver 接线：风格库地址（这次的真 bug）也能翻成 data URL', () => {
  it('接上 fetchSelfBytes 后，/api/style-library/file?name=… 变成 data URL', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-style-'))
    try {
      const app = fakeApp({ '/api/style-library/file': {} })
      const resolveRef = makeResolveResourceUrl({
        canvasResources: new CanvasResourceStore(root),
        readAssetBytes: () => Promise.resolve(undefined),
        fetchSelfBytes: makeFetchSelfBytes({ fetch: app.fetch, origin: () => SELF }),
      })
      const url = '/api/style-library/file?name=821707893_e3f8d738aefc41d6b3368b2df39cadd6.png'
      expect(await resolveRef('c1', url)).toBe('data:image/png;base64,' + Buffer.from(PNG).toString('base64'))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('没接 fetchSelfBytes（老行为）→ 原样返回（不会炸）', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-style2-'))
    try {
      const resolveRef = makeResolveResourceUrl({
        canvasResources: new CanvasResourceStore(root),
        readAssetBytes: () => Promise.resolve(undefined),
      })
      const url = '/api/style-library/file?name=x.png'
      expect(await resolveRef('c1', url)).toBe(url)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
