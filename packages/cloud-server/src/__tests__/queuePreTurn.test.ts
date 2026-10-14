/**
 * **队列里的消息也要过 pre-turn 中间件**（真机查出来的洞）。
 *
 * 症状：同一条消息，「直接发」与「排队发」行为不一样 —— 插件写的拦截 / 改写
 * 被排队绕过去了。而队列是这个应用的常规用法（跑着的时候再发一条就进队列）。
 *
 * 这里锁两条：
 *   1. 排队发时中间件**被调用**，且改写落到真正发出去的那条上；
 *   2. 中间件拦下时，这一条**移出队列**（留在里面会每次 tick 重来一遍，队列永远动不了）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { QueueScheduler } from '../agent/queueScheduler.js'
import { AgentSessionStore } from '../agent/sessionStore.js'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 轮询等条件成立（不用固定延时：并行跑时机器负载高，固定值会假红） */
async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error('waitFor 超时：条件一直没成立')
    await delay(10)
  }
}

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-preturn-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 假 hub：会话恒空闲（isRunning=false），这样 tick 会走到「发」那一步 */
const idleHub = { append: () => undefined, isRunning: () => false }

function makeScheduler(opts: { preTurn?: unknown } = {}) {
  const seen: string[] = []
  const scheduler = new QueueScheduler({
    store,
    runtime: {} as never,
    hub: idleHub as never,
    startRun: async (input: { text: string }) => {
      seen.push(input.text)
      return { started: true, sessionId: 's1' }
    },
    ...opts,
  } as never)
  return { scheduler, seen }
}

async function addItem(text: string): Promise<void> {
  await store.updateQueue('c1', 's1', (q) => ({
    ...q,
    items: [...q.items, { id: 'q1', text, state: 'queued' as const, createdAt: Date.now() }],
  }))
}

/** 加一条「入队前已经跑过中间件」的条目（跑着发消息就是这条路） */
async function addPreTurnedItem(text: string): Promise<void> {
  await store.updateQueue('c1', 's1', (q) => ({
    ...q,
    items: [
      ...q.items,
      { id: 'q1', text, state: 'queued' as const, createdAt: Date.now(), preTurned: true },
    ],
  }))
}

describe('队列消息过 pre-turn 中间件', () => {
  it('中间件被调用，且改写落到真正发出去的那条上', async () => {
    await addItem('原始文本')
    const calls: string[] = []
    const { scheduler, seen } = makeScheduler({
      preTurn: async (turn: { input: { text: string } }) => {
        calls.push(turn.input.text)
        turn.input.text = '[改写]' + turn.input.text
        return {}
      },
    })
    await scheduler.tick('c1', 's1')
    await waitFor(() => seen.length === 1)
    expect(calls).toEqual(['原始文本'])
    expect(seen).toEqual(['[改写]原始文本'])
  })

  it('中间件拦下 → 这一条移出队列（不留在里面反复重拦）', async () => {
    await addItem('会被拦')
    const { scheduler, seen } = makeScheduler({
      preTurn: async () => ({ blocked: true, response: { error: '拦了' } }),
    })
    await scheduler.tick('c1', 's1')
    await waitFor(async () => (await store.getQueue('c1', 's1')).items.length === 0)
    expect(seen).toEqual([])
    const q = await store.getQueue('c1', 's1')
    expect(q.items).toHaveLength(0)
  })

  it('不注入 preTurn 时行为与从前一字不差（老宿主 / 单测）', async () => {
    await addItem('照常发')
    const { scheduler, seen } = makeScheduler()
    await scheduler.tick('c1', 's1')
    await waitFor(() => seen.length === 1)
    expect(seen).toEqual(['照常发'])
  })

  it('preTurned 的条目跳过中间件（入队前已跑过 —— 不重复记两次账）', async () => {
    await addPreTurnedItem('[已改写]跑着发的消息')
    let called = 0
    const { scheduler, seen } = makeScheduler({
      preTurn: async () => {
        called += 1
        return {}
      },
    })
    await scheduler.tick('c1', 's1')
    await waitFor(() => seen.length === 1)
    // 中间件没被再调一次
    expect(called).toBe(0)
    // 正文原样发出去（它已经是改写后的那份）
    expect(seen).toEqual(['[已改写]跑着发的消息'])
  })
})
