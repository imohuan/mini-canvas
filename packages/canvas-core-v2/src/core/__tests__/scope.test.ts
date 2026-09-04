import { describe, it, expect, vi } from 'vitest'
import { Scope } from '../Scope'

describe('Scope（作用域回收 —— v2 核心增量）', () => {
  it('onDispose 登记的清理在 dispose() 时执行', () => {
    const scope = new Scope()
    const cleanup = vi.fn()
    scope.onDispose(cleanup)
    expect(cleanup).not.toHaveBeenCalled()
    scope.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('LIFO 逆序执行（后登记的先清理）', () => {
    const scope = new Scope()
    const order: string[] = []
    scope.onDispose(() => order.push('first'))
    scope.onDispose(() => order.push('second'))
    scope.dispose()
    expect(order).toEqual(['second', 'first'])
  })

  it('dispose 幂等：重复调用只清一次', () => {
    const scope = new Scope()
    const cleanup = vi.fn()
    scope.onDispose(cleanup)
    scope.dispose()
    scope.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('子作用域先于父释放', () => {
    const parent = new Scope()
    const order: string[] = []
    const child = parent.child()
    parent.onDispose(() => order.push('parent'))
    child.onDispose(() => order.push('child'))
    parent.dispose()
    expect(order).toEqual(['child', 'parent'])
  })

  it('effect：fn 返回的 cleanup 自动登记；timer 可被回收', () => {
    const scope = new Scope()
    const clear = vi.fn()
    scope.effect(() => {
      // 模拟 setInterval
      return () => clear()
    })
    scope.dispose()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('单个清理抛错不阻断其余', () => {
    const scope = new Scope()
    const bomb = vi.fn(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    scope.onDispose(bomb)
    scope.onDispose(ok)
    expect(() => scope.dispose()).not.toThrow()
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('onDispose 返回的句柄可提前取消登记', () => {
    const scope = new Scope()
    const cleanup = vi.fn()
    const off = scope.onDispose(cleanup)
    off()
    scope.dispose()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('isDisposed 在 dispose 后为 true', () => {
    const scope = new Scope()
    expect(scope.isDisposed).toBe(false)
    scope.dispose()
    expect(scope.isDisposed).toBe(true)
  })

  it('dispose 后再 onDispose 会立即执行（防泄漏）', () => {
    const scope = new Scope()
    scope.dispose()
    const cleanup = vi.fn()
    scope.onDispose(cleanup)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
