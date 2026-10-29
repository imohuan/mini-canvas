import { describe, expect, it } from 'vitest'
import { frameCountFor, frameTimes } from '../videoFilmstrip'

describe('胶片条抽帧', () => {
  it('格数按宽度 / 56px 算，夹在 [6, 14]', () => {
    expect(frameCountFor(336)).toBe(6)
    expect(frameCountFor(560)).toBe(10)
    expect(frameCountFor(900)).toBe(14)
    expect(frameCountFor(999999)).toBe(14)
    expect(frameCountFor(100)).toBe(6)
    expect(frameCountFor(0)).toBe(8)
  })

  it('时间点 = 每格中心：duration × (i + 0.5) / count', () => {
    const times = frameTimes(10, 4)
    expect(times).toHaveLength(4)
    expect(times[0]).toBeCloseTo(1.25, 5)
    expect(times[3]).toBeCloseTo(8.75, 5)
  })

  it('非法输入给空序列（不给调用方炸）', () => {
    expect(frameTimes(0, 4)).toEqual([])
    expect(frameTimes(10, 0)).toEqual([])
    expect(frameTimes(-1, 4)).toEqual([])
  })
})
