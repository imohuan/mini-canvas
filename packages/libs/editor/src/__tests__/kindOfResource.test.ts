/**
 * 资源类型判定（用户 2026-10-29 第 3 点）：
 * 旧实现只按「名字」猜类型，用户给节点起的真名（「泳装少女」）一律当文本，
 * 于是图片标签 hover 永远不弹预览。这里钉住新的判定顺序。
 */
import { describe, expect, it } from 'vitest'
import { kindOfResource, kindFromName } from '../useEditor'

describe('kindOfResource：先看真实类型，再看地址，最后才看名字', () => {
  it('注册表声明 image → image（名字是用户的真名也照样认）', () => {
    expect(kindOfResource({ chipKind: 'image' }, { name: '泳装少女', url: 'data:image/svg+xml;base64,AA' })).toBe('image')
  })

  it('mediaType 也算声明（老条目只有 mediaType）', () => {
    expect(kindOfResource({ mediaType: 'video' }, { name: '画面推演' })).toBe('video')
    expect(kindOfResource({ mediaType: 'audio' }, { name: '雨声' })).toBe('audio')
  })

  it('没有声明时按地址认：data:image / .png / .mp4 / .mp3', () => {
    expect(kindOfResource(undefined, { name: 'x', url: 'data:image/png;base64,AA' })).toBe('image')
    expect(kindOfResource(undefined, { name: 'x', url: 'https://a/b.png' })).toBe('image')
    expect(kindOfResource(undefined, { name: 'x', url: 'https://a/b.mp4' })).toBe('video')
    expect(kindOfResource(undefined, { name: 'x', url: 'https://a/b.mp3' })).toBe('audio')
  })

  it('地址认不出才退回名字里的自动编号', () => {
    expect(kindOfResource(undefined, { name: '图片3' })).toBe('image')
    expect(kindOfResource(undefined, { name: '视频2' })).toBe('video')
    expect(kindOfResource(undefined, { name: '泳装少女' })).toBe('text')
  })

  it('声明优先于地址（视频的 url 是帧图，不能据此判成图片）', () => {
    expect(kindOfResource({ chipKind: 'video' }, { name: '画面推演', url: 'data:image/png;base64,AA' })).toBe('video')
  })
})

describe('kindFromName 仍是名字专用（不被新逻辑改坏）', () => {
  it('只认自动编号，真名一律 text', () => {
    expect(kindFromName('音频1')).toBe('audio')
    expect(kindFromName('泳装少女')).toBe('text')
  })
})
