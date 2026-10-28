/**
 * 参考标签的纯逻辑（用户 2026-10-28 定案：认节点、认名称，不认序号）。
 *
 * 旧实现按「类型 + 序号」定位（ref-slot:image:3），序号会随排序/增删变化，
 * 标签就必然指错对象。现在：
 *   - 已绑定 = `ref-node:<节点 id>`；
 *   - 待绑定 = `ref-name:<名称>`（名称画布内唯一）；
 *   - 老格式 `ref-slot:*` 不兼容，按失效处理。
 */
import { describe, expect, it } from 'vitest'
import {
  dropVerdictMessage,
  hitSlotAtPoint,
  judgeSlotDrop,
  mediaTypeOf,
  nameOfChip,
  nodeIdOfChip,
  refChipsFromDoc,
  refNameChipId,
  refNodeChipId,
} from '../refSlots'

describe('标签身份：节点 / 名称', () => {
  it('节点 id → ref-node:<id>，再解回来还是同一个 id', () => {
    expect(refNodeChipId('n12')).toBe('ref-node:n12')
    expect(nodeIdOfChip('ref-node:n12')).toBe('n12')
  })

  it('名称 → ref-name:<名>（含空格也原样保留）', () => {
    expect(refNameChipId(' 天空之城 ')).toBe('ref-name:天空之城')
    expect(nameOfChip('ref-name:天空 之城')).toBe('天空 之城')
  })

  it('不是绑定标签 → null（不会把老格式误认成节点）', () => {
    expect(nodeIdOfChip('ref-slot:image:1')).toBeNull()
    expect(nodeIdOfChip('204')).toBeNull()
    expect(nameOfChip('ref-node:n1')).toBeNull()
  })
})

describe('refChipsFromDoc：只认真正的标签节点', () => {
  const doc = (content: unknown[]) => ({ type: 'doc', content })

  it('三种身份各归各类，手打文字不算声明', () => {
    const chips = refChipsFromDoc(doc([{
      type: 'paragraph',
      content: [
        { type: 'text', text: '@天空之城 只是文字' },
        { type: 'resource', attrs: { id: 'ref-node:n1', name: '天空之城' } },
        { type: 'resource', attrs: { id: 'ref-name:雨声', name: '雨声' } },
        { type: 'resource', attrs: { id: 'ref-slot:image:1', name: '图片1' } },
      ],
    }]))
    expect(chips.map((c) => [c.id, c.nodeId, c.pendingName, c.legacy])).toEqual([
      ['ref-node:n1', 'n1', null, false],
      ['ref-name:雨声', null, '雨声', false],
      ['ref-slot:image:1', null, null, true],
    ])
  })

  it('空 / 坏形状 → 空数组', () => {
    expect(refChipsFromDoc(undefined)).toEqual([])
    expect(refChipsFromDoc({ type: 'paragraph' })).toEqual([])
  })
})

describe('judgeSlotDrop：待绑定格什么都收，已绑定格按真实类型', () => {
  it('any 格（手打的 @名字）收任何媒体', () => {
    for (const type of ['image/png', 'video/mp4', 'audio/mpeg', 'text/plain']) {
      expect(judgeSlotDrop('any', { file: { name: 'a', type } }).ok).toBe(true)
    }
  })

  it('已绑定格：类型不匹配要拦住并给出人话提示', () => {
    const verdict = judgeSlotDrop('audio', { file: { name: 'a.mp4', type: 'video/mp4' } })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe('kind-mismatch')
    expect(dropVerdictMessage('audio', verdict)).toContain('音频')
  })

  it('拖画布节点必须按住 Ctrl', () => {
    expect(judgeSlotDrop('image', { node: { name: 'a.png' } }).reason).toBe('no-modifier')
    expect(judgeSlotDrop('image', { node: { name: 'a.png' }, modifier: true }).ok).toBe(true)
  })

  it('媒体类型按扩展名兜底（系统给不出 MIME 时也能认）', () => {
    expect(mediaTypeOf({ name: 'song.mp3' })).toBe('audio')
    expect(mediaTypeOf({ name: 'clip.mov' })).toBe('video')
    expect(mediaTypeOf({ name: 'x.bin' })).toBeNull()
  })
})

describe('hitSlotAtPoint：松手落在哪张卡', () => {
  const rects = [
    { key: 'a', left: 0, top: 0, right: 10, bottom: 10 },
    { key: 'b', left: 12, top: 0, right: 22, bottom: 10 },
  ]

  it('命中 → 返回卡片键', () => {
    expect(hitSlotAtPoint({ x: 15, y: 5 }, rects)).toBe('b')
  })

  it('落在缝里 → null（不误判）', () => {
    expect(hitSlotAtPoint({ x: 11, y: 5 }, rects)).toBeNull()
  })
})
