import { describe, expect, it, vi } from 'vitest'
import { createAutoSaveEngine } from '../autoSaveEngine'

describe('autoSaveEngine', () => {
  it('不启用时不落盘、不置计时器', () => {
    const flush = vi.fn()
    const e = createAutoSaveEngine({ interval: 50, enabled: false, flush })
    e.markDirty()
    expect(flush).not.toHaveBeenCalled()
    e.dispose()
  })

  it('启用后脏位 + 到达 interval → flush 一次并复位', async () => {
    vi.useFakeTimers()
    const flush = vi.fn().mockResolvedValue(undefined)
    const e = createAutoSaveEngine({ interval: 100, enabled: true, flush })
    e.markDirty()
    vi.advanceTimersByTime(100)
    await vi.runOnlyPendingTimersAsync()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(e.isDirty()).toBe(false)
    e.dispose()
    vi.useRealTimers()
  })

  it('无脏位即使到点也不 flush', async () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const e = createAutoSaveEngine({ interval: 100, enabled: true, flush })
    vi.advanceTimersByTime(300)
    await vi.runOnlyPendingTimersAsync()
    expect(flush).not.toHaveBeenCalled()
    e.dispose()
    vi.useRealTimers()
  })

  it('setEnabled(false) 停表；恢复后脏数据下周期落盘', async () => {
    vi.useFakeTimers()
    const flush = vi.fn().mockResolvedValue(undefined)
    const e = createAutoSaveEngine({ interval: 100, enabled: true, flush })
    e.setEnabled(false)
    e.markDirty()
    vi.advanceTimersByTime(500)
    await vi.runOnlyPendingTimersAsync()
    expect(flush).not.toHaveBeenCalled()
    e.setEnabled(true)
    vi.advanceTimersByTime(100)
    await vi.runOnlyPendingTimersAsync()
    expect(flush).toHaveBeenCalledTimes(1)
    e.dispose()
    vi.useRealTimers()
  })

  it('saveNow 无论脏否都落盘', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const e = createAutoSaveEngine({ interval: 1000, enabled: true, flush })
    await e.saveNow()
    expect(flush).toHaveBeenCalledTimes(1)
    e.dispose()
  })

  it('dispose 后停表且不再落盘', async () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const e = createAutoSaveEngine({ interval: 100, enabled: true, flush })
    e.markDirty()
    e.dispose()
    vi.advanceTimersByTime(500)
    await vi.runOnlyPendingTimersAsync()
    expect(flush).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
