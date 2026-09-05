import { describe, it, expect, vi } from 'vitest'
import { Context } from '../Context'
import type { PluginModule, PluginScope } from '../types'

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

  it('get 缺服务返 undefined（cordis 可选探测：不抛、插件照跑）', async () => {
    const ctx = new Context()
    ctx.plugin(
      mkPlugin('consumer', [], (c) => {
        expect(c.get('missing-service')).toBeUndefined()
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
    expect(ctx.get('shouldRollback')).toBeUndefined()
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
    expect(ctx.get('svc')).toBeUndefined()
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
    expect(ctx.get('v')).toBeUndefined()
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

describe('P1 fiber 集成（ctx.fiber 句柄 + 生命周期状态推进）', () => {
  it('冷启动 plugin() 建 PENDING fiber；start 后置 ACTIVE', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'a', inject: ['nodeStore'], apply: () => {} })
    ctx.inject('nodeStore', {} as never)
    expect(ctx.fiber('a')?.stateName).toBe('pending')
    expect(ctx.fiber('a')?.deps).toEqual(['nodeStore'])
    await ctx.start()
    expect(ctx.fiber('a')?.stateName).toBe('active')
  })

  it('installPlugin 热装后 fiber 置 ACTIVE', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.installPlugin({ name: 'hot', apply: () => {} })
    expect(ctx.fiber('hot')?.stateName).toBe('active')
  })

  it('setup 抛错 → fiber 置 FAILED（保留供诊断，可重装复用）', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'bad',
      apply() {
        throw new Error('boom')
      },
    })
    await expect(ctx.start()).rejects.toThrow(/boom/)
    expect(ctx.fiber('bad')?.stateName).toBe('failed')
    // 重装同 name 复用 fiber：换成功实现后转 ACTIVE
    ctx.uninstallPlugin('bad')
    ctx.installPlugin({ name: 'bad', apply: () => {} })
    expect(ctx.fiber('bad')?.stateName).toBe('active')
  })

  it('uninstallPlugin 后 fiber 移除；fiber() 返回 undefined', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.installPlugin({ name: 'p', apply: () => {} })
    ctx.uninstallPlugin('p')
    expect(ctx.fiber('p')).toBeUndefined()
  })

  it('stop 后 fiber 全清（可重 start）', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'a', apply: () => {} })
    await ctx.start()
    expect(ctx.fiber('a')?.stateName).toBe('active')
    ctx.stop()
    expect(ctx.fiber('a')).toBeUndefined()
  })
})

describe('P2b inject 服务依赖 PENDING 编排', () => {
  it('inject 引用"服务名"由同批插件提供：提供方先激活，消费方随后激活（顺序无关）', async () => {
    const ctx = new Context()
    const order: string[] = []
    // 故意消费方先登记、提供方后登记，验证不是靠 topo 文件顺序而是依赖满足
    ctx.plugin({
      name: 'consumer',
      inject: ['greeter'],
      apply(c: PluginScope) {
        order.push('consumer')
        expect(c.get<{ greet(x: string): string }>('greeter').greet('world')).toBe('hi world')
      },
    })
    ctx.plugin({
      name: 'greeter-plugin',
      apply(c: PluginScope) {
        order.push('greeter-plugin')
        c.provide('greeter', { greet: (x: string) => `hi ${x}` })
      },
    })
    await ctx.start()
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(ctx.fiber('greeter-plugin')?.stateName).toBe('active')
    // 消费方在提供方激活之后才跑
    expect(order).toEqual(['greeter-plugin', 'consumer'])
  })

  it('冷启动缺提供方 → 消费方停留 PENDING（不抛），不阻塞 ctx:ready', async () => {
    const ctx = new Context()
    const consumerRan = vi.fn()
    ctx.plugin({
      name: 'consumer',
      inject: ['missing-svc'],
      apply: consumerRan,
    })
    await expect(ctx.start()).resolves.toBeUndefined()
    expect(ctx.fiber('consumer')?.stateName).toBe('pending')
    expect(consumerRan).not.toHaveBeenCalled()
  })

  it('热装提供方后唤醒 PENDING 消费方', async () => {
    const ctx = new Context()
    const consumerRan = vi.fn()
    ctx.plugin({ name: 'consumer', inject: ['late-svc'], apply: consumerRan })
    await ctx.start()
    expect(ctx.fiber('consumer')?.stateName).toBe('pending')
    // 运行中装提供方 → 其 provide 触发 wakePending → consumer 激活
    ctx.installPlugin({
      name: 'provider',
      apply(c: PluginScope) {
        c.provide('late-svc', {})
      },
    })
    expect(ctx.fiber('provider')?.stateName).toBe('active')
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(consumerRan).toHaveBeenCalledTimes(1)
  })

  it('同批两服务连锁依赖：A 依赖 B 的服务，B 依赖 C 的服务', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.plugin({
      name: 'a',
      inject: ['svc-b'],
      apply(c: PluginScope) {
        order.push('a')
        expect(c.get('svc-b')).toBeDefined()
      },
    })
    ctx.plugin({
      name: 'b',
      inject: ['svc-c'],
      apply(c: PluginScope) {
        order.push('b')
        c.provide('svc-b', {})
      },
    })
    ctx.plugin({
      name: 'c',
      apply(c: PluginScope) {
        order.push('c')
        c.provide('svc-c', {})
      },
    })
    await ctx.start()
    expect(order).toEqual(['c', 'b', 'a'])
    expect(ctx.fiber('a')?.stateName).toBe('active')
  })
})

