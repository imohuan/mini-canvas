/**
 * kernel 包自检：证明它是"纯插件框架"——不认识画布。
 *
 * 这些用例锁的是包的**边界**，不是实现细节：
 * 1. 裸 new Context()（不装能力层）只有插件能力：on/effect/inject/get/plugin，没有 ctx.nodes 之类；
 * 2. 插件生命周期 / 依赖编排 / 作用域回收照常工作；
 * 3. 装上"能力层"后，能力段才会出现（画布层就是这么接进来的）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import type { CapabilityLayer } from '../capabilityLayer'
import type { PluginScope } from '../types'

describe("纯插件内核（不装能力层）", () => {
  it('裸 Context 不含画布能力段（ctx.nodes/theme/commands 均不可用）', async () => {
    const ctx = new Context()
    let sawNodes: unknown = 'unset'
    let sawTheme: unknown = 'unset'
    ctx.plugin({
      name: 'probe',
      apply(c: PluginScope) {
        const raw = c as unknown as Record<string, unknown>
        sawNodes = raw.nodes
        sawTheme = raw.theme
      },
    })
    await ctx.start()
    expect(sawNodes).toBeUndefined()
    expect(sawTheme).toBeUndefined()
    // slots/settings 由能力层提供（未装 → 无）；tools 由内核自带（恒在）
    expect(ctx.hasService('slots')).toBe(false)
    expect(ctx.hasService('settings')).toBe(false)
    expect(ctx.hasService('tools')).toBe(true)
    ctx.stop()
  })

  it('插件生命周期与作用域回收照常：卸载后订阅自动解除', async () => {
    const ctx = new Context()
    let hits = 0
    ctx.plugin({
      name: 'sub',
      apply(c: PluginScope) {
        c.on('ping', () => { hits += 1 })
      },
    })
    await ctx.start()
    ctx.emit('ping')
    expect(hits).toBe(1)
    ctx.uninstallPlugin('sub')
    ctx.emit('ping')
    expect(hits).toBe(1)
    ctx.stop()
  })

  it('依赖编排：inject 缺提供方则停在 PENDING，提供方到位后自动激活', async () => {
    const ctx = new Context()
    let activated = false
    ctx.plugin({
      name: 'needs-greeter',
      inject: ['greeter'],
      apply() {
        activated = true
      },
    })
    await ctx.start()
    expect(activated).toBe(false)
    expect(ctx.inspectPlugins().find((p) => p.name === 'needs-greeter')?.missingDeps).toEqual(['greeter'])
    ctx.inject('greeter', { hi: () => 'hello' })
    await Promise.resolve()
    expect(activated).toBe(true)
    ctx.stop()
  })
})

describe("装上能力层后能力段才出现（画布层就是这么接的）", () => {
  it('能力层产出的段挂到插件 ctx 上，且其内置服务经 ctx.get 可取', async () => {
    const fakeBuiltin = { kind: "fake-slots" }
    const layer: CapabilityLayer = {
      buildSegments: () => ({ nodes: { register: () => undefined } }),
      builtins: () => ({ slots: fakeBuiltin }),
      reset: () => undefined,
      declareConfig: () => () => undefined,
    }
    const ctx = new Context({ capabilityLayer: layer })
    let seg: unknown = null
    ctx.plugin({
      name: 'probe',
      apply(c: PluginScope) {
        seg = (c as unknown as Record<string, unknown>).nodes
      },
    })
    await ctx.start()
    expect(seg).toBeDefined()
    expect(ctx.get('slots')).toBe(fakeBuiltin)
    expect(ctx.hasService('slots')).toBe(true)
    ctx.stop()
  })
})
