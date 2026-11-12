/**
 * POST /api/agent/mcp/probe —— 「主动检查 MCP」这条新链路。
 *
 * 背景（用户提问）：「已连接 MCP：smart(3 个工具)」这句只有**发过一句话**才出现，
 * 因为 SDK 的 MCP 是懒连接的（第一次 listTools()/run() 才真连）。
 * 用户想确认配置对不对，不该被迫先花一轮对话 —— 于是加了这个主动探测口。
 *
 * 这里用**本地假 MCP 服务**（Streamable HTTP）验收：真连一次、真列工具、真报错。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer, type Server } from 'node:http'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer
let mcp: Server
let mcpPort = 0
/** 假 MCP 返回的工具清单（每个用例可改） */
let mcpTools: string[] = ['alpha', 'beta']
/** 假 MCP 的响应模式：正常 / 连接即失败 */
let mcpBroken = false

/** 一个够用的 MCP Streamable HTTP 桩：认 initialize / tools/list，返回固定工具集 */
function startFakeMcp(): Promise<void> {
  mcp = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks).toString('utf8')
    if (mcpBroken) {
      res.statusCode = 500
      res.end('boom')
      return
    }
    let id: unknown = null
    let method = ''
    try {
      const parsed = JSON.parse(body) as { id?: unknown; method?: string }
      id = parsed.id ?? null
      method = String(parsed.method ?? '')
    } catch {
      /* 非 JSON 直接忽略 */
    }
    res.setHeader('content-type', 'application/json')
    if (method === 'initialize') {
      res.setHeader('mcp-session-id', 'test-session')
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } }))
      return
    }
    if (method === 'notifications/initialized') {
      res.statusCode = 202
      res.end()
      return
    }
    if (method === 'tools/list') {
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: mcpTools.map((n) => ({ name: n, description: 'tool ' + n, inputSchema: { type: 'object' } })) } }))
      return
    }
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: {} }))
  })
  return new Promise<void>((r) => mcp.listen(0, '127.0.0.1', () => {
    mcpPort = (mcp.address() as { port: number }).port
    r()
  }))
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-' + 'mcp-probe-'))
  // 关掉「内置画布 MCP 自动注册」：这些用例要验的是「用户自己配了什么」这一面，
  // 而内置 MCP 默认携带会让「没配任何 MCP」不再是空集。内置注册另有专门用例。
  srv = await createCloudServer({ dir, watchProviders: false, builtinCanvasMcp: false })
  mcpTools = ['alpha', 'beta']
  mcpBroken = false
  await startFakeMcp()
  // 配好这个假 MCP（http 类型）
  await call('POST', '/api/agent/mcp', {
    name: 'fake', kind: 'http', url: 'http://127.0.0.1:' + mcpPort + '/mcp',
  })
})

afterEach(async () => {
  srv.stop()
  await new Promise<void>((r) => mcp.close(() => r()))
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

describe('主动检查 MCP（不必先发一句话）', () => {
  it('连上并列出可用工具（名字去掉 mcp__server__ 前缀、带上服务名）', async () => {
    const r = await call('POST', '/api/agent/mcp/probe', {})
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(r.json.servers).toHaveLength(1)
    expect(r.json.servers[0]).toMatchObject({ name: 'fake', transport: 'http', status: 'completed', tools: 2 })
    expect(r.json.tools.map((t: { name: string }) => t.name).sort()).toEqual(['alpha', 'beta'])
    expect(r.json.tools.every((t: { server: string }) => t.server === 'fake')).toBe(true)
    expect(r.json.tools.every((t: { fullName: string }) => t.fullName.startsWith('mcp__fake__'))).toBe(true)
  })

  it('工具清单变了，检查结果跟着变（不是缓存）', async () => {
    mcpTools = ['alpha', 'beta', 'gamma']
    const r = await call('POST', '/api/agent/mcp/probe', {})
    expect(r.json.tools.map((t: { name: string }) => t.name).sort()).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('服务连不上 → ok=false 且带失败状态（不是 500，界面能显示原因）', async () => {
    mcpBroken = true
    const r = await call('POST', '/api/agent/mcp/probe', {})
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(false)
    expect(r.json.servers[0].status).not.toBe('completed')
    expect(r.json.tools).toEqual([])
  })

  it('没配任何 MCP → 空结果而不是报错（界面照常渲染）', async () => {
    await call('DELETE', '/api/agent/mcp', { name: 'fake' })
    const r = await call('POST', '/api/agent/mcp/probe', {})
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ ok: true, servers: [], tools: [] })
  })

  it('可以只探指定名字的服务（界面按行检查用）', async () => {
    const r = await call('POST', '/api/agent/mcp/probe', { names: ['不存在的'] })
    expect(r.status).toBe(200)
    expect(r.json.servers).toEqual([])
  })
})
