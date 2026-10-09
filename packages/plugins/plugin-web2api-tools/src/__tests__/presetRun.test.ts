/**
 * runPreset / pollOnce / buildToolArgs（纯逻辑，注入假 MCP）。
 *
 * 锁"执行方式"的几条：参数怎么组、同步怎么回、异步怎么轮、失败与超时怎么收敛。
 * 全程不碰网络（deps 是假货），所以能在 node 里跑完。
 */
import { describe, it, expect } from 'vitest'
import type { ToolPollFn, ToolResult } from '@mini-canvas/kernel'
import { runPreset, pollOnce, makeTaskPoll, buildToolArgs, type RunDeps } from '../presetRun'
import { WEB2API_PRESETS } from '../presets'

const doubaoVideoAuto = WEB2API_PRESETS.find((p) => p.id === 'web2api:doubao-video-fast')!
const doubaoTts = WEB2API_PRESETS.find((p) => p.id === 'web2api:doubao-tts')!
const volcAudio = WEB2API_PRESETS.find((p) => p.id === 'web2api:volcengine-audio')!

/** 一个可控的假 deps：能记录调用、按脚本返回任务状态 */
function makeDeps(script: {
  call?: (tool: string, args: Record<string, unknown>) => { ok: boolean; data?: unknown; error?: string }
  tasks?: Array<{ status?: string; message?: string; progress?: number; resources?: Array<{ downloadUrl?: string }> }>
  now?: () => number
  prepare?: (urls: string[]) => Promise<string[]>
}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  const taskQueries: string[] = []
  const cancels: string[] = []
  let tick = 0
  const deps: RunDeps = {
    callTool: async (tool, args) => {
      calls.push({ tool, args })
      return (script.call?.(tool, args) ?? { ok: true, data: { content: [] } }) as never
    },
    getTask: async (taskId: string) => {
      taskQueries.push(taskId)
      const frame = script.tasks?.[Math.min(tick, (script.tasks?.length ?? 1) - 1)] ?? { status: 'processing' }
      tick += 1
      return { ok: true, data: frame as never }
    },
    cancelTask: async (taskId: string) => {
      cancels.push(taskId)
      return { ok: true }
    },
    origin: () => 'http://localhost:8033',
    config: () => ({ pollIntervalMs: 1, timeoutMs: 10_000 }),
    now: script.now ?? (() => 0),
    sleep: async () => {},
    ...(script.prepare ? { prepareReferenceImages: script.prepare } : {}),
  }
  return { deps, calls, taskQueries, cancels }
}

describe('buildToolArgs', () => {
  it('chat-auto：媒体参数拼进 prompt，不散落成工具参数', () => {
    const args = buildToolArgs({
      preset: doubaoVideoAuto,
      prompt: '一只猫在跑',
      values: { ratio: '16:9', durationSec: 10 },
      referenceImages: [],
    })
    expect(args.tool).toBeUndefined()
    // 模型来自**动作本身**（第一个下拉选的就是模型），不再从 values 里取
    expect(args.prompt).toBe('/video(model:"Seedance 2.0 Fast", ratio:"16:9", durationSec:10) 一只猫在跑')
    expect(args.ratio).toBeUndefined()
    expect(args.model).toBeUndefined()
  })

  it('chat-auto：上游参考图进 referenceImages', () => {
    const args = buildToolArgs({
      preset: doubaoVideoAuto,
      prompt: 'x',
      values: {},
      referenceImages: ['http://a/1.png', 'http://a/2.png'],
    })
    expect(args.referenceImages).toEqual(['http://a/1.png', 'http://a/2.png'])
  })

  it('音频工具（tts）：文本参数名是 text 不是 prompt', () => {
    const args = buildToolArgs({ preset: doubaoTts, prompt: '你好世界', values: { speaker: 'zh_male_ahu_conversation_wvae_bigtts' }, referenceImages: [] })
    expect(args.text).toBe('你好世界')
    expect(args.prompt).toBeUndefined()
    expect(args.speaker).toBe('zh_male_ahu_conversation_wvae_bigtts')
  })

  it('火山音频：文本参数名同样是 text，且带上格式/语速等参数', () => {
    const args = buildToolArgs({
      preset: volcAudio,
      prompt: '讲个故事',
      values: { model: 'seed-audio-1.0', format: 'mp3', speechRate: 0, pitchRate: 0, loudnessRate: 0 },
      referenceImages: [],
    })
    expect(args.text).toBe('讲个故事')
    expect(args.format).toBe('mp3')
    expect(args.model).toBe('seed-audio-1.0')
    // 0 是合法值，不能被"清空空值"误删
    expect(args.speechRate).toBe(0)
  })

  it('空串参数不上送（不覆盖服务端默认）', () => {
    const args = buildToolArgs({ preset: volcAudio, prompt: 'x', values: { format: '', model: 'seed-audio-1.0' }, referenceImages: [] })
    expect(args.format).toBeUndefined()
    expect(args.model).toBe('seed-audio-1.0')
  })
})

