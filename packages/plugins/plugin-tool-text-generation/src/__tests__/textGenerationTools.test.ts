/**
 * textGenerationTools 单测 —— 注册 / 参数 schema / 请求组装 / 轮询映射 / 错误收敛。
 * 全部用假 fetch，不碰真网络。
 *
 * 用户要求"注册放在一个单独的插件里，提供所需参数，然后生成，提供进度"——
 * 这条测试逐项锁住：能注册、参数按声明给、请求带上下文、进度被转发、失败如实上报。
 */
import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '@mini-canvas/kernel'
import {
  buildToolName,
  createTextGenerationTool,
  createTextGenerationTools,
  registerTextGenerationTools,
  registerFromBackend,
  toGenerationResources,
  TEXT_GENERATION_GROUP,
} from '../textGenerationTools'
import { TEXT_MODELS, DEFAULT_BASE_URL } from '../textModels'
import { createFakeFetch, alwaysJson } from './fakeFetch'

const BASE = 'http://backend.test'

/** 建一个干净的注册表（内核契约的同一实现） */
function newRegistry(): ToolRegistry {
  return new ToolRegistry()
}

/** 取一个必存在的模型（避免测试与模型表增删耦合） */
function modelWithThinking() {
  const cap = TEXT_MODELS.find((m) => m.thinking && m.thinking.length > 0)
  if (!cap) throw new Error('测试前提：内置模型表里应有一个声明思考程度的模型')
  return cap
}

describe('工具注册', () => {
  it('注册后能按名取到，且 produces 是 text（文本节点据此挑选）', () => {
    const reg = newRegistry()
    const [def] = registerTextGenerationTools(reg, { fetchImpl: alwaysJson({}).fetchImpl })
    expect(def.produces).toBe('text')
    expect(reg.has(def.name)).toBe(true)
    expect(reg.list({ produces: 'text' }).length).toBe(TEXT_MODELS.length)
  })

  it('产出为 text 的工具不会混进图片列表（两个清单互不污染）', () => {
    const reg = newRegistry()
    registerTextGenerationTools(reg, { fetchImpl: alwaysJson({}).fetchImpl })
    expect(reg.list({ produces: 'image' })).toEqual([])
  })

  it('工具名带 text.generate 前缀（与图片的 image.generate 区分开）', () => {
    const reg = newRegistry()
    registerTextGenerationTools(reg, { fetchImpl: alwaysJson({}).fetchImpl })
    expect(reg.list().every((t) => t.name.startsWith('text.generate:'))).toBe(true)
    expect(buildToolName('m1')).toBe('text.generate:m1')
  })

  it('注册宿主无效时抛出清晰错误（不静默什么都不做）', () => {
    expect(() => registerTextGenerationTools({} as never)).toThrow(/注册宿主无效/)
  })

  it('skipExisting：同名已存在时跳过（后台表补齐内置表时不撞名）', () => {
    const reg = newRegistry()
    const models = [TEXT_MODELS[0]]
    registerTextGenerationTools(reg, { fetchImpl: alwaysJson({}).fetchImpl, models })
    const again = registerTextGenerationTools(reg, {
      fetchImpl: alwaysJson({}).fetchImpl,
      models,
      skipExisting: true,
    })
    expect(again).toEqual([])
    expect(reg.list().length).toBe(1)
  })
})

describe('参数 schema（面板据此自动长控件）', () => {
  it('声明了思考程度的模型才给该参数，且选项名做了中文映射', () => {
    const cap = modelWithThinking()
    const def = createTextGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
    const thinking = def.params?.find((p) => p.key === 'thinking')
    expect(thinking).toBeTruthy()
    expect(thinking?.type).toBe('select')
    expect(thinking?.label).toBe('思考程度')
    // 每个选项都有 label + value，面板才能直接渲染下拉
    for (const o of thinking?.options ?? []) {
      expect(o.label).toBeTruthy()
      expect(o.value).toBeTruthy()
    }
    // 至少有一个档位被翻成中文（low→低 之类），不是原样英文
    expect(thinking?.options?.some((o) => /[\u4e00-\u9fa5]/.test(o.label))).toBe(true)
  })

  it('没声明思考程度的模型就不给该参数（面板整块不渲染）', () => {
    const cap = TEXT_MODELS.find((m) => !m.thinking)!
    const def = createTextGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
    expect(def.params?.some((p) => p.key === 'thinking')).toBe(false)
  })

  it('默认值取"适中档"（有 medium/normal 就优先它，而不是第一个）', () => {
    const cap = modelWithThinking()
    const def = createTextGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
    const thinking = def.params?.find((p) => p.key === 'thinking')
    expect(thinking?.default).toBe('medium')
    const length = def.params?.find((p) => p.key === 'length')
    if (length) expect(length.default).toBe('normal')
  })

  it('每个模型都声明了提示词模板（模板下拉的数据来源）', () => {
    for (const def of createTextGenerationTools({ fetchImpl: alwaysJson({}).fetchImpl })) {
      expect(def.templates?.length).toBeGreaterThan(0)
      for (const t of def.templates ?? []) {
        expect(t.id).toBeTruthy()
        expect(t.name).toBeTruthy()
        expect(t.prompt).toBeTruthy()
      }
    }
  })
})

