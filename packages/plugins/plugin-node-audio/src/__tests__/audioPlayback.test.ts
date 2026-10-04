/**
 * 播放进度换算纯函数测试 —— 波形当进度条用，指针位置与播放进度之间的换算是核心行为。
 */
import { describe, it, expect } from 'vitest'
import { clamp01, progressRatio, seekTime, formatClock, ratioFromPointer } from '../audioPlayback'

describe('audioPlayback · 比例与时间', () => {
  it('progressRatio 收敛在 0..1；时长未知或非法时给 0', () => {
    expect(progressRatio(5, 10)).toBeCloseTo(0.5, 5)
    expect(progressRatio(-1, 10)).toBe(0)
    expect(progressRatio(99, 10)).toBe(1)
    expect(progressRatio(3, 0)).toBe(0)
    expect(progressRatio(Number.NaN, 10)).toBe(0)
    expect(progressRatio(3, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('seekTime 是 progressRatio 的逆运算，并夹在 0..duration', () => {
    expect(seekTime(0.25, 8)).toBeCloseTo(2, 5)
    expect(seekTime(-3, 8)).toBe(0)
    expect(seekTime(2, 8)).toBe(8)
    expect(seekTime(0.5, 0)).toBe(0)
    expect(seekTime(Number.NaN, 8)).toBe(0)
  })

  it('clamp01 把任意数收进 0..1', () => {
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(-2)).toBe(0)
    expect(clamp01(7)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
  })

  it('formatClock 输出 m:ss；超过一小时给 h:mm:ss；非法值给 0:00', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(9.4)).toBe('0:09')
    expect(formatClock(75)).toBe('1:15')
    expect(formatClock(600)).toBe('10:00')
    expect(formatClock(3661)).toBe('1:01:01')
    expect(formatClock(Number.NaN)).toBe('0:00')
    expect(formatClock(-5)).toBe('0:00')
  })

  it('ratioFromPointer 把指针位置换成比例；宽度为 0 时给 0', () => {
    expect(ratioFromPointer(150, 100, 100)).toBeCloseTo(0.5, 5)
    expect(ratioFromPointer(0, 100, 100)).toBe(0)
    expect(ratioFromPointer(500, 100, 100)).toBe(1)
    expect(ratioFromPointer(120, 100, 0)).toBe(0)
  })

})