describe('runPreset：同步路径', () => {
  it('服务端直接回资源 → 同步返回 urls（不进入轮询）', async () => {
    const { deps } = makeDeps({
      call: () => ({
        ok: true,
        data: { content: [{ type: 'resource', resource: { uri: '/api/mcp/resources/audios/doubao/a.mp3' } }] },
      }),
    })
    const out = await runPreset({ preset: doubaoTts, prompt: '你好', values: {}, referenceImages: [] }, deps)
    expect(typeof out).not.toBe('function')
    expect((out as ToolResult).ok).toBe(true)
    expect((out as ToolResult).urls).toEqual(['http://localhost:8033/api/mcp/resources/audios/doubao/a.mp3'])
  })

  it('调用失败（如服务没起）→ 原样把可读错误返回（不静默）', async () => {
    const { deps } = makeDeps({ call: () => ({ ok: false, error: '连不上 web2api（http://localhost:8033/mcp）' }) })
    const out = (await runPreset({ preset: doubaoTts, prompt: '你好', values: {}, referenceImages: [] }, deps)) as ToolResult
    expect(out.ok).toBe(false)
    expect(out.error).toContain('连不上 web2api')
  })

  it('调用失败的原因会原样带出（用户知道下一步做什么）', async () => {
    const { deps } = makeDeps({ call: () => ({ ok: false, error: '平台没有可用账号，请先在 web2api 里导入 Cookie' }) })
    const out = (await runPreset({ preset: doubaoTts, prompt: 'x', values: {}, referenceImages: [] }, deps)) as ToolResult
    expect(out.error).toContain('没有可用账号')
  })
})

