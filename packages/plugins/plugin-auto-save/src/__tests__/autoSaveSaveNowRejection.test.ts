/** saveNow 的失败也不能变成 unhandled rejection（脏位同样要恢复） */
import { describe, it, expect, vi } from 'vitest'
import { createAutoSaveEngine } from '../autoSaveEngine'

describe('autoSaveEngine.saveNow 失败', () => {
  it('抛错时脏位回到「脏」，并在下个周期重试', async () => {
    vi.useFakeTimers()
    const flush = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const e = createAutoSaveEngine({ interval: 100, enabled: true, flush })
    try {
      e.markDirty()
      await expect(e.saveNow()).resolves.toBeUndefined()
      vi.advanceTimersByTime(100)
      await vi.runOnlyPendingTimersAsync()
      expect(flush.mock.calls.length, 'saveNow 失败后没有重试').toBeGreaterThanOrEqual(2)
    } finally {
      e.dispose()
      warn.mockRestore()
      vi.useRealTimers()
    }
  })
})
