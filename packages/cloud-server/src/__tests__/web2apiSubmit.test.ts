/**
 * web2api provider 的**提交/轮询解析**单测 —— 修一个真出过的坑。
 *
 * 用户实测：豆包语音合成（doubao/tts）任务在 web2api 那边**已经成功**（get-task 里
 * `resources[].downloadUrl` 有音频），但云端前台卡片报
 * `Cannot read properties of undefined (reading 'urls')`。
 *
 * 根因两条：
 * 1. 同步完成的工具（tts 就是）只回 `content`，没有 `structuredContent`；
 *    提交分支无脑 `extractUrls(result.structuredContent)` → 传 undefined 进去就炸。
 * 2. `extractUrls` 只认 `url/src/urls`，不认 web2api 任务详情里真正的字段 `downloadUrl`。
 *
 * 这两条都**不联网**就能复现：给 provider 注入一个假 fetch，回真实的响应形状。
 */
import { describe, it, expect } from 'vitest'
import { createWeb2ApiProvider, WEB2API_ACTIONS } from '../providers/web2api/index'
import { Web2ApiClient } from '../providers/web2api/client'
import type { ActionDef } from '../providers/types'

const EP = 'http://localhost:8033/mcp'

/** 造一个假 fetch：按 JSON-RPC 的 method 回预设结果，协议细节（会话头）照真实实现来。 */
function fakeFetch(routes: {
  call?: unknown
  task?: unknown
}): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string; id?: number }
    if (body.method === 'initialize') {
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'mcp-session-id': 's-1' },
      })
    }
    if (body.method === 'notifications/initialized') return new Response('', { status: 202 })
    if (body.method === 'tools/call') {
      const name = (body as { params?: { name?: string } }).params?.name
      const result = name === 'system/get-task' ? routes.task : routes.call
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const TTS: ActionDef = {
  id: 'web2api:doubao-tts',
  title: '豆包·语音合成',
  tool: 'doubao/tts',
  promptMode: 'plain',
  nodeTypes: ['audio'],
  model: 'zh_female_xiaohe_conversation_wvae_bigtts',
}

/** 真实探针抓到的同步完成形状：只有 content，没有 structuredContent */
const TTS_SYNC_RESULT = {
  content: [
    {
      type: 'resource',
      resource: {
        uri: '/api/resources/audios/doubao/tts-e475abc1.ogg',
        mimeType: 'application/octet-stream',
        text: '探针.ogg',
      },
    },
  ],
}

describe('提交同步完成的工具不再崩（tts 无 structuredContent）', () => {
  it('把 content 里的 resource.uri 抽成产物（绝对化到 web2api origin）', async () => {
    const provider = createWeb2ApiProvider({ endpoint: EP, fetchImpl: fakeFetch({ call: TTS_SYNC_RESULT }) })
    const r = await provider.submit(TTS, { canvasId: 'default', nodeId: 'n1', actionId: TTS.id, prompt: '你好' })
    expect(r).toEqual({
      done: true,
      urls: ['http://localhost:8033/api/resources/audios/doubao/tts-e475abc1.ogg'],
    })
  })

  it('structuredContent 缺席也不抛「reading \'urls\'」', async () => {
    const provider = createWeb2ApiProvider({ endpoint: EP, fetchImpl: fakeFetch({ call: { content: [] } }) })
    await expect(
      provider.submit(TTS, { canvasId: 'default', nodeId: 'n1', actionId: TTS.id, prompt: '你好' }),
    ).resolves.toEqual({ error: expect.stringContaining('doubao/tts') })
  })
})

describe('异步任务轮询认 resources[].downloadUrl', () => {
  it('get-task 的 downloadUrl 也算产物（绝对化）', async () => {
    const provider = createWeb2ApiProvider({
      endpoint: EP,
      fetchImpl: fakeFetch({
        // 真实 get-task 把详情放在 structuredContent 里（与 content 里那段 JSON 文本同源）
        task: {
          structuredContent: {
            status: 'completed',
            resources: [{ downloadUrl: '/api/resources/audios/doubao/tts-7d98b8f6.ogg', type: 'audio' }],
          },
        },
      }),
    })
    const p = await provider.poll!('t-1', TTS)
    expect(p).toEqual({
      status: 'done',
      taskId: 't-1',
      urls: ['http://localhost:8033/api/resources/audios/doubao/tts-7d98b8f6.ogg'],
    })
  })
})

describe('extractUrls 防御性', () => {
  it('undefined 详情返回空数组，不抛', async () => {
    const client = new Web2ApiClient({ endpoint: EP })
    // 直接调导出函数（与 provider 走的是同一份）
    const { extractUrls } = await import('../providers/web2api/client')
    expect(extractUrls(undefined)).toEqual([])
    void client
  })
})

describe('每个动作都显式声明轮询节奏与超时（视频不该被默认 5 分钟误杀）', () => {
  /**
   * 真出过的问题：动作不设 pollTimeoutMs 时落到后台默认 5 分钟 —— 一次成功生图实测 136s，
   * 视频更长（web2api 自己的任务超时是 20 分钟、轮询超时 24h），5 分钟必把正常任务判死。
   */
  it('全部动作都带 pollIntervalMs / pollTimeoutMs，且视频 ≥ 30 分钟', () => {
    expect(WEB2API_ACTIONS.length).toBeGreaterThan(0)
    for (const a of WEB2API_ACTIONS) {
      expect(a.pollIntervalMs, a.id).toBeGreaterThan(0)
      expect(a.pollTimeoutMs, a.id).toBeGreaterThan(0)
      if (a.nodeTypes?.includes('video')) {
        expect(a.pollTimeoutMs!, a.id).toBeGreaterThanOrEqual(30 * 60_000)
      }
    }
  })
})

/**
 * 中间态不能当终态（用户实测的 bug，2026-10-08）。
 *
 * 现场：任务在浏览器里等用户过验证码（web2api 那边 status=`paused`，非终态），
 * cloud-server 却把 paused 直接判成失败收工 —— 用户还在过验证码，画布上任务已经「完成（失败）」。
 * 真实日志：18:54:42 暂停 → 立刻判失败；18:55:11 验证码消失自动恢复；18:56:35 真成功。
 *
 * web2api 的状态机里，只有 completed / failed / cancelled 是**真终态**；
 * paused（等验证码）/ retrying（退避）/ polling_failed / pending（换号后重排）都还在自己往前走。
 */
describe('中间态继续轮询，不判失败（paused 等验证码 / retrying 退避）', () => {
  const pollWith = async (status: string, extra: Record<string, unknown> = {}) => {
    const provider = createWeb2ApiProvider({
      endpoint: EP,
      fetchImpl: fakeFetch({ task: { structuredContent: { status, message: 'm', ...extra } } }),
    })
    return provider.poll!('t-1', TTS)
  }

  it('paused（等用户过验证码）→ running + waiting（不占超时预算）', async () => {
    const p = await pollWith('paused', { message: '触发人机验证码，需人工在远程控制中完成验证后恢复' })
    expect(p.status).toBe('running')
    expect(p.waiting).toBe(true)
    expect(p.message).toContain('验证码')
  })

  it('retrying（退避等待重试）→ running + waiting', async () => {
    const p = await pollWith('retrying', { message: '失败，稍后自动重试' })
    expect(p.status).toBe('running')
    expect(p.waiting).toBe(true)
  })

  it('pending（换号后重新排队）→ running + waiting', async () => {
    const p = await pollWith('pending', { message: '已换号，10s 后重新执行' })
    expect(p.status).toBe('running')
    expect(p.waiting).toBe(true)
  })

  it('polling_failed（轮询中断，可手动恢复）→ running（仍算普通等待）', async () => {
    const p = await pollWith('polling_failed')
    expect(p.status).toBe('running')
    expect(p.waiting).toBeUndefined()
  })

  it('普通进行中（processing/polling）→ running，不带 waiting', async () => {
    for (const s of ['processing', 'polling']) {
      const p = await pollWith(s, { progress: 40 })
      expect(p.status, s).toBe('running')
      expect(p.waiting, s).toBeUndefined()
      expect(p.progress, s).toBe(40)
    }
  })

  it('真终态仍然收敛：failed / cancelled → error；completed → done', async () => {
    expect((await pollWith('failed', { message: '节点不存在' })).status).toBe('error')
    expect((await pollWith('cancelled')).status).toBe('error')
    const done = await pollWith('completed', { resources: [{ downloadUrl: '/api/resources/audios/doubao/x.ogg' }] })
    expect(done.status).toBe('done')
  })
})
