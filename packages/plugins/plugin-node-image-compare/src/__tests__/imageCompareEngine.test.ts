import { describe, it, expect } from 'vitest'
import {
  MAX_COMPARE_IMAGES,
  INPUT_CAPACITY,
  DIVIDER_DEFAULT,
  resolveComparePair,
  resolveCompareEntries,
  clampDivider,
  planOverflowTrim,
  incomingImageEdgeIds,
} from '../imageCompareEngine'

const getData = (id: string): Record<string, unknown> | undefined =>
  ({
    a: { imageUrl: 'a.png' },
    b: { imageUrl: 'b.png' },
    c: { imageUrl: 'c.png' },
    none: {},
  })[id]

describe('容量常量', () => {
  it('向内核声明的容量 = 真实上限 2（满额由内核挤老边，不再需要缓冲位）', () => {
    expect(MAX_COMPARE_IMAGES).toBe(2)
    expect(INPUT_CAPACITY).toBe(2)
  })
})

describe('resolveComparePair', () => {
  it('按连线先后取左、右两张图', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'me' },
      { id: 'e2', source: 'b', target: 'me' },
    ]
    expect(resolveComparePair(edges, 'me', getData)).toEqual({ left: 'a.png', right: 'b.png' })
  })

  it('调换连线顺序 → 左右也跟着换', () => {
    const edges = [
      { id: 'e1', source: 'b', target: 'me' },
      { id: 'e2', source: 'a', target: 'me' },
    ]
    expect(resolveComparePair(edges, 'me', getData)).toEqual({ left: 'b.png', right: 'a.png' })
  })

  it('只连一张 → 只有左侧有图', () => {
    expect(resolveComparePair([{ id: 'e1', source: 'a', target: 'me' }], 'me', getData)).toEqual({
      left: 'a.png',
      right: '',
    })
  })

  it('忽略不是连到本节点的边', () => {
    expect(resolveComparePair([{ id: 'e1', source: 'a', target: 'other' }], 'me', getData)).toEqual({
      left: '',
      right: '',
    })
  })

  it('上游没有图的边跳过、不占位（后面的图往前补）', () => {
    const edges = [
      { id: 'e1', source: 'none', target: 'me' },
      { id: 'e2', source: 'a', target: 'me' },
      { id: 'e3', source: 'b', target: 'me' },
    ]
    expect(resolveComparePair(edges, 'me', getData)).toEqual({ left: 'a.png', right: 'b.png' })
  })

  it('只取前两张，多的忽略', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'me' },
      { id: 'e2', source: 'b', target: 'me' },
      { id: 'e3', source: 'c', target: 'me' },
    ]
    expect(resolveComparePair(edges, 'me', getData)).toEqual({ left: 'a.png', right: 'b.png' })
  })
})

describe('resolveCompareEntries', () => {
  it('每条入边带上"图地址 + 上游节点 id"（左右标签要按节点认，而不是按图认）', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'me' },
      { id: 'e2', source: 'b', target: 'me' },
    ]
    expect(resolveCompareEntries(edges, 'me', getData)).toEqual([
      { url: 'a.png', sourceId: 'a' },
      { url: 'b.png', sourceId: 'b' },
    ])
  })

  it('两个上游用同一张图时仍是两条独立记录（不会被去重或认错）', () => {
    const sameData = (id: string) => ({ imageUrl: id === 'x' || id === 'y' ? 'same.png' : undefined })
    const edges = [
      { id: 'e1', source: 'x', target: 'me' },
      { id: 'e2', source: 'y', target: 'me' },
    ]
    expect(resolveCompareEntries(edges, 'me', sameData)).toEqual([
      { url: 'same.png', sourceId: 'x' },
      { url: 'same.png', sourceId: 'y' },
    ])
  })

  it('只取前两条、跳过没有图的上游', () => {
    const edges = [
      { id: 'e1', source: 'none', target: 'me' },
      { id: 'e2', source: 'a', target: 'me' },
      { id: 'e3', source: 'b', target: 'me' },
      { id: 'e4', source: 'c', target: 'me' },
    ]
    expect(resolveCompareEntries(edges, 'me', getData).map((e) => e.sourceId)).toEqual(['a', 'b'])
  })
})

describe('clampDivider', () => {
  it('夹在 0~100', () => {
    expect(clampDivider(-20)).toBe(0)
    expect(clampDivider(140)).toBe(100)
    expect(clampDivider(37.5)).toBe(37.5)
  })

  it('非法值回落默认位置', () => {
    expect(clampDivider(Number.NaN)).toBe(DIVIDER_DEFAULT)
    expect(clampDivider(Number.POSITIVE_INFINITY)).toBe(DIVIDER_DEFAULT)
  })
})

describe('planOverflowTrim', () => {
  it('没超限时不删', () => {
    expect(planOverflowTrim([], 2)).toEqual([])
    expect(planOverflowTrim(['e1'], 2)).toEqual([])
    expect(planOverflowTrim(['e1', 'e2'], 2)).toEqual([])
  })

  it('超限时从最老的开始挤（FIFO）', () => {
    expect(planOverflowTrim(['e1', 'e2', 'e3'], 2)).toEqual(['e1'])
    expect(planOverflowTrim(['e1', 'e2', 'e3', 'e4'], 2)).toEqual(['e1', 'e2'])
  })
})

describe('incomingImageEdgeIds', () => {
  it('按连线先后列出连到本节点、且上游真有图的边', () => {
    const edges = [
      { id: 'e1', source: 'none', target: 'me' },
      { id: 'e2', source: 'a', target: 'me' },
      { id: 'e3', source: 'b', target: 'other' },
      { id: 'e4', source: 'b', target: 'me' },
    ]
    expect(incomingImageEdgeIds(edges, 'me', getData)).toEqual(['e2', 'e4'])
  })
})
