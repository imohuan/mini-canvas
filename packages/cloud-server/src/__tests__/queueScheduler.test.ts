/**
 * QueueScheduler（设计 §3.3）：队列的**唯一裁判**。
 *
 * 这层要钉住的是"不许发两遍、不许脏数据"（用户口径）：
 * - 编辑中的队头阻塞整个队列（位置不变）；
 * - 暂停时不发；恢复后接着发；
 * - 一轮在跑时不发；
 * - 已认领（sending）的快照不会被第二个触发点再发一次（tick 复入被挡）；
 * - 对账：sending 但转录里已有 ⇒ 视为送达移除；没有 ⇒ 退回 queued 重排。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore, type QueueItem } from '../agent/sessionStore.js'
import { QueueScheduler } from '../agent/queueScheduler.js'

let root: string
let store: AgentSessionStore
let sent: Array<{ text: string; sessionId: string }>
let running: boolean
let scheduler: QueueScheduler

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 等到条件成立（最多 timeoutMs）。
 *
 * 为什么不用固定的 `await delay(30)`：全套测试并行跑时机器负载高，固定延时不够，
 * 会出现"单跑全过、全量跑失败"的假红。条件轮询既准确又不受负载影响。
 */
async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error('waitFor 超时：条件一直没成立')
    await delay(10)
  }
}

