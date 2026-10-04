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
import { runAgentMiddleware, type AgentTurn } from '../serverFramework/agent.js'

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

  it('systemPrompt 把文本拼到提示词前面', async () => {
    const { ctx } = boot()
    ctx.plugin({ name: 'sys', apply: (c) => { c.agent.systemPrompt('[规则] 只答十个字内') } })
    await ctx.start()
    const t = turn('你好')
    await runAgentMiddleware(ctx, t)
    expect(t.input.text).toContain('[规则]')
    expect(t.input.text).toContain('你好')
    ctx.stop()
  })
})
