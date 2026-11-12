/**
 * 「引用被点了」之后的两处纯换算（用户口径 2026-10-08）。
 *
 * 为什么要测：引用标记里存的是**本机绝对路径**（要能复制给本机 Agent 直接用），
 * 浏览器加载不了它 —— 换算错的表现是「点开了预览但一片空白」或「点文件夹弹出图片」，
 * 在浏览器里很难看出来。判断「文件还是文件夹」不在这里（由标记里有没有 ext 决定）。
 */
import { describe, expect, it } from 'vitest'
import { assetUrlOf, kindOfExt } from '../composables/assetRefOpen'

describe('kindOfExt', () => {
  it('图片 / 视频 / 音频 / 文本各自归位', () => {
    expect(kindOfExt('png')).toBe('image')
    expect(kindOfExt('JPEG')).toBe('image')
    expect(kindOfExt('mp4')).toBe('video')
    expect(kindOfExt('mp3')).toBe('audio')
    expect(kindOfExt('txt')).toBe('text')
  })

  it('认不出的当图片（资产里最常见的就是图，比什么都不做强）', () => {
    expect(kindOfExt('zzz')).toBe('image')
    expect(kindOfExt(undefined)).toBe('image')
  })
})

describe('assetUrlOf（本机绝对路径 → 同源可取地址）', () => {
  it('上传资产 → /api/assets/files/<文件名>', () => {
    expect(assetUrlOf('D:\\data\\assets\\files\\ab12.png')).toBe('/api/assets/files/ab12.png')
    expect(assetUrlOf('/root/assets/files/ab12.png')).toBe('/api/assets/files/ab12.png')
  })

  it('画布资源 → /api/canvases/<画布id>/resources/<文件名>', () => {
    expect(assetUrlOf('D:/d/canvases/c1/resources/hash.mp4')).toBe('/api/canvases/c1/resources/hash.mp4')
  })

  it('已经是同源 HTTP 地址的再算一次是恒等的（不用特判）', () => {
    expect(assetUrlOf('/api/assets/files/ab12.png')).toBe('/api/assets/files/ab12.png')
    expect(assetUrlOf('/api/canvases/c1/resources/hash.mp4')).toBe('/api/canvases/c1/resources/hash.mp4')
  })

  /** 踩过：以 `/` 开头的**本机绝对路径**被误当成「已经是相对地址」原样返回 → 浏览器打不开 */
  it('以 / 开头的本机绝对路径仍然换算（不是「已经是相对地址」）', () => {
    expect(assetUrlOf('/root/assets/files/ab12.png')).toBe('/api/assets/files/ab12.png')
  })

  it('外部地址原样用（不拿它的尾段去猜本地路由）', () => {
    expect(assetUrlOf('http://localhost:8033/files/ab12.png')).toBe('http://localhost:8033/files/ab12.png')
  })

  it('空路径给空串（不瞎编地址）', () => {
    expect(assetUrlOf(undefined)).toBe('')
    expect(assetUrlOf('')).toBe('')
  })
})
