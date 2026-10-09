/**
 * referencePrep —— 下单前把参考图整理成 web2api 能直接用的形态（纯逻辑，注入假货）。
 *
 * 锁的两件事：
 * 1. needsUpload 的判定边界（哪些原样、哪些必须先上传）；
 * 2. prepareReferenceImages 的编排：保序、失败只丢那一项、外链/本机地址不动。
 */
import { describe, it, expect } from 'vitest'
import { needsUpload, prepareReferenceImages, type ReferencePrepDeps } from '../referencePrep'

const WEB = 'http://localhost:8033'

describe('needsUpload', () => {
  it('画布本站的相对地址（/api/canvases/...、/api/assets/files/...）→ 要上传', () => {
    expect(needsUpload('/api/canvases/c1/resources/x.png', WEB)).toBe(true)
    expect(needsUpload('/api/assets/files/x.png', WEB)).toBe(true)
  })

  it('data: / blob: → 要上传（只有本页面能取到）', () => {
    expect(needsUpload('data:image/png;base64,AA', WEB)).toBe(true)
    expect(needsUpload('blob:http://x/1', WEB)).toBe(true)
  })

  it('其它服务的 http(s) 绝对地址 → 不上传（web2api 自己会下载）', () => {
    expect(needsUpload('https://cdn.example.com/a.png', WEB)).toBe(false)
  })

  it('web2api 自己的地址 → 不上传', () => {
    expect(needsUpload('http://localhost:8033/hash.png', WEB)).toBe(false)
    expect(needsUpload('/api/resources/uploads/hash.png', WEB)).toBe(false)
    expect(needsUpload('/hash.png', WEB)).toBe(false)
  })
})

/** 假 blob：带类型与字节（node 有全局 Blob） */
const blobOf = (text: string, type = 'image/png') => new Blob([text], { type })

function makeDeps(overrides: Partial<ReferencePrepDeps> = {}) {
  const uploaded: Array<{ content: string; mimeType?: string }> = []
  const fetched: string[] = []
  const errors: string[] = []
  const deps: ReferencePrepDeps = {
    webOrigin: WEB,
    fetchBlob: async (url) => {
      fetched.push(url)
      return blobOf('PNGDATA')
    },
    upload: async (content, mimeType) => {
      uploaded.push({ content, mimeType })
      return '/up-' + uploaded.length + '.png'
    },
    onError: (msg) => errors.push(msg),
    ...overrides,
  }
  return { deps, uploaded, fetched, errors }
}

describe('prepareReferenceImages', () => {
  it('相对地址上传换成 referenceUrl；外链与 web2api 自己的地址原样；顺序保持', async () => {
    const { deps, uploaded, fetched } = makeDeps()
    const out = await prepareReferenceImages(
      [
        '/api/canvases/c1/resources/a.png', // 上传 → /up-1.png
        'https://cdn.example.com/b.png', // 原样
        '/api/resources/uploads/c.png', // 原样
        '/api/assets/files/d.png', // 上传 → /up-2.png
        '/hash.png', // 原样
      ],
      deps,
    )
    expect(out).toEqual([
      '/up-1.png',
      'https://cdn.example.com/b.png',
      '/api/resources/uploads/c.png',
      '/up-2.png',
      '/hash.png',
    ])
    // 只对“要上传”的两项取字节；上传内容转成了 data URL，mimeType 从 blob 带过去
    expect(fetched).toEqual(['/api/canvases/c1/resources/a.png', '/api/assets/files/d.png'])
    expect(uploaded).toHaveLength(2)
    expect(uploaded[0].mimeType).toBe('image/png')
    expect(uploaded[0].content.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('上传失败的那一项被丢弃，其余照常、顺序不乱', async () => {
    // 'BAD' 的 base64 是 QkFE；这一份上传失败，另外一份成功
    const { deps, errors } = makeDeps({
      fetchBlob: async (url) => blobOf(url.includes('bad') ? 'BAD' : 'OK'),
      upload: async (content) => (content.includes('QkFE') ? undefined : '/ok.png'),
    })
    const out = await prepareReferenceImages(['/api/assets/files/bad.png', '/api/assets/files/good.png'], deps)
    expect(out).toEqual(['/ok.png'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('已丢弃')
  })

  it('data: 地址原样取字节上传（fetchBlob 拿到原始 data URL）', async () => {
    const { deps, uploaded, fetched } = makeDeps()
    const out = await prepareReferenceImages(['data:image/png;base64,AA'], deps)
    expect(out).toEqual(['/up-1.png'])
    expect(fetched).toEqual(['data:image/png;base64,AA'])
    expect(uploaded[0].content.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('取不到字节的项被丢弃并告警，不把坏地址发出去', async () => {
    const { deps, errors } = makeDeps({ fetchBlob: async () => undefined })
    const out = await prepareReferenceImages(['/api/assets/files/missing.png', 'https://cdn.example.com/keep.png'], deps)
    expect(out).toEqual(['https://cdn.example.com/keep.png'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('已丢弃')
  })
})
