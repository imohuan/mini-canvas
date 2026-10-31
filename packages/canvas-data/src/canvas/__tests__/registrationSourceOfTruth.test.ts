/**
 * 注册事实源与生命周期（执行计划 T01）。
 *
 * 已核实的缺陷：
 * 1. ctx.theme.register 同时写 ThemeRegistry 与 registryOf('theme')，但只登记了前者的回收
 *    → 插件卸载后注册场里留下“幽灵条目”。
 * 2. ctx.theme.add 只写 ThemeRegistry、ctx.theme.remove 只删 ThemeRegistry
 *    → 场与容器读到的内容不一致。
 * 3. ctx.nodes.contribute 在场里自行算 order（且忽略显式 opts.order），NodeRegistry 又用另一套
 *    → 同一次注册在两处排序不同。
 *
 * 这些断言只看“注册后 / 卸载后两处读到什么”，不碰内部实现。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore } from '@mini-canvas/canvas-data'
import { createDocService } from '../../docService'
import { NodeRegistry } from '../registry/nodeRegistry'
import { ThemeRegistry } from '../registry/themeRegistry'
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'

const MyEdge = { name: 'MyEdge' }
const MyShell = { name: 'MyShell' }
const Badge = { name: 'Badge' }

async function boot(plugins: PluginModule[]) {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const theme = new ThemeRegistry()
  const nodeRegistry = new NodeRegistry()
  ctx.inject('doc', createDocService({ nodeStore }))
  ctx.inject('nodeRegistry', nodeRegistry)
  ctx.inject('themeRegistry', theme)
  for (const p of plugins) ctx.plugin(p)
  await ctx.start()
  return { ctx, nodeStore, theme, nodeRegistry }
}

const mk = (name: string, setup: (c: PluginScope) => void): PluginModule => ({ name, setup })

describe('D1 · 主题只留 ThemeRegistry 一处事实源', () => {
  it('ctx.theme.register：ThemeRegistry 生效、theme 场不再重复写、卸载后清空', async () => {
    const { ctx, theme } = await boot([
      mk('theme-a', (c) => c.theme.register('edge', MyEdge)),
    ])
    // 装载后只有真实容器有；theme 场按 D1 删除写入
    expect(theme.winner('edge')).toBe(MyEdge)
    expect(ctx.registryOf('theme').top('edge')).toBeUndefined()

    ctx.uninstallPlugin('theme-a')

    // 卸载后容器必须清空
    expect(theme.winner('edge')).toBeUndefined()
  })

  it('ctx.theme.add 与 register 落在同一处事实源（卸载同样清空，不残留）', async () => {
    const { ctx, theme } = await boot([
      mk('theme-b', (c) => c.theme.add('background', MyShell, { id: 'b', order: 3 })),
    ])
    expect(theme.winner('background')).toBe(MyShell)
    expect(ctx.registryOf('theme').top('background')).toBeUndefined()
    expect(theme.occupantIds('background')).toEqual(['b'])

    ctx.uninstallPlugin('theme-b')
    expect(theme.winner('background')).toBeUndefined()
  })

  it('ctx.theme.remove：从真实容器移除', async () => {
    const { theme } = await boot([
      mk('theme-c', (c) => {
        c.theme.register('nodeShell', MyShell, { id: 'shell' })
        expect((c.get('themeRegistry') as ThemeRegistry).winner('nodeShell')).toBe(MyShell)
        c.theme.remove('nodeShell', 'shell')
      }),
    ])
    expect(theme.winner('nodeShell')).toBeUndefined()
  })

  it('同 id 顶替后容器只剩当前所有者', async () => {
    const { theme } = await boot([
      mk('theme-d', (c) => {
        c.theme.register('edge', MyEdge, { id: 'same' })
        c.theme.register('edge', MyShell, { id: 'same' })
      }),
    ])
    expect(theme.winner('edge')).toBe(MyShell)
    expect(theme.occupantIds('edge')).toEqual(['same'])
  })
})

describe('T01 · nodes.contribute 的 order 只有一份事实', () => {
  it('显式 order 两处一致（场不再忽略 opts.order）', async () => {
    const { ctx, nodeRegistry } = await boot([
      mk('node-plugin', (c) =>
        c.nodes.register({ type: 'text', label: '文本', size: { w: 10, h: 10 } }),
      ),
      mk('badge', (c) => c.nodes.contribute('text', 'out:top', Badge, { id: 'b', order: 7 })),
    ])
    expect(ctx.registryOf('node/region').get('text/out:top', 'b')?.order).toBe(7)
    const fromRegistry = nodeRegistry.contributionOccupants('text', 'out:top').find((e) => e.id === 'b')
    expect(fromRegistry?.order).toBe(7)
  })

  it('缺省 order 两处一致（首条 0/1，其后递增）', async () => {
    const { ctx, nodeRegistry } = await boot([
      mk('node-plugin', (c) =>
        c.nodes.register({ type: 'text', label: '文本', size: { w: 10, h: 10 }, in: { name: 'In' } }),
      ),
      mk('badge', (c) => {
        c.nodes.contribute('text', 'in', Badge, { id: 'x' })
        c.nodes.contribute('text', 'in', Badge, { id: 'y' })
      }),
    ])
    const fieldX = ctx.registryOf('node/region').get('text/in', 'x')?.order
    const fieldY = ctx.registryOf('node/region').get('text/in', 'y')?.order
    const regX = nodeRegistry.contributionOccupants('text', 'in').find((e) => e.id === 'x')?.order
    const regY = nodeRegistry.contributionOccupants('text', 'in').find((e) => e.id === 'y')?.order
    // in 区域有基座 → 首条从 1 起
    expect(fieldX).toBe(1)
    expect(regX).toBe(1)
    expect(fieldY).toBe(2)
    expect(regY).toBe(2)
  })

  it('卸载后两处的贡献条目同时消失', async () => {
    const { ctx, nodeRegistry } = await boot([
      mk('node-plugin', (c) =>
        c.nodes.register({ type: 'text', label: '文本', size: { w: 10, h: 10 } }),
      ),
      mk('badge', (c) => c.nodes.contribute('text', 'out:top', Badge, { id: 'b' })),
    ])
    expect(ctx.registryOf('node/region').get('text/out:top', 'b')).toBeDefined()
    ctx.uninstallPlugin('badge')
    expect(ctx.registryOf('node/region').get('text/out:top', 'b')).toBeUndefined()
    expect(nodeRegistry.contributionIds('text', 'out:top')).toEqual([])
  })
})
