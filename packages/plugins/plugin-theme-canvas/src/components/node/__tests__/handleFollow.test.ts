import { describe, it, expect } from 'vitest'
import { followTarget, stepFollow, needsMoreFrames } from '../handleFollow'

/**
 * 端口球跟随鼠标的几何/动画单测。
 * 背景（回归点）：旧实现是"球心 = 鼠标沿 outward 方向再加固定 cursorGap"，
 * 方向只朝外、距离只加不减 —— 鼠标贴近卡边时球被推到区域外，鼠标往外走时球顶到
 * 区域最外端就再也不动，看起来"永远固定在某一侧"。这里锁住修好之后的行为。
 */
const GAP = 24
const MAX_OUT = 60 // 区域最外沿（球心可达的最远距离）

describe('followTarget —— 球要去的终点', () => {
  it('鼠标贴近卡边：球停在卡边附近，不会被推到区域最外端', () => {
    const t = followTarget({ out: 5, y: 0 }, GAP, MAX_OUT)
    // 鼠标离锚点 5px，球只该再往外一个 gap 左右，远小于最外沿
    expect(t.out).toBeCloseTo(29, 0)
    expect(t.out).toBeLessThan(MAX_OUT)
  })

  it('鼠标往外走：球心跟着变大（跟随方向正确）', () => {
    const near = followTarget({ out: 10, y: 0 }, GAP, MAX_OUT)
    const far = followTarget({ out: 45, y: 0 }, GAP, MAX_OUT)
    expect(far.out).toBeGreaterThan(near.out)
  })

  it('沿"锚点→鼠标"的射线外推：竖直分量同向放大，不是只推 x', () => {
    const t = followTarget({ out: 10, y: 10 }, GAP, MAX_OUT)
    expect(t.out).toBeGreaterThan(0)
    expect(t.y).toBeGreaterThan(10) // 沿对角线继续往外
    // 方向角保持不变
    expect(Math.atan2(t.y, t.out)).toBeCloseTo(Math.atan2(10, 10), 5)
  })

  it('距离封顶在最外沿，不越出可移动区', () => {
    const t = followTarget({ out: 200, y: 0 }, GAP, MAX_OUT)
    expect(Math.hypot(t.out, t.y)).toBeCloseTo(MAX_OUT, 5)
  })

  it('鼠标正好压在锚点上也不会崩（方向退化为朝外）', () => {
    const t = followTarget({ out: 0, y: 0 }, GAP, MAX_OUT)
    expect(Number.isFinite(t.out)).toBe(true)
    expect(Number.isFinite(t.y)).toBe(true)
  })
})

describe('stepFollow —— 逐帧逼近（动画感来源）', () => {
  it('一帧只走一部分，不瞬移到终点', () => {
    const next = stepFollow({ out: 0, y: 0 }, { out: 100, y: 0 }, 0.2)
    expect(next.out).toBeCloseTo(20, 5)
    expect(next.out).toBeLessThan(100)
  })

  it('连续追几帧后单调靠近终点', () => {
    let cur = { out: 0, y: 0 }
    const target = { out: 100, y: 0 }
    const seq = []
    for (let i = 0; i < 5; i++) {
      cur = stepFollow(cur, target, 0.2)
      seq.push(cur.out)
    }
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1])
    expect(cur.out).toBeGreaterThan(60)
  })

  it('终点中途改变时，球从当前位置继续追新终点（鼠标一直动就一直追）', () => {
    let cur = { out: 0, y: 0 }
    cur = stepFollow(cur, { out: 100, y: 0 }, 0.2) // 追到 20
    const afterSwitch = stepFollow(cur, { out: -40, y: 30 }, 0.2)
    expect(afterSwitch.out).toBeLessThan(20) // 反向追回去
    expect(afterSwitch.y).toBeGreaterThan(0)
  })
})

describe('needsMoreFrames —— 到位即停', () => {
  it('差距大要继续追', () => {
    expect(needsMoreFrames({ out: 0, y: 0 }, { out: 50, y: 0 })).toBe(true)
  })
  it('差距小于阈值就停（不再排 rAF）', () => {
    expect(needsMoreFrames({ out: 10, y: 10 }, { out: 10.1, y: 10.1 })).toBe(false)
  })
})
