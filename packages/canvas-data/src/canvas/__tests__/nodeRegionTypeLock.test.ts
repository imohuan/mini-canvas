/**
 * 步骤 9 的**类型锁**：老段名（content / top-toolbar / bottom-toolbar / overlay）不再是合法入参。
 *
 * 为什么这些 `@ts-expect-error` 注释本身就是守卫：`pnpm -C packages/canvas-data typecheck`
 * （tsc --noEmit，涵盖本目录）会逐条核对每条指令**真的压住了一个类型错误**。
 * 老词哪天若又变合法（有人把垫片加回来），指令立刻变成 unused directive 而报错 ——
 * 于是"老词是编译期错误"这条退役目标被自动钉住，不靠人记得复查。
 *
 * 运行时那半边（传老词当场抛清晰错误）由 nodeRegion.test.ts / capabilitiesAttach.test.ts 锁。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory } from '../nodeFactory'
import { resolveSegment, nodeSegmentStack } from '../registry/nodeRenderer'
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'

const Comp = { name: 'Comp' }

/** 造一个带全套服务的最小 ctx（与 capabilities.test.ts 同一形态） */
async function boot(plugins: PluginModule[]): Promise<Context> {
  const ctx = new Context()
  ctx.inject('nodeStore', new NodeStore())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  for (const p of plugins) ctx.plugin(p)
  await ctx.start()
  return ctx
}

const mk = (name: string, setup: (c: PluginScope) => void): PluginModule => ({ name, setup })

describe('步骤 9 类型锁：老段名不再是合法入参', () => {
  it('NodeRegistry.register 的展示段只收区域词', () => {
    const r = new NodeRegistry()
    // @ts-expect-error content 已下线，不是区域词（十个区域词见 canvas/region.ts）
    expect(() => r.register('text', { content: Comp })).toThrow(/不是合法区域词/)
    // @ts-expect-error top-toolbar 已下线，应写 out:top
    expect(() => r.register('text', { 'top-toolbar': Comp })).toThrow(/不是合法区域词/)
  })

  it('registerContribution / unregisterContribution / 诊断读法只收区域词', () => {
    const r = new NodeRegistry()
    r.register('text', { in: Comp })
    // @ts-expect-error bottom-toolbar 已下线，应写 out:bottom
    expect(() => r.registerContribution('text', 'bottom-toolbar', { id: 'x', component: Comp })).toThrow(
      /不是合法区域词/,
    )
    // @ts-expect-error overlay 已下线，应写 over:inset
    expect(() => r.unregisterContribution('text', 'overlay', 'x')).toThrow(/不是合法区域词/)
    // @ts-expect-error top-toolbar 已下线
    expect(() => r.contributionIds('text', 'top-toolbar')).toThrow(/不是合法区域词/)
  })

  it('resolveSegment / nodeSegmentStack 只收区域词', () => {
    const r = new NodeRegistry()
    r.register('text', { in: Comp })
    // 区域词照常工作（对照组：不是"一律拒绝"）
    expect(resolveSegment(r, 'text', 'in')).toBe(Comp)
    expect(nodeSegmentStack(r, 'text', 'in')).toEqual([Comp])
    // @ts-expect-error content 已下线
    expect(() => resolveSegment(r, 'text', 'content')).toThrow(/不是合法区域词/)
    // @ts-expect-error overlay 已下线
    expect(() => nodeSegmentStack(r, 'text', 'overlay')).toThrow(/不是合法区域词/)
  })

  it('ctx.nodes.register 的作者侧字段与段名都只收区域词', async () => {
    await expect(
      boot([
        mk('p', (c) => {
          // @ts-expect-error 作者侧字段 content 已改名为区域词 in
          c.nodes.register({ type: 't', label: 'T', size: { w: 1, h: 1 }, content: Comp })
        }),
      ]),
    ).rejects.toThrow(/不是合法区域词/)
    await expect(
      boot([
        mk('p', (c) => {
          // @ts-expect-error segments 的键必须是区域词
          c.nodes.register({ type: 't', label: 'T', size: { w: 1, h: 1 }, segments: { 'top-toolbar': Comp } })
        }),
      ]),
    ).rejects.toThrow(/不是合法区域词/)
  })

  it('ctx.nodes.contribute / attach 只收区域词', async () => {
    await expect(
      boot([
        mk('p', (c) => {
          // @ts-expect-error contribute 的 segment 必须是区域词
          c.nodes.contribute('image', 'top-toolbar', Comp)
        }),
      ]),
    ).rejects.toThrow(/不是合法区域词/)
    await expect(
      boot([
        mk('p', (c) => {
          // @ts-expect-error attach 的 region 必须是区域词
          c.nodes.attach('image', { region: 'overlay', component: Comp })
        }),
      ]),
    ).rejects.toThrow(/不是合法区域词/)
  })
})