/** 假 hub：running 由测试开关控制（复现"会话空闲/在跑"两种状态） */
function makeHub() {
  return {
    append: vi.fn(),
    isRunning: () => running,
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-sched-'))
  store = new AgentSessionStore(root)
  sent = []
  running = false
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
  scheduler = new QueueScheduler({
    store,
    // runtime 在这里只被 startRun 用到；调度器不碰它的其它面
    runtime: {} as never,
    hub: makeHub() as never,
    startRun: async (input) => {
      sent.push({ text: input.text, sessionId: input.sessionId! })
      // 真实语义：起一轮后会话就"在跑"了（直到 run 结束）
      running = true
      return { started: true, sessionId: input.sessionId! }
    },
  })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function addItem(id: string, text: string, state: QueueItem['state'] = 'queued'): Promise<void> {
  await store.updateQueue('c1', 's1', (q) => ({
    ...q,
    items: [...q.items, { id, text, state, createdAt: Date.now() }],
  }))
}

describe('队列调度器', () => {
  it('空闲 + 未暂停 + 队头 queued ⇒ 发出去', async () => {
    await addItem('a', '第一条')
    scheduler.tick('c1', 's1')
    await waitFor(() => sent.length === 1)
    expect(sent.map((s) => s.text)).toEqual(['第一条'])
    await waitFor(async () => (await store.getQueue('c1', 's1')).items[0]?.state === 'sending')
    // 认领后状态是 sending（还没有"跑完"来结算它）
    const q = await store.getQueue('c1', 's1')
    expect(q.items[0]?.state).toBe('sending')
  })

  it('暂停时不发；恢复后才发', async () => {
    await addItem('a', '等一等')
    await store.updateQueue('c1', 's1', (q) => ({ ...q, paused: true }))
    scheduler.tick('c1', 's1')
    await delay(120) // 这段是"验证不发生"：给足时间，确认它确实没发
    expect(sent).toEqual([])
    await store.updateQueue('c1', 's1', (q) => ({ ...q, paused: false }))
    scheduler.tick('c1', 's1')
    await waitFor(() => sent.length === 1)
    expect(sent.map((s) => s.text)).toEqual(['等一等'])
  })

  it('会话在跑时不发（等这一轮结束）', async () => {
    running = true
    await addItem('a', '排队等轮')
    scheduler.tick('c1', 's1')
    await delay(120) // 同上：验证"不发生"
    expect(sent).toEqual([])
    running = false
    scheduler.tick('c1', 's1')
    await waitFor(() => sent.length === 1)
    expect(sent.map((s) => s.text)).toEqual(['排队等轮'])
  })

  it('编辑阻塞：队头 editing 时整队不动（位置不变）', async () => {
    await addItem('a', '正在改的', 'editing')
    await addItem('b', '后面的')
    scheduler.tick('c1', 's1')
    await delay(120) // 验证"不发生"：编辑阻塞时一条都不发
    expect(sent).toEqual([]) // 一条都不发 —— 队列停在编辑那条上
    // 用户点发送后（editing → queued），队列从原位继续
    await store.updateQueue('c1', 's1', (q) => ({
      ...q,
      items: q.items.map((it) => (it.id === 'a' ? { ...it, state: 'queued' as const } : it)),
    }))
    scheduler.tick('c1', 's1')
    await waitFor(() => sent.length === 1)
    expect(sent.map((s) => s.text)).toEqual(['正在改的'])
  })

  it('**不发两遍**：并发 tick 只发一次（inflight 挡住 + 认领原子）', async () => {
    await addItem('a', '唯一一条')
    // 同时触发 8 次（模拟：一轮结束、用户加项、暂停切换几乎同时发生）
    for (let i = 0; i < 8; i++) scheduler.tick('c1', 's1')
    await waitFor(() => sent.length === 1)
    await delay(120) // 再等一段，确认没有第二条跟上来
    expect(sent).toHaveLength(1)
    expect(sent.map((s) => s.text)).toEqual(['唯一一条'])
  })

  it('对账：sending 且转录里已有该文本 ⇒ 标 sent（留一拍让界面画"已发送"），下一次 tick 清掉', async () => {
    await addItem('a', '已经发过的', 'sending')
    // 转录里有这条 user 回合（说明真送达了）
    await store.appendTurn('c1', 's1', { role: 'user', text: '已经发过的', ts: 1 })
    await scheduler.settleAsync('c1', 's1')
    const q = await store.getQueue('c1', 's1')
    // 留一拍：标成 sent（界面据此画"已发送"），而不是立即消失
    expect(q.items).toHaveLength(1)
    expect(q.items[0]).toMatchObject({ id: 'a', state: 'sent' })
    // 下一次 tick 才真正移除（且不会重发它）
    scheduler.tick('c1', 's1')
    await waitFor(async () => (await store.getQueue('c1', 's1')).items.length === 0)
    expect(sent).toEqual([]) // 没有重发
  })

  it('对账：sending 但转录里没有 ⇒ 退回 queued 重排（没送达的不吞）', async () => {
    await addItem('a', '没送到的', 'sending')
    await scheduler.settleAsync('c1', 's1')
    const q = await store.getQueue('c1', 's1')
    expect(q.items[0]).toMatchObject({ id: 'a', state: 'queued' })
    // 退回后再 tick 会真的发一次
    scheduler.tick('c1', 's1')
    await waitFor(() => sent.length === 1)
    expect(sent.map((s) => s.text)).toEqual(['没送到的'])
  })

  it('startRun 起不来（started:false）⇒ 退回 queued 不丢', async () => {
    let called = false
    const s2 = new QueueScheduler({
      store,
      runtime: {} as never,
      hub: makeHub() as never,
      startRun: async () => {
        called = true
        return { started: false }
      },
    })
    await addItem('a', '起不来的')
    s2.tick('c1', 's1')
    // 先等它真的走到 startRun（否则"等待 queued"会立刻通过 —— 初始就是 queued，
    // 断言可能落在"已认领成 sending"的那一刻上，这就是并发下的假红）
    await waitFor(() => called)
    await waitFor(async () => {
      const q = await store.getQueue('c1', 's1')
      return q.items[0]?.state === 'queued'
    })
    const q = await store.getQueue('c1', 's1')
    expect(q.items[0]).toMatchObject({ id: 'a', state: 'queued' })
  })

  it('队列广播：认领生效后 hub 收到 queue 事件', async () => {
    const hub = makeHub()
    const s3 = new QueueScheduler({
      store,
      runtime: {} as never,
      hub: hub as never,
      startRun: async () => ({ started: false }), // 退回路径会广播
    })
    await addItem('a', '看看广播')
    s3.tick('c1', 's1')
    await waitFor(() => hub.append.mock.calls.length > 0)
    const types = hub.append.mock.calls.map((c) => (c[2] as { type: string }).type)
    expect(types).toContain('queue')
  })

  it('队头不是 queued（比如第二条是 queued）⇒ 只发队头、不发插队的', async () => {
    await addItem('a', '队头')
    await addItem('b', '队二')
    scheduler.tick('c1', 's1')
    await waitFor(() => sent.length === 1)
    expect(sent.map((s) => s.text)).toEqual(['队头'])
    // 清理：把队头结算掉（模拟这一轮跑完了），再 tick 应当发第二条
    await store.appendTurn('c1', 's1', { role: 'user', text: '队头', ts: 1 })
    running = false
    await scheduler.settleAsync('c1', 's1')
    scheduler.tick('c1', 's1')
    await waitFor(() => sent.length === 2)
    expect(sent.map((s) => s.text)).toEqual(['队头', '队二'])
  })

  it('带 goal 的条目走 startGoal（不注入时按普通消息发，绝不静默丢）', async () => {
    const goalCalls: Array<{ objective: string; budget: number }> = []
    const s4 = new QueueScheduler({
      store,
      runtime: {} as never,
      hub: makeHub() as never,
      startRun: async (input) => {
        sent.push({ text: input.text, sessionId: input.sessionId! })
        return { started: true, sessionId: input.sessionId! }
      },
      startGoal: async (_c, _s, objective, budget) => {
        goalCalls.push({ objective, budget })
        return { started: true }
      },
    })
    await store.updateQueue('c1', 's1', (q) => ({
      ...q,
      items: [
        {
          id: 'g1',
          text: '把测试跑绿',
          goal: { objective: '把测试跑绿', budget: 50000 },
          state: 'queued',
          createdAt: 1,
        },
      ],
    }))
    s4.tick('c1', 's1')
    await waitFor(() => goalCalls.length === 1)
    expect(goalCalls).toEqual([{ objective: '把测试跑绿', budget: 50000 }])
    expect(sent).toEqual([]) // 走的是目标通道，不是普通发送
  })
})
