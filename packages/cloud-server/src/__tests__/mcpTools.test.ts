/**
 * ctx.mcp —— 插件给 AI 加 MCP 工具（Task 6）。
 *
 * 两件事：① 注册进注册场（卸载即摘）；② 真的被接进 MCP server（非死代码）。
 */
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { Context, setDefaultCapabilityLayerFactory } from '@mini-canvas/kernel'
import { createServerCapabilityLayer } from '../serverFramework/capabilityLayer.js'
import { listPluginMcpTools, type McpToolDef } from '../serverFramework/mcp.js'

function boot() {
  const app = new Hono()
  setDefaultCapabilityLayerFactory(() => createServerCapabilityLayer({ app }))
  return new Context()
}

describe('ctx.mcp —— 插件注册 MCP 工具', () => {
  it('注册的工具能被列出（含 name/description/input）', async () => {
    const ctx = boot()
    ctx.plugin({
      name: 'greeter',
      apply: (c) => {
        c.mcp.tool({
          name: 'greeter.hello',
          description: '打个招呼',
          input: { who: 'string' },
          required: ['who'],
          handler: (args) => ({ hello: args.who }),
        })
      },
    })
    await ctx.start()
    const tools = listPluginMcpTools(ctx)
    expect(tools.map((t) => t.name)).toEqual(['greeter.hello'])
    expect(tools[0]!.input).toEqual({ who: 'string' })
    ctx.stop()
  })

  it('handler 能收到参数并返回值', async () => {
    const ctx = boot()
    ctx.plugin({
      name: 'calc',
      apply: (c) => {
        c.mcp.tool({ name: 'calc.add', description: '加法', input: { a: 'number', b: 'number' }, handler: (args) => ({ sum: Number(args.a) + Number(args.b) }) }),
          void 0
      },
    })
    await ctx.start()
    const tool = listPluginMcpTools(ctx)[0] as McpToolDef
    const r = await tool.handler({ a: 2, b: 3 })
    expect(r).toEqual({ sum: 5 })
    ctx.stop()
  })

  it('卸载插件 → 它的工具从列表消失', async () => {
    const ctx = boot()
    ctx.plugin({ name: 'temp', apply: (c) => { c.mcp.tool({ name: 'temp.x', description: 'x', handler: () => 1 }) } })
    await ctx.start()
    expect(listPluginMcpTools(ctx)).toHaveLength(1)
    ctx.uninstallPlugin('temp')
    expect(listPluginMcpTools(ctx)).toEqual([])
    ctx.stop()
  })
})

describe('ctx.agent.tool / ctx.jobs.on（Spec 审查补的缺口）', () => {
  it('agent.tool 注册的工具体现在 MCP 工具清单里（同一落点，不是两套）', async () => {
    const ctx = boot()
    ctx.plugin({
      name: 'tooler',
      apply: (c) => {
        c.agent.tool({ name: 'tooler.do', description: '做点事', handler: () => ({ done: true }) })
      },
    })
    await ctx.start()
    expect(listPluginMcpTools(ctx).map((t) => t.name)).toEqual(['tooler.do'])
    ctx.stop()
  })

  it('jobs.on 能订阅内核事件，且卸载后不再收到', async () => {
    const ctx = boot()
    const seen: string[] = []
    ctx.plugin({
      name: 'listener',
      apply: (c) => {
        c.jobs.on('ctx:plugin-installed', (p) => { seen.push('installed:' + String((p as { name?: string })?.name)) })
      },
    })
    await ctx.start()
    // 注意：listener 自己装载时也会发一条 ctx:plugin-installed（内核的正确行为），
    // 所以这里不清空 seen，而是记下当前长度、只断言"后续事件"。
    const before = seen.length
    ctx.emit('ctx:plugin-installed', { name: 'x' })
    expect(seen[seen.length - 1]).toBe('installed:x')
    expect(seen.length).toBe(before + 1)
    ctx.uninstallPlugin('listener')
    const afterUninstall = seen.length
    ctx.emit('ctx:plugin-installed', { name: 'y' })
    expect(seen.length).toBe(afterUninstall)
    ctx.stop()
  })
})
