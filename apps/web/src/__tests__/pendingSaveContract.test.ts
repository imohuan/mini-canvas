/** 落盘钩子的行为契约（注册 / 注销 / 再注册） */
import { describe, it, expect, vi } from 'vitest'
import {
  registerPendingSave,
  unregisterPendingSave,
  flushPendingSave,
} from '../composables/pendingSave'

describe('pendingSave', () => {
  it('注册后 flush 会 await 到落盘函数', async () => {
    const fn = vi.fn(async () => {})
    registerPendingSave(fn)
    await flushPendingSave()
    expect(fn).toHaveBeenCalledTimes(1)
    unregisterPendingSave(fn)
  })

  it('注销后不再调用（且注销别人的函数不会误删当前钩子）', async () => {
    const mine = vi.fn(async () => {})
    const other = vi.fn(async () => {})
    registerPendingSave(mine)
    unregisterPendingSave(other)
    await flushPendingSave()
    expect(mine).toHaveBeenCalledTimes(1)

    unregisterPendingSave(mine)
    await flushPendingSave()
    expect(mine).toHaveBeenCalledTimes(1)
  })

  it('注销后能再次注册（回画布时重新接上）', async () => {
    const fn = vi.fn(async () => {})
    registerPendingSave(fn)
    unregisterPendingSave(fn)
    registerPendingSave(fn)
    await flushPendingSave()
    expect(fn).toHaveBeenCalledTimes(1)
    unregisterPendingSave(fn)
  })

  it('落盘抛错不挡导航', async () => {
    const fn = vi.fn(async () => { throw new Error('boom') })
    registerPendingSave(fn)
    await expect(flushPendingSave()).resolves.toBeUndefined()
    unregisterPendingSave(fn)
  })
})
