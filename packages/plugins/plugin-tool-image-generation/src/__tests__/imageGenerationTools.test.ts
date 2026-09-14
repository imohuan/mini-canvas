/**
 * imageGenerationTools 单测 —— 注册/参数 schema/请求组装/轮询映射/错误收敛。
 * 全部用假 fetch，不碰真网络。
 */
import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '@mini-canvas/kernel'
import {
  type FetchLike,
  buildToolName,
  createImageGenerationTool,
  createImageGenerationTools,
  registerImageGenerationTools,
  registerFromBackend,
  toGenerationResources,
  IMAGE_GENERATION_GROUP,
} from '../imageGenerationTools'
import { IMAGE_MODELS, DEFAULT_BASE_URL } from '../imageModels'
import { createFakeFetch, alwaysJson, type ScriptedResponse } from './fakeFetch'

const BASE = 'http://backend.test'

/** 建一个干净的注册表（内核契约的同一实现） */
function newRegistry(): ToolRegistry {
  return new ToolRegistry()
}

describe('工具注册', () => {
  it('5 个模型各注册一个工具，名字为 image.generate:<modelId>', () => {
    const reg = newRegistry()
    registerImageGenerationTools(reg, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })

    const all = reg.list()
    expect(all).toHaveLength(IMAGE_MODELS.length)
    for (const m of IMAGE_MODELS) {
      expect(reg.has(`image.generate:${m.model}`)).toBe(true)
    }
  })

  it('list({produces:"image"}) 能列全部生成工具；未声明的筛选组为空', () => {
    const reg = newRegistry()
    registerImageGenerationTools(reg, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })

    expect(reg.list({ produces: 'image' })).toHaveLength(IMAGE_MODELS.length)
    expect(reg.list({ produces: 'video' })).toHaveLength(0)
    expect(reg.list({ group: IMAGE_GENERATION_GROUP })).toHaveLength(IMAGE_MODELS.length)
  })

  it('卸载（dispose）后注册表里为空', () => {
    const reg = newRegistry()
    const handles = IMAGE_MODELS.map((m) =>
      reg.register(createImageGenerationTool(m, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })),
    )
    expect(reg.list()).toHaveLength(IMAGE_MODELS.length)

    for (const h of handles) h.dispose()
    expect(reg.list()).toHaveLength(0)
  })

  it('同名重复注册按内核契约抛错（暴露真冲突）', () => {
    const reg = newRegistry()
    const cap = IMAGE_MODELS[0]
    reg.register(createImageGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl }))
    expect(() =>
      reg.register(createImageGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })),
    ).toThrow(/already registered/)
  })

  it('skipExisting：已存在的同名工具被跳过，只有新模型被补进来', () => {
    const reg = newRegistry()
    const first = IMAGE_MODELS[0]
    reg.register(createImageGenerationTool(first, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl }))

    const added = registerImageGenerationTools(reg, {
      baseUrl: BASE,
      fetchImpl: alwaysJson({}).fetchImpl,
      skipExisting: true,
    })
    // 第一个已存在 → 跳过；其余 4 个补进来
    expect(added.map((t) => t.name)).not.toContain(buildToolName(first.model))
    expect(reg.list()).toHaveLength(IMAGE_MODELS.length)
  })
})

describe('工具声明（标题/分组/产出/接受输入）', () => {
  it('title 用模型 label、group 为图片生成、produces 为 image', () => {
    const cap = IMAGE_MODELS[1]
    const def = createImageGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
    expect(def.title).toBe(cap.label)
    expect(def.group).toBe(IMAGE_GENERATION_GROUP)
    expect(def.produces).toBe('image')
    expect(def.description).toBe(cap.description)
  })

  it('accepts 含 text，并带上模型声明支持的媒体类型（去重）', () => {
    const cap = IMAGE_MODELS[0] // supportsInput: ['image']
    const def = createImageGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
    expect(def.accepts).toEqual(['text', 'image'])
  })

  it('未声明 supportsInput 的模型：accepts 只有 text（不挑媒体）', () => {
    const def = createImageGenerationTool(
      { model: 'plain-model' },
      { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl },
    )
    expect(def.accepts).toEqual(['text'])
  })
})

