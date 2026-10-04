/**
 * 按区间缓存峰值；粗层级从细桶聚合，避免重复扫描。
 *
 * 存的是**原始峰值（0..1 绝对振幅）**，不做归一化 —— 归一化留到最后一次性做：
 * 每块各自归一化会把安静段拉满、相对响度全丢，画出来就是"后面一片平"（实测 bug）。
 */
export class PeakCache {
  private readonly levels = new Map<number, Map<number, number>>()
  constructor(readonly duration: number, readonly baseBucketSeconds = 0.02) {}

  async get(startSec: number, endSec: number, buckets: number, sample: (start: number, end: number, count: number) => Promise<number[]>): Promise<number[]> {
    const start = Math.max(0, Math.min(this.duration, startSec))
    const end = Math.max(start, Math.min(this.duration, endSec))
    const count = Math.max(1, Math.floor(buckets))
    if (end <= start) return Array(count).fill(0)
    const step = (end - start) / count
    const level = Math.max(0, Math.floor(Math.log2(step / this.baseBucketSeconds)))
    const size = this.baseBucketSeconds * 2 ** level
    const first = Math.floor(start / size), last = Math.ceil(end / size)
    const cache = this.levels.get(level) ?? new Map<number, number>()
    this.levels.set(level, cache)
    const missing: number[] = []
    for (let i = first; i < last; i++) if (!cache.has(i)) missing.push(i)
    if (level > 0) {
      const fineSize = this.baseBucketSeconds * 2 ** (level - 1)
      const fine = await this.get(start, end, Math.max(1, Math.ceil((end - start) / fineSize)), sample)
      for (const i of missing) {
        const a = Math.max(0, Math.floor((i * size - start) / (end - start) * fine.length))
        const b = Math.max(a + 1, Math.ceil(((i + 1) * size - start) / (end - start) * fine.length))
        cache.set(i, Math.max(...fine.slice(a, b)))
      }
      return Array.from({ length: count }, (_, n) => {
        const a = start + n * step, b = Math.min(end, a + step)
        let peak = 0
        for (let i = Math.floor(a / size); i < Math.ceil(b / size); i++) peak = Math.max(peak, cache.get(i) ?? 1)
        return peak
      })
    }
    const runs: number[][] = []
    for (const i of missing) {
      const run = runs[runs.length - 1]
      if (run && i === run[run.length - 1] + 1) run.push(i)
      else runs.push([i])
    }
    await Promise.all(runs.map(async (run) => {
      const values = await sample(run[0] * size, Math.min(this.duration, (run[run.length - 1] + 1) * size), run.length)
      run.forEach((i, n) => cache.set(i, Math.max(0, values[n] ?? 0)))
    }))
    return Array.from({ length: count }, (_, n) => {
      const a = start + n * step, b = Math.min(end, a + step)
      let peak = 0
      for (let i = Math.floor(a / size); i < Math.ceil(b / size); i++) peak = Math.max(peak, cache.get(i) ?? 1)
      return peak
    })
  }
  clear(): void { this.levels.clear() }
}
