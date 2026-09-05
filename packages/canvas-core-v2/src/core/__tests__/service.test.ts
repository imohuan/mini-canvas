import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import { Service } from '../service'
import type { PluginScope } from '../types'

// 作者示例：GreeterService 经 apply 上架，消费方 ctx.get 读取
class GreeterService extends Service {
  constructor(ctx: PluginScope) {
    super(ctx, 'greeter')
  }
  greet(who: string) {
    return `Hello, ${who}!`
  }
}

describe('Service 类形态（P2a：提供服务）', () => {
  it('Service 子类在 apply 里 new → ctx.get(name) 可读到并调用其方法', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'greeter-plugin',
      apply(c: PluginScope) {
        new GreeterService(c) // 上架 'greeter'
      },
    })
    ctx.plugin({
      name: 'consumer',
      inject: ['greeter-plugin'],
      apply(c: PluginScope) {
        const g = c.get<GreeterService>('greeter')
        expect(g.greet('world')).toBe('Hello, world!')
      },
    })
    await ctx.start()
    expect(ctx.get<GreeterService>('greeter').greet('world')).toBe('Hello, world!')
  })

  it('Service 随提供插件卸载自动移除（撤销挂插件 scope）', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.installPlugin({
      name: 'svc',
      apply(c: PluginScope) {
        new GreeterService(c)
      },
    })
    expect(ctx.get<GreeterService>('greeter').greet('x')).toBe('Hello, x!')
    ctx.uninstallPlugin('svc')
    expect(ctx.get('greeter')).toBeUndefined()
  })

  it('Service 用静态 provide 作默认名；缺名抛错', () => {
    class StaticNamed extends Service {
      static provide = 'staticName'
      constructor(ctx: PluginScope) {
        super(ctx) // 不传 name，取静态 provide
      }
    }
    const ctx = new Context()
    new StaticNamed(ctx as unknown as PluginScope)
    expect(ctx.get('staticName')).toBeInstanceOf(StaticNamed)

    // 无 name 无静态 provide → 抛
    class NoName extends Service {}
    const ctx2 = new Context()
    expect(() => new NoName(ctx2 as unknown as PluginScope)).toThrow(/name/)
  })

  it('provide 重复名抛错', () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'a',
      apply(c: PluginScope) {
        new GreeterService(c)
        expect(() => new GreeterService(c)).toThrow(/already/)
      },
    })
    return ctx.start()
  })
})