describe('参数 schema', () => {
  it('每个工具都声明了提示词模板（用户要的"模板提示词"下拉靠它，不是面板写死）', () => {
    for (const cap of IMAGE_MODELS) {
      const def = createImageGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
      expect(def.templates?.length).toBeGreaterThan(0)
      for (const t of def.templates ?? []) {
        // 模板必须是"选中即可直接填进输入框"的形态：有 id、有显示名、有正文
        expect(t.id).toBeTruthy()
        expect(t.name).toBeTruthy()
        expect(t.prompt).toBeTruthy()
      }
    }
  })

  it('声明了 ratio 的模型给出比例下拉，选项 label 映射成中文', () => {
    const cap = IMAGE_MODELS.find((m) => m.model === 'doubao-seedream-45')!
    const def = createImageGenerationTool(cap, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
    const ratio = def.params?.find((p) => p.key === 'ratio')
    expect(ratio?.type).toBe('select')
    expect(ratio?.default).toBe('auto')
    // auto → 自动（value 保持英文原值传给后台）
    expect(ratio?.options).toContainEqual({ label: '自动', value: 'auto' })
    expect(ratio?.options).toContainEqual({ label: '16:9', value: '16:9' })
  })

  it('只有声明 resolution 的模型才有分辨率参数（其余模型不给该参数）', () => {
    const withRes = IMAGE_MODELS.find((m) => m.model === 'apimart-gpt-image-2')!
    const withoutRes = IMAGE_MODELS.find((m) => m.model === 'chatgpt-gpt-image-2')!

    const a = createImageGenerationTool(withRes, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
    const b = createImageGenerationTool(withoutRes, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })

    expect(a.params?.map((p) => p.key)).toEqual(['ratio', 'resolution'])
    expect(b.params?.map((p) => p.key)).toEqual(['ratio'])
  })

  it('两个能力都不声明的模型：params 为空数组（不无中生有）', () => {
    const def = createImageGenerationTool(
      { model: 'bare' },
      { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl },
    )
    expect(def.params).toEqual([])
  })
})

describe('资源归一（图片给 url、文本给 value）', () => {
  it('图片资源带 url、不带 value', () => {
    const out = toGenerationResources([{ id: 'n1', kind: 'image', name: '参考图', url: 'a.png' }])
    expect(out).toEqual([{ id: 'n1', kind: 'image', name: '参考图', url: 'a.png' }])
  })

  it('文本资源带 value、不带 url', () => {
    const out = toGenerationResources([{ id: 'n2', kind: 'text', value: '一只猫' }])
    expect(out).toEqual([{ id: 'n2', kind: 'text', value: '一只猫' }])
  })

  it('缺 url/value 时补空串（不产生 undefined 字段）', () => {
    const out = toGenerationResources([{ id: 'n3', kind: 'image' }])
    expect(out[0].url).toBe('')
    expect('value' in out[0]).toBe(false)
  })
})

describe('run：提交任务的请求组装', () => {
  it('POST 到 /api/tasks，body 带上 kind/canvasId/targetNodeId/model/prompt/ratio/resolution/resources', async () => {
    const cap = IMAGE_MODELS.find((m) => m.model === 'apimart-gpt-image-2')!
    const { fetchImpl, requests } = createFakeFetch([
      { kind: 'json', body: { ok: true, taskId: 't-1', status: 'pending' } },
    ])
    const def = createImageGenerationTool(cap, { baseUrl: BASE, fetchImpl })

    await def.run(
      {
        prompt: '一只戴帽子的猫',
        params: { ratio: '16:9', resolution: '2k' },
        resources: [
          { id: 'n1', kind: 'image', name: '参考图', url: 'ref.png' },
          { id: 'n2', kind: 'text', value: '风格：水彩' },
        ],
      },
      { nodeId: 'node-7', canvasId: 'canvas-3' },
    )

    expect(requests[0].url).toBe(`${BASE}/api/tasks`)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].headers?.['content-type']).toBe('application/json')
    expect(requests[0].body).toEqual({
      kind: 'image',
      canvasId: 'canvas-3',
      targetNodeId: 'node-7',
      model: 'apimart-gpt-image-2',
      promptText: '一只戴帽子的猫',
      ratio: '16:9',
      resolution: '2k',
      resources: [
        { id: 'n1', kind: 'image', name: '参考图', url: 'ref.png' },
        { id: 'n2', kind: 'text', value: '风格：水彩' },
      ],
    })
  })

  it('没给的比例/分辨率不会出现在 body 里（undefined 被丢弃前先过滤）', async () => {
    const cap = IMAGE_MODELS.find((m) => m.model === 'chatgpt-gpt-image-2')!
    const { fetchImpl, requests } = createFakeFetch([
      { kind: 'json', body: { ok: true, taskId: 't-2' } },
    ])
    const def = createImageGenerationTool(cap, { baseUrl: BASE, fetchImpl })

    await def.run({ prompt: 'hi', params: {} }, { nodeId: 'n', canvasId: 'c' })

    // JSON.stringify 会丢掉值为 undefined 的键 —— 断言"没有这两个键"
    expect('ratio' in (requests[0].body ?? {})).toBe(false)
    expect('resolution' in (requests[0].body ?? {})).toBe(false)
  })

  it('baseUrl 末尾斜杠被归一（不会拼出双斜杠）', async () => {
    const { fetchImpl, requests } = createFakeFetch([{ kind: 'json', body: { ok: true, taskId: 't' } }])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: `${BASE}///`, fetchImpl })
    await def.run({ prompt: 'x' }, {})
    expect(requests[0].url).toBe(`${BASE}/api/tasks`)
  })
})

