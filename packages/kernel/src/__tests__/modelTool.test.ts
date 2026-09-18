/**
 * modelTool 单测 —— 设计文档「步骤 6 · 补工具那 4 个缺口」的契约（§7.2 / §7.3 / §7.4）。
 *
 * 锁的核心是三件事：
 * 1. **两套工具不混**：模型可调用工具走注册场 ctx.registryOf('tool')，不碰内核服务 ctx.tools；
 * 2. **不新造词表**：defineTool 把已有的 ToolParamDef（type/options/min/max/step/default）转成 JSON Schema，
 *    产物再按 output.schema 规范化、按 output.render 渲染成可持久化内容块；
 * 3. **观察者插件能跑**：tools/result 在结果物化时发（在 invoke 兑现之前），且事件名已登记（dev 下不 warn）。
 */
import { describe, it, expect, vi } from 'vitest'
import { Context } from '../Context'
import type { PluginScope } from '../types'
import { RegistryImpl } from '../registry/registry'
import {
  defineTool,
  runToolCall,
  toolParamsToJsonSchema,
  validateToolValue,
  type ToolSpec,
  type ToolCallContext,
} from '../modelTool'

/** 静默发射口（不需要观察者时用） */
const silent = { emit: () => undefined }

/** 一个"打招呼"工具（教程第 7 章的等价物） */
function greetTool(): ToolSpec {
  return defineTool({
    description: '打个招呼',
    parameters: { name: { type: 'string', required: true, description: 'Who to greet' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      return 'Hello, ' + String(args.name) + '!'
    },
  })
}

describe('缺口② defineTool：parameters → JSON Schema（复用 ToolParamDef，不新造词表）', () => {
  it('映射形态：键即参数名；type 缺省按 string；description 原样带上；required 汇总', () => {
    const schema = toolParamsToJsonSchema({
      name: { type: 'string', required: true, description: 'Who to greet' },
      note: { description: '备注' },
    })
    expect(schema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Who to greet' },
        note: { type: 'string', description: '备注' },
      },
      required: ['name'],
    })
  })

  it('select → enum（取 options.value）；number → minimum/maximum/multipleOf；boolean → boolean', () => {
    const schema = toolParamsToJsonSchema({
      ratio: {
        type: 'select',
        options: [
          { label: '1:1', value: '1:1' },
          { label: '16:9', value: '16:9' },
        ],
      },
      seed: { type: 'number', min: 0, max: 100, step: 1, default: 42 },
      upscale: { type: 'boolean' },
    })
    expect(schema.properties?.ratio).toEqual({ type: 'string', enum: ['1:1', '16:9'] })
    expect(schema.properties?.seed).toEqual({
      type: 'number',
      minimum: 0,
      maximum: 100,
      multipleOf: 1,
      default: 42,
    })
    expect(schema.properties?.upscale).toEqual({ type: 'boolean' })
  })

  it('没有必填参数时不出现 required 字段；没有 parameters 时是空对象根', () => {
    expect(toolParamsToJsonSchema({ a: { type: 'string' } }).required).toBeUndefined()
    expect(toolParamsToJsonSchema({})).toEqual({ type: 'object', properties: {} })
  })

  it('嵌套：object 子结构也能校验（路径写到 a.b[0]）', () => {
    const schema: Parameters<typeof validateToolValue>[0] = {
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
      },
    }
    expect(validateToolValue(schema, { list: [{ ok: true }] })).toEqual([])
    expect(validateToolValue(schema, { list: [{ ok: 'yes' }] })[0]).toContain('list[0].ok')
    expect(validateToolValue(schema, { list: [{}] })[0]).toContain('list[0].ok')
  })

  it('校验：缺必填 / 类型不对 / enum 外 / 超范围 都报出来（带路径）', () => {
    const schema = toolParamsToJsonSchema({
      name: { type: 'string', required: true },
      ratio: { type: 'select', options: [{ label: '1:1', value: '1:1' }] },
      seed: { type: 'number', min: 0, max: 10 },
    })
    expect(validateToolValue(schema, { name: 'ok', ratio: '1:1', seed: 5 })).toEqual([])
    const bad = validateToolValue(schema, { ratio: '2:1', seed: 99 }).join(' | ')
    expect(bad).toMatch(/name/)
    expect(bad).toMatch(/ratio/)
    expect(bad).toMatch(/seed/)
  })
})

