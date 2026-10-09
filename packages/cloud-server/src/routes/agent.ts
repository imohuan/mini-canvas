/**
 * agent 路由 —— Agent 的**全局配置**面（模型 / 技能 / MCP / 审批规则）。
 *
 * 与会话路由（agentSessions.ts）分开：这两类数据的归属不同 ——
 * 配置是全局一份，会话按画布分。放两个文件，路由表一眼看出这个区别。
 *
 * 错误处理：服务抛的都是「用户能改的输入问题」（名字不合法 / 地址不是 URL / 目录不在来源里），
 * 一律 400 并把原话回给界面；没料到的问题照抛（500）。
 */
import { Hono } from 'hono'
import type { AgentConfigService } from '../agent/config.js'
import { isSecretMask } from '../agent/config.js'
import type { AgentRuntime } from '../agent/runtime.js'

export function agentRoutes(config: AgentConfigService, runtime: AgentRuntime): Hono {
  const app = new Hono()

  /** 把服务抛的错翻成 400（消息原样给用户看） */
  async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
    try {
      return { ok: true, value: await fn() }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  app.get('/api/agent/config', async (c) => {
    const r = await guard(async () => {
      const m = await config.models()
      const [skills, mcpServers, tools] = await Promise.all([
        config.skills(),
        config.mcpServers(),
        config.resolvedTools(),
      ])
      return {
        models: m.models,
        providers: m.providers,
        clientTypes: config.clientTypes(),
        systemPrompt: await config.systemPrompt(),
        ...(m.defaultRef ? { defaultRef: m.defaultRef } : {}),
        skills,
        mcpServers,
        tools,
        paths: { state: config.stateDir(), systemConfig: config.systemConfigPath() },
      }
    })
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, ...r.value })
  })

  app.post('/api/agent/models', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const r = await guard(() =>
      config.upsertModel({
        provider: String(body.provider ?? ''),
        modelId: String(body.modelId ?? body.model_id ?? ''),
        // 界面会把「已存密钥的掩码」原样回传（它显示在输入框里）。掩码不是真密钥，
        // 存进去会让这个渠道直接失效（401）——所以这里把掩码当"没改"处理。
        ...(typeof body.apiKey === 'string' && !isSecretMask(body.apiKey) ? { apiKey: body.apiKey } : {}),
        ...(typeof body.baseUrl === 'string' ? { baseUrl: body.baseUrl } : {}),
        ...(typeof body.clientType === 'string' ? { clientType: body.clientType } : {}),
        ...(typeof body.contextWindow === 'number' ? { contextWindow: body.contextWindow } : {}),
        ...(typeof body.vision === 'boolean' ? { vision: body.vision } : {}),
        setDefault: body.setDefault === true,
      }),
    )
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    const m = await config.models()
    return c.json({ ok: true, models: m.models, providers: m.providers })
  })

  app.delete('/api/agent/models', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const provider = String(body.provider ?? '')
    const modelId = String(body.modelId ?? body.model_id ?? '')
    if (!provider || !modelId) return c.json({ ok: false, error: '需要 provider 与 modelId' }, 400)
    const r = await guard(() => config.deleteModel(provider, modelId))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, models: (await config.models()).models })
  })

  /**
   * 批量写一个渠道的模型（界面「编辑 Provider」的落点）。
   *
   * 与逐个 POST /api/agent/models 的区别见 AgentConfigService.upsertModels 的注释：
   * 一次请求里把「新增/更新」和「取消勾选的要删掉」一起做掉，不会留下半个渠道。
   */
  app.put('/api/agent/models/bulk', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const provider = String(body.provider ?? '')
    const modelIds = Array.isArray(body.modelIds) ? body.modelIds.map(String) : []
    if (!provider) return c.json({ ok: false, error: '需要 provider' }, 400)
    if (!modelIds.length) return c.json({ ok: false, error: '至少勾选一个模型' }, 400)
    const r = await guard(() =>
      config.upsertModels({
        provider,
        modelIds,
        // 掩码 = 界面回显的"已存密钥"，不是用户新输入的密钥 → 当没改（见 bulk 路由同款判断）
        ...(typeof body.apiKey === 'string' && !isSecretMask(body.apiKey) ? { apiKey: body.apiKey } : {}),
        ...(typeof body.baseUrl === 'string' ? { baseUrl: body.baseUrl } : {}),
        ...(typeof body.clientType === 'string' ? { clientType: body.clientType } : {}),
        ...(typeof body.vision === 'boolean' ? { vision: body.vision } : {}),
        ...(typeof body.makeDefault === 'string' && body.makeDefault ? { makeDefault: body.makeDefault } : {}),
        ...(body.removeMissing === true ? { removeMissing: true } : {}),
      }),
    )
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    const m = await config.models()
    return c.json({ ok: true, ...r.value, models: m.models, providers: m.providers })
  })

  /** 设默认 / 设看图共用一段（只是调不同方法） */
  function modelRefRoute(kind: 'default' | 'vision', run: (p: string, m: string) => Promise<void>): void {
    app.post('/api/agent/models/' + kind, async (c) => {
      const body = await safeJson(c)
      if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
      const provider = String(body.provider ?? '')
      const modelId = String(body.modelId ?? body.model_id ?? '')
      if (!provider || !modelId) return c.json({ ok: false, error: '需要 provider 与 modelId' }, 400)
      const r = await guard(() => run(provider, modelId))
      if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
      return c.json({ ok: true, models: (await config.models()).models })
    })
  }
  modelRefRoute('default', (p, m) => config.setDefaultModel(p, m))
  modelRefRoute('vision', (p, m) => config.setVisionModel(p, m))

  app.get('/api/agent/skills', async (c) => c.json({ ok: true, skills: await config.skills() }))
  app.get('/api/agent/skills/sources', async (c) =>
    c.json({ ok: true, candidates: await config.skillCandidates() }),
  )

  app.post('/api/agent/skills/import', async (c) => {
    const body = await safeJson(c)
    if (!body || typeof body.dir !== 'string' || !body.dir.trim()) {
      return c.json({ ok: false, error: '需要提供 dir（技能目录的绝对路径）' }, 400)
    }
    const r = await guard(() => config.importSkill(body.dir as string))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, imported: r.value, skills: await config.skills() })
  })

  app.delete('/api/agent/skills/:name', async (c) => {
    const name = decodeURIComponent(c.req.param('name'))
    const r = await guard(() => config.removeSkill(name))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, removed: name, skills: await config.skills() })
  })

  app.post('/api/agent/mcp', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const kind = String(body.kind ?? 'http')
    if (kind !== 'stdio' && kind !== 'http' && kind !== 'sse') {
      return c.json({ ok: false, error: 'kind 只能是 stdio / http / sse' }, 400)
    }
    const permission = body.permission
    const r = await guard(() =>
      config.addMcpServer({
        name: String(body.name ?? ''),
        kind: kind as 'stdio' | 'http' | 'sse',
        ...(typeof body.command === 'string' ? { command: body.command } : {}),
        ...(Array.isArray(body.args) ? { args: body.args.map(String) } : {}),
        ...(typeof body.url === 'string' ? { url: body.url } : {}),
        ...(permission === 'auto' || permission === 'r' || permission === 'rw'
          ? { permission: permission as 'auto' | 'r' | 'rw' }
          : {}),
      }),
    )
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, mcpServers: r.value })
  })

  app.delete('/api/agent/mcp', async (c) => {
    const body = await safeJson(c)
    if (!body || typeof body.name !== 'string') return c.json({ ok: false, error: '需要 name' }, 400)
    const r = await guard(() => config.removeMcpServer(body.name as string))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 404)
    return c.json({ ok: true, mcpServers: r.value })
  })

  app.get('/api/agent/tools', async (c) => c.json({ ok: true, ...(await config.resolvedTools()) }))

  /**
   * **主动**连一次 MCP 并列出可用工具（「检查连接」按钮）。
   *
   * 为什么值得单开一个口：SDK 的 MCP 是懒连接的，不主动探一次就只能靠「先发一句话」
   * 看那句「已连接 MCP：…」的提示 —— 用户想确认配得对不对，不该被迫先花一轮对话。
   */
  app.post('/api/agent/mcp/probe', async (c) => {
    const body = (await safeJson(c)) ?? {}
    const names = Array.isArray(body.names) ? body.names.map(String) : undefined
    const r = await guard(() => config.probeMcp(names))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: r.value.ok, servers: r.value.servers, tools: r.value.tools, warnings: r.value.warnings })
  })

  /** Agent 的系统提示词（agent_state/AGENTS.md） */
  app.put('/api/agent/system-prompt', async (c) => {
    const body = await safeJson(c)
    if (!body || typeof body.text !== 'string') {
      return c.json({ ok: false, error: 'body 需要 { text: string }' }, 400)
    }
    const r = await guard(() => config.setSystemPrompt(body.text as string))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, text: await config.systemPrompt() })
  })

  /**
   * 模式提示词清单（全能创作 / 剧本创编 + 用户自建），住后台 KV。
   *
   * GET  -> { prompts: PromptPreset[] }
   * PUT  -> body { prompts: PromptPreset[] } 整包写回；内置项被删会自动补回。
   */
  app.get('/api/agent/prompts', async (c) => {
    const r = await guard(() => config.prompts())
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, prompts: r.value })
  })

  app.put('/api/agent/prompts', async (c) => {
    const body = await safeJson(c)
    if (!body || !Array.isArray((body as { prompts?: unknown }).prompts)) {
      return c.json({ ok: false, error: 'body 需要 { prompts: PromptPreset[] }' }, 400)
    }
    const r = await guard(() => config.savePrompts((body as { prompts: unknown }).prompts))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, prompts: r.value })
  })

  /**
   * 会话标题模型（自动命名用哪个模型）。
   * GET  -> { provider?, modelId? }（空 = 用会话默认模型）
   * PUT  -> body { provider?, modelId? }；两个都空 = 清掉配置。
   */
  app.get('/api/agent/title-model', async (c) => {
    const r = await guard(() => config.titleModel())
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, ...r.value })
  })

  app.put('/api/agent/title-model', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const provider = typeof body.provider === 'string' ? body.provider : undefined
    const modelId = typeof body.modelId === 'string' ? body.modelId : undefined
    const r = await guard(() => config.setTitleModel(provider, modelId))
    if (!r.ok) return c.json({ ok: false, error: r.message }, 400)
    return c.json({ ok: true, ...r.value })
  })

  /** 上游可用模型清单（界面下拉用） */
  app.post('/api/agent/models/available', async (c) => {
    const body = (await safeJson(c)) ?? {}
    const r = await config.upstreamModels(
      typeof body.provider === 'string' ? body.provider : undefined,
      typeof body.modelId === 'string' ? body.modelId : undefined,
      {
        ...(typeof body.baseUrl === 'string' ? { baseUrl: body.baseUrl } : {}),
        // 掩码不算密钥：用户直接点「拉取」时，界面回传的是掩码，
        // 这里必须放空让上游取"已存的那个密钥"，否则会拿掩码去认证 → 401。
        ...(typeof body.apiKey === 'string' && !isSecretMask(body.apiKey) ? { apiKey: body.apiKey } : {}),
      },
    )
    return c.json({ ok: r.ok, models: r.models, ...(r.error ? { error: r.error } : {}) })
  })

  // ------------------------------------------------------------ 审批规则列表
  app.get('/api/agent/policy', (c) => c.json({ ok: true, policy: runtime.getPolicy() }))

  app.put('/api/agent/policy', async (c) => {
    const body = await safeJson(c)
    if (!body) return c.json({ ok: false, error: 'body 不是合法 JSON' }, 400)
    const enabled = body.enabled !== false
    const rawRules = Array.isArray(body.rules) ? body.rules : []
    const rules = rawRules
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r, i) => ({
        id: typeof r.id === 'string' && r.id ? r.id : 'rule-' + i,
        pattern: String(r.pattern ?? ''),
        ask: r.ask !== false,
        ...(typeof r.label === 'string' && r.label ? { label: r.label } : {}),
      }))
      .filter((r) => r.pattern)
    runtime.setPolicy({ enabled, rules })
    return c.json({ ok: true, policy: runtime.getPolicy() })
  })

  return app
}

/** 读 JSON body；坏 JSON 返回 undefined（由调用方回 400） */
export async function safeJson(
  c: { req: { json: () => Promise<unknown> } },
): Promise<Record<string, unknown> | undefined> {
  try {
    const v = await c.req.json()
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
