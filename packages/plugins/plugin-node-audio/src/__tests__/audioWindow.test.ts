/**
 * audioWindow 测试 —— 波形是"长条纹 + 可视窗口"。
 *
 * 为什么需要一层窗口计算：节点宽度固定，而音频有长有短（用户点名的问题）。做法是把整条波形
 * 画成一条长条，**只把可视那一段显示出来** —— 播放时窗口跟着进度走，看上去就是波纹在滑动。
 *
 * 两个口径必须钉死（否则会出现"2 秒的音频只看到 1/4"或"3 分钟的歌显示成一根根粗条"）：
 * 1. 短音频**整条显示**（不裁窗口）；
 * 2. 长音频的窗口有**下限**（不至于只剩几根粗条），由 windowSeconds 换算、再夹到下限。
 */
import { describe, it, expect } from 'vitest'
import { WAVEFORM_BUCKETS } from '../waveform'
import {
  DEFAULT_WINDOW_SECONDS,
  MIN_VISIBLE_BUCKETS,
  visibleBucketCount,
  windowStartBucket,
  seekRatio,
  headFraction,
  audioViewport,
} from '../audioWindow'

describe('audioWindow · 可视桶数', () => {
  it('时长未知 → 整条显示（不知道多长就别裁）', () => {
    expect(visibleBucketCount(0)).toBe(WAVEFORM_BUCKETS)
    expect(visibleBucketCount(Number.NaN)).toBe(WAVEFORM_BUCKETS)
    expect(visibleBucketCount(-5)).toBe(WAVEFORM_BUCKETS)
  })

  it('短音频整条显示（2 秒的东西不该只看到一角）', () => {
    expect(visibleBucketCount(2)).toBe(WAVEFORM_BUCKETS)
    expect(visibleBucketCount(DEFAULT_WINDOW_SECONDS)).toBe(WAVEFORM_BUCKETS)
  })

  it('中等长度按"窗口秒数"换算（40 秒音频 + 10 秒窗口 = 四分之一）', () => {
    expect(visibleBucketCount(40, WAVEFORM_BUCKETS, 10)).toBe(25)
    expect(visibleBucketCount(20, WAVEFORM_BUCKETS, 10)).toBe(50)
  })

  it('很长的音频也不低于下限（否则只剩几根粗条）', () => {
    expect(visibleBucketCount(600)).toBe(MIN_VISIBLE_BUCKETS)
    expect(visibleBucketCount(6000)).toBe(MIN_VISIBLE_BUCKETS)
  })

  it('永不超过整条，且恒为正整数', () => {
    for (const d of [0, 1, 7.5, 19, 120, 9999]) {
      const n = visibleBucketCount(d)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(WAVEFORM_BUCKETS)
      expect(n).toBeGreaterThanOrEqual(MIN_VISIBLE_BUCKETS)
    }
  })
})

describe('audioWindow · 窗口左端', () => {
  it('尽量把当前播放位置放在窗口正中', () => {
    // 总 100 桶、窗口 25 桶、当前在第 50 桶 → 左端 37.5
    expect(windowStartBucket(50, 25, 100)).toBeCloseTo(37.5, 5)
  })

  it('开头不越界（左端不小于 0）', () => {
    expect(windowStartBucket(0, 25, 100)).toBe(0)
    expect(windowStartBucket(5, 25, 100)).toBe(0)
  })

  it('结尾不越界（右端不超出总量）', () => {
    expect(windowStartBucket(100, 25, 100)).toBe(75)
    expect(windowStartBucket(95, 25, 100)).toBe(75)
  })

  it('窗口不小于整条时左端恒为 0（短音频整条显示）', () => {
    expect(windowStartBucket(50, 100, 100)).toBe(0)
    expect(windowStartBucket(50, 120, 100)).toBe(0)
  })

  it('非法输入不产生 NaN（NaN 进 viewBox 会让整块波形消失）', () => {
    expect(Number.isFinite(windowStartBucket(Number.NaN, 25, 100))).toBe(true)
    expect(windowStartBucket(Number.NaN, 25, 100)).toBe(0)
    expect(Number.isFinite(windowStartBucket(50, 0, 100))).toBe(true)
  })
})