describe('缺口② + ④：defineTool 派生 + output.schema/render 物化', () => {
  it('defineTool 派生 schema；execute 收到校验后的参数；产物按 render 渲染成内容块', async () => {
    const spec = greetTool()
    expect(spec.parameters).toEqual({
      type: 'object',
      properties: { name: { type: 'string', description: 'Who to greet' } },
      required: ['name'],
    })
    const table = new RegistryImpl<ToolSpec>()
    table.add('greet', spec)
    const r = await runToolCall(table, silent, { name: 'greet', arguments: { name: 'Cordis' } })
    expect(r.ok).toBe(true)
    expect(r.value).toBe('Hello, Cordis!')
    expect(r.content).toEqual([{ type: 'text', text: 'Hello, Cordis!' }])
    expect(r.name).toBe('greet')
  })

  it('没给 render 时默认渲染：string → text 块，其它 → json 块', async () => {
    const str = defineTool({ description: 'x', execute: () => 'plain' })
    const obj = defineTool({ description: 'y', execute: () => ({ n: 1 }) })
    const table = new RegistryImpl<ToolSpec>()
    table.add('str', str)
    table.add('obj', obj)
    expect((await runToolCall(table, silent, { name: 'str' })).content).toEqual([
      { type: 'text', text: 'plain' },
    ])
    expect((await runToolCall(table, silent, { name: 'obj' })).content).toEqual([
      { type: 'json', value: { n: 1 } },
    ])
  })

  it('参数不合法 → 不执行 execute，ok:false 且写明违规项', async () => {
    const table = new RegistryImpl<ToolSpec>()
    let called = false
    table.add(
      'greet',
      defineTool({
        description: 'x',
        parameters: { name: { type: 'string', required: true } },
        execute: () => {
          called = true
          return 'nope'
        },
      }),
    )
    const r = await runToolCall(table, silent, { name: 'greet', arguments: {} })
    expect(called).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/name/)
    expect(r.content).toEqual([])
  })

  it('产物不符 output.schema → ok:false（规范化拦住"声明 string 却返回数字"）', async () => {
    const table = new RegistryImpl<ToolSpec>()
    table.add('bad', defineTool({ description: 'x', output: { schema: { type: 'string' } }, execute: () => 42 }))
    const r = await runToolCall(table, silent, { name: 'bad' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/schema/)
  })

  it('execute 抛错 / render 抛错 → 都收敛成 ok:false，不往外炸', async () => {
    const table = new RegistryImpl<ToolSpec>()
    table.add(
      'boom',
      defineTool({
        description: 'x',
        execute: () => {
          throw new Error('密钥无效')
        },
      }),
    )
    table.add(
      'badrender',
      defineTool({
        description: 'x',
        output: {
          schema: { type: 'json' },
          render: () => {
            throw new Error('渲染器坏了')
          },
        },
        execute: () => 1,
      }),
    )
    expect((await runToolCall(table, silent, { name: 'boom' })).error).toBe('密钥无效')
    expect((await runToolCall(table, silent, { name: 'badrender' })).error).toMatch(/渲染/)
  })

  it('未找到工具 → ok:false（不静默成功）', async () => {
    const r = await runToolCall(new RegistryImpl<ToolSpec>(), silent, { name: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/未找到工具/)
  })
})

describe('缺口③ callId / signal：调用可关联、可取消', () => {
  it('callId 透传给 execute 与 tools/result；未给时内核自动生成', async () => {
    const table = new RegistryImpl<ToolSpec>()
    const seen: ToolCallContext[] = []
    table.add(
      'probe',
      defineTool({
        description: 'x',
        execute: (_args, ctx) => {
          seen.push(ctx)
          return 'ok'
        },
      }),
    )
    const events: Array<{ callId: string; execCallId: string }> = []
    const emitter = {
      emit: (name: string, exec: { callId: string }, result: { callId: string }) => {
        if (name === 'tools/result') events.push({ callId: result.callId, execCallId: exec.callId })
      },
    }
    const r = await runToolCall(table, emitter, { name: 'probe', callId: 'demo-1' })
    expect(seen[0].callId).toBe('demo-1')
    expect(r.callId).toBe('demo-1')
    expect(events).toEqual([{ callId: 'demo-1', execCallId: 'demo-1' }])

    const auto = await runToolCall(table, emitter, { name: 'probe' })
    expect(auto.callId).toBeTruthy()
    expect(seen[1].callId).toBe(auto.callId)
  })

  it('signal 已 abort → 不执行 execute，直接 ok:false', async () => {
    const table = new RegistryImpl<ToolSpec>()
    let called = false
    table.add(
      'probe',
      defineTool({
        description: 'x',
        execute: () => {
          called = true
          return 'ok'
        },
      }),
    )
    const ac = new AbortController()
    ac.abort()
    const r = await runToolCall(table, silent, { name: 'probe', signal: ac.signal })
    expect(called).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/取消/)
  })

  it('执行期间 abort：工具能读到 ctx.signal；结果收敛为 ok:false（可取消有牙）', async () => {
    const table = new RegistryImpl<ToolSpec>()
    const ac = new AbortController()
    let sawSignal: AbortSignal | undefined
    table.add(
      'slow',
      defineTool({
        description: 'x',
        async execute(_args, ctx) {
          sawSignal = ctx.signal
          ac.abort() // 模拟调用方中途取消
          return '迟到的成功'
        },
      }),
    )
    const r = await runToolCall(table, silent, { name: 'slow', signal: ac.signal })
    expect(sawSignal).toBe(ac.signal)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/取消/)
  })
})

