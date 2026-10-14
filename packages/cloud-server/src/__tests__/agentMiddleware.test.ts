/**
 * ctx.agent —— Agent 中间件（用户点 2）。
 *
 * 中间件跑在 `runtime.run` **之前**（pre-turn），所以能单测、不必起模型。
 * 四条关键行为：改写 / 拦截 / order / 卸载即失效。
 */
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { Context, setDefaultCapabilityLayerFactory } from '@mini-canvas/kernel'
import { createServerCapabilityLayer } from '../serverFramework/capabilityLayer.js'
import { runAgentMiddleware, listAgentPromptSections, type AgentTurn } from '../serverFramework/agent.js'

function boot() {
  const app = new Hono()
  setDefaultCapabilityLayerFactory(() => createServerCapabilityLayer({ app }))
  return { app, ctx: new Context() }
}

const turn = (text: string): AgentTurn => ({ canvasId: 'd', input: { canvasId: 'd', text } })

describe('ctx.agent 中间件（用户点 2）', () => {
  it('空链 = 零改动（没有插件时与不加中间件一字不差）', async () => {
    const { ctx } = boot()
    await ctx.start()
    const t = turn('原样')
    const r = await runAgentMiddleware(ctx, t)
    expect(r.blocked).not.toBe(true)
    expect(t.input.text).toBe('原样')
    ctx.stop()
  })

  it('中间件能改写 turn.input.text（进入前加工）', async () => {
    const { ctx } = boot()
    ctx.plugin({
      name: 'scrubber',
      apply: (c) => {
        c.agent.use(async (t, next) => { t.input.text = t.input.text.replace(/secret/g, '***'); return next() })
      },
    })
    await ctx.start()
    const t = turn('my secret')
    await runAgentMiddleware(ctx, t)
    expect(t.input.text).toBe('my ***')
    ctx.stop()
  })

  it('中间件不调 next() 且返回 blocked → 拦截（下游看不到）', async () => {
    const { ctx } = boot()
    let downstream = false
    ctx.plugin({ name: 'blocker', apply: (c) => { c.agent.use(async () => ({ blocked: true, response: { error: '拦截' } })) } })
    ctx.plugin({ name: 'down', apply: (c) => { c.agent.use(async (_t, n) => { downstream = true; return n() }) } })
    await ctx.start()
    const r = await runAgentMiddleware(ctx, turn('hi'))
    expect(r.blocked).toBe(true)
    expect(r.response).toEqual({ error: '拦截' })
    expect(downstream).toBe(false)
    ctx.stop()
  })

  it('order 决定顺序（小者在外，与前端注册场一致）', async () => {
    const { ctx } = boot()
    const order: string[] = []
    ctx.plugin({ name: 'outer', apply: (c) => { c.agent.use(async (_t, n) => { order.push('outer-in'); const r = await n(); order.push('outer-out'); return r }, { order: -10 }) } })
    ctx.plugin({ name: 'inner', apply: (c) => { c.agent.use(async (_t, n) => { order.push('inner-in'); const r = await n(); order.push('inner-out'); return r }, { order: 10 }) } })
    await ctx.start()
    await runAgentMiddleware(ctx, turn('hi'))
    expect(order).toEqual(['outer-in', 'inner-in', 'inner-out', 'outer-out'])
    ctx.stop()
  })

  it('卸载插件 → 它的中间件不再跑（作用域回收）', async () => {
    const { ctx } = boot()
    let ran = false
    ctx.plugin({ name: 'temp', apply: (c) => { c.agent.use(async (_t, n) => { ran = true; return n() }) } })
    await ctx.start()
    await runAgentMiddleware(ctx, turn('a'))
    expect(ran).toBe(true)
    ran = false
    ctx.uninstallPlugin('temp')
    await runAgentMiddleware(ctx, turn('b'))
    expect(ran).toBe(false)
    ctx.stop()
  })

  it('systemPrompt 登记成**提示词小节**，不再往用户消息里塞字', async () => {
    const { ctx } = boot()
    ctx.plugin({ name: 'sys', apply: (c) => { c.agent.systemPrompt('[规则] 只答十个字内') } })
    await ctx.start()
    // 用户消息**原样不动**：老实现把它拼到 turn.input.text 前面，模型会把规则当成用户说的话。
    const t = turn('你好')
    await runAgentMiddleware(ctx, t)
    expect(t.input.text).toBe('你好')
    // 规则落进提示词小节表，供建会话时拼进系统提示词
    const sections = listAgentPromptSections(ctx)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.text).toContain('[规则]')
    expect(sections[0]!.title).toBe('sys')
    ctx.stop()
  })

  it('同一个 id 再注册 = 顶替（热重载不会越堆越多）', async () => {
    const { ctx } = boot()
    ctx.plugin({
      name: 'p',
      apply: (c) => {
        c.agent.systemPrompt('第一版', { id: 'p:sec', title: 'P 小节' })
        c.agent.systemPrompt('第二版', { id: 'p:sec', title: 'P 小节' })
      },
    })
    await ctx.start()
    const sections = listAgentPromptSections(ctx)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.text).toBe('第二版')
    ctx.stop()
  })

  it('systemPrompt 收函数：每次读都现算（地址 / 端口这类会变的值必须用它）', async () => {
    const { ctx } = boot()
    let port = 1
    ctx.plugin({ name: 'p', apply: (c) => { c.agent.systemPrompt(() => 'port=' + port, { id: 'p:x' }) } })
    await ctx.start()
    expect(listAgentPromptSections(ctx)[0]!.text).toBe('port=1')
    port = 2
    // 不重注册，直接再读 —— 拿到的是新值（写死成字符串就把旧值冻住了）
    expect(listAgentPromptSections(ctx)[0]!.text).toBe('port=2')
    ctx.stop()
  })

  it('按 order 排序（小的在前），并带 source（设置页要显示谁加的）', async () => {
    const { ctx } = boot()
    ctx.plugin({
      name: 'beta',
      apply: (c) => { c.agent.systemPrompt('B', { id: 'beta:s', order: 20 }) },
    })
    ctx.plugin({
      name: 'alpha',
      apply: (c) => { c.agent.systemPrompt('A', { id: 'alpha:s', order: 10 }) },
    })
    await ctx.start()
    const sections = listAgentPromptSections(ctx)
    expect(sections.map((s) => s.text)).toEqual(['A', 'B'])
    expect(sections.map((s) => s.source)).toEqual(['alpha', 'beta'])
    ctx.stop()
  })

  it('卸载插件 → 它加的小节消失（注册场回收）', async () => {
    const { ctx } = boot()
    ctx.plugin({ name: 'temp', apply: (c) => { c.agent.systemPrompt('临时', { id: 'temp:s' }) } })
    await ctx.start()
    expect(listAgentPromptSections(ctx)).toHaveLength(1)
    ctx.uninstallPlugin('temp')
    expect(listAgentPromptSections(ctx)).toHaveLength(0)
    ctx.stop()
  })

  it('next() 调两次：报错要说清是哪个插件（真机探针：从前只有 500 + 堆栈）', async () => {
    const { ctx } = boot()
    ctx.plugin({
      name: 'careless-plugin',
      apply: (c) => {
        c.agent.use(async (_t, next) => {
          await next()
          return next() // 错在这里
        })
      },
    })
    await ctx.start()
    await expect(runAgentMiddleware(ctx, turn('hi'))).rejects.toThrow(/careless-plugin/)
    ctx.stop()
  })
})
