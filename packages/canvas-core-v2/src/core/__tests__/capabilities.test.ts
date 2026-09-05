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

describe('ctx.settings 配置单一数据源（插件导出 Config schema，apply 收校验后 config，按作用域订阅）', () => {
  it('两插件各装配 config，改 A 只触发 A 的 onChange，不误触 B；apply 收默认补齐后的完整 config', async () => {
    const seen: Record<string, string[]> = { a: [], b: [] }
    let aConfig: unknown
    let bConfig: unknown
    const { ctx } = await boot([
      // 模块级 Config schema + apply(ctx, config)：声明入口从 ctx.settings.define 换成 Config 导出
      {
        name: 'theme-a',
        Config: {
          edgeColor: { type: 'color', default: '#fff', label: '连线色' },
          width: { type: 'number', default: 1, min: 0, max: 5, label: '线宽' },
        },
        apply(c, config) {
          aConfig = config
          c.settings.onChange('theme-a', (k) => seen.a.push(k))
        },
      },
      {
        name: 'theme-b',
        Config: { dot: { type: 'boolean', default: true, label: '圆点' } },
        apply(c) {
          bConfig = c.settings
          c.settings.onChange('theme-b', (k) => seen.b.push(k))
        },
      },
    ])
    // apply 收到默认补齐的 config
    expect(aConfig).toEqual({ edgeColor: '#fff', width: 1 })
    // 改 theme-a 的 edgeColor → 只 theme-a 收到；theme-b 不触发
    ctx.settings.set('edgeColor', '#0af')
    expect(seen.a).toEqual(['edgeColor'])
    expect(seen.b).toEqual([])
    // 改 theme-b 的 dot → 只 theme-b 收到
    ctx.settings.set('dot', false)
    expect(seen.b).toEqual(['dot'])
    expect(seen.a).toEqual(['edgeColor'])
    // 越界夹取 + 单数据源(host 与插件读同一份)
    ctx.settings.set('width', 99)
    expect(ctx.settings.get('width')).toBe(5)
  })

  it('config 单一数据源：plugin 与 ctx(host) 共享同一份值', async () => {
    let received: unknown
    const { ctx } = await boot([
      {
        name: 'theme-a',
        Config: { c: { type: 'color', default: '#111' } },
        apply(c, config) {
          received = config
        },
      },
    ])
    // 未给装配 config → apply 收默认补齐的 config
    expect(received).toEqual({ c: '#111' })
    // host 经 ctx.get('settings') 与 ctx.settings 读到同一份
    const raw = ctx.get<{ get(k: string): unknown }>('settings')
    expect(raw.get('c')).toBe('#111')
    ctx.settings.set('c', '#333')
    expect(raw.get('c')).toBe('#333')
  })
})
