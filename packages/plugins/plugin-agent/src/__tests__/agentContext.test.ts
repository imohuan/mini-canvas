/**
 * 运行环境上下文进前端：提示词页要能显示后台地址 / 目录，并让用户点一下插入占位符。
 *
 * 用户口径（2026-10-14）：「我需要你添加一些我当前的上下文信息：1. 当前运行的后台 base URL；
 * 2. 一些目录信息」，并且希望像另一个 Agent 那样有**可点的占位符**。
 *
 * 这里锁的是前端那一半：
 *   - 后台回的 context / template 要落进 state（不落的话界面什么都没得显示）；
 *   - 模板坏了要有可见信号（否则用户改提示词一直没反应还查不出原因）；
 *   - restoreTemplate 要真调后端并刷新。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentApi } from '../agentApi'

let dir: string
let api: AgentApi

const CONFIG_BODY = {
  ok: true,
  models: [],
  providers: [],
  skills: [],
  mcpServers: [],
  tools: { builtin: [], mcp: [], warnings: [] },
  prompts: [],
  context: {
    baseUrl: 'http://127.0.0.1:8865',
    dirs: [
      { label: '数据根', path: 'D:/d/.mini-canvas' },
      { label: '画布', path: 'D:/d/.mini-canvas/canvases' },
    ],
    placeholders: [
      {
        token: '{{BACKEND_BASE_URL}}',
        value: 'http://127.0.0.1:8865',
        description: '这台后台的地址（含真实端口）',
        source: 'mini-canvas',
      },
      { token: '{{CWD}}', value: '', description: '本会话的工作目录', source: 'harness' },
    ],
  },
  template: { ok: false, missing: ['{{AGENTS_MD}}'] },
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-api-ctx-'))
  api = new AgentApi({
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/agent/config')) return Response.json(CONFIG_BODY)
      if (url.endsWith('/api/agent/template/restore')) {
        return Response.json({ ok: true, template: { ok: true, missing: [] } })
      }
      return Response.json({ ok: true })
    }) as unknown as typeof fetch,
  })
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('运行环境上下文（前端 API 面）', () => {
  it('config() 原样带回地址 / 目录 / 占位符 / 模板体检', async () => {
    const cfg = (await api.config()) as any
    expect(cfg.context.baseUrl).toBe('http://127.0.0.1:8865')
    expect(cfg.context.dirs.map((d: { label: string }) => d.label)).toEqual(['数据根', '画布'])
    const tokens = cfg.context.placeholders.map((p: { token: string }) => p.token)
    expect(tokens).toContain('{{BACKEND_BASE_URL}}')
    expect(cfg.context.placeholders.find((p: any) => p.token === '{{CWD}}').source).toBe('harness')
    expect(cfg.template).toEqual({ ok: false, missing: ['{{AGENTS_MD}}'] })
  })

  it('restoreTemplate() 调后端并回体检结果', async () => {
    const r = await api.restoreTemplate()
    expect(r.ok).toBe(true)
    expect(r.template?.ok).toBe(true)
    expect(r.template?.missing).toEqual([])
  })
})
