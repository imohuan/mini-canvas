import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentSessionStore } from '../agent/sessionStore'
import { branchStore } from '../agent/branchStore'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-branch-'))
  srv = await createCloudServer({ dir, watchProviders: false })
})

afterEach(async () => {
  srv.stop()
  await fs.rm(dir, { recursive: true, force: true })
})

async function call(method: string, url: string, body?: unknown) {
  const res = await srv.app.fetch(
    new Request('http://localhost' + url, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' } } : {}),
    }),
  )
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: res.status, json, text }
}

describe('AgentSessionStore.forkFrom', () => {
  it('从某条用户消息之前拷贝转录成新会话（分支从那里继续）', async () => {
    const store = new AgentSessionStore(dir)
    await store.ensure('c1', { id: 's1', title: '原会话', createdAt: 1, provider: 'p', modelId: 'm' })
    await store.appendTurn('c1', 's1', { role: 'user', text: '第一条', ts: 1 })
    await store.appendTurn('c1', 's1', { role: 'assistant', text: '答一', ts: 2 })
    await store.appendTurn('c1', 's1', { role: 'user', text: '第二条', ts: 3 })
    await store.appendTurn('c1', 's1', { role: 'assistant', text: '答二', ts: 4 })

    // 编辑「第二条」重发 → 新会话只带它**之前**的回合（第一条 + 答一）
    const fork = await store.forkFrom('c1', 's1', '第二条')
    expect(fork.parentId).toBe('s1')
    const rec = await store.get('c1', fork.sessionId)
    expect(rec?.turns.map((t) => t.role + ':' + t.text)).toEqual(['user:第一条', 'assistant:答一'])
    // 新会话进索引（历史列表可见），标题标注被编辑的那条（分支来源）
    const list = await store.list('c1')
    expect(list.map((x) => x.id)).toContain(fork.sessionId)
    expect(list.find((x) => x.id === fork.sessionId)?.title).toContain('第二条')
  })

  it('找不到那条消息 → 明确报错（不静默建一个空分支）', async () => {
    const store = new AgentSessionStore(dir)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    await expect(store.forkFrom('c1', 's1', '不存在')).rejects.toThrow('不存在')
  })
})

describe('分支注册表', () => {
  it('登记兄弟分支 + 查询（按画布 + 会话 + 消息）', async () => {
    const root = path.join(dir, 'br')
    const bs = branchStore(root)
    await bs.register('c1', 's1', 'turn-1', 'child-a')
    await bs.register('c1', 's1', 'turn-1', 'child-b')
    expect(await bs.siblingsOf('c1', 's1', 'turn-1')).toEqual(['child-a', 'child-b'])
    // 换画布隔离
    expect(await bs.siblingsOf('c2', 's1', 'turn-1')).toEqual([])
  })
})

  describe('分支 HTTP 面', () => {
  it('POST fork → 转录拷贝进新会话（用 store 直接造父会话，绕开 SDK 凭据）', async () => {
    const { AgentSessionStore: S } = await import('../agent/sessionStore')
    const st = new S(dir)
    await st.ensure('default', { id: 's1', title: '父', createdAt: 1, provider: 'p', modelId: 'm' })
    await st.appendTurn('default', 's1', { role: 'user', text: '要编辑的那句', ts: 1 })
    const r = await call('POST', '/api/agent/canvases/default/sessions/s1/fork', { afterText: '要编辑的那句' })
    expect(r.status).toBe(200)
    expect(typeof r.json.sessionId).toBe('string')
    // 新会话转录 = 空回合（消息本身之前的部分）+ 注册表里有兄弟
    const rec = await st.get('default', r.json.sessionId)
    expect(rec?.turns ?? []).toEqual([])
  })

  it('GET branch-info → 返回分支点 + 全画布分叉点全表', async () => {
    const { AgentSessionStore: S } = await import('../agent/sessionStore')
    const st = new S(dir)
    await st.ensure('default', { id: 's1', title: '父', createdAt: 1, provider: 'p', modelId: 'm' })
    await st.appendTurn('default', 's1', { role: 'user', text: '编辑点', ts: 1 })
    const f1 = await call('POST', '/api/agent/canvases/default/sessions/s1/fork', { afterText: '编辑点' })
    const f2 = await call('POST', '/api/agent/canvases/default/sessions/s1/fork', { afterText: '编辑点' })
    expect(f1.status).toBe(200)
    expect(f2.status).toBe(200)

    const info = await call('GET', '/api/agent/canvases/default/sessions/' + f1.json.sessionId + '/branch-info')
    expect(info.status).toBe(200)
    expect(info.json.parentSessionId).toBe('s1')
    // 全表：一个分叉点，子列表含两条分支（前端按它算 < N / M >）
    expect(info.json.points).toHaveLength(1)
    expect(info.json.points[0].parentId).toBe('s1')
    expect(info.json.points[0].children).toContain(f1.json.sessionId)
    expect(info.json.points[0].children).toContain(f2.json.sessionId)
    // 拿父会话来问：同一个全表也能拿到（分页器需要「父 + 子」都在场）
    const plain = await call('GET', '/api/agent/canvases/default/sessions/s1/branch-info')
    expect(plain.json.points).toHaveLength(1)
    expect(plain.json.points[0].parentId).toBe('s1')
  })
  })
