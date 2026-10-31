import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/kernel'
import type { BarAction, BarApplier } from '../barTypes'
import { registerBarAction, registerBarApplier } from '../nodeBarPlugin'
import { NodeBarService } from '../nodeBarPlugin'

function ctxWithBar() {
  const ctx = new Context()
  ctx.inject('doc', { getNode: () => undefined, getNodes: () => [] })
  ctx.plugin({
    name: 'bar-host',
    apply(c) {
      // Service 构造即上架（super(ctx, 'nodeBar')），不要再 provide 一次
      new NodeBarService(c as never)
    },
  })
  return ctx
}

describe('node/bar-applier 并入 node/bar', () => {
  it('动作落在 actions/<id>，list 只返回动作、不把 applier 当动作', async () => {
    const ctx = ctxWithBar()
    ctx.plugin({
      name: 'producer',
      apply(c) {
        registerBarAction(c, { id: 'gen', title: '生成', order: 1, run: () => ({ ok: true }) } as BarAction)
        registerBarApplier(c, 'image', (() => undefined) as BarApplier)
      },
    })
    await ctx.start()
    const field = ctx.registryOf<unknown>('node/bar')
    expect(field.has('actions/gen')).toBe(true)
    expect(field.has('appliers/image')).toBe(true)
    expect(field.has('gen')).toBe(false)
    const bar = ctx.get<NodeBarService>('nodeBar')
    expect(bar.list({ type: 'image' }).map((a) => a.id)).toEqual(['gen'])
    expect(typeof bar.applierOf('image')).toBe('function')
    ctx.stop()
  })

  it('同一 kind 注册第二个 applier 抛错；卸载插件后 applier 一并消失', async () => {
    const ctx = ctxWithBar()
    ctx.plugin({
      name: 'producer',
      apply(c) {
        registerBarApplier(c, 'image', (() => undefined) as BarApplier)
        expect(() => registerBarApplier(c, 'image', (() => undefined) as BarApplier)).toThrow(
          /applier already registered/,
        )
      },
    })
    await ctx.start()
    expect(ctx.registryOf('node/bar').has('appliers/image')).toBe(true)
    ctx.uninstallPlugin('producer')
    expect(ctx.registryOf('node/bar').has('appliers/image')).toBe(false)
    ctx.stop()
  })
})
