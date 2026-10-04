/**
 * waveform 纯函数测试 —— 波形是「算一次、存进节点、以后只读缓存」的派生数据，
 * 所以口径必须钉死：桶数恒定、静音不塌陷、值域与类型可校验。
 */
import { describe, it, expect } from 'vitest'
import {
  WAVEFORM_BUCKETS,
  WAVEFORM_MAX,
  bucketPeaks,
  normalizeToPercent,
  isValidWaveform,
  fallbackWaveform,
} from '../waveform'

describe('waveform · 桶化峰值', () => {
  it('无论采样多少，恒定输出 WAVEFORM_BUCKETS 个桶', () => {
    expect(bucketPeaks(new Float32Array(48000))).toHaveLength(WAVEFORM_BUCKETS)
    expect(bucketPeaks(new Float32Array(50))).toHaveLength(WAVEFORM_BUCKETS)
    expect(bucketPeaks(new Float32Array(0))).toHaveLength(WAVEFORM_BUCKETS)
  })

  it('每桶取绝对最大值（负半周也要算进峰值）', () => {
    const samples = new Float32Array(200)
    samples[10] = -0.8
    samples[150] = 0.4
    const peaks = bucketPeaks(samples, 2)
    expect(peaks[0]).toBeCloseTo(0.8, 5)
    expect(peaks[1]).toBeCloseTo(0.4, 5)
  })

  it('多声道交错采样按帧取最大（左右声道反相也不会被平均成 0）', () => {
    // 2 帧 × 2 声道：帧 0 = (1, -1)，帧 1 = (0.2, 0.2)
    const samples = new Float32Array([1, -1, 0.2, 0.2])
    expect(bucketPeaks(samples, 1, 2)[0]).toBeCloseTo(1, 5)
  })
})

describe('waveform · 归一化', () => {
  it('落成 1..WAVEFORM_MAX 的整数，静音桶保底 1（不出现 0 高度的空档）', () => {
    const out = normalizeToPercent([0, 0.5, 1])
    expect(out.every((v) => Number.isInteger(v) && v >= 1 && v <= WAVEFORM_MAX)).toBe(true)
    expect(out[0]).toBe(1)
    expect(out[2]).toBe(WAVEFORM_MAX)
  })

  it('全静音不产生 NaN（峰值 0 时整条给保底值）', () => {
    const out = normalizeToPercent(new Array(WAVEFORM_BUCKETS).fill(0))
    expect(out).toHaveLength(WAVEFORM_BUCKETS)
    expect(out.every((v) => v === 1)).toBe(true)
  })
})

describe('waveform · 校验与确定性回落', () => {
  it('isValidWaveform 只认长度正确、值域合法的整数数组', () => {
    expect(isValidWaveform(fallbackWaveform('a'))).toBe(true)
    expect(isValidWaveform('x')).toBe(false)
    expect(isValidWaveform(undefined)).toBe(false)
    expect(isValidWaveform([])).toBe(false)
    expect(isValidWaveform(new Array(WAVEFORM_BUCKETS).fill(0))).toBe(false)
    expect(isValidWaveform(new Array(WAVEFORM_BUCKETS).fill(WAVEFORM_MAX + 1))).toBe(false)
    expect(isValidWaveform(new Array(WAVEFORM_BUCKETS).fill(1.5))).toBe(false)
  })

  it('回落波形只由 seed 决定：同 seed 完全一致，不同 seed 一般不同', () => {
    expect(fallbackWaveform('https://x/a.mp3')).toEqual(fallbackWaveform('https://x/a.mp3'))
    expect(fallbackWaveform('a')).not.toEqual(fallbackWaveform('b'))
    expect(fallbackWaveform('a')).toHaveLength(WAVEFORM_BUCKETS)
    expect(isValidWaveform(fallbackWaveform('a'))).toBe(true)
  })
})