describe('run：轮询状态映射', () => {
  /** 用假 fetch 提交任务并拿回轮询函数 */
  async function pollFnWith(scripts: ScriptedResponse[], params: Record<string, unknown> = {}) {
    const { fetchImpl, requests } = createFakeFetch(scripts)
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE, fetchImpl, ...params })
    const outcome = await def.run({ prompt: 'x' }, { nodeId: 'n', canvasId: 'c' })
    if (typeof outcome !== 'function') throw new Error('预期 run 返回轮询函数')
    return { poll: outcome, requests }
  }

  it('提交失败（HTTP 非 200）→ 直接返回 ok:false，不进入轮询', async () => {
    const { fetchImpl } = createFakeFetch([{ kind: 'json', body: { error: 'boom' }, status: 500 }])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE, fetchImpl })
    const outcome = await def.run({ prompt: 'x' }, {})
    expect(typeof outcome).not.toBe('function')
    expect(outcome).toMatchObject({ ok: false })
    expect((outcome as { error: string }).error).toContain('HTTP 500')
  })

  it('提交时后台 !ok → 带上后台给的原因', async () => {
    const { fetchImpl } = createFakeFetch([{ kind: 'json', body: { ok: false, error: '模型未配置' } }])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE, fetchImpl })
    const outcome = await def.run({ prompt: 'x' }, {})
    expect(outcome).toEqual({ ok: false, error: '模型未配置' })
  })

  it('提交时 fetch 抛错 → 收敛成 ok:false（不往外抛）', async () => {
    const { fetchImpl } = createFakeFetch([{ kind: 'throw', error: new Error('connect ECONNREFUSED') }])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE, fetchImpl })
    const outcome = await def.run({ prompt: 'x' }, {})
    expect(outcome).toMatchObject({ ok: false })
    expect((outcome as { error: string }).error).toContain('ECONNREFUSED')
  })

  it('提交返回非法 JSON → 明确错误', async () => {
    const { fetchImpl } = createFakeFetch([{ kind: 'invalidJson' }])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE, fetchImpl })
    const outcome = await def.run({ prompt: 'x' }, {})
    expect((outcome as { error: string }).error).toContain('合法 JSON')
  })

  it('提交没给 taskId → 明确错误', async () => {
    const { fetchImpl } = createFakeFetch([{ kind: 'json', body: { ok: true } }])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE, fetchImpl })
    const outcome = await def.run({ prompt: 'x' }, {})
    expect((outcome as { error: string }).error).toContain('taskId')
  })

  it('processing → running（带 progress/message/taskId）', async () => {
    const { poll } = await pollFnWith([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'json', body: { ok: true, task: { status: 'processing', progress: 42, message: '采样中' } } },
    ])
    expect(await poll()).toEqual({ status: 'running', progress: 42, message: '采样中', taskId: 't-9' })
  })

  it('pending 且后台没给 message → 回落"任务排队中…"', async () => {
    const { poll } = await pollFnWith([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'json', body: { ok: true, task: { status: 'pending' } } },
    ])
    const state = await poll()
    expect(state.status).toBe('running')
    expect((state as { message: string }).message).toBe('任务排队中…')
  })

  it('done → done + ok:true + urls', async () => {
    const { poll } = await pollFnWith([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'json', body: { ok: true, task: { status: 'done', result: { ok: true, urls: ['out.png'] } } } },
    ])
    expect(await poll()).toEqual({ status: 'done', result: { ok: true, urls: ['out.png'], taskId: 't-9' } })
  })

  it('error → done + ok:false（带上后台错误）', async () => {
    const { poll } = await pollFnWith([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'json', body: { ok: true, task: { status: 'error', error: '平台额度不足' } } },
    ])
    expect(await poll()).toEqual({ status: 'done', result: { ok: false, error: '平台额度不足', taskId: 't-9' } })
  })

  it('status=done 但 result.ok=false → 仍按失败上报', async () => {
    const { poll } = await pollFnWith([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'json', body: { ok: true, task: { status: 'done', result: { ok: false, error: '内容被拒' } } } },
    ])
    expect(await poll()).toEqual({ status: 'done', result: { ok: false, error: '内容被拒', taskId: 't-9' } })
  })

  it('轮询时 HTTP 非 200 → done + ok:false（不返回 running 让用户干等）', async () => {
    const { poll } = await pollFnWith([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'json', body: { error: '任务不存在' }, status: 404 },
    ])
    const state = await poll()
    expect(state.status).toBe('done')
    expect((state as { result: { ok: boolean; error: string } }).result.ok).toBe(false)
    expect((state as { result: { error: string } }).result.error).toContain('HTTP 404')
  })

  it('轮询时 fetch 抛错 → done + ok:false', async () => {
    const { poll } = await pollFnWith([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'throw', error: new Error('socket hang up') },
    ])
    const state = await poll()
    expect(state.status).toBe('done')
    expect((state as { result: { error: string } }).result.error).toContain('socket hang up')
  })

  it('轮询时后台 !ok → done + ok:false', async () => {
    const { poll } = await pollFnWith([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'json', body: { ok: false, error: '任务不存在' } },
    ])
    const state = await poll()
    expect(state.status).toBe('done')
    expect((state as { result: { error: string } }).result.error).toBe('任务不存在')
  })
})

