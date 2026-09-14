/**
 * 资源搬运单测（不碰真网络；dataURL 用真实编码路径验证）。
 *
 * 锁的几条：
 * - 只搬**够大 + 类型认识**的 dataURL（小图留在画布里更划算，text/plain 不该被当资源）；
 * - 只扫**已知的资源字段**（否则用户文本框里一段恰好以 data:image/ 开头的字会被当成图搬走）；
 * - 单个失败不拖垮其它（错误清单单独返回）。
 */
import { describe, it, expect } from 'vitest'
import {
  parseDataUrl,
  isUploadableDataUrl,
  extForMime,
  dataUrlToBlob,
  uploadDataUrl,
  uploadBlob,
  collectUploadableFields,
  uploadFields,
  RESOURCE_FIELDS,
} from '../resourceUpload'

/** 造一个够大的 base64 dataURL（默认 100KB 量级） */
function bigDataUrl(mime = 'image/png', bytes = 100 * 1024): string {
  const raw = new Uint8Array(bytes)
  for (let i = 0; i < bytes; i++) raw[i] = i % 251
  let bin = ''
  for (const b of raw) bin += String.fromCharCode(b)
  return `data:${mime};base64,${btoa(bin)}`
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('parseDataUrl / isUploadableDataUrl', () => {
  it('认出 base64 与非 base64 两类', () => {
    expect(parseDataUrl('data:image/png;base64,AAA')).toEqual({ mime: 'image/png', isBase64: true })
    expect(parseDataUrl('data:image/svg+xml,%3Csvg/%3E')).toEqual({ mime: 'image/svg+xml', isBase64: false })
    expect(parseDataUrl('data:image/svg+xml;charset=utf-8,%3Csvg/%3E')?.mime).toBe('image/svg+xml')
  })

  it('不是 dataURL → null', () => {
    expect(parseDataUrl('https://x/a.png')).toBeNull()
    expect(parseDataUrl('/uploads/abc.png')).toBeNull()
    expect(parseDataUrl('')).toBeNull()
  })

  it('只搬够大的资源类 dataURL', () => {
    expect(isUploadableDataUrl(bigDataUrl('image/png'))).toBe(true)
    expect(isUploadableDataUrl(bigDataUrl('video/mp4'))).toBe(true)
    // 太小 → 不值得搬
    expect(isUploadableDataUrl('data:image/png;base64,AAAA', 32 * 1024)).toBe(false)
    // 类型不认识（文本）→ 不搬
    expect(isUploadableDataUrl(bigDataUrl('text/plain'))).toBe(false)
    // 已经是普通 URL → 不搬
    expect(isUploadableDataUrl('/uploads/x.png')).toBe(false)
    // 非字符串 → 不搬
    expect(isUploadableDataUrl(123)).toBe(false)
  })
})

describe('extForMime / dataUrlToBlob', () => {
  it('MIME → 服务端白名单内的扩展名；不认识的给空串', () => {
    expect(extForMime('image/png')).toBe('.png')
    expect(extForMime('IMAGE/JPEG')).toBe('.jpg')
    expect(extForMime('video/mp4')).toBe('.mp4')
    expect(extForMime('application/x-weird')).toBe('')
  })

  it('base64 → Blob，字节与原文一致', async () => {
    const url = bigDataUrl('image/png', 300)
    const blob = dataUrlToBlob(url)
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(300)
    const buf = new Uint8Array(await blob.arrayBuffer())
    expect(buf[0]).toBe(0)
    expect(buf[250]).toBe(250)
    expect(buf[251]).toBe(0) // i % 251 回绕
  })

  it('非 base64（URI 编码）→ 解码后是原文', async () => {
    const blob = dataUrlToBlob('data:image/svg+xml,%3Csvg%20width%3D%221%22%3E%3C%2Fsvg%3E')
    expect(await blob.text()).toBe('<svg width="1"></svg>')
  })

  it('坏 dataURL → 抛错（不静默产出空 blob）', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrow('不是合法的 dataURL')
  })
})

