import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import { NodeStore } from '../../services/nodeStore'
import { NodeRegistry } from '../registry/nodeRegistry'
import { resolveSegment } from '../registry/nodeRenderer'
import { ThemeRegistry } from '../registry/themeRegistry'
import { CommandRegistry } from '../../services/command'
import { NodeFactory } from '../../services/nodeFactory'
import type { PluginModule, PluginScope } from '../types'

/** 测试组件 stub（opaque 句柄） */
const TextContent = { name: 'TextContent' }
const AltContent = { name: 'AltContent' }
const MyEdge = { name: 'MyEdge' }
const BadgeA = { name: 'BadgeA' }
const BadgeB = { name: 'BadgeB' }
const DockBar = { name: 'DockBar' }

/** 造一个带全套服务的最小 ctx，start 触发各插件 setup(ctx) */
async function boot(plugins: PluginModule[]): Promise<{
  ctx: Context
  nodeStore: NodeStore
  nodeRegistry: NodeRegistry
  theme: ThemeRegistry
  command: CommandRegistry
  factory: NodeFactory
}> {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const nodeRegistry = new NodeRegistry()
  const theme = new ThemeRegistry()
  const command = new CommandRegistry()
  const factory = new NodeFactory()
  for (const [name, impl] of [
    ['nodeStore', nodeStore],
    ['nodeRegistry', nodeRegistry],
    ['themeRegistry', theme],
    ['command', command],
    ['nodeFactory', factory],
  ] as const) {
    ctx.inject(name, impl)
  }
  for (const p of plugins) ctx.plugin(p)
  await ctx.start()
  return { ctx, nodeStore, nodeRegistry, theme, command, factory }
}

const mk = (name: string, setup: (c: PluginScope) => void): PluginModule => ({ name, setup })

describe('插件 ctx 能力段收口（ctx.nodes/theme/commands/slots）', () => {
  it('ctx.nodes.register 一次注册节点(数据+展示)，setup 期间可用', async () => {
    const { nodeStore, nodeRegistry } = await boot([
      mk('text-plugin', (c) => {
        c.nodes.register({ type: 'text', label: '文本', size: { w: 300, h: 200 }, content: TextContent })
      }),
    ])
    expect(nodeStore.types.get('text')?.label).toBe('文本')
    expect(resolveSegment(nodeRegistry, 'text', 'content')).toBe(TextContent)
  })

  it('ctx.theme.register 叠主题槽 occupant；order 更小的顶替', async () => {
    const { theme } = await boot([
      mk('theme-a', (c) => c.theme.register('edge', MyEdge)),
      mk('theme-b', (c) => c.theme.register('edge', MyEdge, { id: 'neon', order: -1 })),
    ])
    expect(theme.winner('edge')).toBe(MyEdge) // theme-b 更高优先级(order -1)顶替
    expect(theme.occupants('edge').length).toBe(2) // 两者都在(可回退)
  })

  it('ctx.commands.register 注册命令可 execute', async () => {
    const { command } = await boot([
      mk('cmd-plugin', (c) =>
        c.commands.register({ id: 'play', run: () => 'played' }),
      ),
    ])
    expect(command.execute('play')).toBe('played')
    expect(command.has('play')).toBe(true)
  })

  it('ctx.slots.register 叠进内置槽，可经 ctx.get("slots") 读到', async () => {
    const { ctx } = await boot([
      mk('ui-plugin', (c) => c.slots.register('canvas.dock', { id: 'bar', order: 1, component: DockBar })),
    ])
    const slots = ctx.get<{
      list(s: string): Array<{ id: string; order: number; value: unknown }>
    }>('slots')
    const occ = slots.list('canvas.dock')
    expect(occ).toHaveLength(1)
    expect(occ[0].value).toBe(DockBar)
  })

  it('插件卸载(stop)自动回收 ctx 各能力段的注册', async () => {
    const { ctx, theme, nodeStore, nodeRegistry, command } = await boot([
      mk('all', (c) => {
        c.nodes.register({ type: 'img', label: '图', size: { w: 100, h: 100 }, content: AltContent })
        c.theme.register('background', MyEdge)
        c.commands.register({ id: 'x', run: () => 1 })
        c.slots.register('canvas.dock', { id: 'bar', component: DockBar })
      }),
    ])
    expect(nodeStore.types.has('img')).toBe(true)
    expect(theme.winner('background')).toBe(MyEdge)
    expect(command.has('x')).toBe(true)
    expect(ctx.get<{ list(s: string): unknown[] }>('slots').list('canvas.dock')).toHaveLength(1)

    ctx.stop()
    // 卸载 → 全部自动回收
    expect(nodeStore.types.has('img')).toBe(false)
    expect(nodeRegistry.get('img')).toBeUndefined()
    expect(theme.winner('background')).toBeUndefined()
    expect(command.has('x')).toBe(false)
    expect(ctx.get<{ list(s: string): unknown[] }>('slots').list('canvas.dock')).toHaveLength(0)
  })

  it('同槽两插件按 order 顺序共存，卸一个只抽走它那份', async () => {
    const { ctx, theme } = await boot([
      mk('p1', (c) => c.theme.register('canvas.overlay', BadgeA, { id: 'a', order: 0 })),
      mk('p2', (c) => c.theme.register('canvas.overlay', BadgeB, { id: 'b', order: 1 })),
    ])
    expect(theme.occupants('canvas.overlay').map((o) => o.value)).toEqual([BadgeA, BadgeB])
    // 卸载 p1 → 只抽走 a，b 保留
    ctx.uninstallPlugin('p1')
    expect(theme.occupants('canvas.overlay').map((o) => o.value)).toEqual([BadgeB])
    expect(theme.occupantIds('canvas.overlay')).toEqual(['b'])
  })
})
