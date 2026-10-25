/**
 * refSlots —— 「@素材标签 / 待输入槽位」的规则测试。
 *
 * 用户口径（2026-10-25）：
 *   1. @图片123 / @音频123 / @音视频123 要解析成标签；
 *   2. 没有连线也要有标签，状态是「待输入」；
 *   3. 可以拖本地文件 / 点击上传 / 按住 Ctrl 拖节点进来。
 */
import { describe, it, expect } from 'vitest'
import {
  parseRefSlots,
  mediaTypeOf,
  slotAccepts,
  judgeSlotDrop,
  dropVerdictMessage,
} from '../refSlots'

describe('@ 标签解析', () => {
  it('三种中文写法都能认出来，并保持出现顺序', () => {
    expect(parseRefSlots('将 @图片1 中的女子，参照 @音频2 和 @音视频3')).toEqual([
      { key: 'image:1', kind: 'image', index: 1 },
      { key: 'audio:2', kind: 'audio', index: 2 },
      { key: 'av:3', kind: 'av', index: 3 },
    ])
  })

  it('英文写法也认；重复只算一次', () => {
    expect(parseRefSlots('@image12 @image12 @video7').map((s) => s.key)).toEqual(['image:12', 'video:7'])
  })

  it('可以关掉「@音视频」', () => {
    expect(parseRefSlots('@音视频1 @音频1', { allowAv: false }).map((s) => s.key)).toEqual(['audio:1'])
  })

  it('0 / 没有数字 / 字母结尾都不算标签', () => {
    expect(parseRefSlots('@图片0 @图片 @图片abc')).toEqual([])
  })

  it('不会因为全局正则残留而漏掉第二次调用', () => {
    const text = '@图片1'
    expect(parseRefSlots(text)).toHaveLength(1)
    expect(parseRefSlots(text)).toHaveLength(1)
  })
})

describe('文件与节点类型', () => {
  it('MIME 优先，扩展名兜底', () => {
    expect(mediaTypeOf({ name: 'a.bin', type: 'image/png' })).toBe('image')
    expect(mediaTypeOf({ name: 'a.MP4', type: '' })).toBe('video')
    expect(mediaTypeOf({ name: 'voice.mp3' })).toBe('audio')
    expect(mediaTypeOf({ name: 'readme.txt', type: 'text/plain' })).toBe(null)
  })

  it('「音视频」收视频与音频，不收图片', () => {
    expect(slotAccepts('av', 'video')).toBe(true)
    expect(slotAccepts('av', 'audio')).toBe(true)
    expect(slotAccepts('av', 'image')).toBe(false)
  })
})

describe('待输入槽位的落点判定', () => {
  it('本地文件：类型对就收，不需要 Ctrl', () => {
    expect(judgeSlotDrop('image', { file: { name: 'a.png', type: 'image/png' } })).toEqual({
      ok: true,
      mediaType: 'image',
    })
  })

  it('本地文件：类型不对 → kind-mismatch', () => {
    expect(judgeSlotDrop('image', { file: { name: 'v.mp3', type: 'audio/mpeg' } })).toEqual({
      ok: false,
      reason: 'kind-mismatch',
      mediaType: 'audio',
    })
  })

  it('拖节点：没按 Ctrl → no-modifier（用户规则 3c）', () => {
    expect(judgeSlotDrop('image', { node: { name: '图片1', mime: 'image/png' }, modifier: false })).toEqual({
      ok: false,
      reason: 'no-modifier',
    })
  })

  it('拖节点：按住 Ctrl 且类型对 → 收', () => {
    expect(judgeSlotDrop('image', { node: { name: '图片1', mime: 'image/png' }, modifier: true })).toEqual({
      ok: true,
      mediaType: 'image',
    })
  })

  it('拖节点：类型不对仍然拒（Ctrl 只解决「能不能拖」，不解决「是不是这个类型」）', () => {
    expect(judgeSlotDrop('audio', { node: { name: '图片1', mime: 'image/png' }, modifier: true })).toEqual({
      ok: false,
      reason: 'kind-mismatch',
      mediaType: 'image',
    })
  })

  it('不支持的类型（文本等）→ unsupported', () => {
    expect(judgeSlotDrop('image', { file: { name: 'a.txt', type: 'text/plain' } })).toEqual({
      ok: false,
      reason: 'unsupported',
    })
  })

  it('提示文案说清楚「为什么不行」', () => {
    expect(dropVerdictMessage('image', { ok: false, reason: 'no-modifier' })).toContain('Ctrl')
    expect(dropVerdictMessage('image', { ok: false, reason: 'kind-mismatch' })).toBe('这个槽位只收图片')
    expect(dropVerdictMessage('av', { ok: false, reason: 'kind-mismatch' })).toBe('这个槽位只收视频或音频')
  })
})
