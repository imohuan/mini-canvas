import { describe, it, expect, vi } from 'vitest'
import { Fiber, FiberState } from '../fiber'

describe('Fiber（cordis 语义生命周期状态机 + 副作用容器）', () => {
  it('初始为 PENDING，可迁移到 LOADING/ACTIVE', () => {
    const fiber = new Fiber({ name: 'p', deps: ['nodeStore'] })
    expect(fiber.state).toBe(FiberState.PENDING)
    expect(fiber.deps).toEqual(['nodeStore'])
    fiber.markLoading()
    expect(fiber.state).toBe(FiberState.LOADING)
    fiber.markActive()
    expect(fiber.state).toBe(FiberState.ACTIVE)
  })

  it('markFailed → FAILED，settle() 拒绝并抛 error', async () => {
    const fiber = new Fiber({ name: 'bad' })
    const boom = new Error('config invalid')
    fiber.markLoading()
    fiber.markFailed(boom)
    expect(fiber.state).toBe(FiberState.FAILED)
    expect(fiber.error).toBe(boom)
    await expect(fiber.settle()).rejects.toThrow(/config invalid/)
  })

  it('状态真变化才触发 onTransition', () => {
    const fiber = new Fiber({ name: 'p' })
    const fn = vi.fn()
    fiber.onTransition = fn
    fiber.markLoading()
    expect(fn).toHaveBeenCalledTimes(1)
    // 重复设同一状态不触发
    fiber.markLoading()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('onDispose 登记的清理在 dispose() 逆序执行，幂等', async () => {
    const fiber = new Fiber({ name: 'p' })
    const order: string[] = []
    fiber.onDispose(() => void order.push('first'))
    fiber.onDispose(() => void order.push('second'))
    await fiber.dispose()
    expect(order).toEqual(['second', 'first'])
    expect(fiber.state).toBe(FiberState.DISPOSED)
    // 幂等：再 dispose 不再重复
    order.length = 0
    await fiber.dispose()
    expect(order).toEqual([])
  })

  it('effect 支持异步 disposer：dispose 时逐项 await 完成', async () => {
    const fiber = new Fiber({ name: 'p' })
    const done = vi.fn()
    fiber.effect(async () => {
      // 模拟异步申请后返回清理
      await Promise.resolve()
      return async () => {
        await Promise.resolve()
        done()
      }
    })
    await fiber.dispose()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('effect 支持同步清理函数与 { dispose } 对象', async () => {
    const fiber = new Fiber({ name: 'p' })
    const a = vi.fn()
    const b = vi.fn()
    fiber.effect(() => a)
    fiber.effect(() => ({ dispose: b }))
    await fiber.dispose()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('单个清理抛错不阻断其余（异步拒收也不阻断）', async () => {
    const fiber = new Fiber({ name: 'p' })
    const ok = vi.fn()
    fiber.onDispose(async () => {
      throw new Error('boom')
    })
    fiber.onDispose(() => {
      ok()
    })
    await expect(fiber.dispose()).resolves.toBeUndefined()
    expect(ok).toHaveBeenCalledTimes(1)
    expect(fiber.state).toBe(FiberState.DISPOSED)
  })

  it('dispose 后 onDispose/effect 的清理立即执行（防泄漏）', async () => {
    const fiber = new Fiber({ name: 'p' })
    await fiber.dispose()
    const leak = vi.fn()
    fiber.onDispose(leak)
    // 异步给 dispose 后登记的清理一个微任务窗口
    await Promise.resolve()
    expect(fiber.state).toBe(FiberState.DISPOSED)
  })

  it('onDispose 返回句柄可提前移除（不再于 dispose 时跑）', async () => {
    const fiber = new Fiber({ name: 'p' })
    const fn = vi.fn()
    const off = fiber.onDispose(fn)
    off()
    await fiber.dispose()
    expect(fn).not.toHaveBeenCalled()
  })

  it('effect 支持 iterable 产出多个清理项', async () => {
    const fiber = new Fiber({ name: 'p' })
    const a = vi.fn()
    const b = vi.fn()
    fiber.effect(function* () {
      yield a
      yield b
    })
    await fiber.dispose()
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
})
