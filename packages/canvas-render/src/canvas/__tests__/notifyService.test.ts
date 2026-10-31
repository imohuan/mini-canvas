import { describe, expect, it, vi } from 'vitest'
import { createNotifyService } from '../notifyService'

describe('notify', () => {
  it('同一 source 重复提示会去重（once）', () => {
    const n = createNotifyService()
    n.notify('网络慢', { source: 'gen', once: true })
    n.notify('网络慢', { source: 'gen', once: true })
    expect(n.list()).toHaveLength(1)
  })

  it('返回的撤回函数只撤自己那条', () => {
    const n = createNotifyService()
    const off = n.notify('A', { source: 'a' })
    n.notify('B', { source: 'b' })
    off()
    expect(n.list().map((x) => x.message)).toEqual(['B'])
  })

  it('空串 = 隐藏（保留 tip 语义）', () => {
    const n = createNotifyService()
    n.notify('拖动中', { source: 'drag', followPointer: true })
    n.notify('', { source: 'drag' })
    expect(n.list()).toHaveLength(0)
  })

  it('多持有者互不覆盖：清掉自己的 source 不影响别人的提示', () => {
    const n = createNotifyService()
    n.notify('A 的提示', { source: 'a', followPointer: true, durationMs: 0 })
    n.notify('B 的提示', { source: 'b', followPointer: true, durationMs: 0 })
    n.hide('a')
    expect(n.list().map((x) => x.message)).toEqual(['B 的提示'])
  })

  it('durationMs 到了会自动消失', () => {
    vi.useFakeTimers()
    const n = createNotifyService()
    n.notify('短暂', { durationMs: 50 })
    vi.advanceTimersByTime(51)
    expect(n.list()).toHaveLength(0)
    vi.useRealTimers()
  })

  it('按 priority 升序给出（数字小的先渲染）', () => {
    const n = createNotifyService()
    n.notify('低', { source: 'x', priority: 5, durationMs: 0 })
    n.notify('高', { source: 'y', priority: 1, durationMs: 0 })
    expect(n.list().map((x) => x.message)).toEqual(['高', '低'])
  })

  it('followPointer 缺省为 true（tip 语义：提示跟着鼠标；Spec 五·13）', () => {
    const n = createNotifyService()
    n.notify('提示', { durationMs: 0 })
    expect(n.list()[0].followPointer).toBe(true)
    n.notify('角落', { durationMs: 0, followPointer: false })
    expect(n.list()[1].followPointer).toBe(false)
  })
})