describe('P3 事件分发（cordis ch4：多参事件 + parallel/serial/bail/waterfall + 自动回收）', () => {
  it('插件用 ctx.on 监听多参事件 + ctx.emit 广播', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.plugin({
      name: 'reporter',
      apply(c: PluginScope) {
        c.on('stats/report', (name: string, count: number) => seen.push(`${name}:${count}`))
      },
    })
    await ctx.start()
    ctx.emit('stats/report', 'tool', 1)
    ctx.emit('stats/report', 'tool', 2)
    expect(seen).toEqual(['tool:1', 'tool:2'])
  })

  it('ctx.serial：第一个 bail 值胜出并停止', async () => {
    const ctx = new Context()
    const calls: string[] = []
    ctx.plugin({
      name: 'svc',
      apply(c: PluginScope) {
        c.on('approve', () => {
          calls.push('a')
          return undefined
        })
        c.on('approve', () => {
          calls.push('b')
          return 'granted'
        })
        c.on('approve', () => calls.push('c'))
      },
    })
    await ctx.start()
    const result = await ctx.serial('approve')
    expect(result).toBe('granted')
    expect(calls).toEqual(['a', 'b'])
  })

  it('ctx.bail 同步短路', async () => {
    const ctx = new Context()
    const calls: string[] = []
    ctx.plugin({
      name: 'svc',
      apply(c: PluginScope) {
        c.on('pick', () => {
          calls.push('a')
          return null
        })
        c.on('pick', () => {
          calls.push('b')
          return 'second'
        })
      },
    })
    await ctx.start()
    expect(ctx.bail('pick')).toBe('second')
    expect(calls).toEqual(['a', 'b'])
  })

  it('插件卸载后其 ctx.on 监听自动移除（自动回收）', async () => {
    const ctx = new Context()
    const fired: string[] = []
    ctx.plugin({
      name: 'listener-a',
      apply(c: PluginScope) {
        c.on('ping', () => fired.push('a'))
      },
    })
    ctx.plugin({
      name: 'listener-b',
      apply(c: PluginScope) {
        c.on('ping', () => fired.push('b'))
      },
    })
    await ctx.start()
    ctx.emit('ping')
    expect(fired).toEqual(['a', 'b'])
    fired.length = 0
    ctx.uninstallPlugin('listener-a')
    ctx.emit('ping')
    expect(fired).toEqual(['b']) // a 的监听已随卸载移除
  })
})

