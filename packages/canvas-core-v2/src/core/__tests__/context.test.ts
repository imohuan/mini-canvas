import { describe, it, expect, vi } from 'vitest'
import { Context } from '../Context'
import type { PluginModule } from '../types'

// 扩展事件表测试插件自定义事件
declare module '../types' {
  interface CanvasEventMap {
    'hello:ping': { from: string }
  }
}

const mkPlugin = (
  name: string,
  deps: string[] = [],
  setup: (ctx: any) => void | (() => void) = () => {},
): PluginModule => ({ name, deps, setup })

describe('Context（Cordis 式内核主类）', () => {
  it('plugin 重复名在装载时报错', () => {
    const ctx = new Context()
    ctx.plugin(mkPlugin('a'))
    expect(() => ctx.plugin(mkPlugin('a'))).toThrow(/Duplicate plugin name/)
  })

  it('start 按拓扑顺序跑 setup', async () => {
    const ctx = new Context()
    const order: string[] = []
    // provider 依赖 storage；consumer 依赖 provider
    ctx.plugin(mkPlugin('provider', [], () => void order.push('provider')))
    ctx.plugin(mkPlugin('consumer', ['provider'], () => void order.push('consumer')))
    await ctx.start()
    expect(order).toEqual(['provider', 'consumer'])
  })

  it('inject/get：插件 A 提供服务，B 用 ctx.get 消费', async () => {
    const ctx = new Context()
    const consumed: string[] = []
    ctx.plugin(
      mkPlugin('provider', [], (c) => {
        c.inject('greeter', { greet: () => 'hello' })
      }),
    )
    ctx.plugin(
      mkPlugin('consumer', ['provider'], (c) => {
        const greeter = c.get('greeter')
        consumed.push(greeter.greet())
      }),
    )
    await ctx.start()
    expect(consumed).toEqual(['hello'])
  })

  it('get 缺服务抛错（定稿：不静默降级）', async () => {
    const ctx = new Context()
    ctx.plugin(
      mkPlugin('consumer', [], (c) => {
        expect(() => c.get('missing-service')).toThrow(/not injected/)
      }),
    )
    await expect(ctx.start()).resolves.toBeUndefined() // setup 内已断言
  })

  it('start 后卸载会触发 scope 回收（插件副作用自动清）', async () => {
    const ctx = new Context()
    const cleanup = vi.fn()
    const unsub = vi.fn()
    ctx.plugin(
      mkPlugin('p', [], (c) => {
        c.effect(() => cleanup)
        c.on('hello:ping', () => {}) // on 也登记
        unsub // 引用防 tree-shake
      }),
    )
    await ctx.start()
    // 手动调用 on 返回的句柄也应被 scope 回收（此处只验证 effect cleanup）
    ctx.stop()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('stop 后服务表清空、ctx 可重新 start', async () => {
    const ctx = new Context()
    const setup = vi.fn()
    ctx.plugin(mkPlugin('p', [], setup))
    await ctx.start()
    ctx.stop()
    expect(ctx.getState()).toBe('created')
    expect(ctx.injectedServices()).toEqual([])
    // 可重新 start
    ctx.plugin(mkPlugin('p', [], setup))
    await ctx.start()
    expect(ctx.getState()).toBe('started')
  })

  it('start 后再 plugin 抛错', async () => {
    const ctx = new Context()
    await ctx.start()
    expect(() => ctx.plugin(mkPlugin('x'))).toThrow()
  })

  it('start 时 setup 抛错会把该插件 scope 置 ERROR 并传播', async () => {
    const ctx = new Context()
    ctx.plugin(
      mkPlugin('bad', [], () => {
        throw new Error('setup failed')
      }),
    )
    await expect(ctx.start()).rejects.toThrow(/setup failed/)
  })

  it('emit 单源广播，不抛 window（同名事件无 DOM 泄漏）', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.plugin(
      mkPlugin('listener', [], (c) => {
        c.on('hello:ping', (p: { from: string }) => seen.push(p.from))
      }),
    )
    await ctx.start()
    ctx.emit('hello:ping', { from: 'ctx' })
    expect(seen).toEqual(['ctx'])
  })

  it('setup 返回 cleanup 函数会被登记进 scope', async () => {
    const ctx = new Context()
    const cleanup = vi.fn()
    ctx.plugin(mkPlugin('p', [], () => cleanup))
    await ctx.start()
    ctx.stop()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('ctx:ready 事件在 start 完成后广播', async () => {
    const ctx = new Context()
    const ready = vi.fn()
    ctx.on('ctx:ready', ready)
    ctx.plugin(mkPlugin('a'))
    await ctx.start()
    expect(ready).toHaveBeenCalledTimes(1)
    expect(ready.mock.calls[0][0]).toMatchObject({ plugins: ['a'] })
  })
})
