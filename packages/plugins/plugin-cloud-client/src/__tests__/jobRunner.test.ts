import { describe, it, expect } from 'vitest'
import { submitJob, type RunDeps } from '../jobRunner'
import { CloudApi } from '../api'
import type { FetchLike } from '../apiTypes'

function fakeApi(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown }): CloudApi {
  const fetchImpl: FetchLike = async (url, init) => {
    const r = handler(url, init)
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 })
  }
  return new CloudApi({ baseUrl: 'http://srv', fetchImpl })
}

function deps(api: CloudApi, over: Partial<RunDeps> = {}): RunDeps {
  return {
    api,
    canvasId: 'default',
    readNodeData: () => ({}),
    uploadLocal: async () => ({ url: '/api/canvases/default/resources/0123456789abcdef.png' }),
    ...over,
  }
}

describe('下单', () => {
  it('把画布 id 与动作一起交给后台', async () => {
    let sent: Record<string, unknown> = {}
    const fetchImpl: FetchLike = async (_url, init) => {
      sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({ ok: true, jobId: 'j1' }), { status: 200 })
    }
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    const r = await submitJob(deps(api), {
      nodeId: 'n1',
      actionId: 'a:1',
      prompts: [{ type: 'prompt', value: '画只猫' }],
    })
    expect('jobId' in r && r.jobId).toBe('j1')
    expect(sent.canvasId).toBe('default')
    expect(sent.nodeId).toBe('n1')
    expect(sent.actionId).toBe('a:1')
    // 不再有 prompt 字段：同一份内容以分段数组给出
    expect(sent.prompt).toBeUndefined()
    expect(sent.prompts).toEqual([{ type: 'prompt', value: '画只猫' }])
  })

  it('资源带着 id 与名称一起交给后台（与提示词里的 tag 对照）', async () => {
    let sent: {
      prompts?: Array<{ type: string; value: string }>
      resources?: Array<{ id?: string; kind: string; name?: string; url?: string }>
    } = {}
    const fetchImpl: FetchLike = async (_url, init) => {
      sent = JSON.parse(String(init?.body ?? '{}')) as typeof sent
      return new Response(JSON.stringify({ ok: true, jobId: 'j1' }), { status: 200 })
    }
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    await submitJob(deps(api), {
      nodeId: 'n1',
      actionId: 'a:1',
      prompts: [
        { type: 'tag', value: 'n7' },
        { type: 'prompt', value: ' 他说：你好' },
      ],
      resources: [{ id: 'n7', kind: 'audio', name: '音频3', url: '/api/canvases/default/resources/abcdef0123456789.mp3' }],
    })
    expect(sent.prompts).toEqual([
      { type: 'tag', value: 'n7' },
      { type: 'prompt', value: ' 他说：你好' },
    ])
    expect(sent.resources).toEqual([
      { id: 'n7', kind: 'audio', name: '音频3', url: '/api/canvases/default/resources/abcdef0123456789.mp3' },
    ])
  })

  it('上游素材里"后台取不到"的地址先上传再交（data:/blob:）', async () => {
    const uploaded: string[] = []
    let sent: { resources?: Array<{ kind: string; url?: string }> } = {}
    const fetchImpl: FetchLike = async (_url, init) => {
      if (init?.method === 'POST') sent = JSON.parse(String(init.body ?? '{}')) as typeof sent
      return new Response(JSON.stringify({ ok: true, jobId: 'j1' }), { status: 200 })
    }
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    const d = deps(api, {
      toBlob: async () => new Blob([new Uint8Array([1, 2, 3])]),
      uploadLocal: async (_c, _b, name) => {
        uploaded.push(name)
        return { url: '/api/canvases/default/resources/0123456789abcdef.png' }
      },
    })
    await submitJob(d, { nodeId: 'n1', actionId: 'a:1', resources: [{ kind: 'image', url: 'data:image/png;base64,AAA' }] })
    expect(uploaded).toHaveLength(1)
    // 交出去的必须是画布资源 URL（不是原本的 data:）
    expect(sent.resources?.[0]?.url).toBe('/api/canvases/default/resources/0123456789abcdef.png')
  })

  it('节点里还有没上传的本地地址 → 提醒一句（不静默）', async () => {
    const notes: string[] = []
    const api = fakeApi(() => ({ body: { ok: true, jobId: 'j1' } }))
    const d = deps(api, {
      readNodeData: () => ({ imageUrl: 'data:image/png;base64,AAA' }),
      onError: (m) => notes.push(m),
    })
    await submitJob(d, { nodeId: 'n1', actionId: 'a:1' })
    expect(notes.join('')).toContain('imageUrl')
  })

  /**
   * 用户口径 2026-11-10：前端不再自己轮询 —— 下单只返回任务号，
   * 进度与终态由后台写节点 + jobsWatcher 对账。
   */
  it('下单只返回任务号（不再给轮询函数）', async () => {
    const api = fakeApi(() => ({ body: { ok: true, jobId: 'j9' } }))
    const r = await submitJob(deps(api), { nodeId: 'n1', actionId: 'a:1' })
    expect(r).toEqual({ jobId: 'j9' })
  })
})
