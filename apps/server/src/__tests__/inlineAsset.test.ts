import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { inlineAssetHeaders } from '../inlineAsset.js'

describe('回读上传资源的安全头', () => {
  it('带 CSP sandbox 与 nosniff', () => {
    const h = inlineAssetHeaders('image/svg+xml')
    expect(h['content-type']).toBe('image/svg+xml')
    expect(h['content-security-policy']).toContain('sandbox')
    expect(h['content-security-policy']).toContain("default-src 'none'")
    expect(h['x-content-type-options']).toBe('nosniff')
  })

  it('图片类型也照样加（不只是 svg）', () => {
    const h = inlineAssetHeaders('image/png')
    expect(h['content-security-policy']).toContain('sandbox')
  })

  /**
   * 用户 2026-11-17 实测：可视化节点的沙箱 iframe（不透明源）里 `<audio src>` 报
   * 「无法播放媒体」。原因是 CORP 写成 same-site —— 不透明源不算同一个 site。
   */
  it('★ CORP 不能是 same-site：沙箱 iframe 是不透明源，否则音视频播不出来', () => {
    const h = inlineAssetHeaders('audio/mpeg')
    expect(h['cross-origin-resource-policy']).toBe('cross-origin')
    expect(h['cross-origin-resource-policy']).not.toBe('same-site')
  })

  it('真的出现在响应头上', async () => {
    const app = new Hono()
    app.get('/x', (c) => c.body(new Uint8Array([1, 2, 3]), 200, inlineAssetHeaders('image/svg+xml')))
    const res = await app.fetch(new Request('http://x/x'))
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
