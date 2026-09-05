import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import { Service } from '../service'
import type { PluginScope } from '../types'

// ===== 类型层声明合并（能力② Context.greeter + 能力③ Events）：tsc -p 编译本文件会校验 =====
declare module '../types' {
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}
declare module '../Context' {
  interface Context {
    greeter: GreeterService
  }
}

// ==================== 能力①：类插件直接 ctx.plugin(MyService) 装载 ====================

/** cordis 03 原文：Service 子类即插件，构造 super(ctx,name) 上架服务 */
class GreeterService extends Service {
  static inject = [] as string[]
  constructor(ctx: PluginScope) {
    super(ctx, 'greeter')
  }
  greet(who: string) {
    return `Hello, ${who}!`
  }
}

function consumerPlugin() {
  return {
    name: 'consumer',
    inject: ['greeter'] as string[],
    apply(c: PluginScope) {
      // 能力②：inject 到齐后 ctx.greeter 运行时直访等价 ctx.get('greeter')
      const direct = (c as unknown as { greeter: GreeterService }).greeter
      expect(direct.greet('world')).toBe('Hello, world!')
      expect(c.get<GreeterService>('greeter').greet('world')).toBe('Hello, world!')
    },
  }
}

describe('能力① 类插件直接 ctx.plugin(类)/installPlugin(类) 装载（cordis 03）', () => {
  it('冷启动 ctx.plugin(类)：归一成插件、构造即上架服务，consumer inject 等到后 ctx.greeter 可用', async () => {
    const ctx = new Context()
    ctx.plugin(GreeterService) // 冷启动直接传类
    ctx.plugin(consumerPlugin())
    await ctx.start()
    expect(ctx.fiber('GreeterService')?.stateName).toBe('active')
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(ctx.get<GreeterService>('greeter').greet('x')).toBe('Hello, x!')
  })

  it('运行中 ctx.installPlugin(类) 热装 → ACTIVE+服务上架；卸载后服务随 scope 移除', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.installPlugin(GreeterService)
    expect(ctx.fiber('GreeterService')?.stateName).toBe('active')
    expect(ctx.get('greeter')).toBeInstanceOf(GreeterService)
    expect(ctx.uninstallPlugin('GreeterService')).toBe(true)
    expect(ctx.get('greeter')).toBeUndefined()
  })

  it('类插件静态 Config 被装配 config 校验（apply/构造收到校验后 config）', async () => {
    let seen: unknown
    class ConfigService extends Service {
      static Config = { times: { type: 'number', default: 1, min: 1, max: 5 } } as const
      constructor(ctx: PluginScope, config?: { times: number }) {
        super(ctx, 'cfgSvc')
        seen = config
      }
    }
    const ctx = new Context()
    await ctx.start()
    ctx.installPlugin(ConfigService, { times: 3 })
    expect(ctx.get<ConfigService>('cfgSvc')).toBeInstanceOf(ConfigService)
    expect(seen).toEqual({ times: 3 })
  })

  it('类插件静态 inject 参与 PENDING：缺提供方停 PENDING，上架后自动激活', async () => {
    class NeedsNodeStore extends Service {
      static inject = ['nodeStore']
      constructor(ctx: PluginScope) {
        super(ctx, 'needy')
        expect(ctx.get('nodeStore')).toBeDefined()
      }
    }
    const ctx = new Context()
    await ctx.start()
    ctx.installPlugin(NeedsNodeStore) // nodeStore 未上架 → PENDING
    expect(ctx.fiber('NeedsNodeStore')?.stateName).toBe('pending')
    ctx.installPlugin({ name: 'store-provider', apply(c: PluginScope) { c.provide('nodeStore', {}) } })
    expect(ctx.fiber('NeedsNodeStore')?.stateName).toBe('active')
    expect(ctx.get('needy')).toBeInstanceOf(NeedsNodeStore)
  })

  it('静态 provide 单串 → 插件名取它；无 provide → 取类名', async () => {
    class NamedByProvide extends Service {
      static provide = 'my-service'
      constructor(ctx: PluginScope) {
        super(ctx)
      }
    }
    const ctx = new Context()
    ctx.plugin(NamedByProvide)
    expect(ctx.listPlugins()).toContain('my-service')
    await ctx.start()
  })

  it('旧写法在 apply 里 new Service(ctx) 仍工作（不回归 service.test 语义）', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'provider',
      apply(c: PluginScope) {
        new GreeterService(c)
      },
    })
    await ctx.start()
    expect(ctx.get('greeter')).toBeInstanceOf(GreeterService)
  })
})