describe('绝不做假图', () => {
  it('提交失败时结果里没有任何 urls / data URL', async () => {
    const { fetchImpl } = createFakeFetch([{ kind: 'throw', error: new Error('offline') }])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE, fetchImpl })
    const out = (await def.run({ prompt: 'x' }, {})) as { urls?: string[] }
    expect(out.urls).toBeUndefined()
  })

  it('后台标记完成但没给 urls → urls 为空数组，不编造图片', async () => {
    const { fetchImpl } = createFakeFetch([
      { kind: 'json', body: { ok: true, taskId: 't-9' } },
      { kind: 'json', body: { ok: true, task: { status: 'done' } } },
    ])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE, fetchImpl })
    const poll = (await def.run({ prompt: 'x' }, {})) as () => Promise<{ status: string; result: { urls: string[] } }>
    const state = await poll()
    expect(state.result.urls).toEqual([])
  })
})

describe('registerFromBackend：拉后台模型表再注册', () => {
  it('注册后台声明的模型（kind=image 与未声明 kind 都算图片）', async () => {
    const reg = newRegistry()
    const { fetchImpl, requests } = alwaysJson({
      ok: true,
      models: [
        { model: 'new-image-model', label: '新模型', kind: 'image', ratio: ['1:1'] },
        { model: 'legacy-model', label: '老模型', ratio: ['1:1'] },
        { model: 'some-video-model', label: '视频', kind: 'video' },
      ],
    })

    const result = await registerFromBackend(reg, { baseUrl: BASE, fetchImpl })

    expect(requests[0].url).toBe(`${BASE}/api/models`)
    expect(requests[0].method).toBe('GET')
    expect(result).toEqual({ ok: true, registered: ['image.generate:new-image-model', 'image.generate:legacy-model'] })
    expect(reg.has('image.generate:new-image-model')).toBe(true)
    // 视频模型不该混进图片生成工具
    expect(reg.has('image.generate:some-video-model')).toBe(false)
  })

  it('HTTP 非 200 → ok:false（不抛）', async () => {
    const reg = newRegistry()
    const { fetchImpl } = alwaysJson({ ok: true, models: [] }, 503)
    const result = await registerFromBackend(reg, { baseUrl: BASE, fetchImpl })
    expect(result).toEqual({ ok: false, error: '读取后台模型列表失败：后台返回 HTTP 503' })
    expect(reg.list()).toHaveLength(0)
  })

  it('fetch 抛错 → ok:false', async () => {
    const reg = newRegistry()
    const { fetchImpl } = createFakeFetch([{ kind: 'throw', error: new Error('ECONNREFUSED') }])
    const result = await registerFromBackend(reg, { baseUrl: BASE, fetchImpl })
    expect(result.ok).toBe(false)
    expect(reg.list()).toHaveLength(0)
  })

  it('后台没声明任何图片模型 → ok:false 说明原因', async () => {
    const reg = newRegistry()
    const { fetchImpl } = alwaysJson({ ok: true, models: [{ model: 'v', kind: 'video' }] })
    const result = await registerFromBackend(reg, { baseUrl: BASE, fetchImpl })
    expect(result).toEqual({ ok: false, error: '后台未声明任何图片生成模型' })
  })

  it('跳过已存在的同名工具（内置表已注册时不冲突）', async () => {
    const reg = newRegistry()
    const existing = IMAGE_MODELS[0]
    reg.register(createImageGenerationTool(existing, { baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl }))

    const { fetchImpl } = alwaysJson({
      ok: true,
      models: [
        { model: existing.model, label: '同名', ratio: ['1:1'] },
        { model: 'brand-new', label: '全新', ratio: ['1:1'] },
      ],
    })
    const result = await registerFromBackend(reg, { baseUrl: BASE, fetchImpl })
    expect(result).toEqual({ ok: true, registered: ['image.generate:brand-new'] })
  })
})

