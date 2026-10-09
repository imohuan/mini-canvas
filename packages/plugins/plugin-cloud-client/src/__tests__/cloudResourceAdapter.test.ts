/**
 * 云端资源后端：**节点里存的就是 URL**。
 *
 * 背景：全项目统一用 URL 表达资源（另一条写入路径在 cloud-server）。前端这边两个口子：
 * 1. putResource 回同源 URL（/api/canvases/<画布id>/resources/<哈希>）；
 * 2. resolveResource **幂等** —— URL 原样返回，别的（blob: / data: / 认不出的）给 undefined。
 */
import { describe, it, expect } from 'vitest'
import { createCloudResourceAdapter } from '../cloudResourceAdapter'
import { CloudApi } from '../api'
import type { FetchLike } from '../apiTypes'

const URL_DEFAULT = '/api/canvases/default/resources/0123456789abcdef.png'

/** 假云端：上传接口照 cloud-server 的真实返回给（ref + hashName + url），换哪个画布就回哪个的地址 */
function fakeApi(): { api: CloudApi; uploads: Array<{ path: string; body: unknown }> } {
  const uploads: Array<{ path: string; body: unknown }> = []
  const fetchImpl: FetchLike = async (url, init) => {
    const path = String(url).replace('http://srv', '')
    const m = /^\/api\/canvases\/([^/]+)\/resources\?/.exec(path)
    if (init?.method === 'POST' && m) {
      uploads.push({ path, body: init.body })
      const hashName = '0123456789abcdef.png'
      return new Response(
        JSON.stringify({
          ok: true,
          hashName,
          url: '/api/canvases/' + m[1] + '/resources/' + hashName,
        }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 })
  }
  return { api: new CloudApi({ baseUrl: 'http://srv', fetchImpl }), uploads }
}

describe('putResource：回同源 URL', () => {
  it('上传成功后返回 /api/canvases/<画布id>/resources/<哈希>', async () => {
    const { api, uploads } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    const ref = await adapter.putResource(new Blob([new Uint8Array([1, 2, 3])]), { kind: 'image' })
    expect(ref).toBe(URL_DEFAULT)
    expect(uploads).toHaveLength(1)
  })

  it('画布 id 跟着走（多画布各传各的目录）', async () => {
    const { api, uploads } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'other')
    const ref = await adapter.putResource(new Blob([new Uint8Array([1])]), { kind: 'image' })
    expect(ref).toBe('/api/canvases/other/resources/0123456789abcdef.png')
    expect(uploads[0].path).toContain('/api/canvases/other/resources')
  })
})

describe('resolveResource：幂等', () => {
  it('已是 URL → 原样返回（渲染组件直接能用）', async () => {
    const { api } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    expect(await adapter.resolveResource(URL_DEFAULT)).toBe(URL_DEFAULT)
    expect(await adapter.resolveResource('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })

  it('其它画布的 URL 也原样返回（跨画布引用不擅自改名）', async () => {
    const { api } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    const other = '/api/canvases/other/resources/0123456789abcdef.png'
    expect(await adapter.resolveResource(other)).toBe(other)
  })

  it('认不出的东西返回 undefined（不猜成地址）', async () => {
    const { api } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    expect(await adapter.resolveResource('res-1-local')).toBeUndefined()
    expect(await adapter.resolveResource('blob:http://x/1')).toBeUndefined()
    expect(await adapter.resolveResource('')).toBeUndefined()
  })
})
