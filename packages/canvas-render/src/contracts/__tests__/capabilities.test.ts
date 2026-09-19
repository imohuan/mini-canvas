/**
 * 能力包（设计文档 §4.5 / 案例 5 / 决策 9）—— 三件事逐条锁死：
 * ① 任何插件都能注册；② 每节点一份实例、由消费方回收；③ needs 缺项 dev 抛错 / prod undefined+warn。
 */
import { describe, it, expect, vi } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import {
  capabilityField,
  resolveCapabilityBag,
  type CapabilityFactory,
  type CapabilityNodeContext,
} from '../capabilities'

/** 最小节点上下文桩：只给工厂真读到的几项（id/type/data/update 的调用记录） */
function nodeCtx(over: Partial<CapabilityNodeContext> = {}): CapabilityNodeContext {
  const data = { value: { label: 'hello' } }
  return {
    ctx: {} as never,
    id: 'n1',
    type: 'image',
    data: data as never,
    selected: { value: false } as never,
    solo: { value: false } as never,
    zoom: { value: 1 } as never,
    update: () => {},
    ...over,
  }
}

describe('能力包：注册与按名取用', () => {
  it('注册进 registryOf(\'capability\') 后，按名能取到该节点专属实例', async () => {
    const ctx = new Context()
    ctx.registryOf<CapabilityFactory>('capability').add('node', (n) => ({ id: n.id, type: n.type }))
    await ctx.start()

    const bag = resolveCapabilityBag(
      capabilityField(ctx),
      ['node'],
      nodeCtx(),
      false,
      'probe',
    )
    expect(bag.node).toEqual({ id: 'n1', type: 'image' })
    ctx.stop()
  })

  it('每节点一份实例：同一工厂在不同节点上各调一次，参数是各自的 id', async () => {
    const ctx = new Context()
    const calls: string[] = []
    ctx.registryOf<CapabilityFactory>('capability').add('node', (n) => {
      calls.push(n.id)
      return { id: n.id }
    })
    await ctx.start()
    const field = capabilityField(ctx)
    resolveCapabilityBag(field, ['node'], nodeCtx({ id: 'a' }), false, 'e1')
    resolveCapabilityBag(field, ['node'], nodeCtx({ id: 'b' }), false, 'e2')
    expect(calls).toEqual(['a', 'b'])
    ctx.stop()
  })

  it('未声明 needs（缺省）= 空袋、零开销：工厂一次都不调', async () => {
    const ctx = new Context()
    const spy = vi.fn()
    ctx.registryOf<CapabilityFactory>('capability').add('node', spy)
    await ctx.start()
    expect(resolveCapabilityBag(capabilityField(ctx), undefined, nodeCtx(), false, 'e')).toEqual({})
    expect(resolveCapabilityBag(capabilityField(ctx), [], nodeCtx(), false, 'e')).toEqual({})
    expect(spy).not.toHaveBeenCalled()
    ctx.stop()
  })

  it('换掉整套能力 = 叠一个更小 order 的条目（order 小者赢，原注册仍在）', async () => {
    const ctx = new Context()
    const field = ctx.registryOf<CapabilityFactory>('capability')
    field.add('node', () => ({ tag: 'default' }), { id: 'default', order: 0 })
    field.add('node', () => ({ tag: 'themed' }), { id: 'neon', order: -1 })
    await ctx.start()
    expect(resolveCapabilityBag(capabilityField(ctx), ['node'], nodeCtx(), false, 'e').node)
      .toEqual({ tag: 'themed' })
    // 原值没丢（"覆盖永不丢原值"）
    expect(field.list('node').map((e) => e.id)).toEqual(['neon', 'default'])
    ctx.stop()
  })
})

describe('能力包：needs 缺项裁决（决策 9 第③条）', () => {
  it('dev（isDev=true）→ 当场抛错，消息写明缺哪个能力、谁的 needs', () => {
    expect(() =>
      resolveCapabilityBag(undefined, ['node'], nodeCtx(), true, 'gen-button'),
    ).toThrow(/"gen-button" 的 needs 里声明了 "node"/)
  })

  it('prod（isDev=false）→ undefined + 一条 warn，不白屏', () => {
    const warn = vi.fn()
    const bag = resolveCapabilityBag(undefined, ['node', 'zoom'], nodeCtx(), false, 'gen-button', warn)
    expect(bag).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toContain('"node"')
  })

  it('缺一项但另一项在：在的那项照常给（不因一项缺失整袋报废）', async () => {
    const ctx = new Context()
    ctx.registryOf<CapabilityFactory>('capability').add('zoom', () => ({ zoom: 1 }))
    await ctx.start()
    const warn = vi.fn()
    const bag = resolveCapabilityBag(capabilityField(ctx), ['zoom', 'nope'], nodeCtx(), false, 'e', warn)
    expect(bag.zoom).toEqual({ zoom: 1 })
    expect(bag.nope).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    ctx.stop()
  })

  it('工厂自己抛错 → 如实抛出（不伪装成"能力缺失"，那是作者 bug）', async () => {
    const ctx = new Context()
    ctx.registryOf<CapabilityFactory>('capability').add('node', () => {
      throw new Error('factory boom')
    })
    await ctx.start()
    expect(() => resolveCapabilityBag(capabilityField(ctx), ['node'], nodeCtx(), false, 'e'))
      .toThrow(/\"node\" 能力工厂抛错：factory boom/)
    ctx.stop()
  })
})

describe('能力包：场取用', () => {
  it('capabilityField 在无 ctx / 无 registryOf 时返回 undefined（不抛）', () => {
    expect(capabilityField(undefined)).toBeUndefined()
    expect(capabilityField({} as never)).toBeUndefined()
  })

  it('capabilityField 返回的就是 registryOf(\'capability\') 那张场', async () => {
    const ctx = new Context()
    ctx.registryOf<CapabilityFactory>('capability').add('node', () => ({}))
    await ctx.start()
    expect(capabilityField(ctx)?.keys()).toEqual(['node'])
    ctx.stop()
  })
})
