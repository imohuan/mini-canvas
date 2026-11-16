/**
 * 51KIK seed-audio-1.0 provider —— 锁住「参考音频顺序」与「请求体形状」。
 *
 * 这两个地方错一次就是坏结果（不是报错）：
 *   1. @音频N 的编号必须和 references 数组下标一致，错一位就换成别人在说话；
 *   2. 参考音频要用 references 传，塞进 audio_url 就只剩一段能用。
 * 不联网：给 provider 注入假 fetch。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Provider } from '../providers/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROVIDERS_DIR = path.resolve(HERE, '../../providers')
const REPO_ROOT = path.resolve(HERE, '../../../..')
const DEPLOYED_DIR = path.join(REPO_ROOT, '.plume', 'providers')

async function load(): Promise<Provider> {
  const text = await fs.readFile(path.join(PROVIDERS_DIR, 'seed-audio.js'), 'utf8')
  const mod = (await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(text))) as {
    default?: Provider
  }
  if (!mod.default) throw new Error('seed-audio.js 没有 default 导出')
  return mod.default
}

/** 录音式假 fetch：记录请求体，回一个固定的音频地址 */
function stubFetch() {
  const globalAny = globalThis as unknown as { fetch: typeof fetch }
  const original = globalAny.fetch
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  globalAny.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response(
      JSON.stringify({ created: 1, data: [{ url: 'https://cdn.example.com/a.mp3' }], usage: { duration: 3.2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return {
    calls,
    restore() {
      globalAny.fetch = original
    },
  }
}

afterEach(() => {
  delete (globalThis as { __mcProviderConfig?: unknown }).__mcProviderConfig
})

describe('seed-audio provider', () => {
  it('部署副本与仓库源文件内容一致（改了源文件记得同步到数据根）', async () => {
    const src = await fs.readFile(path.join(PROVIDERS_DIR, 'seed-audio.js'), 'utf8')
    let deployed: string
    try {
      deployed = await fs.readFile(path.join(DEPLOYED_DIR, 'seed-audio.js'), 'utf8')
    } catch {
      // 还没部署过（CI / 干净检出）：跳过，不影响源文件的其它断言
      return
    }
    expect(deployed.trimEnd()).toBe(src.trimEnd())
  })

  it('导出 id / actions / submit，参数与超时都声明了', async () => {
    const p = await load()
    expect(p.id).toBe('seed-audio')
    expect(p.actions).toHaveLength(1)
    const a = p.actions[0]!
    expect(a.id).toBe('seed-audio:generate')
    expect(a.title).toBeTruthy()
    expect(a.group).toBeTruthy()
    expect(a.nodeTypes).toEqual(['audio'])
    expect(a.pollIntervalMs).toBeGreaterThan(0)
    expect(a.pollTimeoutMs).toBeGreaterThan(0)
  })

  it('参考音频进 references，@音频N 的编号与数组顺序一致', async () => {
    const stub = stubFetch()
    try {
      const p = await load()
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompts: [
          { type: 'prompt', value: '照着' },
          { type: 'tag', value: 'nB' },
          { type: 'prompt', value: '的声音说你好，然后' },
          { type: 'tag', value: 'nA' },
          { type: 'prompt', value: '接着说再见' },
        ],
        resources: [
          { id: 'nA', kind: 'audio', name: '甲', url: 'data:audio/mpeg;base64,AAA' },
          { id: 'nB', kind: 'audio', name: '乙', url: 'data:audio/mpeg;base64,BBB' },
        ],
      })
      expect(r).toEqual({ done: true, urls: ['https://cdn.example.com/a.mp3'] })

      const body = stub.calls[0]!.body
      expect(body.model).toBe('seed-audio-1.0')
      expect(body.stream).toBe(false)
      expect(body.task).toBe(false)
      // references 按 resources 的顺序：甲在前、乙在后 → @音频1 是甲
      expect(body.references).toEqual([
        { type: 'audio', url: 'data:audio/mpeg;base64,AAA' },
        { type: 'audio', url: 'data:audio/mpeg;base64,BBB' },
      ])
      expect(body.prompt).toBe('照着@音频2的声音说你好，然后@音频1接着说再见')
      // 不能再额外塞 audio_url（与 references 互斥）
      expect(body.audio_url).toBeUndefined()
      expect(body.audio_data).toBeUndefined()
    } finally {
      stub.restore()
    }
  })

  it('没写 @音频N 但连了音频时，自动补一句引用（否则模型不知道该学哪段）', async () => {
    const stub = stubFetch()
    try {
      const p = await load()
      const action = p.actions[0]!
      await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompts: [{ type: 'prompt', value: '你好呀' }],
        resources: [{ id: 'nA', kind: 'audio', url: 'data:audio/mpeg;base64,AAA' }],
      })
      const prompt = String(stub.calls[0]!.body.prompt)
      expect(prompt).toContain('@音频1')
      expect(prompt).toContain('你好呀')
    } finally {
      stub.restore()
    }
  })

  it('纯描述（不连参考音频）也能发，且不带 references', async () => {
    const stub = stubFetch()
    try {
      const p = await load()
      const action = p.actions[0]!
      await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompts: [{ type: 'prompt', value: '雨夜的街道，雨点打在铁皮雨棚上' }],
        resources: [],
        values: { format: 'wav', sampleRate: 44100, speechRate: 10, pitchRate: -2, loudnessRate: 5 },
      })
      const body = stub.calls[0]!.body as { references?: unknown; upstream_options: { audio_config: Record<string, unknown> } }
      expect(body.references).toBeUndefined()
      expect(body.upstream_options.audio_config).toEqual({
        format: 'wav',
        sample_rate: 44100,
        speech_rate: 10,
        pitch_rate: -2,
        loudness_rate: 5,
      })
    } finally {
      stub.restore()
    }
  })

  it('最多收 3 段参考音频：第 4 段不传（平台上限），且不混进别的字段', async () => {
    const stub = stubFetch()
    try {
      const p = await load()
      const action = p.actions[0]!
      await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompts: [{ type: 'prompt', value: '@音频1 说话' }],
        resources: [1, 2, 3, 4].map((i) => ({
          id: 'a' + i,
          kind: 'audio',
          url: 'data:audio/mpeg;base64,A' + i,
        })),
      })
      const refs = stub.calls[0]!.body.references as unknown[]
      expect(refs).toHaveLength(3)
    } finally {
      stub.restore()
    }
  })

  it('只收参考音频：连进来的图片 / 视频被跳过，不塞进 references', async () => {
    const stub = stubFetch()
    try {
      const p = await load()
      const action = p.actions[0]!
      await p.submit(action, {
        canvasId: 'c1',
        nodeId: 'n1',
        actionId: action.id,
        prompts: [{ type: 'prompt', value: '@音频1 说话' }],
        resources: [
          { id: 'i1', kind: 'image', url: 'data:image/png;base64,IMG' },
          { id: 'v1', kind: 'video', url: 'data:video/mp4;base64,VID' },
          { id: 'a1', kind: 'audio', url: 'data:audio/mpeg;base64,AUD' },
        ],
      })
      const body = stub.calls[0]!.body
      expect(body.references).toEqual([{ type: 'audio', url: 'data:audio/mpeg;base64,AUD' }])
      expect(JSON.stringify(body)).not.toContain('IMG')
      expect(JSON.stringify(body)).not.toContain('VID')
      expect(body.prompt).toBe('@音频1 说话')
    } finally {
      stub.restore()
    }
  })

  it('提示词为空 → 直接报错，不浪费一次调用', async () => {
    const stub = stubFetch()
    try {
      const p = await load()
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id, prompts: [], resources: [],
      })
      expect('error' in r).toBe(true)
      expect(stub.calls).toHaveLength(0)
    } finally {
      stub.restore()
    }
  })

  it('上游报错时给中文提示，不透出英文原文', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    globalAny.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'invalid api key', type: 'authentication_error' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch
    try {
      const p = await load()
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id,
        prompts: [{ type: 'prompt', value: 'x' }], resources: [],
      })
      expect('error' in r).toBe(true)
      if ('error' in r) expect(r.error).toContain('API Key')
    } finally {
      globalAny.fetch = original
    }
  })

  it('余额不足时说的是「余额不够」与需要多少积分，不是英文原文', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    globalAny.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message:
              'Insufficient available credits for precharge. Available: -122000 credits; required: 100000 credits.',
            type: 'invalid_request_error',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch
    try {
      const p = await load()
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id,
        prompts: [{ type: 'prompt', value: 'x' }], resources: [],
      })
      expect('error' in r).toBe(true)
      if ('error' in r) {
        expect(r.error).toContain('余额')
        expect(r.error).toContain('100000')
        expect(r.error).not.toContain('Insufficient')
      }
    } finally {
      globalAny.fetch = original
    }
  })
})
