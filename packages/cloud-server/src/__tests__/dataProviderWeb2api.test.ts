/**
 * 数据根 providers/ 下的 web2api 三个文件 —— 用**真实文件**跑单测。
 *
 * 背景：2026-11-08 把 web2api 从 cloud-server 内置代码改成外挂 provider
 * （<数据根>/providers/web2api-{image,video,audio}.js）。内置那份已删，所以这里
 * 直接加载数据目录里的真文件，锁住三条以前真出过的问题：
 *
 * 1. 动作 id 与旧前端插件一致（旧画布里存过的 actionId 不能失效）；
 * 2. 每个动作都显式声明轮询节奏与超时（视频不能被默认 5 分钟误杀）；
 * 3. web2api 的中间态（paused 等验证码 / retrying / pending）不能当失败。
 *
 * 不联网：给 provider 注入假 fetch。
 */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Provider } from '../providers/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 仓库根（packages/cloud-server/src/__tests__ → 上四级） */
const REPO_ROOT = path.resolve(HERE, '../../../..')
const PROVIDERS_DIR = path.join(REPO_ROOT, '.mini-canvas', 'providers')

/** 按数据根装载真实 provider 文件（与 load.ts 同一手法：data: URL） */
async function load(file: string): Promise<Provider> {
  const text = await fs.readFile(path.join(PROVIDERS_DIR, file), 'utf8')
  const mod = (await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text))) as {
    default?: Provider
  }
  if (!mod.default) throw new Error(file + ' 没有 default 导出')
  return mod.default
}

const FILES = ['web2api-image.js', 'web2api-video.js', 'web2api-audio.js'] as const

describe('数据根里的 web2api provider 文件', () => {
  it('三个文件都能装载，且都导出 id / actions / submit', async () => {
    for (const f of FILES) {
      const p = await load(f)
      expect(typeof p.id, f).toBe('string')
      expect(p.id.length, f).toBeGreaterThan(0)
      expect(Array.isArray(p.actions), f).toBe(true)
      expect(typeof p.submit, f).toBe('function')
    }
  })

  it('id 互不相同，动作 id 全局唯一（同名会互相覆盖）', async () => {
    const ids: string[] = []
    const actionIds: string[] = []
    for (const f of FILES) {
      const p = await load(f)
      ids.push(p.id)
      for (const a of p.actions) actionIds.push(a.id)
    }
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(actionIds).size).toBe(actionIds.length)
  })

  it('动作 id 与旧前端插件一致（旧画布里的 actionId 继续有效）', async () => {
    // 这 18 条是 plugin-web2api-tools 当初注册的全部动作，一条不能少
    const expected = [
      'web2api:doubao-image-seedream45',
      'web2api:doubao-image-seedream50lite',
      'web2api:doubao-image-seedream40',
      'web2api:dola-image-seedream50pro',
      'web2api:dola-image-seedream45',
      'web2api:chatgpt-image',
      'web2api:apimart-image',
      'web2api:doubao-video-fast',
      'web2api:doubao-video-mini',
      'web2api:dola-video-seedance25',
      'web2api:dola-video-seedance20',
      'web2api:dola-video-seedance10',
      'web2api:doubao-video-api-mini',
      'web2api:doubao-video-api-fast',
      'web2api:seedance-video-fast',
      'web2api:seedance-video-20',
      'web2api:doubao-tts',
      'web2api:volcengine-audio',
    ]
    const actual: string[] = []
    for (const f of FILES) {
      for (const a of (await load(f)).actions) actual.push(a.id)
    }
    expect(actual.sort()).toEqual(expected.sort())
  })

  it('每个动作都声明轮询节奏与超时，视频 ≥ 30 分钟', async () => {
    for (const f of FILES) {
      for (const a of (await load(f)).actions) {
        expect(a.pollIntervalMs, a.id).toBeGreaterThan(0)
        expect(a.pollTimeoutMs, a.id).toBeGreaterThan(0)
        if (a.nodeTypes?.includes('video')) {
          expect(a.pollTimeoutMs!, a.id).toBeGreaterThanOrEqual(30 * 60_000)
        }
      }
    }
  })

  it('每条动作都有 title / group / nodeTypes（缺了前端会显示空白）', async () => {
    for (const f of FILES) {
      for (const a of (await load(f)).actions) {
        expect(a.title, a.id).toBeTruthy()
        expect(a.group, a.id).toBeTruthy()
        expect(Array.isArray(a.nodeTypes), a.id).toBe(true)
      }
    }
  })
})