describe('uploadBlob / uploadDataUrl', () => {
  it('POST 到 /api/files，带 name 查询参数与 content-type，返回服务端回执', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return json({ id: 'abc.png', url: '/uploads/abc.png', size: 3, mime: 'image/png' })
    }) as typeof fetch

    const r = await uploadDataUrl(bigDataUrl('image/png', 300), {
      baseUrl: 'http://s:1/',
      fetchImpl: impl,
      name: 'asset.png',
    })
    expect(r.url).toBe('/uploads/abc.png')
    expect(calls[0].url).toBe('http://s:1/api/files?name=asset.png')
    expect(calls[0].init?.method).toBe('POST')
    expect((calls[0].init?.headers as Record<string, string>)['content-type']).toBe('image/png')
  })

  it('上传失败 → 抛错（带状态码，便于排查）', async () => {
    const impl = (async () => json({ ok: false }, 413)) as unknown as typeof fetch
    await expect(uploadBlob(new Blob([new Uint8Array([1])]), { fetchImpl: impl })).rejects.toThrow('上传失败 413')
  })
})

describe('collectUploadableFields', () => {
  it('只扫已知资源字段，且只收够大的', () => {
    const nodes = [
      { id: 'n1', data: { imageUrl: bigDataUrl('image/png'), text: 'hi' } },
      { id: 'n2', data: { imageUrl: 'data:image/png;base64,AA' } }, // 太小
      { id: 'n3', data: { text: 'data:image/png;base64,' + 'A'.repeat(99999) } }, // 不是资源字段
      { id: 'n4', data: { videoUrl: bigDataUrl('video/mp4') } },
      { id: 'n5' },
    ]
    const fields = collectUploadableFields(nodes)
    expect(fields.map((f) => `${f.nodeId}.${f.field}`)).toEqual(['n1.imageUrl', 'n4.videoUrl'])
  })

  it('资源字段白名单是这 4 个（将来加 video 节点不必改逻辑）', () => {
    expect([...RESOURCE_FIELDS]).toEqual(['imageUrl', 'videoUrl', 'audioUrl', 'posterUrl'])
  })
})

describe('uploadFields', () => {
  it('逐个上传，按节点合并成补丁；返回错误清单', async () => {
    const impl = (async () => json({ id: 'h.png', url: '/uploads/h.png', size: 1, mime: 'image/png' })) as unknown as typeof fetch

    const ok = await uploadFields([
      { nodeId: 'n1', field: 'imageUrl', value: bigDataUrl('image/png', 300) },
      { nodeId: 'n1', field: 'posterUrl', value: bigDataUrl('image/png', 300) },
      { nodeId: 'n2', field: 'imageUrl', value: bigDataUrl('image/png', 300) },
    ], { fetchImpl: impl })
    expect(ok.errors).toEqual([])
    // n1 的两个字段合并进一个补丁（一次写回，一条撤销记录）
    expect(ok.patches).toEqual([
      { nodeId: 'n1', data: { imageUrl: '/uploads/h.png', posterUrl: '/uploads/h.png' } },
      { nodeId: 'n2', data: { imageUrl: '/uploads/h.png' } },
    ])
  })

  it('单个失败不影响其它，失败进 errors', async () => {
    let n = 0
    const impl = (async () => {
      n += 1
      return n === 1 ? json({ ok: false }, 500) : json({ id: 'k.png', url: '/uploads/k.png', size: 1, mime: 'image/png' })
    }) as unknown as typeof fetch

    const r = await uploadFields([
      { nodeId: 'bad', field: 'imageUrl', value: bigDataUrl('image/png', 300) },
      { nodeId: 'good', field: 'imageUrl', value: bigDataUrl('image/png', 300) },
    ], { fetchImpl: impl })
    expect(r.patches).toEqual([{ nodeId: 'good', data: { imageUrl: '/uploads/k.png' } }])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].nodeId).toBe('bad')
  })
})
