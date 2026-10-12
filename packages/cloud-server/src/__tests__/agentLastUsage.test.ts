/**
 * 上下文用量的落盘与恢复（用户口径 2026-10-11 报的问题 1："进度莫名其妙消失"）。
 *
 * 根因：token_usage 既不落转录、重连也不重放 —— 刷新 / 切会话 / 面板重开后，
 * 界面上那个指示器就彻底没了，只有再发一条消息才回来。
 *
 * 这里锁"记忆"这一半：用量会随会话记录存下来、恢复会话时能读回来。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore } from '../agent/sessionStore.js'

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('会话记录里的最近用量', () => {
  it('写进去就能读回来（刷新 / 切会话后靠它把指示器画回原位）', async () => {
    await store.setLastUsage('c1', 's1', { usedTokens: 128_000, limitTokens: 256_000 })
    expect((await store.get('c1', 's1'))!.lastUsage).toEqual({ usedTokens: 128_000, limitTokens: 256_000 })
  })

  it('后写的覆盖先写的（只保留最新那一份）', async () => {
    await store.setLastUsage('c1', 's1', { usedTokens: 100, limitTokens: 256_000 })
    await store.setLastUsage('c1', 's1', { usedTokens: 200, limitTokens: 256_000 })
    expect((await store.get('c1', 's1'))!.lastUsage!.usedTokens).toBe(200)
  })

  it('不知道窗口时 limitTokens 记 null（不编一个假的百分比）', async () => {
    await store.setLastUsage('c1', 's1', { usedTokens: 5000, limitTokens: null })
    expect((await store.get('c1', 's1'))!.lastUsage).toEqual({ usedTokens: 5000, limitTokens: null })
  })

  it('负数 / 非整数被归一到合法值（脏数据不进界面）', async () => {
    await store.setLastUsage('c1', 's1', { usedTokens: -3, limitTokens: 0 })
    expect((await store.get('c1', 's1'))!.lastUsage).toEqual({ usedTokens: 0, limitTokens: null })
  })

  it('会话不存在时什么都不做（不凭空造一条会话出来）', async () => {
    await store.setLastUsage('c1', 'ghost', { usedTokens: 1, limitTokens: 2 })
    expect(await store.get('c1', 'ghost')).toBeUndefined()
  })
})

