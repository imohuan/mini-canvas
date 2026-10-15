/**
 * 队列拖拽排序（用户口径 2026-10-16，Vue Draggable Plus）：queueOp 'reorder'。
 *
 * 契约：
 * - 全量 id 新顺序重排 queued / editing 条目；
 * - **sending / sent 不参与**：位置钉在原索引位（正在路上的不被拖乱）；
 * - id 列表与现状对不上 ⇒ 放弃（返回原队列，不半改）。
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

async function add(text: string, state = 'queued') {
  const r = await store.updateQueue('c1', 's1', (q) => ({
    ...q,
    items: [...q.items, { id: 'q-' + text, text, state: state as 'queued', createdAt: Date.now() }],
  }))
  return r.items.find((it) => it.text === text)!.id
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-reorder-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
  const config = { dataDir: root, modelContextWindow: async () => undefined } as never
  app = new Hono()
  app.route('/', agentSessionRoutes(store, fakeRuntime() as never, config))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function q(body: unknown) {
  const res = await app.request('/api/agent/canvases/c1/sessions/s1/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as { ok: boolean; queue?: { items: Array<{ id: string; state: string }> } }
}

describe('queueOp reorder', () => {
  it('全量新顺序重排 queued 条目', async () => {
    const a = await add('a')
    const b = await add('b')
    const c = await add('c')
    const r = await q({ op: 'reorder', order: [c, a, b] })
    expect(r.queue?.items.map((it) => it.id)).toEqual([c, a, b])
  })

  it('sending 条目钉在原索引位，其余按新顺序填', async () => {
    const a = await add('a')
    const b = await add('b', 'sending')
    const c = await add('c')
    // 用户把 c 拖到最前：新序 [c,a,b]；b（sending）钉在原索引 1
    const r = await q({ op: 'reorder', order: [c, a, b] })
    expect(r.queue?.items.map((it) => it.id)).toEqual([c, b, a])
    expect(r.queue?.items[1].state).toBe('sending')
  })

  it('id 列表对不上（漏/多）⇒ 放弃，队列原样', async () => {
    const a = await add('a')
    await add('b')
    const before = (await q({ op: 'resume' })).queue
    const r = await q({ op: 'reorder', order: [a] })
    expect(r.queue?.items.map((it) => it.id)).toEqual(before?.items.map((it) => it.id))
  })
})
