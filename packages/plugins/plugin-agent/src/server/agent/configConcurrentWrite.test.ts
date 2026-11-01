/**
 * 配置落盘必须**串行**：模型表与 MCP 表都是「读整份 → 改 → 写回」。
 *
 * 复现的真问题：服务启动时 `ensureBuiltinCanvasMcp` 与 `ensureTestModel` 并发跑，
 * 两个并发的保存请求也会同时落盘。没有串行链时各自读到同一份旧内容，后写的把先写的
 * 整条盖掉；Windows 上两次 rename 打同一个目标还会偶发 EPERM。
 *
 * 判据很简单：并发发出去 N 条，落盘后必须 N 条都在。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentConfigService } from './config.js'
import type { AgentKvPort } from '../ports.js'

let dir: string
let svc: AgentConfigService

/** 内存 KV：配置服务只用到 get/set（与宿主 KvStore 同语义） */
function memoryKv(): AgentKvPort {
  const data = new Map<string, unknown>()
  return {
    async get<T>(type: string, key: string) {
      return data.get(type + '/' + key) as T | undefined
    },
    async set(type: string, key: string, value: unknown) {
      data.set(type + '/' + key, value)
    },
  }
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-concurrent-'))
  svc = new AgentConfigService(dir, { kv: memoryKv() })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const baseUrl = 'http://127.0.0.1:3000/v1'

describe('Agent 配置并发写', () => {
  it('8 个模型同时保存：一条都不许丢', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    await Promise.all(
      ids.map((modelId) => svc.upsertModel({ provider: 'gw', modelId, apiKey: 'sk-x', baseUrl })),
    )
    const r = await svc.models()
    // 默认项目配置自带一批预置模型，这里只看本用例写的那个渠道
    expect(r.models.filter((m) => m.provider === 'gw').map((m) => m.modelId).sort()).toEqual(ids)
  })

  it('启动那两步并发：test 模型与画布 MCP 都要在', async () => {
    await Promise.all([
      svc.ensureTestModel({ provider: 'test', modelId: 'test-model', baseUrl, apiKey: 'sk-test' }),
      svc.ensureBuiltinCanvasMcp('http://127.0.0.1:8890/mcp'),
    ])
    const models = await svc.models()
    expect(models.models.map((m) => m.modelId)).toContain('test-model')
    const mcp = await svc.mcpServers()
    expect(mcp.map((m) => m.name)).toContain('canvas')
  })

  it('并发新增 6 个 MCP：全部留住，且不抛 EPERM', async () => {
    const names = ['smart', 'fs', 'git', 'db', 'web', 'shell']
    await Promise.all(
      names.map((name) =>
        svc.addMcpServer({ name, kind: 'http', url: 'http://127.0.0.1:3000/' + name }),
      ),
    )
    const mcp = await svc.mcpServers()
    expect(mcp.map((m) => m.name).sort()).toEqual(names.slice().sort())
  })

  it('并发「加 / 删 / 设默认」：不互相覆盖（设置页连点的形状）', async () => {
    await svc.upsertModel({ provider: 'gw', modelId: 'keep', apiKey: 'sk-x', baseUrl })
    await svc.upsertModel({ provider: 'gw', modelId: 'drop', apiKey: 'sk-x', baseUrl })
    await Promise.all([
      svc.deleteModel('gw', 'drop'),
      svc.upsertModel({ provider: 'gw', modelId: 'new1', apiKey: 'sk-x', baseUrl }),
      svc.setDefaultModel('gw', 'keep'),
      svc.upsertModel({ provider: 'gw', modelId: 'new2', apiKey: 'sk-x', baseUrl }),
    ])
    const r = await svc.models()
    expect(r.models.filter((m) => m.provider === 'gw').map((m) => m.modelId).sort()).toEqual([
      'keep',
      'new1',
      'new2',
    ])
    expect(r.defaultRef).toEqual({ provider: 'gw', modelId: 'keep' })
  })
})
