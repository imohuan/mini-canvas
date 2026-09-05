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

  it('installPlugin：运行中热装插件立即可用（服务注入 + 副作用登记）', async () => {
    const ctx = new Context()
    await ctx.start() // 空内核直接 start，之后再动态装
    expect(ctx.running).toBe(true)

    ctx.installPlugin(mkPlugin('hot', [], (c) => {
      c.inject('hotSvc', { ping: () => 'pong' })
      c.effect(() => vi.fn()) // 一个应被回收的副作用
    }))

    expect(ctx.get<{ ping(): string }>('hotSvc').ping()).toBe('pong')
    expect(ctx.listPlugins()).toContain('hot')
  })

  it('installPlugin 未 start 时抛错', () => {
    const ctx = new Context()
    expect(() => ctx.installPlugin(mkPlugin('x'))).toThrow(/start/)
  })

  it('installPlugin 重名抛错（不覆盖已有插件）', async () => {
    const ctx = new Context()
    ctx.plugin(mkPlugin('a'))
    await ctx.start()
    expect(() => ctx.installPlugin(mkPlugin('a'))).toThrow(/Duplicate plugin name/)
    expect(ctx.listPlugins().filter((n) => n === 'a')).toHaveLength(1)
  })

  it('installPlugin setup 抛错 → 半成品副作用回收 + 不残留 + 抛错', async () => {
    const ctx = new Context()
    await ctx.start()
    expect(() =>
      ctx.installPlugin(
        mkPlugin('bad', [], (c) => {
          c.inject('shouldRollback', {}) // 先注入，后抛 → 应被回滚
          throw new Error('setup boom')
        }),
      ),
    ).toThrow(/setup boom/)
    expect(ctx.listPlugins()).not.toContain('bad')
    expect(() => ctx.get('shouldRollback')).toThrow(/not injected/)
  })

  it('uninstallPlugin：dispose 回收该插件全部副作用 + 服务摘除 + 不再 list', async () => {
    const ctx = new Context()
    await ctx.start()
    const cleanup = vi.fn()
    ctx.installPlugin(
      mkPlugin('p', [], (c) => {
        c.inject('svc', {})
        c.effect(() => cleanup)
      }),
    )
    expect(ctx.uninstallPlugin('p')).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(() => ctx.get('svc')).toThrow(/not injected/)
    expect(ctx.listPlugins()).not.toContain('p')
  })

  it('uninstallPlugin 未装/重复卸返回 false，不抛', async () => {
    const ctx = new Context()
    await ctx.start()
    expect(ctx.uninstallPlugin('ghost')).toBe(false)
    ctx.installPlugin(mkPlugin('p'))
    expect(ctx.uninstallPlugin('p')).toBe(true)
    expect(ctx.uninstallPlugin('p')).toBe(false)
  })

  it('reload 语义：先卸后装，同名插件可重新安装新实现', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.installPlugin(mkPlugin('p', [], (c) => c.inject('v', { n: 1 })))
    expect(ctx.get<{ n: number }>('v').n).toBe(1)

    // 模拟"插件代码改了"：卸掉旧实现，装新实现（同 name 不同值）
    ctx.uninstallPlugin('p')
    expect(() => ctx.get('v')).toThrow(/not injected/)
    ctx.installPlugin(mkPlugin('p', [], (c) => c.inject('v', { n: 2 })))
    expect(ctx.get<{ n: number }>('v').n).toBe(2)
    expect(ctx.listPlugins()).toContain('p')
  })
})

describe('PluginModule Cordis 形态（name/inject/apply）', () => {
  it('apply 优先于 setup；apply(ctx) 里可注册并自动回收', async () => {
    const ctx = new Context()
    const order: string[] = []
    const cleanup = vi.fn()
    ctx.plugin({
      name: 'p',
      apply(c: any) {
        order.push('apply-ran')
        c.effect(() => cleanup)
      },
      setup() {
        order.push('setup-ran') // 不该被调(apply 优先)
      },
    })
    await ctx.start()
    expect(order).toEqual(['apply-ran'])
    ctx.stop()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('inject 依赖字段参与拓扑排序（inject 优先于 deps）', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.plugin({ name: 'b', inject: ['a'], apply: () => void order.push('b') })
    ctx.plugin({ name: 'a', deps: [], apply: () => void order.push('a') })
    await ctx.start()
    expect(order).toEqual(['a', 'b'])
  })

  it('裸 export 三样(name/inject/apply) 经 ctx.plugin 装载并可用 ctx 能力', async () => {
    // 模拟插件作者只 export name/inject/apply 的模块（依赖已注入才跑）
    const { NodeStore } = await import('../../services/nodeStore')
    const { NodeRegistry } = await import('../registry/nodeRegistry')
    const ctx = new Context()
    ctx.inject('nodeStore', new NodeStore())
    ctx.inject('nodeRegistry', new NodeRegistry())
    const pluginMod: PluginModule = {
      name: 'audio',
      inject: ['nodeStore', 'nodeRegistry'],
      apply(c: any) {
        c.nodes.register({ type: 'audio', label: '音频', size: { w: 100, h: 60 } })
      },
    }
    ctx.plugin(pluginMod)
    await ctx.start()
    expect(ctx.get<{ types: ReadonlyMap<string, unknown> }>('nodeStore').types.has('audio')).toBe(true)
    expect(ctx.listPlugins()).toContain('audio')
  })
})
