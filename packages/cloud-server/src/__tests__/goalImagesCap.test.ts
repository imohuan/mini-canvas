/**
 * 目标参考图落盘要有上限 —— 回归测试。
 *
 * 为什么（代码审查发现）：这些是 data URL，直接写进**会话文件**，而会话文件每次转录写入
 * 都是「整体读 → 改 → 整体写」。没有上限时，一次 goal-images 请求就能把文件撑到几十 MB，
 * 之后每一轮对话都在重复搬它（写入变慢、索引变大）。界面上限是 4 张 × 4MB，路由层必须对齐。
 */
import { it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'

const fakeRuntime = () => ({
  isRunning: () => false,
  isSteerable: () => false,
  steerInto: async () => false,
  pendingApprovals: () => [],
  abort: () => undefined,
  forget: () => undefined,
})

async function postImages(app: Hono, images: string[]) {
  const res = await app.request('/api/agent/canvases/c1/sessions/s1/goal-images', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ images }),
  })
  expect(res.status).toBe(200)
}

it('最多落 4 张（多出来的截断）', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-img-cap-'))
  try {
    const store = new AgentSessionStore(root)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const app = new Hono()
    app.route('/', agentSessionRoutes(store, fakeRuntime() as never, { dataDir: root } as never))
    await postImages(app, ['a', 'b', 'c', 'd', 'e', 'f'])
    expect((await store.get('c1', 's1'))!.goalImages).toEqual(['a', 'b', 'c', 'd'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('单张超长（>6MB 字符）被丢掉，不让会话文件被撑大', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-img-big-'))
  try {
    const store = new AgentSessionStore(root)
    await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
    const app = new Hono()
    app.route('/', agentSessionRoutes(store, fakeRuntime() as never, { dataDir: root } as never))
    const huge = 'x'.repeat(6 * 1024 * 1024 + 1)
    await postImages(app, [huge, 'ok'])
    expect((await store.get('c1', 's1'))!.goalImages).toEqual(['ok'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
