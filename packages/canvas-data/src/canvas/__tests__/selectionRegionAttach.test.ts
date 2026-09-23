/**
 * ctx.selectionRegion.attach —— 多选框区域接缝（与 ctx.nodes.attach 同形）。
 *
 * 用户要求："多选的能力能不能就写到这个 selection 里面呢，两个规则上下文同样" ——
 * 即多选框的位置注册**复用节点那套区域词与落场规则**，只是宿主从"某个节点"换成"选择集"。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, createDocService } from '@mini-canvas/canvas-data'
import { NodeRegistry } from '../registry/nodeRegistry'
import { ThemeRegistry } from '../registry/themeRegistry'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory } from '../nodeFactory'
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'

const Comp = { name: 'SelComp' }

async function boot(plugins: PluginModule[]): Promise<Context> {
  const ctx = new Context()
  ctx.inject('doc', createDocService({ nodeStore: new NodeStore() }))
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  for (const p of plugins) ctx.plugin(p)
  await ctx.start()
  return ctx
}

const mk = (name: string, setup: (c: PluginScope) => void): PluginModule => ({ name, setup })

describe('ctx.selectionRegion.attach', () => {
  it('落到 selection/region 场，键 = 区域词（多选框没有"类型"，位置进键）', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.selectionRegion.attach({ region: 'out:top', component: Comp })
      }),
    ])
    const entries = ctx.registryOf('selection/region').list('out:top')
    expect(entries).toHaveLength(1)
    expect((entries[0].value as { component: unknown }).component).toBe(Comp)
    expect(entries[0].source).toBe('p')
  })

  it('needs/props 进 value 原样读回（与节点区域条目同一形状）', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.selectionRegion.attach({
          region: 'out:bottom',
          component: Comp,
          needs: ['selection'],
          props: { 展开: true },
        })
      }),
    ])
    const value = ctx.registryOf('selection/region').top('out:bottom')?.value as {
      component: unknown
      needs?: string[]
      props?: Record<string, unknown>
    }
    expect(value.component).toBe(Comp)
    expect(value.needs).toEqual(['selection'])
    expect(value.props).toEqual({ 展开: true })
  })

  it('缺省 id = 当前插件名；同 id 重装替换该格', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.selectionRegion.attach({ region: 'out:top', component: Comp })
        c.selectionRegion.attach({ region: 'out:top', component: { name: 'Second' } })
      }),
    ])
    const entries = ctx.registryOf('selection/region').list('out:top')
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('p')
  })

  it('插件卸载自动回收', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.selectionRegion.attach({ region: 'out:top', component: Comp })
      }),
    ])
    expect(ctx.registryOf('selection/region').list('out:top')).toHaveLength(1)
    ctx.uninstallPlugin('p')
    expect(ctx.registryOf('selection/region').list('out:top')).toHaveLength(0)
  })
})
