import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore } from '@mini-canvas/canvas-data'
import { createDocService } from '../../docService'
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
  // 5c：节点类型表随 doc 提供
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

describe('糖 → 注册场落点（§8.2 兼容映射）', () => {
  it('ctx.nodes.register 落 node/type/<type>、node/creator/<type>', async () => {
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
    expect(typeof ctx.registryOf('node/creator').top('text')?.value).toBe('function')
    // node/shell 不再由 ctx.nodes.register 写"展示定义摘要"：§4.5 定义它的值是**壳组件**、
    // 消费者是节点壳装配。写摘要会让装配端拿到非组件对象（渲染即崩），且那份摘要在
    // nodeRegistry / node/region 里已有等价物。这里锁"糖不往这张场写东西"。
    expect(ctx.registryOf('node/shell').has('text')).toBe(false)
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

  it('ctx.theme.register 落 theme/<slot>；同 id 顶替（main 语义，审查 H3 回退）；winner = order 最小者', async () => {
   const ctx = await boot([
     mk('theme-a', (c) => c.theme.register('edge', MyEdge)),
     mk('theme-b', (c) => {
       c.theme.register('edge', MyEdge, { id: 'neon', order: -1 })
        // 同 id 重复 register = 顶替该 id 那格（main 语义：register 走 placeTheme/addOccupant，
        // 只有 default occupant 已存在时才由 ThemeRegistry.register 抛错）。
       expect(() => c.theme.register('edge', MyEdge, { id: 'neon' })).not.toThrow();
       // 不同 id 的 occupant 各自独立共存（theme-a 与 theme-b 的两条都在，可回退）
      }),
    ])
  const entries = ctx.registryOf('theme').list('edge')
    // 落点：两个插件各一条 —— 默认 id = 插件名（theme-a），显式 id = 'neon'（theme-b）。
    expect(ctx.registryOf('theme').ids('edge').sort()).toEqual(['neon', 'theme-a'])
    // 同 id 顶替：neon 注册两次仍只有一条（同 id 替换，不叠加）—— 与 main 的 addOccupant 同义。
    expect(ctx.registryOf('theme').ids('edge').filter((x) => x === 'neon')).toHaveLength(1)
    // 栈序 = order 升序从外到里；重复 register 未带 order → 该条回到缺省 0，
    // 与同为 0 的 theme-a 按插入序稳定排列（第一版断言写成 neon 恒在最前，是错的）。
    expect(entries.map((e) => e.order)).toEqual([0, 0])
    expect(entries.map((e) => e.id)).toEqual(['theme-a', 'neon'])
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