describe('runPreset：异步路径（视频这类）', () => {
  it('第一次只回 taskId → 返回轮询函数，轮询到 completed 才给 urls', async () => {
    const { deps } = makeDeps({
      call: () => ({ ok: true, data: { content: [{ type: 'text', text: '任务已创建' }], structuredContent: { taskId: 't-1' } } }),
      tasks: [
        { status: 'processing', progress: 30, message: '排队中' },
        { status: 'processing', progress: 70, message: '生成中' },
        { status: 'completed', resources: [{ downloadUrl: '/api/mcp/resources/videos/doubao/v.mp4' }] },
      ],
    })
    const out = await runPreset({ preset: doubaoVideoAuto, prompt: '猫', values: {}, referenceImages: [] }, deps)
    expect(typeof out).toBe('function')
    const poll = out as ToolPollFn
    const s1 = await poll()
    expect(s1.status).toBe('running')
    expect((s1 as { progress?: number }).progress).toBe(30)
    const s2 = await poll()
    expect(s2.status).toBe('running')
    const s3 = await poll()
    expect(s3.status).toBe('done')
    if (s3.status === 'done') {
      expect(s3.result.ok).toBe(true)
      expect(s3.result.urls).toEqual(['http://localhost:8033/api/mcp/resources/videos/doubao/v.mp4'])
    }
  })

  it('任务 failed → 轮询直接给 done + 失败原因（不无限转圈）', async () => {
    const { deps } = makeDeps({ tasks: [{ status: 'failed', message: '额度不足' }] })
    const state = await pollOnce('t-2', deps)
    expect(state.status).toBe('done')
    if (state.status === 'done') expect(state.result).toEqual({ ok: false, error: '额度不足', taskId: 't-2' })
  })

  it('任务完成但没资源 → 明确失败（不返回空的 ok）', async () => {
    const { deps } = makeDeps({ tasks: [{ status: 'completed', resources: [] }] })
    const state = await pollOnce('t-3', deps)
    if (state.status === 'done') expect(state.result.ok).toBe(false)
  })

  it('超过配置的超时 → 收成失败并说明等了几分钟', async () => {
    let t = 0
    const { deps } = makeDeps({ now: () => t, tasks: [{ status: 'processing' }] })
    const poll = makeTaskPoll('t-4', { ...deps, config: () => ({ pollIntervalMs: 1, timeoutMs: 5000 }) }, 0)
    t = 6000
    const state = await poll()
    expect(state.status).toBe('done')
    if (state.status === 'done') {
      expect(state.result.ok).toBe(false)
      expect(state.result.error).toContain('超时')
    }
  })

  it('取消（abort）后轮询立刻收成"已取消"，不再查任务', async () => {
    const ctrl = new AbortController()
    const { deps, taskQueries } = makeDeps({ tasks: [{ status: 'processing' }] })
    // 先让 runPreset 返回轮询函数（call 回 taskId）
    const withTaskId: RunDeps = { ...deps, callTool: async () => ({ ok: true, data: { content: [], structuredContent: { taskId: 't-5' } } }) }
    const out = await runPreset({ preset: doubaoVideoAuto, prompt: 'x', values: {}, referenceImages: [] }, withTaskId, {
      signal: ctrl.signal,
    })
    const poll = out as ToolPollFn
    ctrl.abort()
    const state = await poll()
    expect(state.status).toBe('done')
    if (state.status === 'done') expect(state.result.error).toBe('已取消')
    // 取消了就不该再去问服务端要进度
    expect(taskQueries.length).toBe(0)
  })

  /**
   * 用户实测的 bug（2026-10-08）：paused = 等用户在浏览器里过验证码，
   * web2api 的 captcha-watcher 会**自动恢复**它 —— 不能当成"停住了"直接收工。
   * 早先把它收敛成 done(ok:false)，于是用户还在过验证码，画布上任务已经「完成（失败）」。
   */
  it('任务 paused（等验证码）→ 继续 running（带原因），不判失败', async () => {
    const { deps } = makeDeps({ tasks: [{ status: 'paused', message: '触发人机验证码', progress: 40 }] })
    const state = await pollOnce('t-6', deps)
    expect(state.status).toBe('running')
    if (state.status === 'running') {
      expect(state.message).toContain('触发人机验证码')
      expect(state.progress).toBe(40)
    }
  })

  it('任务 polling_failed（轮询中断）→ 同样收敛，不卡在百分比上', async () => {
    const { deps } = makeDeps({ tasks: [{ status: 'polling_failed', progress: 40 }] })
    const state = await pollOnce('t-7', deps)
    expect(state.status).toBe('done')
    if (state.status === 'done') expect(state.result.ok).toBe(false)
  })
})

describe('runPreset：下单前整理参考图（referencePrep 接线）', () => {
  it('给 prepareReferenceImages 时，工具参数里的 referenceImages 用的是整理后的值', async () => {
    const seen: string[][] = []
    const { deps, calls } = makeDeps({
      prepare: async (urls) => {
        seen.push(urls)
        // 本地素材换成 web2api 的 referenceUrl；外链原样
        return urls.map((u) => (u.startsWith('/api/') ? '/uploaded.png' : u))
      },
    })
    await runPreset(
      {
        preset: doubaoVideoAuto,
        prompt: '猫',
        values: {},
        referenceImages: ['/api/assets/files/x.png', 'https://cdn.example.com/a.png'],
      },
      deps,
    )
    expect(seen).toEqual([['/api/assets/files/x.png', 'https://cdn.example.com/a.png']])
    const args = calls[0].args as { referenceImages?: string[] }
    expect(args.referenceImages).toEqual(['/uploaded.png', 'https://cdn.example.com/a.png'])
  })

  it('没有参考图时不做整理（不白跑一次）', async () => {
    let called = 0
    const { deps } = makeDeps({
      prepare: async (urls) => {
        called += 1
        return urls
      },
    })
    await runPreset({ preset: doubaoTts, prompt: '你好', values: {}, referenceImages: [] }, deps)
    expect(called).toBe(0)
  })
})
