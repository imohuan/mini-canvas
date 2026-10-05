/**
 * 模式提示词清单（住后台 KV）+ 内置画布 MCP 自注册。
 *
 * 用户口径：
 * 1. 设置里有提示词列表，每条有名字；
 * 2. 支持自己新增；
 * 3. 内置两条（全能创作 / 剧本创编）**不允许删除**；
 * 4. 画布 MCP 默认携带、用户零配置。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-agent-prompts-'))
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

describe('模式提示词清单', () => {
  it('首次读 = 两条内置，且带 builtin 标记', async () => {
    const r = await call('GET', '/api/agent/prompts')
    expect(r.status).toBe(200)
    const names = r.json.prompts.map((p: { name: string }) => p.name)
    expect(names).toEqual(['全能创作', '剧本创编'])
    expect(r.json.prompts.every((p: { builtin?: boolean }) => p.builtin === true)).toBe(true)
  })

  it('自建一条能存下来，别的内置还在', async () => {
    const first = await call('GET', '/api/agent/prompts')
    const list = [...first.json.prompts, { id: 'user-1', name: '广告片', text: '写广告脚本' }]
    const put = await call('PUT', '/api/agent/prompts', { prompts: list })
    expect(put.status).toBe(200)
    expect(put.json.prompts.map((p: { id: string }) => p.id)).toEqual(['general', 'script', 'user-1'])
    // 落盘：再读一次仍在
    const again = await call('GET', '/api/agent/prompts')
    expect(again.json.prompts).toHaveLength(3)
  })

  it('内置项被删 → 自动补回（不允许删除）', async () => {
    const put = await call('PUT', '/api/agent/prompts', {
      prompts: [{ id: 'general', name: '全能创作（改过名）', text: 'x' }],
    })
    expect(put.status).toBe(200)
    const ids = put.json.prompts.map((p: { id: string }) => p.id).sort()
    expect(ids).toEqual(['general', 'script'])
    // 用户对内置项的改名与正文保留
    const general = put.json.prompts.find((p: { id: string }) => p.id === 'general')
    expect(general.name).toBe('全能创作（改过名）')
    expect(general.builtin).toBe(true)
  })

  it('非法 body 明确报错（不是 500）', async () => {
    const r = await call('PUT', '/api/agent/prompts', { nope: true })
    expect(r.status).toBe(400)
  })
})

describe('内置画布 MCP', () => {
  it('启动后自动在 Agent 的 MCP 清单里（默认携带，用户零配置）', async () => {
    const cfg = await call('GET', '/api/agent/config')
    const names = cfg.json.mcpServers.map((m: { name: string }) => m.name)
    expect(names).toContain('canvas')
    const canvas = cfg.json.mcpServers.find((m: { name: string }) => m.name === 'canvas')
    expect(String(canvas.config.url)).toMatch(/\/mcp$/)
  })

  it('关掉开关时不注册（测试可隔离）', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-nomcp-'))
    const srv2 = await createCloudServer({ dir: dir2, watchProviders: false, builtinCanvasMcp: false })
    try {
      const cfg = await srv2.app.fetch(new Request('http://localhost/api/agent/config'))
      const body = (await cfg.json()) as { mcpServers: Array<{ name: string }> }
      expect(body.mcpServers.map((m) => m.name)).not.toContain('canvas')
    } finally {
      srv2.stop()
      await fs.rm(dir2, { recursive: true, force: true })
    }
  })
})
