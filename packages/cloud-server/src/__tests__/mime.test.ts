/**
 * mime 查表单测 —— 纯逻辑（不落盘、不启服务）。
 *
 * 为什么值得单测：上传（MIME → 扩展名）与回读（扩展名 → MIME）走的是同一张表，
 * 两边一旦飘了，表现是"图片存成了 .bin、浏览器当二进制下载"这种很晚才发现的问题。
 */
import { describe, it, expect } from 'vitest'
import { safeExt, extFromMime, mimeFromName, mimeOf, ALLOWED_EXT } from '../store/mime'

describe('safeExt：白名单外的扩展名不许落盘', () => {
  it('认识的图片 / 视频 / 音频扩展名原样返回', () => {
    expect(safeExt('a.png')).toBe('.png')
    expect(safeExt('A.JPEG')).toBe('.jpeg')
    expect(safeExt('b.mp4')).toBe('.mp4')
    expect(safeExt('c.webm')).toBe('.webm')
    expect(safeExt('d.mp3')).toBe('.mp3')
  })
  it('危险扩展名一律回落空串（同源托管下会造成 XSS 面）', () => {
    expect(safeExt('evil.html')).toBe('')
    expect(safeExt('evil.js')).toBe('')
    expect(safeExt('evil.mjs')).toBe('')
    expect(safeExt('evil.php')).toBe('')
  })
  it('没有扩展名 / 怪名字 → 空串', () => {
    expect(safeExt('noext')).toBe('')
    expect(safeExt('')).toBe('')
  })
})

describe('extFromMime：上传时按 Content-Type 猜扩展名', () => {
  it('常见类型能认出来', () => {
    expect(extFromMime('image/png')).toBe('.png')
    expect(extFromMime('image/jpeg')).toBe('.jpg')
    expect(extFromMime('video/mp4')).toBe('.mp4')
    expect(extFromMime('audio/mpeg')).toBe('.mp3')
  })
  it('带 charset 也能认（取分号前那段）', () => {
    expect(extFromMime('image/svg+xml; charset=utf-8')).toBe('.svg')
  })
  it('不认识的类型 → 空串（不猜）', () => {
    expect(extFromMime('text/html')).toBe('')
    expect(extFromMime('application/javascript')).toBe('')
    expect(extFromMime('')).toBe('')
  })
})

describe('mimeFromName / mimeOf：回读时给 Content-Type', () => {
  it('按扩展名给对的 MIME', () => {
    expect(mimeFromName('a1b2.png')).toBe('image/png')
    expect(mimeFromName('a1b2.webp')).toBe('image/webp')
    expect(mimeOf('a1b2.mp4')).toBe('video/mp4')
  })
  it('未知扩展名的兜底是二进制流（不是猜类型）', () => {
    expect(mimeFromName('a1b2.xyz')).toBe('application/octet-stream')
    expect(mimeFromName('noext')).toBe('application/octet-stream')
  })
})

describe('白名单自身', () => {
  it('不含脚本类扩展名', () => {
    for (const bad of ['.html', '.htm', '.js', '.mjs', '.cjs', '.php', '.py']) {
      expect(ALLOWED_EXT).not.toContain(bad)
    }
  })
  it('含画布用得到的主要媒体类型', () => {
    for (const ok of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.webm', '.mp3', '.wav', '.pdf']) {
      expect(ALLOWED_EXT).toContain(ok)
    }
  })
})
