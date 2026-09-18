/**
 * 核心插件标识 core（设计文档 §十一 决策 1）—— kernel 侧验收。
 *
 * 决策要求：被 `core: true` 标记的插件**拒绝动态卸载**。语义边界必须精确到"一次副作用都不产生"：
 * 不 dispose fiber、不发 `ctx:plugin-uninstalled`、不触发 `retractUnsatisfiedActives`（依赖方不被
 * 连带回退 PENDING）。而 `ctx.stop()` / `stopAsync()` **不拦** —— 整体生命周期终结不是动态卸载。
 *
 * 本文件逐条对号设计文档 §决策 1 末尾的六条验收用例（对号见每个 describe 标题）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import { Service } from '../service'
import type { PluginModule, PluginScope } from '../types'
import { FiberState } from '../fiber'

describe('决策 1-① 核心插件拒卸：名字还在、fiber 仍 active、服务仍可用', () => {
  it('uninstallPlugin(核心插件) 返回 false 且四件事一件都没发生', async () => {
    const ctx = new Context()
    const events: string[] = []
    ctx.plugin({ name: 'canvas-base', core: true, apply(c: PluginScope) { c.inject('doc', { v: 1 }) } })
    await ctx.start()
    ctx.on('ctx:plugin-uninstalled', ({ name }) => events.push('uninstalled:' + name))

    expect(ctx.uninstallPlugin('canvas-base')).toBe(false)

    // ① 名字仍在列表 ② fiber 仍 active ③ 它提供的服务仍可用
    expect(ctx.listPlugins()).toContain('canvas-base')
    expect(ctx.fiber('canvas-base')?.state).toBe(FiberState.ACTIVE)
    expect(ctx.get<{ v: number }>('doc').v).toBe(1)
    // ④ 一个事件都没发（未遂卸载不留痕）
    expect(events).toEqual([])
    ctx.stop()
  })
})

describe('决策 1-② 核心插件的 ctx.effect 清理：未遂卸载后一次都没跑；stop 后正常跑一次', () => {
  it('未遂卸载不跑 disposer；ctx.stop() 时跑恰好一次', async () => {
    const ctx = new Context()
    let cleaned = 0
    ctx.plugin({
      name: 'core-with-effect',
      core: true,
      apply(c: PluginScope) {
        c.effect(() => () => {
          cleaned += 1
        })
      },
    })
    await ctx.start()

    ctx.uninstallPlugin('core-with-effect')
    expect(cleaned).toBe(0) // 未遂卸载：清理一次都没跑

    ctx.stop() // 整体终结不拦 → 正常回收
    expect(cleaned).toBe(1) // 恰好一次（不重复）
  })
})

describe('决策 1-③ 普通插件照常卸得掉（守卫不能误伤）', () => {
  it('普通插件返回 true、服务消失、名字移出', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'plain', apply(c: PluginScope) { c.inject('plainSvc', { ok: 1 }) } })
    ctx.plugin({ name: 'core-sibling', core: true, apply(c: PluginScope) { c.inject('coreSvc', { ok: 2 }) } })
    await ctx.start()

    expect(ctx.uninstallPlugin('plain')).toBe(true)
    expect(ctx.get('plainSvc')).toBeUndefined()
    expect(ctx.listPlugins()).not.toContain('plain')
    // 同一次运行里有核心插件，也不能误伤普通插件的卸载
    expect(ctx.listPlugins()).toContain('core-sibling')
    ctx.stop()
  })
})

describe('决策 1-④ 依赖核心插件的消费方：未被连带回退 PENDING', () => {
  it('未遂卸载后消费方仍 active、missingDeps 空、事件照常收到', async () => {
    const ctx = new Context()
    let hits = 0
    ctx.plugin({ name: 'canvas-base', core: true, apply(c: PluginScope) { c.inject('doc', { ok: 1 }) } })
    ctx.plugin({ name: 'consumer', inject: ['doc'], apply(c: PluginScope) { c.on('ping', () => { hits += 1 }) } })
    await ctx.start()

    expect(ctx.inspectPlugins().find((p) => p.name === 'consumer')?.state).toBe('active')
    ctx.emit('ping')
    expect(hits).toBe(1)

    expect(ctx.uninstallPlugin('canvas-base')).toBe(false)

    // 消费方没被回退：仍 active、missingDeps 空、订阅仍在（事件照常收）
    const st = ctx.inspectPlugins().find((p) => p.name === 'consumer')!
    expect(st.state).toBe('active')
    expect(st.missingDeps).toEqual([])
    ctx.emit('ping')
    expect(hits).toBe(2)
    ctx.stop()
  })

  it('对照：普通提供方被真卸时，消费方确实会被回退 PENDING（守卫没把机制改坏）', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'provider', apply(c: PluginScope) { c.inject('svc', { ok: 1 }) } })
    ctx.plugin({ name: 'consumer', inject: ['svc'], apply() {} })
    await ctx.start()
    expect(ctx.uninstallPlugin('provider')).toBe(true)
    expect(ctx.inspectPlugins().find((p) => p.name === 'consumer')?.state).toBe('pending')
    ctx.stop()
  })
})

describe('决策 1-⑤ 类形态 static core = true 同样拒卸（先断言它真装上了）', () => {
  it('Service 子类 static core 被 asPluginModule 透传，且确实在运行', async () => {
    class CoreService extends Service {
      static core = true
      static provide = 'core-svc'
      constructor(c: PluginScope) {
        super(c, 'core-svc')
      }
    }
    const ctx = new Context()
    ctx.plugin(CoreService)
    await ctx.start()

    // 先证明"真装上了"——否则返回 false 可能是"找不到该插件"而非"被拦"，测试会假绿
    expect(ctx.listPlugins()).toContain('core-svc')
    expect(ctx.inspectPlugins().find((p) => p.name === 'core-svc')?.core).toBe(true)
    expect(ctx.get('core-svc')).toBeInstanceOf(CoreService)

    expect(ctx.uninstallPlugin('core-svc')).toBe(false)
    expect(ctx.listPlugins()).toContain('core-svc')
    expect(ctx.get('core-svc')).toBeInstanceOf(CoreService)
    ctx.stop()
  })

  it('类形态没声明 core 时照常卸得掉（透传不误伤）', async () => {
    class PlainService extends Service {
      static provide = 'plain-svc'
      constructor(c: PluginScope) {
        super(c, 'plain-svc')
      }
    }
    const ctx = new Context()
    ctx.plugin(PlainService)
    await ctx.start()
    expect(ctx.inspectPlugins().find((p) => p.name === 'plain-svc')?.core).toBeUndefined()
    expect(ctx.uninstallPlugin('plain-svc')).toBe(true)
    ctx.stop()
  })
})

describe('决策 1-⑥ inspectPlugins().core + canUninstall() 三态', () => {
  it('inspectPlugins 里核心插件带 core: true，普通插件不带该字段', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'canvas-base', core: true, apply() {} })
    ctx.plugin({ name: 'plain', apply() {} })
    await ctx.start()
    expect(ctx.inspectPlugins().find((p) => p.name === 'canvas-base')?.core).toBe(true)
    expect(ctx.inspectPlugins().find((p) => p.name === 'plain')?.core).toBeUndefined()
    ctx.stop()
  })

  it('canUninstall 三态：core / not-found / not-started（外加 ok: true）', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'canvas-base', core: true, apply() {} })
    ctx.plugin({ name: 'plain', apply() {} })

    // 没 start：任何动态卸载都不生效
    expect(ctx.canUninstall('plain')).toEqual({ ok: false, reason: 'not-started' })

    await ctx.start()
    expect(ctx.canUninstall('plain')).toEqual({ ok: true })
    expect(ctx.canUninstall('canvas-base')).toEqual({ ok: false, reason: 'core' })
    expect(ctx.canUninstall('ghost')).toEqual({ ok: false, reason: 'not-found' })

    // 普通插件卸掉之后 → not-found（与"被拦"区分得开）
    ctx.uninstallPlugin('plain')
    expect(ctx.canUninstall('plain')).toEqual({ ok: false, reason: 'not-found' })
    ctx.stop()
  })

  it('stop 之后回到 created：canUninstall 报 not-started（stop 不拦、也不是卸）', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'canvas-base', core: true, apply() {} })
    await ctx.start()
    ctx.stop()
    expect(ctx.canUninstall('canvas-base')).toEqual({ ok: false, reason: 'not-started' })
  })
})

describe('决策 1 边界：core 不挡整体生命周期终结，也不挡"重装同名"', () => {
  it('stopAsync() 正常回收核心插件（页面关闭时必须能收）', async () => {
    const ctx = new Context()
    let cleaned = 0
    ctx.plugin({ name: 'canvas-base', core: true, apply(c: PluginScope) { c.effect(() => () => { cleaned += 1 }) } })
    await ctx.start()
    await ctx.stopAsync()
    expect(cleaned).toBe(1)
    expect(ctx.getState()).toBe('created')
    expect(ctx.listPlugins()).toEqual([])
  })

  it('stop 后核心标识一并清空：同一 ctx 重启并装普通同名插件不再被拦', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'canvas-base', core: true, apply() {} })
    await ctx.start()
    ctx.stop()
    ctx.plugin({ name: 'canvas-base', apply() {} }) // 这次不声明 core
    await ctx.start()
    expect(ctx.canUninstall('canvas-base')).toEqual({ ok: true })
    expect(ctx.uninstallPlugin('canvas-base')).toBe(true)
    ctx.stop()
  })

  it('core 插件装载失败（setup 抛错）不留核心身份：不被当成 core 拦下（可清理 FAILED fiber）', async () => {
    const ctx = new Context()
    await ctx.start()
    await expect(
      Promise.resolve().then(() =>
        ctx.installPlugin({
          name: 'boom',
          core: true,
          apply() {
            throw new Error('bad')
          },
        }),
      ),
    ).rejects.toThrow(/bad/)
    // 装载失败＝已不在 runtime，核心身份一并撤销：不能留下"核心"身份占着拦截位
    // （否则重装成普通插件会被误拦）。FAILED fiber 仍保留供诊断，故可被清理。
    expect(ctx.inspectPlugins().find((p) => p.name === 'boom')?.core).toBeUndefined()
    expect(ctx.canUninstall('boom')).toEqual({ ok: true })
    expect(ctx.uninstallPlugin('boom')).toBe(true)
    ctx.stop()
  })

  it('ctx.stop() 之后再 start，核心插件可再次装载且仍拒卸', async () => {
    const mod: PluginModule = { name: 'canvas-base', core: true, apply() {} }
    const ctx = new Context()
    ctx.plugin(mod)
    await ctx.start()
    expect(ctx.uninstallPlugin('canvas-base')).toBe(false)
    ctx.stop()
    ctx.plugin(mod)
    await ctx.start()
    expect(ctx.canUninstall('canvas-base')).toEqual({ ok: false, reason: 'core' })
    ctx.stop()
  })
})
