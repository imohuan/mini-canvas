import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore } from '@mini-canvas/canvas-data'
import { NodeRegistry } from '../registry/nodeRegistry'
import { ThemeRegistry } from '../registry/themeRegistry'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory } from '../nodeFactory'
import type { PluginModule, PluginScope } from '@mini-canvas/kernel'

/**
 * 锁"糖 → 场"的落点（设计文档 §8.2 / 步骤 2）：
 * ctx.commands / ctx.slots / ctx.settings / ctx.nodes / ctx.theme 底层改走 ctx.registryOf，
 * 每个糖在转发前保留自己的校验语义（本文件锁落点；行为语义由既有测试继续钉住）。
 */

const TextContent = { name: 'TextContent' }
const MyEdge = { name: 'MyEdge' }
const Badge = { name: 'Badge' }
const DockBar = { name: 'DockBar' }
const Slide = { name: 'Slide' }

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

describe('糖 → 注册场落点（§8.2 兼容映射）', () => {
  it('ctx.nodes.register 落 node/type/<type>、node/shell/<type>、node/creator/<type>', async () => {
    const ctx = await boot([
      mk('text-plugin', (c) => {
        c.nodes.register({
          type: 'text',
          label: '文本',
          size: { w: 300, h: 200 },
          in: TextContent,
          create: () => 'n1',
        })
      }),
    ])
    expect(ctx.registryOf('node/type').top('text')?.value).toEqual({ type: 'text', label: '文本' })
    const shell = ctx.registryOf('node/shell').top('text')?.value
    expect((shell as { segments?: { in?: unknown } }).segments?.in).toBe(TextContent)
    expect(typeof ctx.registryOf('node/creator').top('text')?.value).toBe('function')
  })

  it('ctx.nodes.contribute 落 node/region/<type>/<seg>，order 缺省 = 已有最大 + 1（首条在基座之后）', async () => {
    const ctx = await boot([
      mk('text-plugin', (c) => {
        c.nodes.register({ type: 'text', label: '文本', size: { w: 10, h: 10 }, in: TextContent })
      }),
      mk('badge-a', (c) => {
        const a = c.nodes.contribute('text', 'title', Badge, { id: 'a' })
        const b = c.nodes.contribute('text', 'title', Badge, { id: 'b' })
        expect(typeof a).toBe('string')
        expect(b > a).toBe(true)
      }),
    ])
    const entries = ctx.registryOf('node/region').list('text/title')
    expect(entries.map((e) => e.id)).toEqual(['a', 'b'])
    // title 区域基座为空 → order 从 0 起；若贡献的是 in 区域（基座在），首条 order = 1
    expect(entries[0].order).toBe(0)
    expect(entries[1].order).toBe(entries[0].order + 1)
  })

  it('ctx.theme.register 落 theme/<slot>；同槽重复抛错；winner = order 最小者', async () => {
    const ctx = await boot([
      mk('theme-a', (c) => c.theme.register('edge', MyEdge)),
      mk('theme-b', (c) => {
        c.theme.register('edge', MyEdge, { id: 'neon', order: -1 })
        // 同 id 重复（默认 id = 插件名）→ 抛错（themeRegistry 语义：同 occupant id 重复 register 防覆盖）
        expect(() => c.theme.register('edge', MyEdge, { id: 'neon' })).toThrow(
          /already registered/,
        )
      }),
    ])
    const entries = ctx.registryOf('theme').list('edge')
    expect(entries.map((e) => e.id)).toContain('neon')
    expect(entries[0].id).toBe('neon') // order 最小者在最前
  })

  it('ctx.commands.register 落 command/<id>，重复 id 抛错，返回可 dispose 句柄', async () => {
    const ctx = await boot([
      mk('cmd-plugin', (c) => {
        const handle = c.commands.register({ id: 'cmd-x', run: () => 'ok' })
        expect(() => c.commands.register({ id: 'cmd-x', run: () => 'other' })).toThrow(
          /already registered/,
        )
        // 场里 top 能看到这条命令（值 = { def }）；handle.dispose() 摘掉那条，top 变 undefined
        expect(c.registryOf('command').top('cmd-x')).toBeDefined()
        handle.dispose()
        expect(c.commands.has('cmd-x')).toBe(false)
        expect(c.registryOf('command').top('cmd-x')).toBeUndefined()
      }),
    ])
  })

  it('ctx.slots.register 落 slot/<slot>，返回 id（string）', async () => {
    const ctx = await boot([
      mk('ui-plugin', (c) => {
        const id = c.slots.register('canvas.dock', { id: 'bar', order: 1, component: DockBar })
        expect(typeof id).toBe('string')
      }),
    ])
    expect(ctx.registryOf('slot').top('canvas.dock')?.value).toBe(DockBar)
  })

  it('ctx.settings.* 落 setting 场：define/set/get/onChange/groups 语义不变', async () => {
    const ctx = await boot([
      mk('set-a', (c) => {
        c.settings.define('bg', { accent: { type: 'color', default: '#fff' } })
        expect(c.settings.set('accent', '#0af')).toBe(true)
        c.settings.onChange('set-a', () => {})
        expect(c.settings.groups()).toContain('bg')
        expect(c.settings.get('accent')).toBe('#0af')
      }),
    ])
    const entries = ctx.registryOf('setting').list('accent')
    expect(entries).toHaveLength(1)
    // 落点是 setting 场；current 摘要是"define 时点"的值（set 是 store 值变化，不重落场）
    expect((entries[0].value as { current: string }).current).toBe('#fff')
  })
})
