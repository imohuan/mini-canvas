/**
 * 插件 MCP 工具**真的能被 MCP 端点列出**（Spec 审查指出的缺口：原测试只测了注册场与 handler 直调）。
 *
 * 另外锁一条防回归：插件工具与内置同名时**跳过**（而不是让 SDK 抛错把整个 /mcp 打成 500）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer } from '../server.js'
import { TOOL_LIST } from '../mcp/server.js'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-mcpep-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/**
 * 走一次 MCP 握手 + tools/list，拿回工具名。
 * 用 `app.fetch`（不启真端口、不走网络）—— 之前写成真实 fetch 到 http://x，
 * 在无网/无 DNS 的环境里会 `getaddrinfo ENOTFOUND x`（实测踩过）。
 */
async function mcpToolNames(app: { fetch: (r: Request) => Response | Promise<Response> }): Promise<string[]> {
  const post = (body: unknown) =>
    app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      }),
    )
  await (await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
  })).text()
  const text = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })).text()
  // SSE 形态：从 data: 行里取 JSON；纯 JSON 形态直接解析
  const line = text.split('\n').find((l) => l.startsWith('data:')) ?? text
  const json = JSON.parse(line.replace(/^data:\s*/, ''))
  return (json.result?.tools ?? []).map((t: { name: string }) => t.name)
}

describe('插件 MCP 工具走到真实端点（E2E）', () => {
  it('插件注册的工具出现在 MCP tools/list 里', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    srv.ctx.installPlugin({
      name: 'mcp-ext',
      apply: (c) => {
        c.mcp.tool({
          name: 'ext.ping',
          description: '插件提供的探针工具',
          handler: () => ({ pong: true }),
        })
      },
    })
    const names = await mcpToolNames(srv.app)
    expect(names).toContain('ext.ping')
    srv.stop()
  })

  it('插件工具与内置同名 → 跳过，不把 /mcp 打成 500', async () => {
    const srv = await createCloudServer({ port: 0, dir, watchProviders: false })
    const builtin = TOOL_LIST[0]!.name
    srv.ctx.installPlugin({
      name: 'mcp-clash',
      apply: (c) => {
        c.mcp.tool({ name: builtin, description: '冒名顶替', handler: () => 1 })
      },
    })
    const names = await mcpToolNames(srv.app)
    // 内置那个仍在（没被顶掉、也没让整条链炸）
    expect(names).toContain(builtin)
    expect(names.filter((n) => n === builtin)).toHaveLength(1)
    srv.stop()
  })
})
