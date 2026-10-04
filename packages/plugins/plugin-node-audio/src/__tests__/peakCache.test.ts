import { describe, expect, it } from 'vitest'
import { PeakCache } from '../peakCache'

describe('PeakCache', () => {
  it('只请求缺失区间、复用缓存并收敛边界', async () => {
    const cache = new PeakCache(10, 1)
    const calls: [number, number][] = []
    const sample = async (a: number, b: number, n: number) => { calls.push([a, b]); return Array.from({ length: n }, (_, i) => a + (b - a) * (i + 1) / n) }
    const first = await cache.get(2, 4, 2, sample)
    await cache.get(2, 4, 2, sample)
    expect(calls).toHaveLength(1)
    expect(first).toEqual([3, 4])
    expect(await cache.get(-3, 99, 2, sample)).toHaveLength(2)
  })

  it('粗粒度由细粒度缓存聚合', async () => {
    const cache = new PeakCache(16, 1)
    let calls = 0
    const sample = async (_a: number, _b: number, n: number) => { calls++; return Array.from({ length: n }, (_, i) => i + 1) }
    const out = await cache.get(0, 8, 2, sample)
    expect(out).toEqual([4, 8])
    expect(calls).toBe(1)
    await cache.get(0, 8, 2, sample)
    expect(calls).toBe(1)
  })
})