describe('工具声明（标题/分组/接受输入）', () => {
  it('标题用中文 label、分组是「文本生成」', () => {
    const def = createTextGenerationTools({ fetchImpl: alwaysJson({}).fetchImpl })[0]
    expect(def.title).toBeTruthy()
    expect(def.group).toBe(TEXT_GENERATION_GROUP)
  })

  it('文本恒可接受；声明支持图片的模型额外接受 image', () => {
    const withImage = TEXT_MODELS.find((m) => m.supportsInput?.includes('image'))
    if (withImage) {
      const def = createTextGenerationTool(withImage, { fetchImpl: alwaysJson({}).fetchImpl })
      expect(def.accepts).toContain('text')
      expect(def.accepts).toContain('image')
    }
    const plain = TEXT_MODELS.find((m) => !m.supportsInput?.length)!
    const def = createTextGenerationTool(plain, { fetchImpl: alwaysJson({}).fetchImpl })
    expect(def.accepts).toEqual(['text'])
  })
})

describe('资源归一（文本给 value、图片给 url）', () => {
  it('文本资源带 value，图片资源带 url，互不混淆', () => {
    const out = toGenerationResources([
      { id: 't1', kind: 'text', name: '笔记', value: '内容' },
      { id: 'i1', kind: 'image', name: '图', url: 'i.png' },
    ])
    expect(out[0]).toMatchObject({ id: 't1', kind: 'text', value: '内容' })
    expect(out[0].url).toBeUndefined()
    expect(out[1]).toMatchObject({ id: 'i1', kind: 'image', url: 'i.png' })
    expect(out[1].value).toBeUndefined()
  })

  it('没有资源时给空数组（后台不必判 null）', () => {
    expect(toGenerationResources(undefined)).toEqual([])
  })
})