describe('audioWindow · 视口内位置 ↔ 绝对进度（拖动/点击共用这一条）', () => {
  it('整条模式：视口左端是 0，指针位置就是绝对进度', () => {
    expect(seekRatio(0, 0, 100, 100)).toBe(0)
    expect(seekRatio(0.5, 0, 100, 100)).toBeCloseTo(0.5, 5)
    expect(seekRatio(1, 0, 100, 100)).toBe(1)
  })

  it('窗口模式：指针位置换算到"窗口左端 + 视口内偏移"', () => {
    // 视口左端在第 40 桶、窗口 20 桶：点在正中间 → 第 50 桶 = 一半
    expect(seekRatio(0.5, 40, 20, 100)).toBeCloseTo(0.5, 5)
    // 点在左端 → 第 40 桶；右端 → 第 60 桶
    expect(seekRatio(0, 40, 20, 100)).toBeCloseTo(0.4, 5)
    expect(seekRatio(1, 40, 20, 100)).toBeCloseTo(0.6, 5)
  })

  it('seekRatio 永远收敛在 0..1（点出边界也不越界）', () => {
    // 指针在视口左缘之外 → 收敛到"视口左端"本身（第 90 桶 = 0.9），不是整条开头
    expect(seekRatio(-3, 90, 20, 100)).toBeCloseTo(0.9, 5)
    expect(seekRatio(5, 90, 20, 100)).toBe(1)
    expect(seekRatio(Number.NaN, 40, 20, 100)).toBeCloseTo(0.4, 5)
  })

  it('headFraction：视口内播放头的相对位置（边缘夹住时不硬钉在中间）', () => {
    // 开头：视口从 0 开始、播放头在第 0 桶 → 贴左缘（**不是**中间）
    expect(headFraction(0, 0, 20)).toBe(0)
    // 视口左端 40、播放头 50 → 正中
    expect(headFraction(50, 40, 20)).toBeCloseTo(0.5, 5)
    // 结尾：视口左端 80、播放头 100 → 贴右缘
    expect(headFraction(100, 80, 20)).toBe(1)
  })

  it('headFraction 与 seekRatio 互为逆运算（同一个视口下点哪就是哪）', () => {
    const start = 37.5
    const visible = 25
    const currentBucket = 50
    const f = headFraction(currentBucket, start, visible)
    expect(seekRatio(f, start, visible, 100)).toBeCloseTo(currentBucket / 100, 5)
  })
})

describe('audioWindow · 视口（波形铺满 + 与 seek 同一把尺子）', () => {
  it('视口宽度就是可见桶数，左端是整数桶（进 viewBox 不会出小数抖动）', () => {
    const vp = audioViewport(50, 100, 180)
    expect(vp.visible).toBe(visibleBucketCount(180, 100))
    expect(Number.isInteger(vp.start)).toBe(true)
  })

  it('视口内位置与 seek 互为逆运算（色块分界与播放头才会重合）', () => {
    for (const dur of [2, 40, 457]) {
      for (const bucket of [0, 5, 33, 50, 87, 100]) {
        const vp = audioViewport(bucket, 100, dur)
        expect(seekRatio(vp.fraction, vp.start, vp.visible, 100)).toBeCloseTo(bucket / 100, 5)
      }
    }
  })

  it('fraction 恒在 0..1、visible 为正（NaN 进 width 会让整块波形消失）', () => {
    for (const bucket of [Number.NaN, -3, 0, 42.42, 999]) {
      const vp = audioViewport(bucket, 100, 600)
      expect(Number.isFinite(vp.fraction)).toBe(true)
      expect(vp.fraction).toBeGreaterThanOrEqual(0)
      expect(vp.fraction).toBeLessThanOrEqual(1)
      expect(vp.visible).toBeGreaterThan(0)
      expect(vp.start).toBeGreaterThanOrEqual(0)
      expect(vp.start + vp.visible).toBeLessThanOrEqual(100)
    }
  })

  it('短音频整条显示：视口左端为 0、宽度就是整条', () => {
    const vp = audioViewport(30, 100, 3)
    expect(vp.start).toBe(0)
    expect(vp.visible).toBe(100)
    expect(vp.fraction).toBeCloseTo(0.3, 5)
  })
})
