/**
 * GET 会话要把**挂起中的审批**带回去 —— 契约测试。
 *
 * 前端刷新后靠这一条补渲染审批卡片（见 plugin-agent 的 restoreApprovals）。
 * 若这里不再返回 approvals，界面上就永远看不到那张卡片，而后台一直挂着等它，
 * 这一轮永远结束不了（用户实测：右下角按钮永远停在「停止」）。
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

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ap-route-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function appWith(pending: Array<Record<string, unknown>>): Hono {
  const runtime = {
    isRunning: () => true,
    isSteerable: () => false,
    steerInto: async () => false,
    pendingApprovals: () => pending,
    abort: () => undefined,
    forget: () => undefined,
  }
  const app = new Hono()
  app.route('/', agentSessionRoutes(
    store, runtime as never, { dataDir: root, modelContextWindow: async () => undefined } as never,
    undefined, undefined, undefined, undefined, undefined,
  ))
  return app
}

describe('GET 会话返回挂起审批', () => {
  it('有挂起审批 ⇒ 响应里带 approvals（前端据此补卡片）', async () => {
    const app = appWith([{ id: 'ap-1', toolName: 'exec_command', arguments: '{"cmd":"ls"}', createdAt: 7 }])
    const res = await app.request('/api/agent/canvases/c1/sessions/s1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approvals: unknown[] }
    expect(body.approvals).toEqual([{ id: 'ap-1', toolName: 'exec_command', arguments: '{"cmd":"ls"}', createdAt: 7 }])
  })

  it('没有挂起审批 ⇒ approvals 是空数组（前端不补卡片）', async () => {
    const app = appWith([])
    const body = (await (await app.request('/api/agent/canvases/c1/sessions/s1')).json()) as { approvals: unknown[] }
    expect(body.approvals).toEqual([])
  })
})
