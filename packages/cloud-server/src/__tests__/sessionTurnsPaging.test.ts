/**
 * GET /sessions/:id 的转录分页（用户口径 2026-10-15）：长对话不要一次全拉。
 *
 * 契约：
 * - 不带参数 = 全量（旧客户端行为不变）；
 * - turnsLimit 只回最后 N 条，并带 turnsTotal / turnsHaveBefore；
 * - turnsBefore 从「倒数第 K 条」再往前取一页（顶部哨兵续拉用）；
 * - 切点对齐用户消息边界（切片的第一条是 user turn）—— 一条 user 的内容
 *   被切在两页里会让前端重放出孤立的助手占位。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'

let root: string
let store: AgentSessionStore
let app: Hono

function fakeRuntime() {
  return {
    isRunning: () => false,
    isSteerable: () => false,
    steerInto: async () => false,
    pendingApprovals: () => [],
    abort: () => undefined,
    forget: () => undefined,
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'turns-paging-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
  // 造 8 条：u1 a1 u2 a2 u3 a3 u4 a4
  for (let i = 1; i <= 4; i++) {
    await store.appendTurn('c1', 's1', { role: 'user', text: 'u' + i, ts: i })
    await store.appendTurn('c1', 's1', { role: 'assistant', text: 'a' + i, ts: i })
  }
  const config = { dataDir: root, modelContextWindow: async () => undefined } as never
  app = new Hono()
  app.route('/', agentSessionRoutes(store, fakeRuntime() as never, config))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

type Body = {
  session: { turns: Array<{ role: string; text: string }> }
  turnsTotal: number
  turnsHaveBefore: boolean
}

describe('GET /sessions/:id 转录分页', () => {
  it('不带参数 = 全量（旧客户端不变）', async () => {
    const res = await app.request('/api/agent/canvases/c1/sessions/s1')
    const b = (await res.json()) as Body
    expect(b.session.turns).toHaveLength(8)
  })

  it('turnsLimit 只回最后 N 条，带 turnsTotal / turnsHaveBefore；切点对齐 user 边界', async () => {
    const res = await app.request('/api/agent/canvases/c1/sessions/s1?turnsLimit=3')
    const b = (await res.json()) as Body
    // end=8, start=5（assistant a3）→ 对齐退到 4（u3）⇒ u3 a3 u4 a4？不对：start=5..8 是 [a3,u4,a4] 只有 3 条；
    // start=5 非 user → 退到... start<end 且 turns[5] 是 u4？索引：0=u1,1=a1,2=u2,3=a2,4=u3,5=a3,6=u4,7=a4
    // end=8 start=5 → turns[5]=a3 非 user → 6 → u4 ⇒ 切 [u4,a4]... 等等 start=5 长度 3 = [a3,u4,a4]
    // 对齐后 start=6 ⇒ [u4,a4]（2 条，比要的 3 少 —— 边界优先于条数）
    expect(b.session.turns.map((t) => t.text)).toEqual(['u4', 'a4'])
    expect(b.turnsTotal).toBe(8)
    expect(b.turnsHaveBefore).toBe(true)
  })

  it('turnsBefore：顶部续拉时从更早处切一页', async () => {
    // 前端已显示最后 2 条（u4 a4）：turnsBefore=2 再取 4 条 ⇒ [u2 a2 u3 a3]
    const res = await app.request('/api/agent/canvases/c1/sessions/s1?turnsLimit=4&turnsBefore=2')
    const b = (await res.json()) as Body
    expect(b.session.turns.map((t) => t.text)).toEqual(['u2', 'a2', 'u3', 'a3'])
    expect(b.turnsHaveBefore).toBe(true)
  })

  it('到头了 ⇒ turnsHaveBefore=false，且不越界', async () => {
    const res = await app.request('/api/agent/canvases/c1/sessions/s1?turnsLimit=10')
    const b = (await res.json()) as Body
    expect(b.session.turns).toHaveLength(8)
    expect(b.turnsHaveBefore).toBe(false)
  })
})
