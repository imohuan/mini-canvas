/**
 * HistoryStore 单测 —— 纯逻辑（临时目录）。
 *
 * 锁几件事：归档最新在前、超上限丢最旧、分页正确、汇总不受分页影响、
 * 筛选（类型 / 状态 / 评级 / 画布）都对、写一笔会通知订阅者。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HistoryStore } from '../tasks/history'
import type { HistoryEntry } from '../tasks/types'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'history-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: over.id ?? 'h1',
    jobId: 'j1',
    canvasId: 'default',
    nodeId: 'n1',
    actionId: 'web2api:doubao-image-seedream45',
    title: '豆包 Seedream 4.5',
    kind: 'image',
    status: 'done',
    rating: 'passed',
    createdAt: 1000,
    finishedAt: 2000,
    ...over,
  }
}

describe('归档与读取', () => {
  it('落盘在 <画布>/history.json，读回来一致', async () => {
    const h = new HistoryStore(root)
    await h.append('default', entry())
    const file = path.join(root, 'canvases', 'default', 'history.json')
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(raw).toHaveLength(1)
    expect(raw[0].title).toBe('豆包 Seedream 4.5')
  })

  it('最新在前', async () => {
    const h = new HistoryStore(root)
    await h.append('default', entry({ id: 'old', finishedAt: 100 }))
    await h.append('default', entry({ id: 'new', finishedAt: 200 }))
    const all = await h.readAll('default')
    expect(all.map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('超过上限丢最旧的（账本不能无限长）', async () => {
    const h = new HistoryStore(root, 3)
    for (let i = 1; i <= 5; i++) await h.append('default', entry({ id: 'h' + i, finishedAt: i }))
    const all = await h.readAll('default')
    expect(all.map((e) => e.id)).toEqual(['h5', 'h4', 'h3'])
  })

  it('没有历史 → 空数组（不是抛错）', async () => {
    expect(await new HistoryStore(root).readAll('default')).toEqual([])
  })

  it('写一笔会通知订阅者（前端靠它知道"该重拉历史了"）', async () => {
    const h = new HistoryStore(root)
    let fired = 0
    h.onChange(() => {
      fired += 1
    })
    await h.append('default', entry())
    expect(fired).toBe(1)
  })
})

describe('查询：筛选 + 分页 + 汇总', () => {
  async function seed(): Promise<HistoryStore> {
    const h = new HistoryStore(root)
    await h.append('default', entry({ id: 'i1', kind: 'image', finishedAt: 100 }))
    await h.append('default', entry({ id: 'v1', kind: 'video', finishedAt: 200 }))
    await h.append('default', entry({ id: 'a1', kind: 'audio', finishedAt: 300 }))
    await h.append('default', entry({ id: 'e1', kind: 'image', status: 'error', finishedAt: 400 }))
    return h
  }

  it('默认（最新在前）分页', async () => {
    const h = await seed()
    const page1 = await h.query({ page: 1, pageSize: 2 })
    expect(page1.items.map((e) => e.id)).toEqual(['e1', 'a1'])
    expect(page1.total).toBe(4)
    const page2 = await h.query({ page: 2, pageSize: 2 })
    expect(page2.items.map((e) => e.id)).toEqual(['v1', 'i1'])
  })

  it('按类型筛（汇总跟着筛后的集合）', async () => {
    const h = await seed()
    const r = await h.query({ kind: 'image' })
    expect(r.items.map((e) => e.id).sort()).toEqual(['e1', 'i1'])
    expect(r.summary.byKind).toEqual({ image: 2 })
  })

  it('按状态筛', async () => {
    const h = await seed()
    const r = await h.query({ status: 'error' })
    expect(r.items.map((e) => e.id)).toEqual(['e1'])
  })

  it('评级筛：all 与省略等价（前端那个"所有评级"）', async () => {
    const h = await seed()
    expect((await h.query({ rating: 'all' })).total).toBe(4)
    expect((await h.query({})).total).toBe(4)
  })

  it('时间正序 / 倒序', async () => {
    const h = await seed()
    const asc = await h.query({ order: 'asc' })
    expect(asc.items.map((e) => e.id)).toEqual(['i1', 'v1', 'a1', 'e1'])
  })

  it('汇总给出总量与按类型分布（不受分页影响）', async () => {
    const h = await seed()
    const r = await h.query({ page: 1, pageSize: 1 })
    expect(r.items).toHaveLength(1)
    expect(r.summary.total).toBe(4)
    expect(r.summary.byKind).toEqual({ image: 2, video: 1, audio: 1 })
  })

  it('不筛画布 → 跨全部画布（按时间合并排序）', async () => {
    const h = new HistoryStore(root)
    await h.append('a', entry({ id: 'a-1', canvasId: 'a', finishedAt: 100 }))
    await h.append('b', entry({ id: 'b-1', canvasId: 'b', finishedAt: 200 }))
    const r = await h.query({})
    expect(r.items.map((e) => e.id)).toEqual(['b-1', 'a-1'])
    expect(r.total).toBe(2)
  })

  it('筛某个画布 → 只看它', async () => {
    const h = new HistoryStore(root)
    await h.append('a', entry({ id: 'a-1', canvasId: 'a' }))
    await h.append('b', entry({ id: 'b-1', canvasId: 'b' }))
    const r = await h.query({ canvasId: 'a' })
    expect(r.items.map((e) => e.id)).toEqual(['a-1'])
  })
})
