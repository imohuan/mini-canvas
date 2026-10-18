/**
 * 云端资源后端：**put 只回逻辑 ID，地址由 resolve 现拼**。
 *
 * 形态：`<canvasId>/<hashName>`（例 `default/0123456789abcdef.png`）。
 * ID 里带画布作用域，是为了复制画布时能把前缀换成新画布 id —— 不依赖 URL 字符串替换。
 *
 * resolve 同时认三种输入：
 * 1. 新逻辑 ID → 拼 `/api/canvases/<canvasId>/resources/<hashName>`，HEAD 确认可请求；
 * 2. 旧同源 URL → 原样返回（迁移期存档里还有）；
 * 3. 旧 `res-` 前缀 → undefined（云端没有这份字节）。
 */
import { describe, it, expect } from 'vitest'
import {
  createCloudResourceAdapter,
  cloudResourceId,
  cloudResourceUrl,
  parseCloudResourceId,
} from '../cloudResourceAdapter'
import { CloudApi } from '../api'
import type { FetchLike } from '../apiTypes'

const HASH = '0123456789abcdef.png'

/**
 * 假云端：上传回 hashName；HEAD 按 `existing` 集合回答 200/404。
 *
 * 记下每次 HEAD 的路径，用来断言"旧 URL 不探测、逻辑 ID 才探测"。
 */
function fakeApi(existing: string[] = []): {
  api: CloudApi
  uploads: Array<{ path: string; body: unknown }>
  heads: string[]
} {
  const uploads: Array<{ path: string; body: unknown }> = []
  const heads: string[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const path = String(url).replace('http://srv', '')
    if (init?.method === 'HEAD') {
      heads.push(path)
      return new Response(null, { status: existing.includes(path) ? 200 : 404 })
    }
    const m = /^\/api\/canvases\/([^/]+)\/resources\?/.exec(path)
    if (init?.method === 'POST' && m) {
      uploads.push({ path, body: init.body })
      return new Response(JSON.stringify({ ok: true, hashName: HASH }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 })
  }
  return { api: new CloudApi({ baseUrl: 'http://srv', fetchImpl }), uploads, heads }
}

describe('putResource：只回逻辑 ID，不带 URL 形状', () => {
  it('上传成功返回 <canvasId>/<hashName>', async () => {
    const { api, uploads } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    const ref = await adapter.putResource(new Blob([new Uint8Array([1, 2, 3])]), { kind: 'image' })
    expect(ref).toBe('default/' + HASH)
    expect(uploads).toHaveLength(1)
  })

  it('返回值不含 ://，不以 blob:/data: 开头', async () => {
    const { api } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    const ref = await adapter.putResource(new Blob([new Uint8Array([1])]), { kind: 'video' })
    expect(ref).not.toContain('://')
    expect(ref.startsWith('blob:')).toBe(false)
    expect(ref.startsWith('data:')).toBe(false)
  })

  it('画布 id 就是 ID 的作用域（多画布各存各的目录）', async () => {
    const { api, uploads } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'other')
    const ref = await adapter.putResource(new Blob([new Uint8Array([1])]), { kind: 'image' })
    expect(ref).toBe('other/' + HASH)
    expect(uploads[0].path).toContain('/api/canvases/other/resources')
  })

  it('调用方给了 ref（派生资源 / 固定槽位）→ 原样返回裸引用', async () => {
    const { api } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    const ref = await adapter.putResource(new Blob([new Uint8Array([1])]), { ref: 'thumb-n1', derived: true })
    expect(ref).toBe('thumb-n1')
  })
})

describe('resolveResource：逻辑 ID → 路由', () => {
  it('认新 ID，拼出本画布资源路由', async () => {
    const url = cloudResourceUrl('default', HASH)
    const { api, heads } = fakeApi([url])
    const adapter = createCloudResourceAdapter(api, 'default')
    expect(await adapter.resolveResource(cloudResourceId('default', HASH))).toBe(url)
    expect(heads).toEqual([url])
  })

  it('ID 里的画布作用域决定路由（跨画布引用不自作主张改地址）', async () => {
    const url = cloudResourceUrl('other', HASH)
    const { api } = fakeApi([url])
    const adapter = createCloudResourceAdapter(api, 'default')
    expect(await adapter.resolveResource('other/' + HASH)).toBe(url)
  })

  it('文件不在（HEAD 404）→ undefined，不返回一条打不开的地址', async () => {
    const { api } = fakeApi([])
    const adapter = createCloudResourceAdapter(api, 'default')
    expect(await adapter.resolveResource('default/' + HASH)).toBeUndefined()
  })

  it('HEAD 本身失败（网络异常）→ undefined', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('offline')
    }
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    const adapter = createCloudResourceAdapter(api, 'default')
    expect(await adapter.resolveResource('default/' + HASH)).toBeUndefined()
  })
})

describe('resolveResource：兼容旧形态', () => {
  it('旧同源 URL → 原样返回，不探测', async () => {
    const { api, heads } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    const old = cloudResourceUrl('default', HASH)
    expect(await adapter.resolveResource(old)).toBe(old)
    expect(await adapter.resolveResource('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(heads).toHaveLength(0)
  })

  it('旧远端画布 URL 也原样返回（跨画布引用不擅自改名）', async () => {
    const { api } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    const other = '/api/canvases/other/resources/' + HASH
    expect(await adapter.resolveResource(other)).toBe(other)
  })

  it('旧 res- 前缀 → undefined（云端不认识本地取件码），也不去 HEAD', async () => {
    const { api, heads } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    expect(await adapter.resolveResource('res-1-local')).toBeUndefined()
    expect(heads).toHaveLength(0)
  })

  it('认不出的东西返回 undefined（blob: / data: / 空 / 任意字符串）', async () => {
    const { api } = fakeApi()
    const adapter = createCloudResourceAdapter(api, 'default')
    expect(await adapter.resolveResource('blob:http://x/1')).toBeUndefined()
    expect(await adapter.resolveResource('data:image/png;base64,AAAA')).toBeUndefined()
    expect(await adapter.resolveResource('')).toBeUndefined()
    expect(await adapter.resolveResource('not-a-resource')).toBeUndefined()
  })
})

describe('逻辑 ID 形态：复制画布靠前缀重映射', () => {
  it('c1/hash → c2/hash 后解析到副本画布，不去改 URL 字符串', async () => {
    const copied = 'c2/' + HASH
    expect(copied.startsWith('c1/')).toBe(false)
    const { api } = fakeApi([cloudResourceUrl('c2', HASH)])
    const adapter = createCloudResourceAdapter(api, 'c2')
    expect(await adapter.resolveResource(copied)).toBe('/api/canvases/c2/resources/' + HASH)
  })

  it('parseCloudResourceId 只认白名单形态', () => {
    expect(parseCloudResourceId('default/' + HASH)).toEqual({ canvasId: 'default', hashName: HASH })
    expect(parseCloudResourceId('default/slot-thumb-1.webp')).toEqual({
      canvasId: 'default',
      hashName: 'slot-thumb-1.webp',
    })
    // 多段、外链、本地取件码、非哈希资源名都不算逻辑 ID
    expect(parseCloudResourceId('a/b/c')).toBeUndefined()
    expect(parseCloudResourceId('https://x/y.png')).toBeUndefined()
    expect(parseCloudResourceId('res-1')).toBeUndefined()
    expect(parseCloudResourceId('default/notahash.png')).toBeUndefined()
  })
})
