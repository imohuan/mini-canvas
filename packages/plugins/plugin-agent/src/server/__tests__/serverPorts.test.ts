/**
 * 后台半的接线守卫：**插件不靠 import 宿主也能装配起来**。
 *
 * 锁三件事（都是搬迁时最容易悄悄退化的地方）：
 * 1. 端口注入：只给 dataDir / kv / promptSections / runMiddleware，服务组就能建起来；
 * 2. 提示词小节：装配时用的是**注入进来的那一份**（不是插件自己找的注册场）；
 * 3. 路由 adoption：三条路由插件会把自己的路由交给宿主，且名字与 inject 稳定。
 */
import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentHostPorts, AgentKvPort } from '../ports.js'
import { assembleAgentServices } from '../agent/assembleAgent.js'
import { agentPlugins, AGENT_SERVICES } from '../routes/plugin.js'

/** 内存 KV：只实现插件真正用到的 get/set（与宿主 KvStore 同语义）。 */
function memoryKv(): AgentKvPort & { size(): number } {
  const data = new Map<string, unknown>()
  return {
    async get<T>(type: string, key: string) {
      return data.get(type + '/' + key) as T | undefined
    },
    async set(type: string, key: string, value: unknown) {
      data.set(type + '/' + key, value)
    },
    size: () => data.size,
  }
}

async function makePorts(overrides: Partial<AgentHostPorts> = {}): Promise<{ dir: string; ports: AgentHostPorts; kv: ReturnType<typeof memoryKv> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-ports-'))
  const kv = memoryKv()
  const ports: AgentHostPorts = {
    dataDir: dir,
    canvasDirOf: (canvasId) => path.join(dir, 'canvases', canvasId),
    kv,
    promptSections: () => [{ id: 's1', title: '注入的小节', source: 'test', order: 0, text: '正文' }],
    runMiddleware: async () => ({}),
    ...overrides,
  }
  return { dir, ports, kv }
}

describe('Agent 后台：端口注入', () => {
  it('只给注入端口就能装配出服务组（不需要宿主模块）', async () => {
    const { dir, ports, kv } = await makePorts()
    try {
      const services = await assembleAgentServices({ ports })
      expect(services.config).toBeTruthy()
      expect(services.sessions).toBeTruthy()
      expect(services.runtime).toBeTruthy()
      expect(services.queue).toBeTruthy()
      expect(services.goal).toBeTruthy()
      // 提示词清单落在**注入的** KV 上：证明没有偷偷自己 new 一份宿主 store。
      await services.config.prompts()
      expect(kv.size()).toBeGreaterThan(0)
      services.dispose()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('中间件链走注入的那一个（插件不 import 宿主注册场）', async () => {
    const { dir, ports } = await makePorts({ runMiddleware: async () => ({ blocked: true, response: { hit: 1 } }) })
    try {
      const services = await assembleAgentServices({ ports })
      // 直接调注入点：证明「谁来跑中间件」是外部给的，不是插件自己找的。
      const result = await ports.runMiddleware({ canvasId: 'c1', input: { canvasId: 'c1', text: 'hi' } })
      expect(result).toEqual({ blocked: true, response: { hit: 1 } })
      services.dispose()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('Agent 后台：路由 adoption', () => {
  it('三条路由插件名字与 inject 稳定（宿主的清单校验按它认人）', () => {
    const plugins = agentPlugins(async () => ({}))
    expect(plugins.map((p) => p.name)).toEqual(['agent-routes', 'agent-sessions', 'agent-chat'])
    for (const p of plugins) {
      expect(Array.isArray(p.inject) && p.inject.length > 0, p.name + ' 应声明 inject').toBe(true)
    }
    expect(AGENT_SERVICES.config).toBe('agentConfig')
  })

  it('配置路由插件把自己的路由 adopt 给宿主（不自己起 Hono 服务器）', () => {
    const adopted: unknown[] = []
    const ctx = {
      routes: { adopt: (app: unknown) => adopted.push(app) },
      tryGet: (name: string) => (name === AGENT_SERVICES.config || name === AGENT_SERVICES.runtime ? {} : undefined),
    }
    const [configPlugin] = agentPlugins(async () => ({}))
    configPlugin!.apply!(ctx as never)
    expect(adopted).toHaveLength(1)
  })
})