describe('默认后台地址', () => {
  it('不传 baseUrl 时用默认地址', async () => {
    const { fetchImpl, requests } = createFakeFetch([{ kind: 'json', body: { ok: true, taskId: 't' } }])
    const def = createImageGenerationTool(IMAGE_MODELS[0], { fetchImpl })
    await def.run({ prompt: 'x' }, {})
    expect(requests[0].url).toBe(`${DEFAULT_BASE_URL}/api/tasks`)
  })
})

describe('超时收敛', () => {
  it('请求超时（fetch 一直不返回）→ 收敛成 ok:false 且说明超时', async () => {
    // 假 fetch 永不 resolve，但监听 abort 信号 → 超时触发时抛 AbortError（与真实 fetch 行为一致）
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    const def = createImageGenerationTool(IMAGE_MODELS[0], {
      baseUrl: BASE,
      fetchImpl: hanging,
      timeoutMs: 10,
    })
    const outcome = await def.run({ prompt: 'x' }, {})
    expect(outcome).toMatchObject({ ok: false })
    expect((outcome as { error: string }).error).toContain('请求超时')
  })
})

describe('fetch 不绑死（可注入 / 可回落到 globalThis.fetch）', () => {
  it('不注入 fetchImpl 时回落到 globalThis.fetch（运行时读取，非加载时刻）', async () => {
    const original = (globalThis as { fetch?: unknown }).fetch
    const requests: string[] = []
    try {
      // 运行期才挂上去：证明实现是"调用时读"，而不是模块加载时抓一次
      ;(globalThis as { fetch?: unknown }).fetch = async (url: string) => {
        requests.push(url)
        return {
          ok: true,
          status: 200,
          async json() {
            return { ok: true, taskId: 't-global' }
          },
        }
      }
      const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE })
      await def.run({ prompt: 'x' }, {})
      expect(requests[0]).toBe(`${BASE}/api/tasks`)
    } finally {
      if (original === undefined) delete (globalThis as { fetch?: unknown }).fetch
      else (globalThis as { fetch?: unknown }).fetch = original
    }
  })

  it('环境里没有 fetch 且未注入 → 明确错误（不静默失败）', async () => {
    const original = (globalThis as { fetch?: unknown }).fetch
    try {
      delete (globalThis as { fetch?: unknown }).fetch
      const def = createImageGenerationTool(IMAGE_MODELS[0], { baseUrl: BASE })
      const outcome = await def.run({ prompt: 'x' }, {})
      expect(outcome).toMatchObject({ ok: false })
      expect((outcome as { error: string }).error).toContain('fetch')
    } finally {
      if (original !== undefined) (globalThis as { fetch?: unknown }).fetch = original
    }
  })

  it('真实 fetch 在类型上可直接当 fetchImpl 传入（宿主无需适配层）', () => {
    // 类型层面的断言：编译期通过即证明 fetch 结构上满足 FetchLike
    const asFetchLike: FetchLike = fetch
    expect(typeof asFetchLike).toBe('function')
  })
})

describe('createImageGenerationTools', () => {
  it('一次建出全部模型的工具（默认 5 个）', () => {
    const tools = createImageGenerationTools({ baseUrl: BASE, fetchImpl: alwaysJson({}).fetchImpl })
    expect(tools).toHaveLength(IMAGE_MODELS.length)
    expect(tools.map((t) => t.name)).toEqual(IMAGE_MODELS.map((m) => `image.generate:${m.model}`))
  })
})
