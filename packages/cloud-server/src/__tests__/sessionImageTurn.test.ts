/**
 * 会话转录里的图片落盘 —— 用户要求「Agent 支持图片」的持久化那半。
 *
 * 为什么单独测：图片走的是 data URL（体积大、不是普通字符串），
 * 转录是**给界面回放**用的；不落盘的话，刷新 / 切会话后用户就只剩一句光秃秃的文字，
 * 会以为图丢了。这里直接盯 store 的读写，不经过 HTTP。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore } from '../agent/sessionStore'

let dir: string
let store: AgentSessionStore

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
const IMG2 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-' + 'img-'))
  store = new AgentSessionStore(dir)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** 建一条会话 */
async function newSession(id = 's1'): Promise<string> {
  await store.ensure('c1', { id, title: '新会话', createdAt: 1, provider: 'p', modelId: 'm' })
  return id
}

describe('图片随用户消息落盘', () => {
  it('写入再读出：图片原样回来（data URL 不被截断改形）', async () => {
    const id = await newSession()
    await store.appendTurn('c1', id, { role: 'user', text: '这是什么', images: [IMG], ts: 1 })
    const rec = await store.get('c1', id)
    const u = rec!.turns.find((t) => t.role === 'user')!
    expect(u.images).toEqual([IMG])
    expect(u.text).toBe('这是什么')
  })

  it('多张图按顺序保留', async () => {
    const id = await newSession()
    await store.appendTurn('c1', id, { role: 'user', text: '', images: [IMG, IMG2], ts: 1 })
    const rec = await store.get('c1', id)
    expect(rec!.turns[0].images).toEqual([IMG, IMG2])
  })

  it('只有图、没有文字也能落盘（图不能因为 text 为空被丢掉）', async () => {
    const id = await newSession()
    await store.appendTurn('c1', id, { role: 'user', text: '', images: [IMG], ts: 1 })
    const rec = await store.get('c1', id)
    expect(rec!.turns[0].text).toBe('')
    expect(rec!.turns[0].images).toEqual([IMG])
  })

  it('不带图的消息不写 images 字段（老数据形状不变）', async () => {
    const id = await newSession()
    await store.appendTurn('c1', id, { role: 'user', text: '纯文字', ts: 1 })
    const rec = await store.get('c1', id)
    expect(rec!.turns[0].images).toBeUndefined()
  })

  it('助手那条不会被写入图片（图只属于用户消息）', async () => {
    const id = await newSession()
    await store.appendTurn('c1', id, { role: 'user', text: 'x', images: [IMG], ts: 1 })
    await store.appendTurn('c1', id, { role: 'assistant', text: 'y', ts: 2 })
    const rec = await store.get('c1', id)
    const a = rec!.turns.find((t) => t.role === 'assistant')!
    expect(a.images).toBeUndefined()
  })
})
