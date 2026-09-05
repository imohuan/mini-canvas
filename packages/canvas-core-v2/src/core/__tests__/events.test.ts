import { describe, it, expect, vi } from 'vitest'
import { EventBus, isBailed } from '../EventBus'

describe('EventBus 分发模式（cordis ch4）', () => {
  it('emit 同步广播，忽略返回值', () => {
    const bus = new EventBus()
    const a = vi.fn((x: number) => x + 100)
    const b = vi.fn()
    bus.on('e', a)
    bus.on('e', b)
    bus.emit('e', 1, 2)
    expect(a).toHaveBeenCalledWith(1, 2)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('parallel 并发跑所有监听并等待；有拒绝抛 AggregateError', async () => {
    const bus = new EventBus()
    const order: string[] = []
    bus.on('e', async () => {
      await new Promise((r) => setTimeout(r, 10))
      order.push('slow')
    })
    bus.on('e', () => {
      order.push('fast')
    })
    await bus.parallel('e')
    expect(order).toEqual(['fast', 'slow']) // fast 先完成，但都等齐

    bus.on('boom', async () => {
      throw new Error('rejected')
    })
    await expect(bus.parallel('boom')).rejects.toMatchObject({ errors: [{ message: 'rejected' }] })
  })

  it('serial 顺序 await，第一个 bail 值(non-null/false/undefined)胜出并停止', async () => {
    const bus = new EventBus()
    const calls: string[] = []
    bus.on('e', async () => {
      calls.push('first')
      return undefined // 不 bail
    })
    bus.on('e', async () => {
      calls.push('second')
      return 'STOP'
    })
    bus.on('e', () => {
      calls.push('third') // 不应被调用
    })
    const result = await bus.serial('e')
    expect(result).toBe('STOP')
    expect(calls).toEqual(['first', 'second'])
  })

  it('bail 同步短路（serial 的同步版）', () => {
    const bus = new EventBus()
    const calls: string[] = []
    bus.on('e', () => {
      calls.push('a')
      return false // 不 bail
    })
    bus.on('e', () => {
      calls.push('b')
      return 42
    })
    bus.on('e', () => {
      calls.push('c')
    })
    const result = bus.bail('e')
    expect(result).toBe(42)
    expect(calls).toEqual(['a', 'b'])
  })

  it('waterfall 中间件环绕；短路(不调 next)否决下游', async () => {
    const bus = new EventBus()
    // 内层默认行为：返回原样
    const inner = (s: string) => `default:${s}`
    // 监听1：把下游结果转大写（包外层）
    bus.on('demo', (input: string, next: () => string) => {
      const downstream = next()
      return downstream.toUpperCase()
    })
    // 监听2：含 blocked 则短路（不调 next → 否决下游默认）
    bus.on('demo', (input: string, next: () => string) => {
      if (input.includes('blocked')) return '** BLOCKED **'
      return next()
    })
    const r1 = bus.waterfall('demo', 'hello', inner)
    const r2 = bus.waterfall('demo', 'blocked words', inner)
    // hello: 监听1→监听2→inner(default:hello)→监听2 next 返回→监听1 转大写 = "DEFAULT:HELLO"
    expect(r1).toBe('DEFAULT:HELLO')
    // blocked: 监听1→监听2 短路返回 ** BLOCKED **（inner 从未运行）→监听1 转大写
    expect(r2).toBe('** BLOCKED **')
  })
})

describe('EventBus isBailed', () => {
  it('null/false/undefined 不 bail；其它值 bail', () => {
    expect(isBailed(null)).toBe(false)
    expect(isBailed(false)).toBe(false)
    expect(isBailed(undefined)).toBe(false)
    expect(isBailed(0)).toBe(true)
    expect(isBailed('')).toBe(true)
    expect(isBailed('x')).toBe(true)
    expect(isBailed({})).toBe(true)
  })
})
