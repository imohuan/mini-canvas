/**
 * 插件装配与生命周期 —— 经**真实内核 Context**装载本插件，验证：
 * - 装载后 ctx.get('tools') 能列出全部生成工具；
 * - 卸载后工具从注册表消失（回收真的生效，不是靠 Context.stop 整体重置）；
 * - 端到端：ctx.tools.invoke（假 fetch → 轮询 running → done）能拿到 urls。
 */
import { describe, it, expect } from 'vitest'
import { type ToolDef } from '@mini-canvas/kernel'
import { Context } from '@mini-canvas/canvas-data'
import { pluginImageGenerationTools } from '../imageGenerationPlugin'
import { createImageGenerationTool, buildToolName } from '../imageGenerationTools'
import { IMAGE_MODELS } from '../imageModels'
import { createFakeFetch, alwaysJson } from './fakeFetch'

const BASE = 'http://backend.test'

/** 用给定 fetch 装配插件（fetch 经 Config 无法注入 → 用工厂函数注册，等价于插件内部那一步） */
async function bootWithTools(fetchImpl: ReturnType<typeof createFakeFetch>['fetchImpl']) {
  const ctx = new Context()
  const register = {
    name: 'test-image-tools',
    inject: ['tools'] as string[],
    apply(scope: Context) {
      for (const m of IMAGE_MODELS) {
        scope.tools.register(createImageGenerationTool(m, { baseUrl: BASE, fetchImpl }))
      }
    },
  }
  ctx.plugin(register)
  await ctx.start()
  return ctx
}

describe('插件装配（真实内核 Context）', () => {
  it('装载 pluginImageGenerationTools 后，ctx.get("tools") 能列出全部图片生成工具', async () => {
    const ctx = new Context()
    ctx.plugin(pluginImageGenerationTools)
    await ctx.start()

    const tools = ctx.get<{ list(filter?: { produces?: string }): ToolDef[] }>('tools')
    expect(tools.list({ produces: 'image' })).toHaveLength(IMAGE_MODELS.length)
    ctx.stop()
  })

  it('ctx.tools 能力段与 ctx.get("tools") 是同一张表（插件注册、节点可见）', async () => {
    const ctx = new Context()
    ctx.plugin(pluginImageGenerationTools)
    await ctx.start()

    expect(ctx.tools.list({ produces: 'image' })).toHaveLength(IMAGE_MODELS.length)
    expect(ctx.tools.has(buildToolName(IMAGE_MODELS[0].model))).toBe(true)
    ctx.stop()
  })

  it('插件声明的 Config 有默认值，apply 不传 config 也能工作', async () => {
    // Config 是模块级导出，内核装配时校验；这里断言 schema 本身给了默认值
    const schema = pluginImageGenerationTools.Config!
    for (const field of Object.values(schema)) {
      expect(field.default).toBeDefined()
    }
    const ctx = new Context()
    ctx.plugin(pluginImageGenerationTools)
    await ctx.start()
    expect(ctx.tools.list()).toHaveLength(IMAGE_MODELS.length)
    ctx.stop()
  })
})

describe('卸载回收', () => {
  it('uninstallPlugin 后工具从注册表消失（不靠 Context.stop 的整体重置）', async () => {
    const ctx = new Context()
    ctx.plugin(pluginImageGenerationTools)
    await ctx.start()
    expect(ctx.tools.list()).toHaveLength(IMAGE_MODELS.length)

    expect(ctx.uninstallPlugin('tool-image-generation')).toBe(true)
    expect(ctx.tools.list()).toHaveLength(0)
    ctx.stop()
  })

  it('重装同插件后工具回来（回收干净、不残留、不冲突）', async () => {
    const ctx = new Context()
    ctx.plugin(pluginImageGenerationTools)
    await ctx.start()
    ctx.uninstallPlugin('tool-image-generation')
    expect(ctx.tools.list()).toHaveLength(0)

    ctx.installPlugin(pluginImageGenerationTools)
    expect(ctx.tools.list()).toHaveLength(IMAGE_MODELS.length)
    ctx.stop()
  })

  it('stop() 后工具注册表被重置为空', async () => {
    const ctx = new Context()
    ctx.plugin(pluginImageGenerationTools)
    await ctx.start()
    ctx.stop()
    expect(ctx.tools.list()).toHaveLength(0)
  })
})

