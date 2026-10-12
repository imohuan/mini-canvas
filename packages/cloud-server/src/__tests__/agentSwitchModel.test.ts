/**
 * 切换模型 = 换一条会话（用户口径 2026-10-11）。
 *
 * 为什么是"换会话"而不是"改字段"：SDK 把模型钉在 session_meta 上（建会话时写死），
 * 运行中改不了 —— 所以切换必然开新会话。但这个动作对用户必须**像"在一条对话里换了脑子"**：
 * 历史全带过去 + 记一条模型分段（界面据此画分割线），分叉点登记进 branches.json
 * （于是它与"编辑重发"出来的分支共用一套分页器 / 历史聚合）。
 *
 * 这里锁路由层的四件事：
 *  1. 历史整段拷过去，新会话的 provider/modelId 是**新的那个**；
 *  2. modelSegments 是"父的分段 + 新的一段"，第一段若缺就补上父当前的模型；
 *  3. 已经就是这个模型 ⇒ unchanged，不折腾（否则每点一次都长一条会话）；
 *  4. 这一轮在跑 ⇒ 409（切换会把正在写的一轮搅乱）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { branchStore } from '../agent/branchStore.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'

let root: string
let store: AgentSessionStore
let app: Hono

async function setup(runtimeOver: Record<string, unknown> = {}) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'switch-model-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: '对话', createdAt: 1, provider: 'deepseek', modelId: 'deepseek-v4-pro' })
  await store.appendTurn('c1', 's1', { role: 'user', text: '第一句', ts: 1 })
  await store.appendTurn('c1', 's1', { role: 'assistant', text: '第一答', ts: 2 })
  await store.appendTurn('c1', 's1', { role: 'user', text: '第二句', ts: 3 })
  const config = { dataDir: root, modelContextWindow: async () => undefined } as never
  app = new Hono()
  app.route(
    '/',
    agentSessionRoutes(
      store,
      { isRunning: () => false, isCompactActive: () => false, ...runtimeOver } as never,
      config,
      branchStore(root),
      undefined,
      undefined,
      undefined,
      undefined,
    ),
  )
}

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function switchTo(provider: string, modelId: string, sessionId = 's1') {
  const res = await app.request('/api/agent/canvases/c1/sessions/' + sessionId + '/switch-model', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, modelId }),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe('切换模型', () => {
  beforeEach(async () => { await setup() })

  it('开一条新会话：历史全带过去、模型是新的、记了模型分段', async () => {
    const r = await switchTo('openrouter', 'anthropic/claude-opus-5')
    expect(r.status).toBe(200)
    const newId = String(r.json.sessionId)
    expect(newId).not.toBe('s1')
    const rec = await store.get('c1', newId)
    expect(rec!.provider).toBe('openrouter')
    expect(rec!.modelId).toBe('anthropic/claude-opus-5')
    // 历史整段照拷（界面因此"接着聊"，不是从空白开始）
    expect(rec!.turns.map((t) => t.text)).toEqual(['第一句', '第一答', '第二句'])
    // 分段：第一段（老模型）+ 新的一段，新的一段从第 2 条用户消息（序号 1）起
    expect(rec!.modelSegments).toEqual([
      { fromUser: 0, provider: 'deepseek', modelId: 'deepseek-v4-pro' },
      { fromUser: 2, provider: 'openrouter', modelId: 'anthropic/claude-opus-5' },
    ])
    // 分支登记：新会话挂在父会话的末尾分叉点上（与"编辑重发"同一张表）
    expect(await branchStore(root).pointOf('c1', newId)).toEqual({ parentSessionId: 's1', point: 'turn:3' })
  })

  /**
   * 真机实测的洞（2026-10-11）：切模型后新会话的上下文用量是空的 ——
   * 界面表现就是"刚换完模型，那个上下文指示器就没了"，而这恰好是用户报的
   * "进度莫名其妙消失"。上下文没变（历史全在），用量必须跟着历史一起走。
   */
  it('最近用量随历史一起带过去（换完模型指示器不会消失）', async () => {
    await store.setLastUsage('c1', 's1', { usedTokens: 6308, limitTokens: 256_000 })
    const r = await switchTo('openrouter', 'anthropic/claude-opus-5')
    const rec = await store.get('c1', String(r.json.sessionId))
    expect(rec!.lastUsage).toEqual({ usedTokens: 6308, limitTokens: 256_000 })
  })

  /**
   * 真机实测到的脏数据（2026-10-11）：在同一位置连切两次模型（A → B → A），
   * 后两段共用同一个 fromUser，记录里出现两条同起点的分段 —— 界面只能画一条线，
   * 另一条成了幽灵数据。每个起点只该留**最后一次**的选择。
   */
  it('同一位置连切两次 ⇒ 同起点的旧分段被折掉，只留最后一次的选择', async () => {
    const r1 = await switchTo('openrouter', 'claude-opus-5')
    const mid = await store.get('c1', String(r1.json.sessionId))
    // 在新会话上再切回原模型
    const app2 = app
    const res = await app2.request('/api/agent/canvases/c1/sessions/' + r1.json.sessionId + '/switch-model', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', modelId: 'deepseek-v4-pro' }),
    })
    expect(res.status).toBe(200)
    const final = await store.get('c1', String(((await res.json()) as Record<string, unknown>).sessionId))
    const starts = (final!.modelSegments ?? []).map((s) => s.fromUser)
    expect(new Set(starts).size).toBe(starts.length)
    // 最终那一段的模型 = 最后一次的选择（起点是这条新会话的转录末尾：2 条用户消息）
    expect(final!.modelSegments!.at(-1)).toEqual({ fromUser: 2, provider: 'deepseek', modelId: 'deepseek-v4-pro' })
    // 中间那条会话自己的分段没被动过（分段随会话记录走，不是全局的）
    expect(mid!.modelSegments!.at(-1)!.modelId).toBe('claude-opus-5')
  })

  it('已经是这个模型 ⇒ unchanged（不产生第二条会话）', async () => {
    const r = await switchTo('deepseek', 'deepseek-v4-pro')
    expect(r.json.unchanged).toBe(true)
    expect(r.json.sessionId).toBe('s1')
    expect((await store.list('c1')).length).toBe(1)
  })

  it('缺 provider / modelId ⇒ 400（模型引用必须是成对的一对）', async () => {
    expect((await switchTo('', 'x')).status).toBe(400)
  })

  it('一轮正在跑 ⇒ 409，不折腾会话', async () => {
    await setup({ isRunning: () => true })
    const r = await switchTo('openrouter', 'anthropic/claude-opus-5')
    expect(r.status).toBe(409)
    expect((await store.list('c1')).length).toBe(1)
  })
})

