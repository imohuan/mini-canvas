import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import { CommandRegistry } from '../command'
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

  it('服务轴：内置服务（tools/slots/settings）也列出，标 source=<builtin>（审查 C3）', async () => {
    const ctx = new Context()
    await ctx.start()
    const s = ctx.surface()
    const toolsEntry = s.services.find((x) => x.name === 'tools')!;
    expect(toolsEntry).toBeDefined();
    expect(toolsEntry.source).toBe('<builtin>');
    // tools 是 ToolRegistry 实例：方法清单应列出 register/list/invoke 等（审查 A3）
    expect(toolsEntry.methods).toContain('register');
    expect(toolsEntry.methods).toContain('list');
    expect(toolsEntry.methods).toContain('invoke');
    ctx.stop()
  })

  it('describeMethods 不执行 getter（只用 descriptor 反射）', async () => {
    const ctx = new Context()
    let getterRuns = 0;
    const svc = {
      doThing() { return 1 },
      get dangerous() { getterRuns += 1; return 'should-not-run' },
    };
    ctx.plugin(mk('svc', (c) => c.provide('probe-svc', svc)))
    await ctx.start()
    const entry = ctx.surface().services.find((x) => x.name === 'probe-svc')!;
    expect(entry.methods).toContain('doThing');
    expect(entry.methods).not.toContain('dangerous');
    expect(getterRuns).toBe(0);
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
    expect(demo.keys).toEqual([{ key: 'demo/a', count: 2 }])
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
    // 插件注入的服务没了；内核/能力层内置服务（tools 等）恒在，标 <builtin>
    expect(s.services.some((x) => x.source === 'reg')).toBe(false);
    expect(s.services.every((x) => x.source === '<builtin>')).toBe(true);
    expect(s.registries).toEqual([])
  })

  it('命令轴兼读 command 服务：服务直注册的命令也能列出（审查 C1）', async () => {
    const ctx = new Context()
    const command = new CommandRegistry()
    ctx.inject('command', command)
    await ctx.start()
    // 模拟数据层自带命令的注册路径（不经 ctx.commands.register 糖 → 不进注册场）
    command.register({ id: 'command:delete', title: '删除', keys: ['Delete'], run: () => 1 })
    command.register({ id: 'command:undo', title: '撤销', keys: ['mod+z'], run: () => 1 })
    const s = ctx.surface()
    const del = s.commands.find((c) => c.id === 'command:delete')!;
    expect(del).toBeDefined();
    expect(del.origin).toBe('service');
    expect(del.keys).toEqual(['Delete']);
    expect(s.commands.some((c) => c.id === 'command:undo')).toBe(true);
    ctx.stop()
  })

  it('params 逐字段透传、无虚构 required 字段、options 是副本（审查 B/C4）', async () => {
    const ctx = new Context()
    const opts = [{ label: '1:1', value: '1:1' }];
    ctx.plugin(
      mk('gen', (c) => {
        c.tools.register({
          name: 'gen.image',
          produces: 'image',
          params: [
            {
              key: 'ratio',
              label: '比例',
              description: '画幅比例',
              type: 'select',
              options: opts,
              default: '1:1',
              span: 2,
            },
            { key: 'seed', type: 'number', min: 0, max: 100, step: 1, placeholder: '随机' },
          ],
          templates: [{ id: 'hd', name: '高清', prompt: '高清写实', description: '写实风', forTools: ['gen.image'] }],
          run: () => ({ ok: true }),
        })
      }),
    )
    await ctx.start()
    const t = ctx.surface().tools.find((x) => x.name === 'gen.image')!;
    const p0 = t.params![0];
    expect(p0.label).toBe('比例');
    expect(p0.description).toBe('画幅比例');
    expect(p0.default).toBe('1:1');
    expect(p0.span).toBe(2);
    expect('required' in p0).toBe(false); // 虚构字段已删
    expect(t.params![1].min).toBe(0);
    expect(t.params![1].placeholder).toBe('随机');
    expect(t.templates![0].prompt).toBe('高清写实');
    // 副本：往快照里 push 不该污染注册表里的原始声明
    p0.options!.push({ label: 'X', value: 'x' });
    expect(opts).toHaveLength(1);
    ctx.stop()
  })
})
