/**
 * ToolRegistry 单测 —— 工具这一层的契约（纯逻辑，零 DOM）。
 *
 * 锁的核心是"异步形态归一化"：第三方 API 有的同步返回、有的提交任务后轮询，
 * 调用方（节点 UI）只该处理一种返回形态，轮询/超时/异常都在这里收敛掉。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import {
  ToolRegistry,
  resolveToolParams,
  resolveToolTemplates,
  type ToolDef,
  type ToolPollState,
} from '../toolRegistry'

/** 一个最简工具（同步返回） */
function syncTool(over: Partial<ToolDef> = {}): ToolDef {
  return {
    name: 'demo.sync',
    title: '同步工具',
    group: '图片生成',
    produces: 'image',
    run: () => ({ ok: true, urls: ['a.png'] }),
    ...over,
  }
}

describe('ToolRegistry 注册与查询', () => {
  it('注册后可按名取得；has/get/list 三种查法一致', () => {
    const reg = new ToolRegistry()
    reg.register(syncTool())
    expect(reg.has('demo.sync')).toBe(true)
    expect(reg.get('demo.sync')?.title).toBe('同步工具')
    expect(reg.list().map((t) => t.name)).toEqual(['demo.sync'])
  })

  it('同名重复注册抛错（防静默覆盖：两个插件抢同一个工具名要立刻暴露）', () => {
    const reg = new ToolRegistry()
    reg.register(syncTool())
    expect(() => reg.register(syncTool())).toThrow(/already registered/)
  })

  it('缺 name 抛错', () => {
    const reg = new ToolRegistry()
    expect(() => reg.register(syncTool({ name: '' }))).toThrow(/必须有 name/)
  })

  it('dispose 注销；撤销后同名可重新注册（热重载场景）', () => {
    const reg = new ToolRegistry()
    const h = reg.register(syncTool())
    h.dispose()
    expect(reg.has('demo.sync')).toBe(false)
    expect(() => reg.register(syncTool())).not.toThrow()
  })

  it('dispose 幂等，且不会误删顶替者', () => {
    const reg = new ToolRegistry()
    const h = reg.register(syncTool())
    h.dispose()
    const h2 = reg.register(syncTool({ title: '新版本' }))
    h.dispose() // 旧的再撤一次：不该把新注册的删掉
    expect(reg.get('demo.sync')?.title).toBe('新版本')
    h2.dispose()
  })
})

describe('ToolRegistry 筛选', () => {
  it('按 group / produces 过滤', () => {
    const reg = new ToolRegistry()
    reg.register(syncTool({ name: 'image.a', group: '图片生成', produces: 'image' }))
    reg.register(syncTool({ name: 'text.a', group: '文本生成', produces: 'text' }))

    expect(reg.list({ group: '文本生成' }).map((t) => t.name)).toEqual(['text.a'])
    expect(reg.list({ produces: 'image' }).map((t) => t.name)).toEqual(['image.a'])
  })

  it('按可接受输入过滤：未声明 accepts = 不挑食，任何输入都收', () => {
    const reg = new ToolRegistry()
    reg.register(syncTool({ name: 'any.input' })) // 不声明 accepts
    reg.register(syncTool({ name: 'only.image', accepts: ['image'] }))
    reg.register(syncTool({ name: 'only.text', accepts: ['text'] }))

    expect(reg.list({ accepts: 'image' }).map((t) => t.name)).toEqual(['any.input', 'only.image'])
    expect(reg.list({ accepts: 'text' }).map((t) => t.name)).toEqual(['any.input', 'only.text'])
  })

  it('accepts 为空数组同样视为不挑食（避免"空数组=全拒"的隐式坑）', () => {
    const reg = new ToolRegistry()
    reg.register(syncTool({ name: 'empty.accepts', accepts: [] }))
    expect(reg.list({ accepts: 'image' }).map((t) => t.name)).toEqual(['empty.accepts'])
  })
})

