/**
 * GET /sessions/:id/json-path（用户口径 2026-11-17：面板头部「复制对话 JSON 地址」）。
 *
 * 地址必须由后台按自己的数据根算：数据根可以用 -d 改，前端猜不出来；
 * 同时它要与会话文件**真实落点**一致，否则用户复制了地址却在磁盘上找不到文件。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '@plume-canvas/plugin-agent/server/agent/sessionStore.js'
import { agentSessionRoutes } from '@plume-canvas/plugin-agent/server/routes/agentSessions.js'

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'session-json-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
  await store.appendTurn('c1', 's1', { role: 'user', text: '你好', ts: 1 })
  app = new Hono()
  app.route('/', agentSessionRoutes(store, fakeRuntime() as never, { dataDir: root, modelContextWindow: async () => undefined } as never))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('会话 JSON 地址', () => {
  it('返回的路径就是磁盘上真实存在的那份会话文件', async () => {
    const res = await app.request('/api/agent/canvases/c1/sessions/s1/json-path')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; path: string }
    expect(body.ok).toBe(true)
    const stat = await fs.stat(body.path)
    expect(stat.isFile()).toBe(true)
    // 内容确实是这条会话（不是索引文件、也不是别的画布）
    const json = JSON.parse(await fs.readFile(body.path, 'utf8')) as { id: string; turns: unknown[] }
    expect(json.id).toBe('s1')
    expect(json.turns.length).toBeGreaterThan(0)
  })

  it('会话不存在 ⇒ 404，不给一个不存在的路径', async () => {
    const res = await app.request('/api/agent/canvases/c1/sessions/nope/json-path')
    expect(res.status).toBe(404)
  })

  it('非法画布 / 会话 id ⇒ 400（路径不能被拼到目录外）', async () => {
    expect((await app.request('/api/agent/canvases/..%2F..%2Fx/sessions/s1/json-path')).status).toBe(400)
    expect((await app.request('/api/agent/canvases/c1/sessions/..%2F..%2Fx/json-path')).status).toBe(400)
  })
})
