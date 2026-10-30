/**
 * 定时落盘失败不能变成 unhandled rejection（2026-10-30 扫描发现）。
 *
 * start() 里是 `void tick()`；tick 内部 `await opts.flush()` 没有 catch。
 * 落盘函数一旦 reject（后台 500 / 网络断了 / 适配器抛错），这个 Promise 就没人接 ——
 * 每秒一条 unhandled rejection，在 Node 里是进程级告警，在浏览器里是控制台刷屏，
 * 而且脏位已被清掉，这次改动悄悄丢了。
 */
import { describe, it, expect, vi } from 'vitest'
import { createAutoSaveEngine } from '../autoSaveEngine'

describe('autoSaveEngine 落盘失败', () => {
  it('flush 抛错不会产生未处理 rejection，且下次仍会重试', async () => {
    vi.useFakeTimers()
    const failures: unknown[] = []
    const flush = vi
      .fn()
      .mockRejectedValueOnce(new Error('后台 500'))
      .mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onUnhandled = (err: unknown): void => { failures.push(err) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const e = createAutoSaveEngine({ interval: 100, enabled: true, flush })
      e.markDirty()
      vi.advanceTimersByTime(100)
      await vi.runOnlyPendingTimersAsync()
      // 再等一轮：失败那一拍之后，脏位要回到「脏」才能重试
      vi.advanceTimersByTime(100)
      await vi.runOnlyPendingTimersAsync()
      expect(flush.mock.calls.length, '失败后没有重试').toBeGreaterThanOrEqual(2)
      expect(failures, '落盘失败变成了 unhandled rejection').toEqual([])
      e.dispose()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      warn.mockRestore()
      vi.useRealTimers()
    }
  })
})