// ==================== 能力②：ctx.greeter 代理直访（运行时） ====================

describe('能力② inject 后 ctx.greeter 属性直访运行时可用（cordis proxy 语义）', () => {
  it('提供方上架服务后，consumer 的 ctx.greeter 与 ctx.get 运行时等价', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.plugin({
      name: 'provider',
      apply(c: PluginScope) {
        c.provide('greeter', { greet: (w: string) => `Hi ${w}` })
      },
    })
    ctx.plugin({
      name: 'consumer2',
      inject: ['greeter'],
      apply(c: PluginScope) {
        const g = (c as unknown as { greeter: { greet(w: string): string } }).greeter
        seen.push(g.greet('world'))
        seen.push(c.get<{ greet(w: string): string }>('greeter').greet('again'))
      },
    })
    await ctx.start()
    expect(seen).toEqual(['Hi world', 'Hi again'])
  })

  it('代理不破坏能力段：nodes/theme/commands/slots/settings 与 on/effect/get 仍可达', async () => {
    const ctx = new Context()
    let caps: string[] = []
    ctx.plugin({
      name: 'caps-user',
      apply(c: PluginScope) {
        caps = ['nodes', 'theme', 'commands', 'slots', 'settings'].filter(
          (k) => typeof (c as unknown as Record<string, unknown>)[k] === 'object',
        )
        expect(typeof c.on).toBe('function')
        expect(typeof c.effect).toBe('function')
        expect(typeof c.get).toBe('function')
      },
    })
    await ctx.start()
    expect(caps.sort()).toEqual(['commands', 'nodes', 'settings', 'slots', 'theme'])
  })

  it('未命中服务名的属性读返回 undefined 不抛（cordis proxy 未注册属性语义）', async () => {
    const ctx = new Context()
    let val: unknown = 'init'
    ctx.plugin({
      name: 'probe',
      apply(c: PluginScope) {
        val = (c as unknown as Record<string, unknown>).definitelyNotAService
      },
    })
    await ctx.start()
    expect(val).toBeUndefined()
  })

  it('内置 slots 能力段可用（register 经代理读得到），ctx.get("slots") 返回底层注册表实例', async () => {
    const ctx = new Context()
    let caps: unknown
    let store: unknown
    ctx.plugin({
      name: 'slots-user',
      apply(c: PluginScope) {
        caps = c.slots
        store = c.get('slots')
      },
    })
    await ctx.start()
    // 代理不破坏能力段：ctx.slots 是带 register/remove/occupants 的收口
    expect(typeof (caps as { register?: unknown }).register).toBe('function')
    // ctx.get('slots') 返回底层 SlotRegistry（内核持久存储实例）
    expect(store).toBeDefined()
  })
})

// ==================== 能力③：Events 声明合并 + 类型化 on/emit ====================

describe('能力③ declare Events 后 ctx.on/ctx.emit 多参类型化且运行时接线', () => {
  it("声明后 ctx.on('stats/report',(name,count)) 收多参、emit 广播命中监听", async () => {
    const ctx = new Context()
    const seen: Array<[string, number]> = []
    ctx.plugin({
      name: 'reporter',
      apply(c: PluginScope) {
        // 类型由 Events['stats/report'] 推导：(name: string, count: number)
        c.on('stats/report', (name, count) => {
          seen.push([name, count])
        })
      },
    })
    await ctx.start()
    ctx.emit('stats/report', 'tool', 1)
    ctx.emit('stats/report', 'tool', 2)
    expect(seen).toEqual([
      ['tool', 1],
      ['tool', 2],
    ])
  })
})

// ===== 类型层强制断言（tsc -p 编译 src 校验；vitest/esbuild 运行期跳过这些函数体） =====
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typed(ctx: Context) {
  // 能力②：增强 Context 后 ctx.greeter 类型为 GreeterService
  ctx.greeter.greet('w')
  // 能力③：on 回调参数已类型化，错类型应报错（@ts-expect-error 证明）
  ctx.on('stats/report', (name, count) => {
    name.toUpperCase()
    count.toFixed()
  })
  ctx.emit('stats/report', 'a', 2)
  // @ts-expect-error emit 参数量应被 Events 约束（少一个 → 编译错）
  ctx.emit('stats/report', 'a')
  // @ts-expect-error on 回调 count 应为 number（这里标 string → 编译错）
  ctx.on('stats/report', (name: string, count: string) => void count)
}
