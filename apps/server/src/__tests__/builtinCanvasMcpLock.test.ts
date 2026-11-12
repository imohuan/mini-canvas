/**
 * 自带画布 MCP 的**两条硬保证**（用户口径 2026-10-05）：
 * 1. **删不掉** —— 界面上没有删除按钮，接口层面也必须拦住（否则手搓一个请求就没了）；
 * 2. **缺了就自动补** —— 哪怕清单被人从磁盘上改坏、或老数据里没有，读一次配置就补回来，
 *    保证「每次工作时都有这个画布 MCP 工具」。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-builtin-mcp-'))
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

describe('自带画布 MCP：删不掉', () => {
  it('接口拦住删除请求，且清单里它还在', async () => {
    const del = await call('DELETE', '/api/agent/mcp', { name: 'canvas' })
    // 明确拒绝（不是 500）；文案要说清是内置件
    expect(del.status).toBeGreaterThanOrEqual(400)
    expect(del.status).toBeLessThan(500)
    expect(del.text).toContain('canvas')
    const cfg = await call('GET', '/api/agent/config')
    const names = (cfg.json.mcpServers as Array<{ name: string }>).map((m) => m.name)
    expect(names).toContain('canvas')
  })

  it('清单里标记成内置（界面据此不给删除按钮）', async () => {
    const cfg = await call('GET', '/api/agent/config')
    const canvas = (cfg.json.mcpServers as Array<{ name: string; builtin?: boolean }>).find(
      (m) => m.name === 'canvas',
    )
    expect(canvas?.builtin).toBe(true)
    // 用户自己配的不带这个标记（照样可删）
    await call('POST', '/api/agent/mcp', { name: 'mine', kind: 'http', url: 'http://127.0.0.1:9/mcp' })
    const cfg2 = await call('GET', '/api/agent/config')
    const mine = (cfg2.json.mcpServers as Array<{ name: string; builtin?: boolean }>).find(
      (m) => m.name === 'mine',
    )
    expect(mine?.builtin).toBeUndefined()
  })
})

describe('自带画布 MCP：缺了自动补', () => {
  it('从磁盘上把 canvas 删掉 → 读一次配置就补回来', async () => {
    const cfg = await call('GET', '/api/agent/config')
    const systemConfigPath = String(cfg.json.paths.systemConfig)
    const yaml = await import('yaml')
    const raw = yaml.parse(await fs.readFile(systemConfigPath, 'utf8')) as {
      tools?: { mcpServers?: Array<{ name: string }> }
    }
    raw.tools = { ...(raw.tools ?? {}), mcpServers: [] }
    await fs.writeFile(systemConfigPath, yaml.stringify(raw, { lineWidth: 0 }), 'utf8')

    // 事前确认真的没了（不是测试自己写错文件）
    const before = yaml.parse(await fs.readFile(systemConfigPath, 'utf8')) as {
      tools?: { mcpServers?: Array<{ name: string }> }
    }
    expect(before.tools?.mcpServers ?? []).toHaveLength(0)

    const back = await call('GET', '/api/agent/config')
    const names = (back.json.mcpServers as Array<{ name: string }>).map((m) => m.name)
    expect(names).toContain('canvas')
    // 而且真的写回磁盘了（下次启动也在）
    const after = yaml.parse(await fs.readFile(systemConfigPath, 'utf8')) as {
      tools?: { mcpServers?: Array<{ name: string }> }
    }
    expect((after.tools?.mcpServers ?? []).map((m) => m.name)).toContain('canvas')
  })
})

describe('自带画布 MCP：地址用真实监听端口', () => {
  /**
   * port 传 0 时真实端口由系统分配。地址若用「请求的 0」写死，就会落成 `http://127.0.0.1:0/mcp` ——
   * 那是个连不上的地址（Agent 每次跑都要连它，等于工具不可用）。
   */
  it('port:0 起服务 → 地址里是真实端口，不是 0', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-builtin-port-'))
    const srv2 = await createCloudServer({ port: 0, dir: dir2, watchProviders: false })
    try {
      const info = await srv2.start()
      const cfg = await srv2.app.fetch(new Request('http://localhost/api/agent/config'))
      const body = (await cfg.json()) as { mcpServers: Array<{ name: string; config: { url?: string } }> }
      const url = String(body.mcpServers.find((m) => m.name === 'canvas')?.config.url ?? '')
      expect(url).toBe(`http://127.0.0.1:${info.port}/mcp`)
      expect(url).not.toContain(':0/mcp')
    } finally {
      srv2.stop()
      await fs.rm(dir2, { recursive: true, force: true })
    }
  })
})