describe('P5 inspectPlugins：fiber 状态可查 + PENDING 缺依赖诊断（只读视图）', () => {
  it('正常冷启动后：ACTIVE 插件全部上报，state=active 且 missingDeps 空', async () => {
    const ctx = new Context()
    ctx.inject('nodeStore', {} as never)
    ctx.plugin({ name: 'a', inject: ['nodeStore'], apply: () => {} })
    ctx.plugin({ name: 'b', apply: () => {} })
    await ctx.start()
    const byName = new Map(ctx.inspectPlugins().map((s) => [s.name, s]))
    expect(byName.get('a')).toMatchObject({ state: 'active', missingDeps: [] })
    expect(byName.get('b')).toMatchObject({ state: 'active', missingDeps: [] })
  })

  it('靠 inject 引用缺提供方的服务 → 停留 PENDING 且 missingDeps 报出缺的服务名', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'consumer', inject: ['missing-svc'], apply: () => {} })
    await ctx.start()
    const s = ctx.inspectPlugins().find((x) => x.name === 'consumer')
    expect(s).toMatchObject({ state: 'pending', missingDeps: ['missing-svc'] })
  })

  it('区分"缺服务"与"等插件(依赖它、它自身 PENDING)"两种 PENDING', async () => {
    const ctx = new Context()
    // consumer 依赖插件 provider；provider 自身缺服务 → 停留 PENDING
    ctx.plugin({ name: 'consumer', inject: ['provider'], apply: () => {} })
    ctx.plugin({ name: 'provider', inject: ['missing-svc'], apply: () => {} })
    await ctx.start()
    const byName = new Map(ctx.inspectPlugins().map((s) => [s.name, s]))
    // consumer：缺的是"provider"（已登记但未 ACTIVE → 不满足），而非不存在的服务
    expect(byName.get('consumer')).toMatchObject({ state: 'pending', missingDeps: ['provider'] })
    // provider：缺的是真正未上架的服务
    expect(byName.get('provider')).toMatchObject({ state: 'pending', missingDeps: ['missing-svc'] })
  })

  it('FAILED(apply 抛错) 插件：从 plugins 表移出但仍上报，带 error message', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'bad', apply() { throw new Error('boom-config') } })
    await expect(ctx.start()).rejects.toThrow(/boom-config/)
    // 已不在可装载表
    expect(ctx.listPlugins()).not.toContain('bad')
    // 但 inspectPlugins 仍能看到 FAILED + error
    const s = ctx.inspectPlugins().find((x) => x.name === 'bad')
    expect(s).toMatchObject({ state: 'failed', error: 'boom-config' })
  })
})

