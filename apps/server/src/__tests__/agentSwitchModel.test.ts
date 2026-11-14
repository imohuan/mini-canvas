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
import { AgentSessionStore } from '@plume-canvas/plugin-agent/server/agent/sessionStore.js'
import { branchStore } from '@plume-canvas/plugin-agent/server/agent/branchStore.js'
import { agentSessionRoutes } from '@plume-canvas/plugin-agent/server/routes/agentSessions.js'

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
    /**
     * 切模型**接管当前分支**，不新增版本（用户 2026-11-14 口径）。
     * 没有编辑分支时，新会话是这条对话的延续：不该登记任何分叉点，
     * 否则界面上会凭空多出一组分页器（与编辑分支叠在一起）。
     */
    expect(await branchStore(root).pointOf('c1', newId)).toBeNull()
    expect(await branchStore(root).allPoints('c1')).toEqual([])
    // 旧会话被顶替掉：历史里只剩新的一条，用户看到的是一条对话、一个模型
    expect((await store.list('c1')).map((s) => s.id)).toEqual([newId])
    expect(await store.get('c1', 's1')).toBeUndefined()
    // 但它仍属于同一棵树（历史列表不会因此多出一行）
    expect(await branchStore(root).parentMap('c1')).toEqual({ [newId]: 's1' })
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
    // 在新会话上再切回原模型
    const app2 = app
    const res = await app2.request('/api/agent/canvases/c1/sessions/' + r1.json.sessionId + '/switch-model', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', modelId: 'deepseek-v4-pro' }),
    })
    expect(res.status).toBe(200)
    const finalId = String(((await res.json()) as Record<string, unknown>).sessionId)
    const final = await store.get('c1', finalId)
    const starts = (final!.modelSegments ?? []).map((s) => s.fromUser)
    expect(new Set(starts).size).toBe(starts.length)
    // 最终那一段的模型 = 最后一次的选择（起点是这条新会话的转录末尾：2 条用户消息）
    expect(final!.modelSegments!.at(-1)).toEqual({ fromUser: 2, provider: 'deepseek', modelId: 'deepseek-v4-pro' })
    // 连切两次也只留一条会话：第一次那条已被第二次顶替
    expect((await store.list('c1')).map((s) => s.id)).toEqual([finalId])
    expect(await store.get('c1', String(r1.json.sessionId))).toBeUndefined()
  })

  /**
   * 用户 2026-11-14 的核心要求：切模型**直接覆盖当前分支**，不影响编辑出来的分支。
   *
   * 现场：一条对话先「编辑重发」分出两版（分页器 1/2、2/2），再在其中一版上切模型 ——
   * 以前会在末尾再登记一个分叉点，于是同一栏里叠出两组分页器。
   * 现在切模型顶替当前那一版：版本数量不变、页码不变、另一版仍然可达。
   */
  it('在编辑分支上切模型：原地顶替那一版，不新增版本', async () => {
    // 先造一条编辑分支：s1 在「第二句」之前分出 v2
    const bs = branchStore(root)
    const fork = await store.forkFrom('c1', 's1', '第二句')
    await bs.register('c1', 's1', fork.point, fork.sessionId)
    const before = await bs.allPoints('c1')
    expect(before).toHaveLength(1)
    expect(before[0].children).toEqual([fork.sessionId])

    // 在这条分支上切模型
    const r = await switchTo('openrouter', 'claude-opus-5', fork.sessionId)
    expect(r.status).toBe(200)
    const newId = String(r.json.sessionId)
    expect(newId).not.toBe(fork.sessionId)

    const after = await bs.allPoints('c1')
    // 仍然只有**一处**分叉点、一个版本位 —— 只是内容换成了新会话
    expect(after).toHaveLength(1)
    expect(after[0].parentId).toBe('s1')
    expect(after[0].children).toEqual([newId])
    // 旧分支会话被顶替（历史里不会同时出现两份内容相同的版本）
    expect(await store.get('c1', fork.sessionId)).toBeUndefined()
    expect(await bs.pointOf('c1', newId)).toEqual({ parentSessionId: 's1', point: fork.point })
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

