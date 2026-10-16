/**
 * 队列路由的 HTTP 层（设计 §3.3）：七个 op 的准入与语义。
 *
 * 为什么单开一份而不是只测 store/scheduler：这里最容易漏的是**路由自己的守卫**
 * （比如"正文不能为空"的判定必须给每个不需要正文的 op 放行）—— 少列一个 op
 * 就会把合法操作挡成 400，而 store/scheduler 的测试完全看不见这种洞。
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

/** runtime/config 不是本测试的对象：给最小假件（路由只用到 isSteerable/steerInto/isRunning/pendingApprovals/abort） */
function fakeRuntime(over: Record<string, unknown> = {}) {
  return {
    isRunning: () => false,
    isSteerable: () => false,
    steerInto: async () => false,
    pendingApprovals: () => [],
    abort: () => undefined,
    forget: () => undefined,
    ...over,
  }
}

async function setup(runtimeOver: Record<string, unknown> = {}, goalOver?: Record<string, unknown>) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-route-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
  const config = { dataDir: root, modelContextWindow: async () => undefined } as never
  app = new Hono()
  app.route(
    '/',
    agentSessionRoutes(
      store,
      fakeRuntime(runtimeOver) as never,
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      goalOver ? (goalOver as never) : undefined,
    ),
  )
}

/** 打一次队列端点 */
async function q(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request('/api/agent/canvases/c1/sessions/s1/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

async function readQueue(): Promise<{ paused: boolean; items: Array<Record<string, unknown>> }> {
  const res = await app.request('/api/agent/canvases/c1/sessions/s1/queue')
  return ((await res.json()) as { queue: never }).queue
}

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('队列路由', () => {
  beforeEach(async () => {
    await setup()
  })

  it('add 需要正文；空文本空图 ⇒ 400', async () => {
    expect((await q({ op: 'add' })).status).toBe(400)
    expect((await q({ op: 'add', text: 'x' })).status).toBe(200)
  })

  it('**不需要正文的六个 op 全部放行**（漏一个就会把合法操作挡成 400）', async () => {
    // add 一条作为被操作对象
    await q({ op: 'add', text: 'a' })
    const itemId = (await readQueue()).items[0].id
    // remove / close / cancel-edit / edit / pause / resume —— 全都不带 text
    for (const op of ['edit', 'cancel-edit', 'pause', 'resume', 'close', 'remove']) {
      const r = await q({ op, itemId })
      expect(r.status, 'op=' + op + ' 应当放行').toBe(200)
    }
  })

  it('edit 只改状态为 editing（内容不动）', async () => {
    await q({ op: 'add', text: '原文' })
    const id = (await readQueue()).items[0].id
    await q({ op: 'edit', itemId: id })
    const item = (await readQueue()).items[0]
    expect(item.state).toBe('editing')
    expect(item.text).toBe('原文')
  })

  it('update 原位替换 + 回 queued；不传 images 时保留原图', async () => {
    const img = 'data:image/png;base64,AAA'
    await q({ op: 'add', text: 'a', images: [img] })
    await q({ op: 'add', text: 'b' })
    const first = (await readQueue()).items[0].id
    await q({ op: 'update', itemId: first, text: 'a2' })
    const q1 = await readQueue()
    expect(q1.items[0]).toMatchObject({ id: first, text: 'a2', state: 'queued' })
    expect(q1.items[0].images).toEqual([img]) // 没传 images ⇒ 原图保留
    expect(q1.items[1].text).toBe('b') // 位置不变
  })

  it('update 显式传空数组 ⇒ 清掉图（"只留文字"是合法编辑）', async () => {
    await q({ op: 'add', text: 'a', images: ['data:image/png;base64,AAA'] })
    const id = (await readQueue()).items[0].id
    await q({ op: 'update', itemId: id, text: 'a', images: [] })
    expect((await readQueue()).items[0].images).toBeUndefined()
  })

  it('close = 移除条目（内容由界面回填，路由不管）', async () => {
    await q({ op: 'add', text: 'a' })
    const id = (await readQueue()).items[0].id
    await q({ op: 'close', itemId: id })
    expect((await readQueue()).items).toEqual([])
  })

  it('pause / resume 切换 paused', async () => {
    await q({ op: 'pause' })
    expect((await readQueue()).paused).toBe(true)
    await q({ op: 'resume' })
    expect((await readQueue()).paused).toBe(false)
  })

  it('未知 op ⇒ 400（不是静默成功）', async () => {
    expect((await q({ op: 'nonsense' })).status).toBe(400)
  })

  it('add 带 goal ⇒ 条目带目标声明', async () => {
    await q({ op: 'add', text: '把测试跑绿', goal: { objective: '把测试跑绿', budget: 50000 } })
    expect((await readQueue()).items[0].goal).toEqual({ objective: '把测试跑绿', budget: 50000 })
  })
})

describe('引导端点', () => {
  it('空闲时引导 ⇒ steered:false + 条目**留在队列**（不丢不重复）', async () => {
    await setup({ isSteerable: () => false })
    await q({ op: 'add', text: 'a' })
    const id = (await readQueue()).items[0].id
    const res = await app.request('/api/agent/canvases/c1/sessions/s1/queue/' + id + '/steer', { method: 'POST' })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.steered).toBe(false)
    expect(body.reason).toBe('idle')
    expect((await readQueue()).items).toHaveLength(1) // 还在
  })

  it('正在跑且 steer 成功 ⇒ 条目置 sending 留在队列（用户口径 2026-10-16：发送中可见，消息真进入对话后由对账清除）', async () => {
    await setup({ isSteerable: () => true, steerInto: async () => true })
    await q({ op: 'add', text: 'a' })
    const id = (await readQueue()).items[0].id
    const res = await app.request('/api/agent/canvases/c1/sessions/s1/queue/' + id + '/steer', { method: 'POST' })
    expect(((await res.json()) as Record<string, unknown>).steered).toBe(true)
    const items = (await readQueue()).items
    expect(items).toHaveLength(1)
    expect(items[0].state).toBe('sending')
  })

  it('steer 恰好失败（轮刚结束）⇒ 条目**留在队列**（绝不丢）', async () => {
    await setup({ isSteerable: () => true, steerInto: async () => false })
    await q({ op: 'add', text: 'a' })
    const id = (await readQueue()).items[0].id
    const res = await app.request('/api/agent/canvases/c1/sessions/s1/queue/' + id + '/steer', { method: 'POST' })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.steered).toBe(false)
    expect(body.reason).toBe('finished')
    expect((await readQueue()).items).toHaveLength(1) // 还在，等调度器发
  })
})
