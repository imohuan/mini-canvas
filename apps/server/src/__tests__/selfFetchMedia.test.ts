/**
 * 补两组守卫（用户实测延伸出来的真实隐患）：
 *   1. 路由不存在 / 插件没加载时，静态兜底会把 **index.html** 返回给任何 GET ——
 *      "取字节成功"其实拿到一段 HTML，内嵌成 data URL 发给上游，上游把它当图片解 → 报错。
 *      所以 selfFetch 必须校验"拿回来的是不是媒体"（Content-Type + 文件头双把关）。
 *   2. looksLikeMedia 本身的判定表。
 */
import { describe, it, expect } from 'vitest'
import { makeFetchSelfBytes, looksLikeMedia } from '../tasks/selfFetch'

const SELF = 'http://127.0.0.1:8865'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
const HTML = new TextEncoder().encode('<!doctype html><html><body>index</body></html>')

function app(handler: (url: string) => { status?: number; type?: string; body: Uint8Array }) {
  return (req: Request): Response => {
    const r = handler(new URL(req.url).pathname + new URL(req.url).search)
    return new Response(r.body, { status: r.status ?? 200, headers: r.type ? { 'content-type': r.type } : {} })
  }
}

describe('selfFetch 不会被静态兜底的 index.html 骗到（实测隐患）', () => {
  it('路由不存在 → 兜底返回 index.html → 判定为"没取到"（不给上游一段 HTML 当图片）', async () => {
    const fetchSelfBytes = makeFetchSelfBytes({
      fetch: app(() => ({ type: 'text/html; charset=utf-8', body: HTML })),
      origin: () => SELF,
    })
    expect(await fetchSelfBytes('/api/style-library/file?name=x.png')).toBeUndefined()
  })

  it('Content-Type 撒谎说是图片、实际是 HTML → 按文件头拒掉', async () => {
    const fetchSelfBytes = makeFetchSelfBytes({
      fetch: app(() => ({ type: 'image/png', body: HTML })),
      origin: () => SELF,
    })
    expect(await fetchSelfBytes('/api/whatever.png')).toBeUndefined()
  })

  it('JSON / text 响应也拒掉（有些接口按 JSON 回错误）', async () => {
    const fetchSelfBytes = makeFetchSelfBytes({
      fetch: app((u) => (u.includes('json')
        ? { type: 'application/json', body: new TextEncoder().encode('{"ok":false}') }
        : { type: 'text/plain', body: new TextEncoder().encode('nope') })),
      origin: () => SELF,
    })
    expect(await fetchSelfBytes('/api/x.json')).toBeUndefined()
    expect(await fetchSelfBytes('/api/x.txt')).toBeUndefined()
  })

  it('真图片照常放行（Content-Type 缺失也能靠文件头认出来）', async () => {
    const fetchSelfBytes = makeFetchSelfBytes({
      fetch: app(() => ({ body: PNG })),
      origin: () => SELF,
    })
    expect(new Uint8Array((await fetchSelfBytes('/api/style-library/file?name=x.png'))!)).toEqual(PNG)
  })
})

describe('looksLikeMedia：常见媒体头认得出，网页/文本认不出', () => {
  it('图片 / 视频 / 音频都对', () => {
    expect(looksLikeMedia(PNG)).toBe(true)
    expect(looksLikeMedia(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true) // jpeg
    expect(looksLikeMedia(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe(true) // gif
    expect(looksLikeMedia(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBe(true) // riff/webp
    expect(looksLikeMedia(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]))).toBe(true) // mp4
    expect(looksLikeMedia(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00]))).toBe(true) // ogg
    expect(looksLikeMedia(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(true)
  })
  it('HTML / JSON / 纯文本 / 太短 → 不是媒体', () => {
    expect(looksLikeMedia(HTML)).toBe(false)
    expect(looksLikeMedia(new TextEncoder().encode('{"a":1}'))).toBe(false)
    expect(looksLikeMedia(new TextEncoder().encode('hello world'))).toBe(false)
    expect(looksLikeMedia(new Uint8Array([]))).toBe(false)
    expect(looksLikeMedia(new Uint8Array([0x89, 0x50]))).toBe(false)
  })
})

