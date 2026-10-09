import { describe, it, expect } from 'vitest'
import { makeJobPoll, submitJob, toPollState, type RunDeps } from '../jobRunner'
import { CloudApi } from '../api'
import type { FetchLike } from '../apiTypes'
import type { ServerJob } from '../apiTypes'

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

describe('Job → 底栏认识的轮询状态', () => {
  it('running：带上 taskId（不带的话"取消"发不到后台）', () => {
    const job: ServerJob = { id: 'j1', canvasId: 'default', nodeId: 'n1', actionId: 'a', providerId: 'p', status: 'running', progress: 40, message: '跑着' }
    expect(toPollState(job, 'j1')).toEqual({ status: 'running', progress: 40, message: '跑着', taskId: 'j1' })
  })

  it('done：带上产物', () => {
    const job: ServerJob = {
      id: 'j1', canvasId: 'default', nodeId: 'n1', actionId: 'a', providerId: 'p', status: 'done',
      result: { ok: true, urls: ['https://x/1.png'] },
    }
    expect(toPollState(job, 'j1')).toEqual({ status: 'done', result: { ok: true, urls: ['https://x/1.png'], taskId: 'j1' } })
  })

  it('error：收敛成 done + ok:false（底栏不会永远转）', () => {
    const job: ServerJob = {
      id: 'j1', canvasId: 'default', nodeId: 'n1', actionId: 'a', providerId: 'p', status: 'error',
      result: { ok: false, error: '平台说不行' },
    }
    const s = toPollState(job, 'j1')
    expect(s.status).toBe('done')
    expect(s.status === 'done' && s.result.ok).toBe(false)
    expect(s.status === 'done' && s.result.error).toBe('平台说不行')
  })
})

describe('轮询函数', () => {
  it('问后台，翻译成底栏状态', async () => {
    const api = fakeApi(() => ({ body: { ok: true, job: { id: 'j1', status: 'running', progress: 10 } } }))
    const poll = makeJobPoll(deps(api), 'j1')
    expect(await poll()).toEqual({ status: 'running', progress: 10, taskId: 'j1' })
  })

  it('任务在后台不存在 → 收敛成失败（别让界面永远转）', async () => {
    const api = fakeApi(() => ({ status: 404, body: {} }))
    const s = await makeJobPoll(deps(api), 'gone')()
    expect(s.status).toBe('done')
    expect(s.status === 'done' && s.result.ok).toBe(false)
  })

  it('查一次失败不算终态（报给用户但继续）', async () => {
    const api = fakeApi(() => ({ status: 500, body: {} }))
    const s = await makeJobPoll(deps(api), 'j1')()
    expect(s.status).toBe('running')
  })
})

describe('下单', () => {
  it('把画布 id 与动作一起交给后台', async () => {
    let sent: Record<string, unknown> = {}
    const fetchImpl: FetchLike = async (_url, init) => {
      sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({ ok: true, jobId: 'j1' }), { status: 200 })
    }
    const api = new CloudApi({ baseUrl: 'http://srv', fetchImpl })
    const r = await submitJob(deps(api), { nodeId: 'n1', actionId: 'a:1', prompt: '画只猫' })
    expect('jobId' in r && r.jobId).toBe('j1')
    expect(sent.canvasId).toBe('default')
    expect(sent.nodeId).toBe('n1')
    expect(sent.actionId).toBe('a:1')
    expect(sent.prompt).toBe('画只猫')
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
})
