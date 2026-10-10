/**
 * 删会话时那一轮还在跑：不许把通道 / 转录「复活」—— 回归测试。
 *
 * 真缺陷（代码审查第二轮指出）：删会话只调 runtime.forget / queueScheduler.forget，
 * 而 hub 的通道是**懒建**的 —— 还在跑的那一轮收尾时一定还会 append `run_state:false`
 *（runtime 还会 append `done`），一 append 就把刚删掉的通道又建回来（内存泄漏没止住）；
 * 更重的是 appendTurn / updateQueue 在文件不存在时会 ensureRecord，把会话文件**重建**，
 * 磁盘上留下一条只写半截的脏会话。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { SessionHub } from '../agent/sessionHub.js'

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'del-running-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('SessionHub：删会话后拒绝复活', () => {
  it('forget 之后 append 不再重建通道（lastSeq 保持 0）', () => {
    const hub = new SessionHub()
    hub.append('c1', 's1', { type: 'notice', message: 'a' })
    expect(hub.lastSeq('c1', 's1')).toBe(1)
    hub.forget('c1', 's1')
    expect(hub.lastSeq('c1', 's1')).toBe(0)
    // 还在跑的那一轮收尾事件：吞掉，不许把通道建回来
    hub.append('c1', 's1', { type: 'run_state', running: false })
    hub.append('c1', 's1', { type: 'done' })
    expect(hub.lastSeq('c1', 's1')).toBe(0)
  })

  it('forget 之后 start 被拒（不会给已删会话开新轮）', async () => {
    const hub = new SessionHub()
    hub.forget('c1', 's1')
    await expect(
      hub.start('c1', 's1', { run: async function* () { yield { type: 'done' } } }),
    ).rejects.toThrow()
  })

  it('revive 之后可以再用（删了又拿同一个 id 建回来）', () => {
    const hub = new SessionHub()
    hub.forget('c1', 's1')
    hub.revive('c1', 's1')
    hub.append('c1', 's1', { type: 'notice', message: 'b' })
    expect(hub.lastSeq('c1', 's1')).toBe(1)
  })
})

describe('AgentSessionStore：删会话后写不复活', () => {
  it('remove 之后 appendTurn 不再把会话文件写回来', async () => {
    await store.remove('c1', 's1')
    expect(await store.get('c1', 's1')).toBeUndefined()
    // 正在跑的那一轮收尾会来写
    await store.appendTurn('c1', 's1', { role: 'assistant', text: '半截', ts: 1 })
    expect(await store.get('c1', 's1')).toBeUndefined()
    // 列表里也不该冒出来
    expect((await store.list('c1')).map((s) => s.id)).not.toContain('s1')
  })

  it('remove 之后 updateQueue 也写不回来', async () => {
    await store.remove('c1', 's1')
    await store.updateQueue('c1', 's1', (q) => ({ ...q, items: [] }))
    expect(await store.get('c1', 's1')).toBeUndefined()
  })
})