describe('缺口① tools/* 事件（观察者插件的地基）', () => {
  it('tools/registered 在放入时发（带工具名、工具、放置方 = 插件名）', async () => {
    const ctx = new Context()
    const seen: Array<{ name: string; source: string; hasExec: boolean }> = []
    ctx.plugin({
      name: 'logger',
      apply(c: PluginScope) {
        c.on('tools/registered', (name, tool, source) => {
          seen.push({ name, source, hasExec: typeof tool.execute === 'function' })
        })
      },
    })
    ctx.plugin({
      name: 'greet-tool',
      apply(c: PluginScope) {
        c.registryOf<ToolSpec>('tool').add('greet', greetTool())
      },
    })
    await ctx.start()
    expect(seen).toEqual([{ name: 'greet', source: 'greet-tool', hasExec: true }])
    ctx.stop()
  })

  it('tools/unregistered 在撤销时发；插件热卸后它的工具一条不留', async () => {
    const ctx = new Context()
    const gone: string[] = []
    ctx.plugin({
      name: 'logger',
      apply(c: PluginScope) {
        c.on('tools/unregistered', (name) => {
          gone.push(name)
        })
      },
    })
    let handle: { dispose(): void } | undefined
    ctx.plugin({
      name: 'greet-tool',
      apply(c: PluginScope) {
        handle = c.registryOf<ToolSpec>('tool').add('greet', greetTool())
      },
    })
    await ctx.start()
    expect(ctx.registryOf<ToolSpec>('tool').top('greet')).toBeDefined()

    handle?.dispose()
    expect(gone).toEqual(['greet'])

    ctx.uninstallPlugin('greet-tool')
    expect(ctx.registryOf<ToolSpec>('tool').has('greet')).toBe(false)
    ctx.stop()
  })

  it('tools/result 在结果物化时发，且先于 runToolCall 的 promise 兑现', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.plugin({
      name: 'logger',
      apply(c: PluginScope) {
        c.on('tools/result', (exec, result) => {
          order.push('event:' + exec.name + ':' + result.content.length)
        })
      },
    })
    ctx.plugin({
      name: 'greet-tool',
      apply(c: PluginScope) {
        c.registryOf<ToolSpec>('tool').add('greet', greetTool())
      },
    })
    await ctx.start()
    await runToolCall(ctx.registryOf<ToolSpec>('tool'), ctx, { name: 'greet', arguments: { name: 'x' } })
    order.push('returned')
    expect(order).toEqual(['event:greet:1', 'returned'])
    ctx.stop()
  })

  it('dev 下三个事件名都已登记（不 warn）；未登记名仍会 warn（证明机制活着）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ctx = new Context({ dev: true })
      ctx.plugin({
        name: 'greet-tool',
        apply(c: PluginScope) {
          const h = c.registryOf<ToolSpec>('tool').add('greet', greetTool())
          c.effect(() => () => h.dispose())
        },
      })
      await ctx.start()
      await runToolCall(ctx.registryOf<ToolSpec>('tool'), ctx, { name: 'greet', arguments: { name: 'x' } })
      expect(warn).not.toHaveBeenCalled()

      ctx.emit('some/typo', 1)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('some/typo')
      ctx.stop()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('验收硬指标：教程第 7 章的 tool-logger 观察者插件能真跑起来', () => {
  it('两个互不认识的插件由注册场 + tools/result 连起来，打印每次调用', async () => {
    const ctx = new Context({ dev: true })
    const lines: string[] = []
    // 提供方：把模型可调用工具放进注册场（不 inject 'tools'，也不用 ctx.tools）
    ctx.plugin({
      name: 'greet-tool',
      apply(c: PluginScope) {
        c.registryOf<ToolSpec>('tool').add('greet', greetTool())
      },
    })
    // 观察方：只听事件，不认识提供方
    ctx.plugin({
      name: 'tool-logger',
      apply(c: PluginScope) {
        c.on('tools/result', (exec, result) => {
          const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
          lines.push('[tool-logger] ' + exec.name + ' -> ' + text)
        })
      },
    })
    await ctx.start()

    // 测试充当"模型"那一侧：经注册场取工具并跑一次
    const result = await runToolCall(ctx.registryOf<ToolSpec>('tool'), ctx, {
      name: 'greet',
      arguments: { name: 'Cordis' },
      callId: 'demo-1',
      signal: new AbortController().signal,
    })

    expect(lines).toEqual(['[tool-logger] greet -> Hello, Cordis!'])
    expect(result.content).toEqual([{ type: 'text', text: 'Hello, Cordis!' }])
    ctx.stop()
  })
})