describe('P6/P2b2 提供方被卸/换，依赖方随之回退 PENDING 并在服务恢复后自动重载（cordis inject 非一次性）', () => {
  it('① 依赖"服务名"：卸提供方 → 依赖方副作用回收并回退 pending；重装 → 依赖方自动重载(apply 再跑)', async () => {
    const ctx = new Context()
    await ctx.start()
    const cleanup = vi.fn()
    let consumerRuns = 0
    // consumer 先装（provider 未装 → 因缺 data-svc 停留 PENDING，apply 未跑）
    ctx.installPlugin({
      name: 'consumer',
      inject: ['data-svc'],
      apply(c: any) {
        consumerRuns++
        expect(c.get('data-svc')).toBeDefined()
        c.effect(() => cleanup)
      },
    })
    expect(ctx.fiber('consumer')?.stateName).toBe('pending')
    expect(consumerRuns).toBe(0)
    // 装提供方 → wakePending → consumer 激活
    ctx.installPlugin({ name: 'provider', apply(c: any) { c.provide('data-svc', { n: 1 }) } })
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(consumerRuns).toBe(1)
    // 卸提供方 → consumer 副作用回收 + fiber 回退 pending + 服务摘除
    expect(ctx.uninstallPlugin('provider')).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(ctx.fiber('consumer')?.stateName).toBe('pending')
    expect(ctx.get('data-svc')).toBeUndefined()
    // 重装提供方 → wakePending → consumer 自动重载（apply 又跑）
    ctx.installPlugin({ name: 'provider', apply(c: any) { c.provide('data-svc', { n: 2 }) } })
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(consumerRuns).toBe(2)
    expect(ctx.get<{ n: number }>('data-svc').n).toBe(2)
  })

  it('② 提供方"换版本"(reload = 先卸后装同 name)：依赖方跟下(pending)再跟上(读到新实现)', async () => {
    const ctx = new Context()
    await ctx.start()
    let consumerRuns = 0
    const mkProvider = (v: number) => ({
      name: 'prov',
      apply(c: any) { c.provide('svc', { v }) },
    })
    ctx.installPlugin({ name: 'consumer', inject: ['svc'], apply(c: any) { consumerRuns++; expect(c.get('svc')).toBeDefined() } })
    ctx.installPlugin(mkProvider(1))
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(consumerRuns).toBe(1)
    // reload：卸旧版本 → consumer 随之 pending；装新版本 → consumer 自动重载并读到 v=2
    ctx.uninstallPlugin('prov')
    expect(ctx.fiber('consumer')?.stateName).toBe('pending')
    expect(ctx.fiber('prov')).toBeUndefined()
    ctx.installPlugin(mkProvider(2))
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(consumerRuns).toBe(2)
    expect(ctx.get<{ v: number }>('svc').v).toBe(2)
    expect(ctx.listPlugins()).toContain('consumer')
  })

  it('③ 依赖"插件名"(inject 其名而非服务名)：同样跟随卸载/重装', async () => {
    const ctx = new Context()
    await ctx.start()
    let consumerRuns = 0
    const mkProvider = () => ({ name: 'dep-plugin', apply() {} })
    ctx.installPlugin({ name: 'consumer', inject: ['dep-plugin'], apply() { consumerRuns++ } })
    ctx.installPlugin(mkProvider())
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(consumerRuns).toBe(1)
    // 卸依赖的插件本身 → consumer 也回退（其 dep 名从 plugins 表消失）
    ctx.uninstallPlugin('dep-plugin')
    expect(ctx.fiber('consumer')?.stateName).toBe('pending')
    // 重装 → consumer 自动重载
    ctx.installPlugin(mkProvider())
    expect(ctx.fiber('consumer')?.stateName).toBe('active')
    expect(consumerRuns).toBe(2)
  })

  it('③b 传递链：卸底层提供方 → 依赖方与其下游逐层回退 PENDING；恢复后整链自动重载', async () => {
    const ctx = new Context()
    await ctx.start()
    let midRuns = 0
    let leafRuns = 0
    // leaf 依赖 mid 的服务；mid 依赖 base 的服务
    ctx.installPlugin({ name: 'leaf', inject: ['mid-svc'], apply() { leafRuns++ } })
    ctx.installPlugin({ name: 'mid', inject: ['base-svc'], apply(c: any) { midRuns++; c.provide('mid-svc', {}) } })
    ctx.installPlugin({ name: 'base', apply(c: any) { c.provide('base-svc', {}) } })
    expect(ctx.fiber('leaf')?.stateName).toBe('active')
    expect(ctx.fiber('mid')?.stateName).toBe('active')
    expect(midRuns).toBe(1)
    expect(leafRuns).toBe(1)
    // 卸 base → mid 回退(连带摘 mid-svc) → 下一轮 leaf 也回退（迭代传递）
    ctx.uninstallPlugin('base')
    expect(ctx.fiber('mid')?.stateName).toBe('pending')
    expect(ctx.fiber('leaf')?.stateName).toBe('pending')
    // 恢复 base → 整链按依赖序重载
    ctx.installPlugin({ name: 'base', apply(c: any) { c.provide('base-svc', {}) } })
    expect(ctx.fiber('mid')?.stateName).toBe('active')
    expect(ctx.fiber('leaf')?.stateName).toBe('active')
    expect(midRuns).toBe(2)
    expect(leafRuns).toBe(2)
  })

  it('④ ctx.get 可选依赖：无提供方时 get("x") 返 undefined 且插件照常 apply 运行', async () => {
    const ctx = new Context()
    await ctx.start()
    const ran = vi.fn()
    ctx.installPlugin({
      name: 'optional-user',
      apply(c: any) {
        ran()
        expect(c.get('maybe-svc')).toBeUndefined() // 无提供方 → undefined，不抛
      },
    })
    expect(ran).toHaveBeenCalledTimes(1)
    expect(ctx.fiber('optional-user')?.stateName).toBe('active')
    // 之后补上提供方也不影响已激活的可选消费方（它没 inject 硬依赖）
    ctx.installPlugin({ name: 'opt-provider', apply(c: any) { c.provide('maybe-svc', {}) } })
    expect(ctx.fiber('optional-user')?.stateName).toBe('active')
    expect(ran).toHaveBeenCalledTimes(1)
  })
})
