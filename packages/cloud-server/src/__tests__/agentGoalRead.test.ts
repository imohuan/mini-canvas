/**
 * 会话详情里的 `goal` 字段（GET /sessions/:id）—— 锁**读目标的路径口径**。
 *
 * 真 bug（2026-10-09 真机复现）：目标明明在跑，刷新后界面却看不到目标状态。
 * 根因是「写」与「读」用的根不一致：
 *   - 写（goalRuntime / 插件）：`sessionScratchpadPath(agentRoot(dataDir), sid)`
 *     ⇒ `<dataDir>/agent/<project>/agents/<agent>/scratchpad/<sid>/GOAL.json`
 *   - 读（本路由）：`sessionScratchpadPath(config.dataDir, sid)`
 *     ⇒ `<dataDir>/<project>/agents/<agent>/scratchpad/<sid>/GOAL.json`（少一层 agent/）
 * 少一层 ⇒ 永远读不到 ⇒ `goal` 恒为 undefined。
 *
 * 这条用例把「GOAL.json 落在 SDK root 相对位置时能被读到」钉死；
 * 修之前必红（读的是少一层的假目录）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { AgentSessionStore } from '../agent/sessionStore.js'
import { agentSessionRoutes } from '../routes/agentSessions.js'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot, sessionScratchpadPath } from '../agent/agentPaths.js'

let root: string
let store: AgentSessionStore
let app: Hono

/** 路由只用到这几个 runtime 方法；给最小假件即可 */
function fakeRuntime() {
  return {
    isRunning: () => false,
    isSteerable: () => false,
    steerInto: async () => false,
    pendingApprovals: () => [],
    abort: () => undefined,
    forget: () => undefined,
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'goal-read-'))
  store = new AgentSessionStore(root)
  await store.ensure('c1', { id: 's1', title: 't', createdAt: 1, provider: 'p', modelId: 'm' })
  // config.dataDir = **真实数据根**（与生产一致：server.ts 传的是 AgentConfigService.dataDir）
  const config = { dataDir: root, modelContextWindow: async () => undefined } as never
  app = new Hono()
  app.route('/', agentSessionRoutes(store, fakeRuntime() as never, config))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** 把 GOAL.json 写到 **SDK root 相对位置**（= 插件与 goalRuntime 真正用的那份） */
async function writeRealGoal(sessionId: string, state: Record<string, unknown>): Promise<void> {
  const dir = sessionScratchpadPath(agentRoot(root), sessionId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'GOAL.json'), JSON.stringify(state))
}

describe('会话详情读目标状态（路径口径）', () => {
  it('GOAL.json 在 SDK root 相对位置时，GET /sessions/:id 能读到 goal', async () => {
    await writeRealGoal('s1', {
      objective: '把测试跑绿',
      status: 'active',
      budget: 50000,
      round: 3,
      tokens_used: 12000,
    })
    const res = await app.request('/api/agent/canvases/c1/sessions/s1')
    const body = (await res.json()) as { goal?: Record<string, unknown> }
    expect(body.goal).toBeTruthy()
    expect(body.goal).toMatchObject({ objective: '把测试跑绿', status: 'active', budget: 50000, round: 3 })
  })

  it('没有 GOAL.json ⇒ 不返回 goal 字段（界面据此显示"无目标"）', async () => {
    const res = await app.request('/api/agent/canvases/c1/sessions/s1')
    const body = (await res.json()) as Record<string, unknown>
    expect(body.goal).toBeUndefined()
  })

  it('路径里确实带着 agent/ 这一层（不是裸 dataDir）', () => {
    const real = sessionScratchpadPath(agentRoot(root), 's1')
    const naive = sessionScratchpadPath(root, 's1')
    expect(real).toContain(path.join('agent', AGENT_PROJECT_ID, 'agents', AGENT_ID, 'scratchpad', 's1'))
    expect(real).not.toBe(naive)
  })
})
