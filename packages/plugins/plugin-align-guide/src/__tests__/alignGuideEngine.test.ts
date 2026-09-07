import { describe, it, expect } from 'vitest'
import { computeAlignGuides, SNAP_THRESHOLD } from '../alignGuideEngine'
import type { AlignRect } from '../alignGuideEngine'

/**
 * 测试几何约定：被拖窄框用 40x40，参考目标放到远处（x=300 系列）避免被拖框
 * 多个特征同时落入阈值造成"多模式等距歧义"；每种用例只有目标对齐关系命中。
 */
function drag(x: number, y: number): AlignRect {
  return { id: 'a', x, y, w: 40, h: 40 }
}

/** 垂直参考目标：左缘 300、中心 350、右缘 400（高 60 与 x 正交无关） */
const vTarget: AlignRect = { id: 'b', x: 300, y: 0, w: 100, h: 60 }

describe('computeAlignGuides —— 左缘对齐', () => {
  it('阈值内：吸附并把参考线画在目标左缘', () => {
    // a.x=297 → 左缘距 300 差 3
    const r = computeAlignGuides(drag(297, 500), [vTarget])
    expect(r.deltaX).toBe(3)
    expect(r.deltaY).toBe(0)
    expect(r.guides).toEqual([{ type: 'vertical', position: 300 }])
  })

  it('超出阈值：不吸附不出线', () => {
    // a.x=290 → 左缘距 300 差 10；特征 290/310/330 距 300/350/400 均 >8
    const r = computeAlignGuides(drag(290, 500), [vTarget])
    expect(r.deltaX).toBe(0)
    expect(r.guides).toEqual([])
  })

  it('已精确对齐：delta 0 但显示参考线', () => {
    const r = computeAlignGuides(drag(300, 500), [vTarget])
    expect(r.deltaX).toBe(0)
    expect(r.guides).toEqual([{ type: 'vertical', position: 300 }])
  })
})

describe('computeAlignGuides —— 右缘 / 中心对齐', () => {
  it('右缘对齐：参考线画在目标右缘(400)', () => {
    // a.x=357 → 右缘 397 距 400 差 3；中心 377 距 350 差 27
    const r = computeAlignGuides(drag(357, 500), [vTarget])
    expect(r.deltaX).toBe(3)
    expect(r.guides).toEqual([{ type: 'vertical', position: 400 }])
  })

  it('中心对齐：参考线画在目标中心(350)', () => {
    // a.x=327 → 中心 347 距 350 差 3；左缘 327 距 300 差 27、右缘 367 距 400 差 33
    const r = computeAlignGuides(drag(327, 500), [vTarget])
    expect(r.deltaX).toBe(3)
    expect(r.guides).toEqual([{ type: 'vertical', position: 350 }])
  })
})

describe('computeAlignGuides —— 水平对齐', () => {
  /** 水平参考目标：上缘 300、中心 330、下缘 360（宽 100 与 y 正交无关） */
  const hTarget: AlignRect = { id: 'c', x: 0, y: 300, w: 100, h: 60 }

  it('上缘对齐：参考线画在目标上缘(300)', () => {
    // a.y=297 → 上缘距 300 差 3
    const r = computeAlignGuides(drag(700, 297), [hTarget])
    expect(r.deltaY).toBe(3)
    expect(r.guides).toEqual([{ type: 'horizontal', position: 300 }])
  })

  it('中心对齐：参考线画在目标水平中心(330)', () => {
    // a.y=307 → 中心 327 距 330 差 3
    const r = computeAlignGuides(drag(700, 307), [hTarget])
    expect(r.deltaY).toBe(3)
    expect(r.guides).toEqual([{ type: 'horizontal', position: 330 }])
  })

  it('下缘对齐：参考线画在目标下缘(360)', () => {
    // a.y=317 → 下缘 357 距 360 差 3；中心 337 距 330 差 7 也命中但下缘更近(3<7)
    const r = computeAlignGuides(drag(700, 317), [hTarget])
    expect(r.deltaY).toBe(3)
    expect(r.guides).toEqual([{ type: 'horizontal', position: 360 }])
  })
})

describe('computeAlignGuides —— 边界与多节点', () => {
  it('多节点取最近一条', () => {
    const far: AlignRect = { id: 'd', x: 600, y: 0, w: 100, h: 60 }
    // a.x=298 距 b 左缘(300)差 2；距 far 左缘(600)差 302 → 取 b
    const r = computeAlignGuides(drag(298, 500), [vTarget, far])
    expect(r.deltaX).toBe(2)
    expect(r.guides).toEqual([{ type: 'vertical', position: 300 }])
  })

  it('同帧垂直+水平同时吸附', () => {
    const hTarget: AlignRect = { id: 'c', x: 0, y: 300, w: 100, h: 60 }
    const r = computeAlignGuides({ id: 'a', x: 297, y: 297, w: 40, h: 40 }, [vTarget, hTarget])
    expect(r.deltaX).toBe(3)
    expect(r.deltaY).toBe(3)
    expect(r.guides).toHaveLength(2)
  })

  it('无比对对象：无对齐无线', () => {
    expect(computeAlignGuides(drag(0, 0), [])).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
  })

  it('阈值默认 8：等于阈值不吸，可覆盖', () => {
    // a.x=292 → 左缘距 300 差 8 == 阈值 → 不吸
    expect(computeAlignGuides(drag(292, 500), [vTarget]).deltaX).toBe(0)
    // a.x=290 → 差 10：默认不吸；threshold=12 吸到
    expect(computeAlignGuides(drag(290, 500), [vTarget]).deltaX).toBe(0)
    expect(computeAlignGuides(drag(290, 500), [vTarget], 12).deltaX).toBe(10)
    expect(SNAP_THRESHOLD).toBe(8)
  })

  it('零尺寸矩形跳过', () => {
    const r = computeAlignGuides({ id: 'a', x: 297, y: 0, w: 0, h: 0 }, [vTarget])
    expect(r).toEqual({ deltaX: 0, deltaY: 0, guides: [] })
  })
})