describe('提交与轮询：直接调 web2api 的 HTTP 接口', () => {
  it('下单：POST /api/tasks，body 带 platform / operation / params', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    const calls: Array<{ url: string; method: string; body: unknown }> = []
    globalAny.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 'task-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const p = await load('web2api-image.js')
      const action = p.actions.find((a) => a.id === 'web2api:doubao-image-seedream45')!
      const r = await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompt: '夕阳下的城市',
        values: { ratio: '16:9' },
      })
      expect(r).toEqual({ taskId: 'task-1' })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('http://localhost:8033/api/tasks')
      expect(calls[0].method).toBe('POST')
      const body = calls[0].body as { platform: string; operation: string; params: Record<string, unknown> }
      expect(body.platform).toBe('doubao')
      expect(body.operation).toBe('chat-auto')
      expect(body.params.ratio).toBeUndefined() // 已拼进 prompt 前缀
      expect(body.params.prompt).toContain('/image(model:"Seedream 4.5", ratio:"16:9")')
    } finally {
      globalAny.fetch = original
    }
  })

  it('chat-auto：参数拼成括号前缀，不是空格分隔的纯文本', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    const calls: Array<{ body: unknown }> = []
    globalAny.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 'task-2' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const p = await load('web2api-video.js')
      const action = p.actions.find((a) => a.id === 'web2api:doubao-video-fast')!
      await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompt: '一只猫在跑',
        values: { ratio: '9:16', durationSec: 10 },
      })
      const sent = calls[0].body as { params: { prompt: string } }
      expect(sent.params.prompt).toBe('/video(model:"Seedance 2.0 Fast", ratio:"9:16", durationSec:10) 一只猫在跑')
    } finally {
      globalAny.fetch = original
    }
  })

  it('plain 模式：模型烘焙进 params，参考图随 resources 一起带过去', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    const calls: Array<{ body: unknown }> = []
    globalAny.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 'task-3' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const p = await load('web2api-image.js')
      const action = p.actions.find((a) => a.id === 'web2api:apimart-image')!
      await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompt: '画一只猫',
        values: { ratio: '1:1', resolution: '2k' },
        resources: [{ kind: 'image', url: 'data:image/png;base64,AAA' }],
      })
      const sent = calls[0].body as { platform: string; operation: string; params: Record<string, unknown> }
      expect(sent.platform).toBe('apimart')
      expect(sent.operation).toBe('generate-image')
      expect(sent.params.ratio).toBe('1:1')
      expect(sent.params.resolution).toBe('2k')
      expect(sent.params.prompt).toBe('画一只猫')
      expect(sent.params.referenceImages).toEqual(['data:image/png;base64,AAA'])
    } finally {
      globalAny.fetch = original
    }
  })

  it('中间态继续轮询：paused / retrying / pending → running + waiting', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    try {
      const p = await load('web2api-video.js')
      const action = p.actions[0]
      for (const status of ['paused', 'retrying', 'pending']) {
        globalAny.fetch = (async () =>
          new Response(
            JSON.stringify({ code: 0, message: 'ok', data: { status, message: '等验证码', progress: 30 } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )) as typeof fetch
        const r = await p.poll!('t-1', action)
        expect(r.status, status).toBe('running')
        expect(r.waiting, status).toBe(true)
      }
    } finally {
      globalAny.fetch = original
    }
  })

  it('终态：completed + 产物 → done（相对地址绝对化到 web2api）', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    globalAny.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: { status: 'completed', result: [{ url: '/api/resources/images/doubao/a.png', type: 'image' }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    try {
      const p = await load('web2api-image.js')
      const r = await p.poll!('t-1', p.actions[0])
      expect(r.status).toBe('done')
      expect(r.urls).toEqual(['http://localhost:8033/api/resources/images/doubao/a.png'])
    } finally {
      globalAny.fetch = original
    }
  })

  it('终态：failed / cancelled → error', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    try {
      const p = await load('web2api-image.js')
      for (const status of ['failed', 'cancelled']) {
        globalAny.fetch = (async () =>
          new Response(JSON.stringify({ code: 0, message: 'ok', data: { status, message: '失败了' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })) as typeof fetch
        const r = await p.poll!('t-1', p.actions[0])
        expect(r.status, status).toBe('error')
      }
    } finally {
      globalAny.fetch = original
    }
  })

  it('连不上 web2api 时给的是人话，不是 fetch failed', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    globalAny.fetch = (async () => {
      throw new Error('fetch failed')
    }) as typeof fetch
    try {
      const p = await load('web2api-image.js')
      const r = await p.submit(p.actions[0], { canvasId: 'c1', nodeId: 'n1', actionId: p.actions[0].id, prompt: 'x' })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toContain('连不上 web2api')
    } finally {
      globalAny.fetch = original
    }
  })
})
