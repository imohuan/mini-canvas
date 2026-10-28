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
  hitSlotAtPoint,
  normalizeRefSlots,
} from '../refSlots'
import { mergeRefTiles } from '../refTiles'

describe('声明序号归一化（用户口径 2026-10-27）', () => {
  /**
   * 为什么需要：正文写 `@图片1 @图片9` 时，按原序号保留会撑出 9 个格子；
   * 归一化成 图片1、图片2 后，格子数 = 声明数，缩略图也能按「第 N 项」取。
   */
  it('同类型按出现顺序重编，跨类型互不影响', () => {
    const out = normalizeRefSlots([
      { key: 'image:1', kind: 'image', index: 1 },
      { key: 'image:9', kind: 'image', index: 9 },
      { key: 'image:3', kind: 'image', index: 3 },
      { key: 'audio:5', kind: 'audio', index: 5 },
    ])
    expect(out.renamed.map((r) => r.slot.key)).toEqual(['image:1', 'image:9', 'image:3', 'audio:5'])
    expect(out.renamed.map((r) => r.index)).toEqual([1, 2, 3, 1])
    expect(out.map.get('image:9')).toBe(2)
    expect(out.map.get('image:3')).toBe(3)
    expect(out.map.get('audio:5')).toBe(1)
  })

  it('已经是 1..n 时不动（幂等）', () => {
    const out = normalizeRefSlots([
      { key: 'image:1', kind: 'image', index: 1 },
      { key: 'image:2', kind: 'image', index: 2 },
    ])
    expect(out.renamed.map((r) => r.index)).toEqual([1, 2])
  })

  it('空输入 → 空结果', () => {
    const out = normalizeRefSlots([])
    expect(out.renamed).toEqual([])
    expect(out.map.size).toBe(0)
  })
})

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

  it('文本格收文本、不收图片；图片格不收文本', () => {
    expect(judgeSlotDrop('text', { node: { name: '正文' }, modifier: true, mediaType: 'text' })).toEqual({
      ok: true,
      mediaType: 'text',
    })
    expect(judgeSlotDrop('text', { node: { name: '图片1' }, modifier: true, mediaType: 'image' })).toEqual({
      ok: false,
      reason: 'kind-mismatch',
      mediaType: 'image',
    })
    expect(judgeSlotDrop('image', { node: { name: '正文' }, modifier: true, mediaType: 'text' })).toEqual({
      ok: false,
      reason: 'kind-mismatch',
      mediaType: 'text',
    })
  })

  it('类型不匹配的提示会同时说清格子收什么、你拖的是什么', () => {
    expect(dropVerdictMessage('image', { ok: false, reason: 'kind-mismatch', mediaType: 'text' })).toBe(
      '这个槽位只收图片，你拖的是文本',
    )
  })
})

describe('文本槽位（用户 2026-10-28：文本也能拖进对应槽位）', () => {
  it('正文声明 @文本1 → 出现文本格；文本素材落在这一格', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'text', index: 1 }],
      [{ id: 't', name: '文本1', isText: true }],
    )
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ kind: 'text', pending: false, isText: true, slotIndex: 1 })
  })

  it('声明两个文本格、只有一条文本 → 第 2 格是待输入的文本格', () => {
    const tiles = mergeRefTiles(
      [{ kind: 'text', index: 1 }, { kind: 'text', index: 2 }],
      [{ id: 't', name: '文本1', isText: true }],
    )
    expect(tiles.map((t) => t.kind)).toEqual(['text', 'text'])
    expect(tiles[1]).toMatchObject({ pending: true, slotKey: 'text:2' })
  })
})

describe('拖拽落点：鼠标点 → 槽位', () => {
  const rects = [
    { key: 'image:1', left: 100, top: 100, right: 148, bottom: 148 },
    { key: 'audio:1', left: 160, top: 100, right: 208, bottom: 148 },
  ]

  it('落在某个槽位矩形里 → 返回它的键（规则 3c 的命中判定）', () => {
    expect(hitSlotAtPoint({ x: 120, y: 120 }, rects)).toBe('image:1')
    expect(hitSlotAtPoint({ x: 200, y: 140 }, rects)).toBe('audio:1')
  })

  it('落在两个槽位之间的空隙 / 外面 → null（不许误填）', () => {
    expect(hitSlotAtPoint({ x: 154, y: 120 }, rects)).toBe(null)
    expect(hitSlotAtPoint({ x: 20, y: 20 }, rects)).toBe(null)
  })

  it('边界上算命中（贴边松手也是用户意图）', () => {
    expect(hitSlotAtPoint({ x: 100, y: 100 }, rects)).toBe('image:1')
    expect(hitSlotAtPoint({ x: 148, y: 148 }, rects)).toBe('image:1')
  })
})