describe('端到端：ctx.tools.invoke（假 fetch → 轮询 → urls）', () => {
  it('提交 → 两轮 running（进度被转发）→ done，最终拿到 urls', async () => {
    const { fetchImpl, requests } = createFakeFetch([
      // 1) POST /api/tasks
      { kind: 'json', body: { ok: true, taskId: 'task-42', status: 'pending' } },
      // 2) 第一轮轮询：排队中
      { kind: 'json', body: { ok: true, task: { status: 'pending' } } },
      // 3) 第二轮轮询：采样中
      { kind: 'json', body: { ok: true, task: { status: 'processing', progress: 60, message: '采样中' } } },
      // 4) 第三轮：完成
      {
        kind: 'json',
        body: { ok: true, task: { status: 'done', result: { ok: true, urls: ['http://cdn/out.png'] } } },
      },
    ])
    const ctx = await bootWithTools(fetchImpl)

    const progress: Array<{ progress?: number; message?: string }> = []
    const result = await ctx.tools.invoke(
      buildToolName(IMAGE_MODELS[0].model),
      { prompt: '一只猫', params: { ratio: '1:1', resolution: '1k' }, resources: [] },
      {
        // 轮询间隔调小，测试不必真等 650ms
        interval: 1,
        ctx: { nodeId: 'node-1', canvasId: 'canvas-1' },
        onProgress: (p) => progress.push({ progress: p.progress, message: p.message }),
      },
    )

    expect(result).toEqual({ ok: true, urls: ['http://cdn/out.png'], taskId: 'task-42' })
    // 两个 running 各转发一次进度
    expect(progress).toHaveLength(2)
    expect(progress[1]).toEqual({ progress: 60, message: '采样中' })

    // 第一次是 POST 提交，其余是 GET 轮询
    expect(requests[0].method).toBe('POST')
    expect(requests[1].url).toBe(`${BASE}/api/tasks/task-42`)
    expect(requests[1].method).toBe('GET')
    ctx.stop()
  })

  it('端到端失败：后台任务 error → invoke 返回 ok:false（不带 urls）', async () => {
    const { fetchImpl } = createFakeFetch([
      { kind: 'json', body: { ok: true, taskId: 'task-9' } },
      { kind: 'json', body: { ok: true, task: { status: 'error', error: '额度不足' } } },
    ])
    const ctx = await bootWithTools(fetchImpl)

    const result = await ctx.tools.invoke(
      buildToolName(IMAGE_MODELS[0].model),
      { prompt: 'x' },
      { interval: 1, ctx: { nodeId: 'n', canvasId: 'c' } },
    )
    expect(result).toEqual({ ok: false, error: '额度不足', taskId: 'task-9' })
    expect(result.urls).toBeUndefined()
    ctx.stop()
  })

  it('端到端：后台连不上 → invoke 收敛成 ok:false（不抛异常）', async () => {
    const { fetchImpl } = createFakeFetch([{ kind: 'throw', error: new Error('ECONNREFUSED') }])
    const ctx = await bootWithTools(fetchImpl)

    const result = await ctx.tools.invoke(
      buildToolName(IMAGE_MODELS[0].model),
      { prompt: 'x' },
      { interval: 1, ctx: { nodeId: 'n', canvasId: 'c' } },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ECONNREFUSED')
    ctx.stop()
  })

  it('调用不存在的工具 → 内核返回明确错误', async () => {
    const ctx = await bootWithTools(alwaysJson({}).fetchImpl)
    const result = await ctx.tools.invoke('image.generate:没这个模型', { prompt: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('未找到工具')
    ctx.stop()
  })
})
