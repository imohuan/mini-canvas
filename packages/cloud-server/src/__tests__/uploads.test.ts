import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_UPLOAD_BYTES, maxUploadBytes, readBodyLimited, uploadErrorBody } from '../uploads.js'

/** 造一个假的请求对象（只要 header + arrayBuffer） */
function fakeReq(bytes: Uint8Array | null, contentLength?: string) {
  return {
    header: (n: string) => (n.toLowerCase() === 'content-length' ? contentLength : undefined),
    arrayBuffer: async () => {
      if (!bytes) throw new Error('boom')
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      return copy.buffer
    },
  }
}

describe('uploads 上限', () => {
  it('默认 50MB', () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024)
    expect(maxUploadBytes({})).toBe(DEFAULT_MAX_UPLOAD_BYTES)
  })

  it('环境变量可覆盖，非法值回落默认', () => {
    expect(maxUploadBytes({ MINI_CANVAS_MAX_UPLOAD_MB: '2' })).toBe(2 * 1024 * 1024)
    expect(maxUploadBytes({ MINI_CANVAS_MAX_UPLOAD_MB: 'abc' })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(maxUploadBytes({ MINI_CANVAS_MAX_UPLOAD_MB: '-3' })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
  })

  it('content-length 超限：不读 body 直接拒', async () => {
    const r = await readBodyLimited(fakeReq(new Uint8Array(8), String(999)), 100)
    expect(r).toMatchObject({ ok: false, reason: 'too-large' })
  })

  it('content-length 撒谎（声明小、实际大）：读的时候也会拦', async () => {
    const r = await readBodyLimited(fakeReq(new Uint8Array(200), '10'), 100)
    expect(r).toMatchObject({ ok: false, reason: 'too-large' })
  })

  it('没有 content-length 也按实际字节数拦', async () => {
    const r = await readBodyLimited(fakeReq(new Uint8Array(200)), 100)
    expect(r).toMatchObject({ ok: false, reason: 'too-large' })
  })

  it('空文件 / 读失败各有自己的原因', async () => {
    expect(await readBodyLimited(fakeReq(new Uint8Array(0)), 100)).toMatchObject({ ok: false, reason: 'empty' })
    expect(await readBodyLimited(fakeReq(null), 100)).toMatchObject({ ok: false, reason: 'unreadable' })
  })

  it('正常大小通过，字节原样', async () => {
    const r = await readBodyLimited(fakeReq(new Uint8Array([1, 2, 3])), 100)
    expect(r.ok).toBe(true)
    if (r.ok) expect(Array.from(r.bytes)).toEqual([1, 2, 3])
  })

  it('错误体：超限是 413，其余 400', () => {
    expect(uploadErrorBody({ ok: false, reason: 'too-large', limit: 1024 * 1024 }).status).toBe(413)
    expect(uploadErrorBody({ ok: false, reason: 'empty', limit: 10 }).status).toBe(400)
    expect(uploadErrorBody({ ok: false, reason: 'unreadable', limit: 10 }).status).toBe(400)
  })
})
