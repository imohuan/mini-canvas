/**
 * 火山引擎官方 seed-audio-1.0 provider —— 锁住官方接口的字段名。
 *
 * 与中转站那版的区别（不是“换个地址”那么简单）：
 *   - 正文叫 text_prompt（不是 prompt）；
 *   - 参考音频放 references[]，每项用 audio_data（裸 base64）或 audio_url；
 *   - 鉴权头是 X-Api-Key（不是 Bearer）；
 *   - 业务失败也可能回 200，错误码在 body.code 里。
 * 这几条错一条就是“看起来成功、其实是空的”。
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

/** 装载时注入伪造的账号配置（与官方装载器同一手法：源码前面拼一个常量） */
async function load(key = 'k-test'): Promise<Provider> {
  const text = await fs.readFile(path.join(PROVIDERS_DIR, 'seed-audio-volc.js'), 'utf8')
  const cfg = key
    ? 'const __mcProviderConfig = ' +
      JSON.stringify({
        accounts: [{ id: 'main', values: { apiKey: key } }],
        values: { apiKey: key },
        byId: { main: { apiKey: key } },
        defaultId: 'main',
      }) +
      ';\n'
    : ''
  const mod = (await import(/* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(cfg + text))) as {
    default?: Provider
  }
  if (!mod.default) throw new Error('seed-audio-volc.js 没有 default 导出')
  return mod.default
}

function stubFetch(body: unknown = { url: 'https://cdn.example.com/a.mp3', duration: 3.2 }) {
  const globalAny = globalThis as unknown as { fetch: typeof fetch }
  const original = globalAny.fetch
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
  globalAny.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers || {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')),
    })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return {
    calls,
    restore() {
      globalAny.fetch = original
    },
  }
}

const PROMPT = [{ type: 'prompt' as const, value: '雨夜的街道' }]

describe('seed-audio-volc provider（官方接口）', () => {
  afterEach(() => {
    delete (globalThis as { __mcProviderConfig?: unknown }).__mcProviderConfig
  })

  it('部署副本与仓库源文件内容一致', async () => {
    const src = await fs.readFile(path.join(PROVIDERS_DIR, 'seed-audio-volc.js'), 'utf8')
    let deployed: string
    try {
      deployed = await fs.readFile(path.join(DEPLOYED_DIR, 'seed-audio-volc.js'), 'utf8')
    } catch {
      return
    }
    expect(deployed.trimEnd()).toBe(src.trimEnd())
  })

  it('导出 id / actions / submit，图标是豆包官方 SVG', async () => {
    const p = await load()
    expect(p.id).toBe('seed-audio-volc')
    expect(p.actions).toHaveLength(1)
    const a = p.actions[0]!
    expect(a.id).toBe('seed-audio-volc:generate')
    // 标题不带「（官方）」后缀（用户 2026-11-17）：平台名已经说明了是火山引擎
    expect(a.title).toBe('Seed Audio 1.0')
    expect(a.title).not.toContain('官方')
    expect(a.model).toBe('seed-audio-1.0')
    expect(a.nodeTypes).toEqual(['audio'])
    expect(a.pollTimeoutMs).toBeGreaterThan(0)
    // 平台管理列表只认 SVG / 图片地址：写图标名会退回成「火」字兜底（2026-11-17）
    expect(String(p.icon)).toMatch(/^<svg[\s>]/)
    expect(String(p.icon)).toContain('viewBox="0 0 24 24"')
    expect(String(p.icon)).toContain('#1E37FC')
  })

  it('没填鉴权时直接说清楚（两种控制台都提到），不发请求', async () => {
    const stub = stubFetch()
    try {
      const p = await load('')
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id, prompts: PROMPT, resources: [],
      })
      expect('error' in r).toBe(true)
      if ('error' in r) {
        expect(r.error).toContain('API Key')
        expect(r.error).toContain('App ID')
      }
      expect(stub.calls).toHaveLength(0)
    } finally {
      stub.restore()
    }
  })

  /**
   * 旧版控制台鉴权（用户 2026-11-17 给的是一串 App ID 样式的值）：
   * 官方文档写的是 X-Api-App-Id + X-Api-Access-Key 双头，provider 要能直接用。
   */
  it('旧版控制台：App ID + Access Key 走双头，且不发单头 X-Api-Key', async () => {
    const text = await fs.readFile(path.join(PROVIDERS_DIR, 'seed-audio-volc.js'), 'utf8')
    const cfg =
      'const __mcProviderConfig = ' +
      JSON.stringify({
        accounts: [{ id: 'main', values: { appId: 'app-1', accessKey: 'acc-1' } }],
        values: { appId: 'app-1', accessKey: 'acc-1' },
        byId: { main: { appId: 'app-1', accessKey: 'acc-1' } },
        defaultId: 'main',
      }) +
      ';\n'
    const stub = stubFetch()
    try {
      const mod = (await import(
        /* @vite-ignore */ 'data:text/javascript,' + encodeURIComponent(cfg + text)
      )) as { default?: Provider }
      const p = mod.default!
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id, prompts: PROMPT, resources: [],
      })
      expect('done' in r).toBe(true)
      const h = stub.calls[0]!.headers
      expect(h['X-Api-App-Id']).toBe('app-1')
      expect(h['X-Api-Access-Key']).toBe('acc-1')
      expect(h['X-Api-Key']).toBeUndefined()
    } finally {
      stub.restore()
    }
  })

  it('官方字段：text_prompt、X-Api-Key、audio_config', async () => {
    const stub = stubFetch()
    try {
      const p = await load('k-test')
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id,
        prompts: PROMPT,
        values: { format: 'mp3', sampleRate: 48000, speechRate: 10, pitchRate: 2, loudnessRate: 0 },
        resources: [],
      })
      expect(r).toEqual({ done: true, urls: ['https://cdn.example.com/a.mp3'] })
      const call = stub.calls[0]!
      expect(call.url).toContain('/api/v3/tts/create')
      expect(call.headers['X-Api-Key']).toBe('k-test')
      expect(call.headers.Authorization).toBeUndefined()
      expect(call.body.model).toBe('seed-audio-1.0')
      expect(call.body.text_prompt).toBe('雨夜的街道')
      expect(call.body.prompt).toBeUndefined()
      expect(call.body.audio_config).toEqual({
        format: 'mp3', sample_rate: 48000, speech_rate: 10, pitch_rate: 2, loudness_rate: 0,
      })
      // 没有参考音频时不传 references（纯描述模式）
      expect(call.body.references).toBeUndefined()
    } finally {
      stub.restore()
    }
  })

  it('参考音频进 references（裸 base64），@音频N 编号与数组顺序一致', async () => {
    const stub = stubFetch()
    try {
      const p = await load('k-test')
      const action = p.actions[0]!
      await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id,
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
      const body = stub.calls[0]!.body
      expect(body.references).toEqual([{ audio_data: 'AAA' }, { audio_data: 'BBB' }])
      expect(body.text_prompt).toBe('照着@音频2的声音说你好，然后@音频1接着说再见')
    } finally {
      stub.restore()
    }
  })

  it('没写 @音频N 但连了音频时自动补引用', async () => {
    const stub = stubFetch()
    try {
      const p = await load('k-test')
      const action = p.actions[0]!
      await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id,
        prompts: [{ type: 'prompt', value: '你好呀' }],
        resources: [{ id: 'nA', kind: 'audio', url: 'data:audio/mpeg;base64,AAA' }],
      })
      const prompt = String(stub.calls[0]!.body.text_prompt)
      expect(prompt).toContain('@音频1')
      expect(prompt).toContain('你好呀')
    } finally {
      stub.restore()
    }
  })

  it('最多 3 段参考音频，图片/视频被跳过', async () => {
    const stub = stubFetch()
    try {
      const p = await load('k-test')
      const action = p.actions[0]!
      await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id,
        prompts: [{ type: 'prompt', value: '@音频1 说话' }],
        resources: [
          { id: 'i1', kind: 'image', url: 'data:image/png;base64,IMG' },
          { id: 'v1', kind: 'video', url: 'data:video/mp4;base64,VID' },
          ...[1, 2, 3, 4].map((i) => ({ id: 'a' + i, kind: 'audio', url: 'data:audio/mpeg;base64,A' + i })),
        ],
      })
      const body = stub.calls[0]!.body
      expect(body.references).toHaveLength(3)
      const json = JSON.stringify(body)
      expect(json).not.toContain('IMG')
      expect(json).not.toContain('VID')
    } finally {
      stub.restore()
    }
  })

  it('OGG 强制 48 kHz（官方限制）', async () => {
    const stub = stubFetch()
    try {
      const p = await load('k-test')
      const action = p.actions[0]!
      await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id,
        prompts: PROMPT,
        values: { format: 'ogg_opus', sampleRate: 24000 },
        resources: [],
      })
      const cfg = stub.calls[0]!.body.audio_config as Record<string, unknown>
      expect(cfg.sample_rate).toBe(48000)
    } finally {
      stub.restore()
    }
  })

  it('没有 url 时把返回的 base64 包成 data URL', async () => {
    const stub = stubFetch({ audio: 'QUJD', duration: 3, original_duration: 3 })
    try {
      const p = await load('k-test')
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id, prompts: PROMPT, resources: [],
      })
      expect('done' in r).toBe(true)
      if ('done' in r) expect(r.urls?.[0]).toBe('data:audio/mpeg;base64,QUJD')
    } finally {
      stub.restore()
    }
  })

  it('业务失败（200 + code≠0）被当成错误，并带 logid', async () => {
    const globalAny = globalThis as unknown as { fetch: typeof fetch }
    const original = globalAny.fetch
    globalAny.fetch = (async () =>
      new Response(JSON.stringify({ code: 45000001, message: 'invalid api key' }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-tt-logid': 'LOG-1' },
      })) as typeof fetch
    try {
      const p = await load('k-test')
      const action = p.actions[0]!
      const r = await p.submit(action, {
        canvasId: 'c1', nodeId: 'n1', actionId: action.id, prompts: PROMPT, resources: [],
      })
      expect('error' in r).toBe(true)
      if ('error' in r) {
        expect(r.error).toContain('API Key')
        expect(r.error).toContain('LOG-1')
      }
    } finally {
      globalAny.fetch = original
    }
  })

  it('提示词为空 → 直接报错，不浪费一次调用', async () => {
    const stub = stubFetch()
    try {
      const p = await load('k-test')
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
})
