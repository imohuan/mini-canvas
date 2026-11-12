import { describe, it, expect } from 'vitest'
import { createCoalescer, manualScheduler } from '../coalesce'

describe('coalesce：高频值合帧(目标 B2 性能约束③)', () => {
  it('同一帧内多次 push 同 key 只保留最后一次(一次 flush 一次应用)', () => {
    const queue: Array<() => void> = []
    const applied: Array<Array<[string, unknown]>> = []
    const c = createCoalescer((pairs) => applied.push(pairs), manualScheduler(queue))

    // 一次拖动内连续 30 次改同 key → 只存最新
    for (let i = 0; i < 30; i++) c.push('edgeColor', `#${String(i).padStart(6, '0')}`)
    c.push('edgeLineWidth', 5)
    c.push('edgeColor', '#ff0000')
    c.push('edgeLineWidth', 3)
    expect(applied).toHaveLength(0) // 未到帧尾不应用

    // 帧尾手动 flush 一次 → 一次 apply，且各 key 只取最后一次值
    expect(queue).toHaveLength(1)
    queue[0]()
    expect(applied).toHaveLength(1)
    expect(new Map(applied[0]).get('edgeColor')).toBe('#ff0000')
    expect(new Map(applied[0]).get('edgeLineWidth')).toBe(3)
  })

  it('跨帧(多次 flush)各自独立应用；空队列不重复触发', () => {
    const queue: Array<() => void> = []
    let count = 0
    const c = createCoalescer(() => void count++, manualScheduler(queue))
    c.push('a', 1)
    queue[0]()
    expect(count).toBe(1)
    // 没有新 push → flush 空返回 false，不重复计
    expect(c.flush()).toBe(false)
    c.push('b', 2)
    queue[0]()
    expect(count).toBe(2)
  })

  it('push 立刻读到最新、未应用(单一数据源最终一致)', () => {
    const queue: Array<() => void> = []
    const c = createCoalescer(() => {}, manualScheduler(queue))
    c.push('x', 1)
    c.push('x', 2)
    // 手动 flush 清空
    queue[0]()
    expect(c.flush()).toBe(false)
  })
})
