/**
 * 纯图消息（只发图、不打字）必须落进转录 —— 回归测试。
 *
 * 真 bug（代码审查发现）：托管开跑那一支的落盘条件是 `if (input.text)`，
 * 于是「只发一张图问这是什么」这种消息**整条不进转录**。两个后果：
 *   ① 刷新 / 切会话后这条用户消息凭空消失，界面上只剩 AI 的回答（用户以为图丢了）；
 *   ② 队列里的纯图条目在对账（settleAsync）时按文本比对恒不成立 ⇒ 退回 queued ⇒
 *      再发一遍 ⇒ 跑完再退回 ⇒ **无限重发同一条**。
 *
 * 修法：条件放宽成 `input.text || input.images?.length`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentRuntime } from '../agent/runtime.js'
import { AgentSessionStore } from '../agent/sessionStore.js'

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

let root: string
let store: AgentSessionStore

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rt-img-'))
  store = new AgentSessionStore(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 假 SDK 会话：run 只回一句助手文本，够验证「落盘了什么」 */
function fakeSession() {
  return {
    sessionId: 's-img',
    provider: 'p',
    modelId: 'm',
    run: async function* () {
      yield { type: 'model_msg', payload: { type: 'text', text: 'ok', role: 'assistant' } }
    },
  }
}

function makeRuntime(session: ReturnType<typeof fakeSession>) {
  const agent = { createSession: async () => session, resumeSession: async () => session }
  return new AgentRuntime({
    root,
    store,
    agent: async () => agent as never,
    makeUserMessage: (text: string, images?: string[]) => ({ kind: 'user', text, images }),
    log: () => undefined,
  } as never)
}

async function run(runtime: AgentRuntime, text: string, images?: string[]): Promise<void> {
  await store.ensure('c1', { id: 's-img', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
  for await (const ev of runtime.run(
    'c1',
    { canvasId: 'c1', sessionId: 's-img', text, ...(images ? { images } : {}) },
    new AbortController().signal,
  )) {
    void ev
  }
}

describe('纯图消息落盘', () => {
  it('只有图、没有正文 ⇒ 照样落一条用户回合（带图）', async () => {
    const rt = makeRuntime(fakeSession())
    await run(rt, '', [IMG])
    const rec = await store.get('c1', 's-img')
    const users = rec!.turns.filter((t) => t.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].text).toBe('')
    expect(users[0].images).toEqual([IMG])
  })

  it('正文 + 图 ⇒ 一条用户回合（图一起落）', async () => {
    const rt = makeRuntime(fakeSession())
    await run(rt, '这是什么', [IMG])
    const rec = await store.get('c1', 's-img')
    const users = rec!.turns.filter((t) => t.role === 'user')
    expect(users).toHaveLength(1)
    expect(users[0].text).toBe('这是什么')
    expect(users[0].images).toEqual([IMG])
  })

  it('两者都空（目标 resume 那种 harness-only 轮）⇒ 不落空白用户回合', async () => {
    const rt = makeRuntime(fakeSession())
    await run(rt, '')
    const rec = await store.get('c1', 's-img')
    expect(rec!.turns.filter((t) => t.role === 'user')).toHaveLength(0)
  })
})
