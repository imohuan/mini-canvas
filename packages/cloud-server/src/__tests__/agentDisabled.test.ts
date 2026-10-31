/**
 * `agent: false` 必须是真关闭：不构造服务、不登记路由、不写 Agent 数据。
 *
 * 旧实现只跳过两条内置路由插件，Config / SessionStore / SDK 预热 / goal hook
 * 仍在开关之前执行 —— 表现为“关了还有后台对象，关了 agent-chat 还登记”。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'

let dir = ''
let srv: Awaited<ReturnType<typeof createCloudServer>> | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-agent-off-'))
})
afterEach(async () => {
  srv?.stop()
  srv = undefined
  await fs.rm(dir, { recursive: true, force: true })
})

describe('Agent 关闭时零副作用', () => {
  it('不注入任何 Agent 服务', async () => {
    srv = await createCloudServer({ port: 0, dir, agent: false, watchProviders: false })
    for (const name of ['agentConfig', 'agentSessions', 'agentRuntime', 'agentHub', 'agentQueue', 'agentGoal', 'agentLoadSdk']) {
      expect(srv.ctx.tryGet(name), name).toBeUndefined()
    }
  })

  it('三条 Agent 路由插件都不登记，接口回 404 JSON', async () => {
    srv = await createCloudServer({ port: 0, dir, agent: false, watchProviders: false })
    const names = srv.ctx.listPlugins()
    expect(names.filter((n) => n.startsWith('agent-'))).toEqual([])

    const res = await srv.app.fetch(new Request('http://x/api/agent/chat/completion', { method: 'POST' }))
    expect(res.status).toBe(404)
    expect(((await res.json()) as { ok?: boolean }).ok).toBe(false)
  })

  it('不创建 agent 数据目录（不装 goal hook、不写配置）', async () => {
    srv = await createCloudServer({ port: 0, dir, agent: false, watchProviders: false })
    const agentDir = path.join(dir, 'agent')
    await expect(fs.access(agentDir)).rejects.toThrow()
  })
})