describe('ToolRegistry.invoke 异步形态归一化', () => {
  it('同步工具：直接返回结果', async () => {
    const reg = new ToolRegistry()
    reg.register(syncTool())
    await expect(reg.invoke('demo.sync', {})).resolves.toEqual({ ok: true, urls: ['a.png'] })
  })

  it('轮询工具：驱动到 done，并把每步 running 进度转发出去', async () => {
    const reg = new ToolRegistry()
    const steps: ToolPollState[] = [
      { status: 'running', progress: 30, message: '构图', taskId: 't1' },
      { status: 'running', progress: 70, message: '采样', taskId: 't1' },
      { status: 'done', result: { ok: true, urls: ['out.png'], taskId: 't1' } },
    ]
    let i = 0
    reg.register(syncTool({ name: 'demo.poll', run: () => () => steps[i++] }))

    const seen: Array<number | undefined> = []
    const result = await reg.invoke('demo.poll', {}, { interval: 1, onProgress: (p) => seen.push(p.progress) })

    expect(result).toEqual({ ok: true, urls: ['out.png'], taskId: 't1' })
    expect(seen).toEqual([30, 70]) // 两次 running 各转发一次；done 不再转发
  })

  it('工具 run 抛异常 → 收敛成 ok:false（调用方不必到处写 try/catch）', async () => {
    const reg = new ToolRegistry()
    reg.register(syncTool({ run: () => { throw new Error('密钥无效') } }))
    await expect(reg.invoke('demo.sync', {})).resolves.toEqual({ ok: false, error: '密钥无效' })
  })

  it('轮询过程中抛异常 → 同样收敛成 ok:false，不留悬挂', async () => {
    const reg = new ToolRegistry()
    let called = 0
    reg.register(syncTool({
      name: 'demo.boom',
      run: () => () => {
        called += 1
        if (called > 1) throw new Error('连接中断')
        return { status: 'running' as const, progress: 10 }
      },
    }))
    await expect(reg.invoke('demo.boom', {}, { interval: 1 })).resolves.toEqual({ ok: false, error: '连接中断' })
  })

  it('轮询超时 → 报超时失败（不让 UI 一直转圈）', async () => {
    const reg = new ToolRegistry()
    reg.register(syncTool({
      name: 'demo.slow',
      run: () => () => ({ status: 'running' as const, progress: 1, taskId: 'slow' }),
    }))
    const result = await reg.invoke('demo.slow', {}, { interval: 1, timeoutMs: 5 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/超时/)
    expect(result.taskId).toBe('slow')
  })

  it('调用不存在的工具 → 明确报错（不静默成功）', async () => {
    const reg = new ToolRegistry()
    const r = await reg.invoke('nope', {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/未找到工具/)
  })

  it('run 收到调用方给的上下文（节点 id / 画布 id）', async () => {
    const reg = new ToolRegistry()
    let got: unknown
    reg.register(syncTool({ run: (_input, ctx) => { got = ctx; return { ok: true } } }))
    await reg.invoke('demo.sync', { prompt: '一只猫' }, { ctx: { nodeId: 'n1', canvasId: 'c1' } })
    expect(got).toEqual({ nodeId: 'n1', canvasId: 'c1' })
  })
})

describe('resolveToolTemplates —— 模板下拉的数据来源', () => {
  const withOwn: ToolDef = syncTool({
    name: 'image.a',
    templates: [
      { id: 'clear', name: '高清写实', prompt: '高清写实风格' },
      { id: 'blank', name: '留白极简', prompt: '极简留白构图' },
    ],
  })
  const shared: ToolDef = syncTool({
    name: 'image.b',
    templates: [
      { id: 'poster', name: '海报感', prompt: '电影海报构图', forTools: ['image.a'] },
      { id: 'other', name: '只给 b', prompt: 'x', forTools: ['image.b'] },
    ],
  })

  it('工具自己声明的模板全部列出', () => {
    expect(resolveToolTemplates(withOwn).map((t) => t.id)).toEqual(['clear', 'blank'])
  })

  it('收集其它工具里 forTools 命中本工具的共享模板', () => {
    expect(resolveToolTemplates(withOwn, [withOwn, shared]).map((t) => t.id)).toEqual([
      'clear',
      'blank',
      'poster',
    ])
  })

  it('forTools 不命中的模板不出现（避免把别家模板塞进来）', () => {
    const ids = resolveToolTemplates(withOwn, [withOwn, shared]).map((t) => t.id)
    expect(ids).not.toContain('other')
  })

  it('没有 forTools 的共享模板不自动收集（只在它自己的工具下出现）', () => {
    const noScope: ToolDef = syncTool({ name: 'image.c', templates: [{ id: 'globalish', name: 'x', prompt: 'y' }] })
    expect(resolveToolTemplates(withOwn, [withOwn, noScope]).map((t) => t.id)).toEqual(['clear', 'blank'])
  })

  it('同 id 去重（先到先得），不让下拉出现两条一样的', () => {
    const dup: ToolDef = syncTool({
      name: 'image.d',
      templates: [{ id: 'clear', name: '另一份同名', prompt: 'z', forTools: ['image.a'] }],
    })
    const list = resolveToolTemplates(withOwn, [withOwn, dup])
    expect(list.map((t) => t.id)).toEqual(['clear', 'blank'])
    expect(list[0].name).toBe('高清写实') // 工具自己的优先
  })

  it('没选工具 / 没有模板 → 空数组（调用方无需判空）', () => {
    expect(resolveToolTemplates(undefined)).toEqual([])
    expect(resolveToolTemplates(syncTool())).toEqual([])
  })
})

describe('resolveToolParams —— 参数默认值收敛成一处口径', () => {
  const def = syncTool({
    params: [
      { key: 'ratio', type: 'select', options: [{ label: '1:1', value: '1:1' }, { label: '16:9', value: '16:9' }] },
      { key: 'resolution', type: 'select', default: '2k', options: [{ label: '1k', value: '1k' }, { label: '2k', value: '2k' }] },
      { key: 'seed', type: 'number', default: 42 },
      { key: 'style', type: 'string' },
    ],
  })

  it('无当前值时：下拉取第一项、有默认用默认、没有的留空（不编造）', () => {
    expect(resolveToolParams(def)).toEqual({ ratio: '1:1', resolution: '2k', seed: 42 })
  })

  it('已有用户选择时原样保留（不覆盖用户选的值）', () => {
    expect(resolveToolParams(def, { ratio: '16:9', seed: 7 })).toMatchObject({ ratio: '16:9', seed: 7 })
  })

  it('空串视为"没选"→ 回落默认（清空下拉后不该把空串发给 API）', () => {
    expect(resolveToolParams(def, { ratio: '' }).ratio).toBe('1:1')
  })

  it('工具不存在或没声明参数 → 空对象（调用方无需判空）', () => {
    expect(resolveToolParams(undefined)).toEqual({})
    expect(resolveToolParams(syncTool())).toEqual({})
  })
})

describe('内核接入：ctx.tools 与 ctx.get("tools") 是同一个表', () => {
  it('插件经 ctx.tools.register 注册后，节点侧 ctx.get("tools") 能查到并调用', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'tool-provider',
      apply(c: Context) {
        c.tools.register(syncTool({ name: 'plugin.tool' }))
      },
    })
    await ctx.start()

    const reg = ctx.get<ToolRegistry>('tools')
    expect(reg.has('plugin.tool')).toBe(true)
    await expect(reg.invoke('plugin.tool', {})).resolves.toEqual({ ok: true, urls: ['a.png'] })
  })

  it('插件卸载后它注册的工具一起回收（不留死工具）', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'tool-provider',
      apply(c: Context) {
        c.tools.register(syncTool({ name: 'plugin.tool' }))
      },
    })
    await ctx.start()
    const reg = ctx.get<ToolRegistry>('tools')
    expect(reg.has('plugin.tool')).toBe(true)

    ctx.stop()
    expect(ctx.get<ToolRegistry>('tools').has('plugin.tool')).toBe(false)
  })

  it('inject:["tools"] 的插件可正常激活（内置服务恒在，不该卡 PENDING）', async () => {
    const ctx = new Context()
    let activated = false
    ctx.plugin({
      name: 'tool-consumer',
      inject: ['tools'],
      apply() {
        activated = true
      },
    })
    await ctx.start()
    expect(activated).toBe(true)
    ctx.stop()
  })
})

