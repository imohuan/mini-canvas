import { describe, it, expect } from 'vitest'
import {
  filterHitEdges,
  bladeOnly,
  cutTrailOnly,
  rectsOverlap,
  toPathData,
  BLADE_POINTS,
  TRAIL_POINTS,
} from '../edgeCuttingCore'

describe('edgeCuttingCore: toPathData', () => {
  it('把屏幕点数组转成 M/L path 数据', () => {
    expect(toPathData([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }])).toBe('M 1 2 L 3 4 L 5 6')
  })
  it('单点只输出 M', () => {
    expect(toPathData([{ x: 1, y: 2 }])).toBe('M 1 2')
  })
  it('空数组返回空串', () => {
    expect(toPathData([])).toBe('')
  })
})

describe('edgeCuttingCore: rectsOverlap', () => {
  const rect = (l: number, t: number, r: number, b: number) => ({ left: l, top: t, right: r, bottom: b })
  it('重叠返回 true', () => {
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(5, 5, 15, 15))).toBe(true)
  })
  it('相接边界算重叠', () => {
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(true)
  })
  it('完全分离返回 false', () => {
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(20, 20, 30, 30))).toBe(false)
  })
})

describe('edgeCuttingCore: bladeOnly', () => {
  it('只取末尾 BLADE_POINTS 个点', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }))
    const blade = bladeOnly(points)
    expect(blade).toHaveLength(BLADE_POINTS)
    expect(blade[0]).toEqual({ x: 13, y: 0 })
    expect(blade[blade.length - 1]).toEqual({ x: 19, y: 0 })
  })
  it('点数少于 BLADE_POINTS 时全量返回', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    expect(bladeOnly(points)).toEqual(points)
  })
})

describe('edgeCuttingCore: cutTrailOnly', () => {
  it('只取末尾 TRAIL_POINTS 个点（与关闭完整轨迹时 overlay 绘制的刀锋尾迹范围一致）', () => {
    const points = Array.from({ length: 30 }, (_, i) => ({ x: i, y: 0 }))
    const trail = cutTrailOnly(points)
    expect(trail).toHaveLength(TRAIL_POINTS)
    expect(trail[0]).toEqual({ x: 30 - TRAIL_POINTS, y: 0 })
    expect(trail[trail.length - 1]).toEqual({ x: 29, y: 0 })
  })
  it('点数少于 TRAIL_POINTS 时全量返回', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    expect(cutTrailOnly(points)).toEqual(points)
  })
})

describe('edgeCuttingCore: filterHitEdges', () => {
  // 水平边采样(屏幕坐标)
  const horizontalEdge = { id: 'e1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
  const farEdge = { id: 'e2', points: [{ x: 0, y: 200 }, { x: 100, y: 200 }] }

  it('只返回被切割轨迹命中的边', () => {
    const cut = [{ x: 50, y: -20 }, { x: 50, y: 20 }]
    expect(filterHitEdges([horizontalEdge, farEdge], cut, 8)).toEqual(['e1'])
  })

  it('没有命中返回空数组', () => {
    const cut = [{ x: 50, y: -200 }, { x: 50, y: -100 }]
    expect(filterHitEdges([horizontalEdge, farEdge], cut, 8)).toEqual([])
  })

  it('切割点数不足(<2)返回空数组', () => {
    expect(filterHitEdges([horizontalEdge], [{ x: 1, y: 1 }], 8)).toEqual([])
  })

  it('空候选返回空数组', () => {
    expect(filterHitEdges([], [{ x: 0, y: 0 }, { x: 1, y: 1 }], 8)).toEqual([])
  })

  describe('跟随开关判定（所见即所得）：完整路径 vs 仅刀锋短路径', () => {
    // 场景复刻用户 Bug：一整条长切割线从左划到右，最后落笔在空白处。
    // 远处那条边(在左半段)被完整长轨迹扫到、但当前刀锋(尾部短尾迹)根本没碰到它。
    const longCut = Array.from({ length: 40 }, (_, i) => ({ x: i * 10, y: 0 })) // x: 0→390
    const leftEdge = { id: 'left', points: [{ x: 0, y: -5 }, { x: 200, y: -5 }] } // 在左半段 y=-5
    const rightEdge = { id: 'right', points: [{ x: 260, y: 0 }, { x: 400, y: 0 }] } // 在右半段（当前刀锋落点）
    const entries = [leftEdge, rightEdge]

    it('按完整轨迹判定：完整长线扫到的 left 也会被删（旧行为/开关开）', () => {
      // cutTrailOnly 后刀锋覆盖 x:280→390，命中 right；但完整轨迹命中 left
      const hitFull = filterHitEdges(entries, longCut, 8)
      expect(hitFull).toContain('left')
      expect(hitFull).toContain('right')
    })

    it('按刀锋短路径判定：只删当前刀锋碰到的那条，远处被长线扫到的不删（开关关）', () => {
      const bladeCut = cutTrailOnly(longCut) // 仅尾部 TRAIL_POINTS 点，x 落在右半段
      const hitBlade = filterHitEdges(entries, bladeCut, 8)
      expect(hitBlade).toContain('right')
      expect(hitBlade).not.toContain('left') // 关键：完整长线扫过但刀锋没碰到 → 不误删
    })
  })
})
