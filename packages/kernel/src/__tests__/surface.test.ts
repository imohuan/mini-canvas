import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import type { PluginModule, PluginScope } from '../types'

const mk = (name: string, setup: (c: PluginScope) => void): PluginModule => ({ name, setup })

describe('ctx.surface() 自省快照（列出注册了什么、支持什么）', () => {
  it('服务轴：services 列出全部按名可取的服务并带 source（谁注入的）', async () => {
    const ctx = new Context()
    ctx.plugin(mk('host-svc', (c) => c.provide('doc', { kind: 'doc' })))
    await ctx.start()
    const s = ctx.surface()
    const names = s.services.map((x) => x.name)
    expect(names).toContain('doc')
    expect(s.services.find((x) => x.name === 'doc')).toBeDefined()
    const docEntry = s.services.find((x) => x.name === 'doc')!;
    expect(docEntry.source).toBe('host-svc')
    ctx.stop()
  })

  it('注册轴：registries 列 kind/键/条目数，registryEntries 带明细致 source', async () => {
    const ctx = new Context()
    ctx.plugin(
      mk('reg', (c) => {
        c.registryOf('demo').add('demo/a', { v: 1 }, { id: 'a' })
        c.registryOf('demo').add('demo/a', { v: 2 }, { id: 'b', order: 2 })
      }),
    )
    await ctx.start()
    const s = ctx.surface()
    const demo = s.registries.find((r) => r.kind === 'demo')!;
    expect(demo.keys).toEqual(['demo/a'])
    expect(demo.entries).toEqual([2])
    expect(s.registryEntries.filter((e) => e.kind === 'demo').map((e) => e.source)).toEqual(['reg', 'reg'])
    ctx.stop()
  })

  it('语义视图：commands 列 id/keys/areas/group；tool 场列 parameters/outputSchema', async () => {
    const ctx = new Context()
   ctx.plugin(
     mk('cmds', (c) => {
       // 命令能力段在纯 kernel ctx 下不存在（canvas-data 能力层才有）；surface 的命令语义视图
       // 读 command 场，故直接按 §8.2 的落点形状放一条：值 = { def }。
       c.registryOf('command').add('cmd-x', {
         def: { id: 'cmd-x', title: 'X', keys: ['mod+x'], areas: ['pane'], group: 'g', run: () => 1 },
       })
        // 命令能力段在纯 kernel ctx 下不存在（canvas-data 能力层才有），这里直接用工具场验证语义视图
        c.registryOf('tool').add('greet', {
          description: '打个招呼',
          parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: '' }] },
          execute: () => 'hi',
        })
      }),
    )
    await ctx.start()
    const s = ctx.surface()
    const cmd = s.commands.find((c) => c.id === 'cmd-x')!;
    expect(cmd.title).toBe('X')
    expect(cmd.keys).toEqual(['mod+x'])
    expect(cmd.areas).toEqual(['pane'])
    const mt = s.modelTools.find((t) => t.name === 'greet')!;
    expect(mt.description).toBe('打个招呼')
    expect(mt.parameters).toBeDefined()
    expect(mt.outputSchema).toBeDefined()
    ctx.stop()
  })

  it('生成工具（ctx.tools）也进快照：name/params/produces', async () => {
    const ctx = new Context()
    ctx.plugin(
      mk('gen', (c) => {
        c.tools.register({
          name: 'gen.image',
          title: '出图',
          produces: 'image',
          params: [{ key: 'ratio', type: 'select', options: [{ label: '1:1', value: '1:1' }] }],
          run: () => ({ ok: true }),
        })
      }),
    )
    await ctx.start()
    const s = ctx.surface()
    const t = s.tools.find((x) => x.name === 'gen.image')!;
    expect(t.title).toBe('出图')
    expect(t.produces).toBe('image')
    expect(t.params?.[0].key).toBe('ratio')
    ctx.stop()
  })

  it('插件作用域上也能调 surface()（deriveScope 显式挂载，Proxy 坑）', async () => {
    const ctx = new Context()
    await ctx.start()
    // start 后热装：插件 scope 上的 surface 必须可调（漏挂 = 静默 undefined，正是 Proxy 坑）
    ctx.installPlugin(
      mk('probe', (c) => {
        const s = c.surface();
        expect(Array.isArray(s.services)).toBe(true);
        expect(Array.isArray(s.registries)).toBe(true);
        expect(typeof s.state).toBe('string');
      }),
    )
    ctx.stop()
  })

  it('stop() 后快照清空（服务与场都不再有注册）', async () => {
    const ctx = new Context()
    ctx.plugin(mk('reg', (c) => c.registryOf('demo').add('k', 1)))
    await ctx.start()
    ctx.stop()
    const s = ctx.surface()
    expect(s.services).toEqual([])
    expect(s.registries).toEqual([])
  })
})
