/**
 * 剪辑范围的约束规则契约（纯函数，Node 直接跑）。
 *
 * 这些规则的共同点：它们是**用户拖进度条**的结果。拖的时候必须永远落回合法范围（不早于 0、
 * 不晚于时长、两端之间留够最短长度），否则播放器会拿到越界的 currentTime 而卡住。
 */
import { describe, it, expect } from 'vitest'
import {
  clampClipEnd,
  clampClipRange,
  clampClipStart,
  MIN_CLIP_DURATION,
  moveClipRange,
  readClipRange,
} from '../videoClip'

describe('clampClipRange：把范围收进 [0,时长] 且保住最短长度', () => {
  it('合法范围原样通过（只做 3 位小数收敛）', () => {
    expect(clampClipRange({ start: 1, end: 5, duration: 10 })).toEqual({ start: 1, end: 5 })
  })

  it('越界被夹住：起点不早于 0、终点不晚于时长', () => {
    expect(clampClipRange({ start: -3, end: 99, duration: 10 })).toEqual({ start: 0, end: 10 })
  })

  it('两端颠倒自动交换', () => {
    expect(clampClipRange({ start: 7, end: 2, duration: 10 })).toEqual({ start: 2, end: 7 })
  })

  it('长度不足最短时把终点往后推', () => {
    const r = clampClipRange({ start: 2, end: 2.01, duration: 10, minDuration: 1 })
    expect(r.start).toBe(2)
    expect(r.end).toBe(3)
  })

  it('贴住尾部、终点推不动时改把起点往前挪', () => {
    const r = clampClipRange({ start: 9.95, end: 10, duration: 10, minDuration: 1 })
    expect(r.end).toBe(10)
    expect(r.start).toBe(9)
  })

  it('时长非法 → 按 0.1 处理，绝不回 NaN / 负数', () => {
    for (const bad of [0, -5, Number.NaN, undefined, 'x']) {
      const r = clampClipRange({ start: 0, end: 1, duration: bad as number })
      expect(Number.isFinite(r.start)).toBe(true)
      expect(Number.isFinite(r.end)).toBe(true)
      expect(r.end).toBeLessThanOrEqual(MIN_CLIP_DURATION)
    }
  })

  it('浮点脏值被收敛到 3 位小数（不落 3.0000000000000004 这种数进库）', () => {
    const r = clampClipRange({ start: 0.1 + 0.2, end: 1.7000000000000002, duration: 10 })
    expect(r.start).toBe(0.3)
    expect(r.end).toBe(1.7)
  })
})

describe('clampClipStart / clampClipEnd：只动一端', () => {
  it('动起点时终点钉住不动', () => {
    expect(clampClipStart({ start: 3, end: 6, duration: 10 })).toEqual({ start: 3, end: 6 })
  })

  it('起点不能顶到终点（至少留最短时长）', () => {
    expect(clampClipStart({ start: 6, end: 6, duration: 10, minDuration: 1 })).toEqual({ start: 5, end: 6 })
  })

  it('动终点时起点钉住不动', () => {
    expect(clampClipEnd({ start: 3, end: 6, duration: 10 })).toEqual({ start: 3, end: 6 })
  })

  it('终点不能贴到起点（至少留最短时长）；也不能超过时长', () => {
    expect(clampClipEnd({ start: 5, end: 5, duration: 10, minDuration: 1 })).toEqual({ start: 5, end: 6 })
    expect(clampClipEnd({ start: 5, end: 99, duration: 10 })).toEqual({ start: 5, end: 10 })
  })
})

describe('moveClipRange：整段平移（长度不变）', () => {
  it('中间位置平移：长度原样', () => {
    expect(moveClipRange({ start: 2, end: 5, nextStart: 4, duration: 10 })).toEqual({ start: 4, end: 7 })
  })

  it('往前推过头 → 抵住 0（起点不能为负）', () => {
    expect(moveClipRange({ start: 2, end: 5, nextStart: -10, duration: 10 })).toEqual({ start: 0, end: 3 })
  })

  it('往后推过头 → 抵住时长（终点不能超时长），长度仍不变', () => {
    const r = moveClipRange({ start: 2, end: 5, nextStart: 99, duration: 10 })
    expect(r.end).toBe(10)
    expect(r.end - r.start).toBe(3)
  })

  it('范围比时长还长 → 长度被收到时长（不越界）', () => {
    const r = moveClipRange({ start: 0, end: 20, duration: 10, nextStart: 0 })
    expect(r.end - r.start).toBeLessThanOrEqual(10)
  })
})

describe('readClipRange：读已保存的范围', () => {
  it('没有保存过 → 整段 [0, 时长]', () => {
    expect(readClipRange({ videoDuration: 12 })).toEqual({ start: 0, end: 12 })
  })

  it('保存过就用保存的值', () => {
    expect(readClipRange({ videoDuration: 12, clipStart: 3, clipEnd: 8 })).toEqual({ start: 3, end: 8 })
  })

  it('脏数据（越界 / 颠倒 / 非数）被收敛后才交给播放器', () => {
    expect(readClipRange({ videoDuration: 10, clipStart: -5, clipEnd: 99 })).toEqual({ start: 0, end: 10 })
    expect(readClipRange({ videoDuration: 10, clipStart: 8, clipEnd: 2 })).toEqual({ start: 2, end: 8 })
    expect(readClipRange({ videoDuration: 10, clipStart: 'x', clipEnd: null })).toEqual({ start: 0, end: 10 })
  })

  it('null 视为"没保存过"而不是 0 秒 —— 否则清空过的剪辑范围会把整段压成 0.1 秒', () => {
    // 这是真实踩过的坑：JS 里 Number(null) === 0，照直转换会把终点读成 0。
    expect(readClipRange({ videoDuration: 10, clipStart: null, clipEnd: null })).toEqual({ start: 0, end: 10 })
    expect(readClipRange({ videoDuration: 10, clipStart: 2, clipEnd: null })).toEqual({ start: 2, end: 10 })
  })

  it('时长未知 → 空范围 [0,0]（播放器据此不设限制，也不会拿到 NaN）', () => {
    expect(readClipRange({})).toEqual({ start: 0, end: 0 })
    expect(readClipRange(undefined)).toEqual({ start: 0, end: 0 })
  })
})
