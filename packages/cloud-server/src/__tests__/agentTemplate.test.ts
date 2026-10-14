/**
 * 提示词模板体检与恢复（真机 2026-10-06 事故的后遗症）。
 *
 * 事故：8865 数据目录的 `system_config.yaml` / `AGENTS.md` 被并发写截断。重建配置时
 * `system_prompt` 被写成了**纯文本**，于是 {{AGENTS_MD}} 没了 —— 用户在设置里写的提示词、
 * 模式提示词、引用标记说明、技能 / 记忆小节，**一个字都进不了模型**，而模型端不报任何错。
 *
 * 真机证据：265 条会话里 259 条的系统提示词长度恒为 34 个字符。
 *
 * 这里锁两件事：
 *   1. 体检结果要出现在 GET /api/agent/config（界面据此提示）；
 *   2. 恢复动作把模板换回 SDK 出厂那份（用户点按钮才做）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'yaml'
import { createCloudServer, type CloudServer } from '../server'

let dir: string
let srv: CloudServer

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-template-'))
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
  return { status: res.status, json: (await res.json()) as any }
}

/** 直接改磁盘上的 system_prompt（模拟「被别的东西覆盖成了纯文本」） */
async function writeTemplate(template: string): Promise<void> {
  const file = srv.paths.data
  const target = path.join(
    file,
    'agent',
    'mini-canvas',
    'agents',
    'canvas-agent',
    'agent_state',
    'system_config.yaml',
  )
  const cfg = yaml.parse(await fs.readFile(target, 'utf8')) as Record<string, unknown>
  cfg.system_prompt = template
  await fs.writeFile(target, yaml.stringify(cfg, { lineWidth: 0 }), 'utf8')
}

describe('提示词模板体检', () => {
  it('新建的 Agent 模板是健康的（保住了 {{AGENTS_MD}}）', async () => {
    const cfg = await call('GET', '/api/agent/config')
    expect(cfg.status).toBe(200)
    expect(cfg.json.template.ok).toBe(true)
    expect(cfg.json.template.missing).toEqual([])
  })

  it('模板被写成纯文本时体检报警（列出缺的记号）', async () => {
    // 服务起来时已经写过一次配置；这里把它改坏
    await writeTemplate('你是 mini-canvas 画布助手。')
    const cfg = await call('GET', '/api/agent/config')
    expect(cfg.json.template.ok).toBe(false)
    expect(cfg.json.template.missing).toContain('{{AGENTS_MD}}')
  })

  it('一键恢复：把模板换回出厂那份，体检随即转绿', async () => {
    await writeTemplate('你是 mini-canvas 画布助手。')
    expect((await call('GET', '/api/agent/config')).json.template.ok).toBe(false)

    const restored = await call('POST', '/api/agent/template/restore')
    expect(restored.status).toBe(200)
    expect(restored.json.template.ok).toBe(true)

    // 再读一次（确认真的落盘，不是只改了内存）
    const cfg = await call('GET', '/api/agent/config')
    expect(cfg.json.template.ok).toBe(true)
    expect(cfg.json.template.template).toContain('{{AGENTS_MD}}')
  })

  it('恢复模板不动 MCP 清单（那是用户数据，不属于「模板」）', async () => {
    const before = await call('GET', '/api/agent/config')
    const namesBefore = before.json.mcpServers.map((m: { name: string }) => m.name)
    await writeTemplate('坏的')
    await call('POST', '/api/agent/template/restore')
    const after = await call('GET', '/api/agent/config')
    expect(after.json.mcpServers.map((m: { name: string }) => m.name)).toEqual(namesBefore)
    expect(namesBefore).toContain('canvas')
  })
})

describe('运行环境上下文进配置面', () => {
  it('GET /api/agent/config 带上地址 / 目录 / 占位符清单', async () => {
    const cfg = await call('GET', '/api/agent/config')
    expect(cfg.json.context.baseUrl).toMatch(/^http:\/\//)
    expect(cfg.json.context.dirs.map((d: { label: string }) => d.label)).toContain('画布')
    const tokens = cfg.json.context.placeholders.map((p: { token: string }) => p.token)
    expect(tokens).toContain('{{BACKEND_BASE_URL}}')
    expect(tokens).toContain('{{CANVASES_DIR}}')
  })

  it('真起监听后，地址里的端口是**真实端口**（port:0 由系统分配也不虚）', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-template-listen-'))
    const srv2 = await createCloudServer({ dir: dir2, watchProviders: false, port: 0 })
    try {
      const info = await srv2.start()
      const res = await srv2.app.fetch(new Request('http://localhost/api/agent/config'))
      const body = (await res.json()) as { context: { baseUrl: string } }
      expect(body.context.baseUrl).toBe('http://127.0.0.1:' + info.port)
    } finally {
      srv2.stop()
      await fs.rm(dir2, { recursive: true, force: true })
    }
  })
})