describe('run：提交任务的请求组装', () => {
  it('kind=text，带上模型/提示词/参数/上下文/素材', async () => {
    const cap = modelWithThinking()
    const { fetchImpl, requests } = createFakeFetch([
      { json: { ok: true, taskId: 't1' } },
      { json: { ok: true, task: { status: 'done', result: { ok: true, text: '结果' } } } },
    ])
    const def = createTextGenerationTool(cap, { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(def)

    await reg.invoke(def.name, {
      prompt: '写点什么',
      resources: [{ id: 'r1', kind: 'text', name: '素材', value: 'abc' }],
      params: { thinking: 'high' },
    }, { ctx: { nodeId: 'n1', canvasId: 'c1' } })

    const post = requests[0]
    expect(post.url).toBe(`${BASE}/api/tasks`)
    expect(post.method).toBe('POST')
    expect(post.body).toMatchObject({
      kind: 'text',
      canvasId: 'c1',
      targetNodeId: 'n1',
      promptText: '写点什么',
      thinking: 'high',
    })
    expect((post.body?.resources as unknown[]).length).toBe(1)
  })

  it('没给的参数不出现在请求体里（后台看到"没传"而不是空串）', async () => {
    const cap = TEXT_MODELS.find((m) => !m.thinking)!
    const { fetchImpl, requests } = createFakeFetch([
      { json: { ok: true, taskId: 't1' } },
      { json: { ok: true, task: { status: 'done', result: { ok: true, text: 'x' } } } },
    ])
    const def = createTextGenerationTool(cap, { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(def)
    await reg.invoke(def.name, { prompt: 'x' })
    expect(requests[0].body?.thinking).toBeUndefined()
  })

  it('mcpModel 存在时用它作为发给后台的 model', async () => {
    const cap = TEXT_MODELS.find((m) => m.mcpModel)!
    const { fetchImpl, requests } = createFakeFetch([
      { json: { ok: true, taskId: 't1' } },
      { json: { ok: true, task: { status: 'done', result: { ok: true, text: 'x' } } } },
    ])
    const def = createTextGenerationTool(cap, { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(def)
    await reg.invoke(def.name, { prompt: 'x' })
    expect(requests[0].body?.model).toBe(cap.mcpModel)
  })
})

describe('run：轮询状态映射', () => {
  it('processing → running 且带进度与文案', async () => {
    const def = createTextGenerationTools({ baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })[0]
    const { fetchImpl } = createFakeFetch([
      { json: { ok: true, taskId: 't1' } },
      { json: { ok: true, task: { status: 'processing', progress: 40, message: '写作中' } } },
    ])
    const rolling = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(rolling)

    const seen: Array<number | undefined> = []
    const result = await reg.invoke(rolling.name, { prompt: 'x' }, {
      interval: 1,
      timeoutMs: 50,
      onProgress: (p) => seen.push(p.progress),
    })
    // 只有一条 running 后脚本用尽会重复它 → 超时；这里只断言进度被转发过
    expect(seen).toContain(40)
    expect(result.ok).toBe(false) // 超时收敛成失败（不是无限等待）
    void def
  })

  it('done → 拿到 text（文本产物的落点）', async () => {
    const def = createTextGenerationTools({ baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })[0]
    const { fetchImpl } = createFakeFetch([
      { json: { ok: true, taskId: 't1' } },
      { json: { ok: true, task: { status: 'done', result: { ok: true, text: '这是生成结果' } } } },
    ])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' }, { interval: 1 })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('这是生成结果')
    void def
  })

  it('error 状态 → 失败 + 后台给的原因', async () => {
    const { fetchImpl } = createFakeFetch([
      { json: { ok: true, taskId: 't1' } },
      { json: { ok: true, task: { status: 'error', error: '额度用尽' } } },
    ])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' }, { interval: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('额度用尽')
  })

  it('done 但 result.ok=false → 仍按失败（不伪造成功）', async () => {
    const { fetchImpl } = createFakeFetch([
      { json: { ok: true, taskId: 't1' } },
      { json: { ok: true, task: { status: 'done', result: { ok: false, error: '内容被拦截' } } } },
    ])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' }, { interval: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('内容被拦截')
  })
})

describe('错误收敛（都给人看得懂的话，不静默成功）', () => {
  it('提交时 HTTP 非 200 → 失败并说明状态码', async () => {
    const { fetchImpl } = createFakeFetch([{ status: 500, json: {} }])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('500')
  })

  it('提交时后台 !ok → 用后台给的原因', async () => {
    const { fetchImpl } = createFakeFetch([{ json: { ok: false, error: '模型不可用' } }])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' })
    expect(result.error).toContain('模型不可用')
  })

  it('提交时 fetch 抛错 → 失败并带上原因', async () => {
    const { fetchImpl } = createFakeFetch([{ throwError: new Error('连不上后台') }])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('连不上后台')
  })

  it('后台没返回 taskId → 明确失败', async () => {
    const { fetchImpl } = createFakeFetch([{ json: { ok: true } }])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('taskId')
  })

  it('轮询查询失败 → 收敛成终态失败（不返回 running 让 UI 干等）', async () => {
    const { fetchImpl } = createFakeFetch([
      { json: { ok: true, taskId: 't1' } },
      { status: 503, json: {} },
    ])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' }, { interval: 1 })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('503')
  })

  it('环境没有 fetch → 明确失败（而不是崩）', async () => {
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl: undefined })
    const reg = newRegistry()
    reg.register(tool)
    // node 18+ 自带 fetch，这里模拟"没有 fetch"的环境
    const saved = globalThis.fetch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = undefined
    try {
      const result = await reg.invoke(tool.name, { prompt: 'x' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('fetch')
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).fetch = saved
    }
  })
})

describe('绝不做假文本', () => {
  it('后台不可用时返回错误，而不是编一段文字', async () => {
    const { fetchImpl } = createFakeFetch([{ throwError: new Error('offline') }])
    const tool = createTextGenerationTool(TEXT_MODELS[0], { baseUrl: BASE, fetchImpl })
    const reg = newRegistry()
    reg.register(tool)
    const result = await reg.invoke(tool.name, { prompt: 'x' })
    expect(result.ok).toBe(false)
    expect(result.text).toBeUndefined()
  })
})

describe('registerFromBackend：拉后台模型表再注册', () => {
  it('只注册 kind=text（或未声明 kind）的模型', async () => {
    const { fetchImpl } = alwaysJson({
      ok: true,
      models: [
        { model: 'bt1', label: '后台文本', kind: 'text', thinking: ['low', 'high'] },
        { model: 'bi1', label: '后台图片', kind: 'image' },
        { model: 'bk', label: '没声明 kind 也算文本' },
      ],
    })
    const reg = newRegistry()
    const result = await registerFromBackend(reg, { baseUrl: BASE, fetchImpl })
    expect(result.ok).toBe(true)
    const names = reg.list().map((t) => t.name)
    expect(names).toContain('text.generate:bt1')
    expect(names).toContain('text.generate:bk')
    expect(names).not.toContain('text.generate:bi1')
  })

  it('后台一个文本模型都没有 → 明确失败', async () => {
    const { fetchImpl } = alwaysJson({ ok: true, models: [{ model: 'x', kind: 'image' }] })
    const reg = newRegistry()
    const result = await registerFromBackend(reg, { baseUrl: BASE, fetchImpl })
    expect(result.ok).toBe(false)
  })

  it('后台请求失败 → 明确失败（不抛）', async () => {
    const { fetchImpl } = createFakeFetch([{ throwError: new Error('down') }])
    const reg = newRegistry()
    const result = await registerFromBackend(reg, { baseUrl: BASE, fetchImpl })
    expect(result.ok).toBe(false)
  })
})

describe('默认后台地址', () => {
  it('默认连本地 mcp-server（与图片侧一致）', () => {
    expect(DEFAULT_BASE_URL).toContain('127.0.0.1')
  })
})
