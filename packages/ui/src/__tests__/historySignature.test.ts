/**
 * 历史缓存 key 与缓存上限（用户实测口径 2026-10-30）。
 *
 * 两个真问题：
 *   ① 切画布后，「本画布」的历史缓存 key 与上一个画布相同 → 先把 A 的卡片贴出来，
 *      后台同步又只「插新卡不删旧卡」，A 的记录留在 B 的画布页里；
 *   ② histDataCache 每套筛选存一整份列表且没有上限 → 浏览越多占得越多。
 */
import { describe, it, expect } from 'vitest'
import { historySignatureOf, trimMapToLimit, HIST_DATA_CACHE_LIMIT } from '../composables/historySignature'

const base = { scope: '本画布', type: '图片', rating: '所有评级', sortDesc: true, pageSize: 20 }

describe('historySignatureOf', () => {
  it('「本画布」的 key 带画布 id：切画布不会命中上一个画布的缓存', () => {
    const a = historySignatureOf(base, 'canvas-a')
    const b = historySignatureOf(base, 'canvas-b')
    expect(a).not.toBe(b)
    expect(a).toContain('canvas-a')
    expect(b).toContain('canvas-b')
  })

  it('「全部画布」不看画布 id（跨画布看同一份列表，切画布不该重新拉）', () => {
    const all = { ...base, scope: '全部画布' }
    expect(historySignatureOf(all, 'canvas-a')).toBe(historySignatureOf(all, 'canvas-b'))
  })

  it('原来的四维筛选仍在 key 里（类型 / 评级 / 排序 / 页大小各改一项都会换 key）', () => {
    const key = historySignatureOf(base, 'c')
    for (const patch of [
      { type: '视频' },
      { rating: '已通过' },
      { sortDesc: false },
      { pageSize: 40 },
    ]) {
      expect(historySignatureOf({ ...base, ...patch }, 'c')).not.toBe(key)
    }
  })
})

describe('trimMapToLimit', () => {
  it('满到上限就逐出最旧的，插入后最多 limit 条', () => {
    const m = new Map<string, number>()
    for (let i = 0; i < HIST_DATA_CACHE_LIMIT + 2; i++) {
      trimMapToLimit(m, HIST_DATA_CACHE_LIMIT)
      m.set('k' + i, i)
    }
    expect(m.size).toBe(HIST_DATA_CACHE_LIMIT)
    expect(m.has('k0'), '最旧的条目没有被逐出').toBe(false)
    expect(m.has('k' + (HIST_DATA_CACHE_LIMIT + 1)), '最新的一条不该被逐出').toBe(true)
  })

  it('没满时什么都不做', () => {
    const m = new Map([['a', 1]])
    trimMapToLimit(m, 8)
    expect([...m.keys()]).toEqual(['a'])
  })
})
