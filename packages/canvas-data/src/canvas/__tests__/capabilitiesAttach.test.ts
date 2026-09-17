import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore } from '@mini-canvas/canvas-data'
import { NodeRegistry } from '../registry/nodeRegistry'
import { ThemeRegistry } from '../registry/themeRegistry'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory } from '../nodeFactory'
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'
import type { NodeRegion } from '../region'

const Comp = { name: 'RegionComp' }
const Probe = { name: 'Probe' }

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

describe('ctx.nodes.attach（§8.3 一等 API）', () => {
  it('落到 node/region 场，键 = type/region（位置进键）', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.nodes.attach('image', { region: 'out:top', component: Comp })
      }),
    ])
    const entries = ctx.registryOf('node/region').list('image/out:top')
    expect(entries).toHaveLength(1)
    expect((entries[0].value as { component: unknown }).component).toBe(Comp)
    expect(entries[0].source).toBe('p')
  })

  it("type='*' 落 */<region>（通配所有节点类型）", async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.nodes.attach('*', { region: 'in', component: Probe })
      }),
    ])
    const entries = ctx.registryOf('node/region').list('*/in')
    expect(entries).toHaveLength(1)
    expect((entries[0].value as { component: unknown }).component).toBe(Probe)
  })

  it('缺省 id = 当前插件名；同 id 重装替换', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.nodes.attach('image', { region: 'on:top', component: Comp })
        c.nodes.attach('image', { region: 'on:top', component: Probe })
      }),
    ])
    const entries = ctx.registryOf('node/region').list('image/on:top')
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('p')
    expect((entries[0].value as { component: unknown }).component).toBe(Probe)
  })

  it('返回 Disposable，dispose 后场里摘除', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        const h = c.nodes.attach('image', { region: 'out:left', id: 'x', component: Comp })
        expect(typeof h.dispose).toBe('function')
        h.dispose()
      }),
    ])
    expect(ctx.registryOf('node/region').list('image/out:left')).toHaveLength(0)
  })

  it('老段词当 region 传入 → 归一到区域词键（兼容垫片）', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.nodes.attach('image', {
          region: 'top-toolbar' as unknown as NodeRegion,
          component: Comp,
        })
      }),
    ])
    expect(ctx.registryOf('node/region').list('image/out:top')).toHaveLength(1)
  })

  it('needs/props 进 value 原样读回（§8.3：条目自己的数据）', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.nodes.attach('image', {
          region: 'out:right',
          component: Comp,
          needs: ['node', 'zoom'],
          props: { 展开: true },
        })
      }),
    ])
    const value = ctx.registryOf('node/region').top('image/out:right')?.value as {
      component: unknown
      needs?: string[]
      props?: Record<string, unknown>
    }
    expect(value.component).toBe(Comp)
    expect(value.needs).toEqual(['node', 'zoom'])
    expect(value.props).toEqual({ 展开: true })
  })

  it('插件卸载自动回收 attach 条目', async () => {
    const ctx = await boot([
      mk('p', (c) => {
        c.nodes.attach('image', { region: 'over:outset', component: Comp })
      }),
    ])
    expect(ctx.registryOf('node/region').list('image/over:outset')).toHaveLength(1)
    ctx.uninstallPlugin('p')
    expect(ctx.registryOf('node/region').list('image/over:outset')).toHaveLength(0)
  })
})
