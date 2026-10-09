/**
 * 会话文件里的队列存储（设计 §3.1 / §3.3）。
 *
 * 这层要钉住三件事：
 * 1. 老会话文件（没有 queue 字段）读出来是空队列，不炸；
 * 2. 队列更新与转录追加走**同一条串行链** —— 并发调用不互相覆盖；
 * 3. updateQueue 的 mutator 返回 null 表示放弃（认领失败语义的地基）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore, type QueueState } from '../agent/sessionStore.js'

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-store-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('队列存储', () => {
  it('新会话读出来是空队列（没有 queue 字段）', async () => {
    const q = await store.getQueue('c1', 's1')
    expect(q).toEqual({ paused: false, items: [] })
  })

  it('加一条：落盘且能读回', async () => {
    const next = await store.updateQueue('c1', 's1', (q) => ({
      ...q,
      items: [...q.items, { id: 'q1', text: '你好', state: 'queued', createdAt: 100 }],
    }))
    expect(next?.items).toHaveLength(1)
    const back = await store.getQueue('c1', 's1')
    expect(back.items[0]).toMatchObject({ id: 'q1', text: '你好', state: 'queued' })
    expect(back.paused).toBe(false)
  })

  it('mutator 返回 null = 放弃本次修改（磁盘不变）', async () => {
    await store.updateQueue('c1', 's1', (q) => ({
      ...q,
      items: [{ id: 'q1', text: 'a', state: 'queued', createdAt: 1 }],
    }))
    const r = await store.updateQueue('c1', 's1', () => null)
    expect(r).toBeNull()
    const back = await store.getQueue('c1', 's1')
    expect(back.items).toHaveLength(1) // 还是原来那一条
  })

  it('暂停标记能记能清', async () => {
    await store.updateQueue('c1', 's1', (q) => ({ ...q, paused: true }))
    expect((await store.getQueue('c1', 's1')).paused).toBe(true)
    await store.updateQueue('c1', 's1', (q) => ({ ...q, paused: false }))
    expect((await store.getQueue('c1', 's1')).paused).toBe(false)
  })

  it('并发：转录追加与队列更新交错执行，两边都不丢（串行链）', async () => {
    // 同时打 20 个写：10 条转录 + 10 次队列加项（不 await 任何一个）
    const jobs: Promise<unknown>[] = []
    for (let i = 0; i < 10; i++) {
      jobs.push(
        store.appendTurn('c1', 's1', { role: 'user', text: 'm' + i, ts: i + 1 }),
      )
      jobs.push(
        store.updateQueue('c1', 's1', (q) => ({
          ...q,
          items: [...q.items, { id: 'q' + i, text: 't' + i, state: 'queued', createdAt: i + 1 }],
        })),
      )
    }
    await Promise.all(jobs)
    const record = await store.get('c1', 's1')
    const q = await store.getQueue('c1', 's1')
    // 10 条转录一条不少、10 条队列一条不少（若链失效，后写会覆盖前写，条数会少）
    expect(record?.turns.filter((t) => t.role === 'user')).toHaveLength(10)
    expect(q.items).toHaveLength(10)
    expect(new Set(q.items.map((i) => i.id)).size).toBe(10)
  })

  it('目标暂停标记：setGoalPaused 写与清（undefined = 不留字段）', async () => {
    await store.setGoalPaused('c1', 's1', true)
    expect((await store.get('c1', 's1'))?.goalPaused).toBe(true)
    await store.setGoalPaused('c1', 's1', false)
    expect((await store.get('c1', 's1'))?.goalPaused).toBeUndefined()
  })

  it('队列条目带图片与目标声明，序列化原样往返', async () => {
    const item = {
      id: 'q-img',
      text: '',
      images: ['data:image/png;base64,AAA'],
      goal: { objective: '把测试跑绿', budget: 50000 },
      state: 'queued' as const,
      createdAt: 9,
    }
    await store.updateQueue('c1', 's1', (q) => ({ ...q, items: [item] }))
    const q: QueueState = await store.getQueue('c1', 's1')
    expect(q.items[0]).toEqual(item)
  })
})
