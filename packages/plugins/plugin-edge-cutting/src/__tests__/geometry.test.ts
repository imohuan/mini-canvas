import { describe, it, expect } from 'vitest'
import { doSegmentsIntersect, segmentDistance, isPolylineHitByCut } from '../geometry'

describe('geometry: doSegmentsIntersect', () => {
  it('相交的线段返回 true', () => {
    expect(doSegmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true)
  })

  it('平行不相交返回 false', () => {
    expect(doSegmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false)
  })

  it('端点相接(共享端点)返回 true', () => {
    expect(doSegmentsIntersect({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 0 })).toBe(true)
  })

  it('共线但分离返回 false', () => {
    expect(doSegmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe(false)
  })
})

describe('geometry: segmentDistance', () => {
  it('相交距离为 0', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(0)
  })

  it('平行线段距离 = 纵向间距', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 3 }, { x: 10, y: 3 })).toBeCloseTo(3)
  })
})

describe('geometry: isPolylineHitByCut', () => {
  const edge = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 200, y: 0 },
  ]

  it('切割线横穿边 → 命中', () => {
    const cut = [
      { x: 50, y: -20 },
      { x: 50, y: 20 },
    ]
    expect(isPolylineHitByCut(edge, cut, 8)).toBe(true)
  })

  it('切割线离边太远(> tolerance) → 不命中', () => {
    const cut = [
      { x: 50, y: -50 },
      { x: 50, y: -20 },
    ]
    expect(isPolylineHitByCut(edge, cut, 8)).toBe(false)
  })

  it('在容差内斜擦过 → 命中', () => {
    const cut = [
      { x: 0, y: 10 },
      { x: 100, y: 6 },
    ]
    expect(isPolylineHitByCut(edge, cut, 8)).toBe(true)
  })

  it('点数不足(<2) → 不命中', () => {
    expect(isPolylineHitByCut([{ x: 0, y: 0 }], [{ x: 1, y: 1 }, { x: 2, y: 2 }], 8)).toBe(false)
    expect(isPolylineHitByCut(edge, [{ x: 1, y: 1 }], 8)).toBe(false)
  })
})
