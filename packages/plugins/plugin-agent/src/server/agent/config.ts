/**
 * AgentConfigService —— Agent 的**全局配置**面（模型 / 技能 / MCP）。
 *
 * 为什么把 SDK 包在这一层：cloud-server 不能 import 工作区包，但可以依赖 SDK；
 * 而直接散着调 SDK 会让「密钥不回传」「base_url 要校验」这类口径散到各路由里。
 * 收在一个类里，路由只做 HTTP。
 *
 * 两条硬口径：
 * 1. **密钥只写不回读**：返回给界面的是 hasKey，明文永不出服务端。
 * 2. **base_url 存之前就校验**：存错的后果是第一次对话时模型端报 Invalid URL，
 *    而 SDK 会用指数退避重试、界面只显示「等待首个 token」，极难定位。
 */
import {
  addModel,
  loadProjectConfig,
  removeModel,
  setDefaultModel,
  setVisionModel,
  MODEL_PROVIDERS,
  MODEL_CATALOG,
  resolveModelEnv,
  modelHomepageUrl,
  buildToolConfig,
  loadAgentState,
  resolveMCPServer,
  McpToolProvider,
  MCP_TOOL_PREFIX,
} from '@prismshadow/penguin-core'
import { AGENT_ID, AGENT_PROJECT_ID } from './agentPaths.js'
import { AgentConfigBase } from './configShared.js'
import { AGENT_PROMPTS_KV_TYPE, AGENT_TITLE_MODEL_KEY } from './configTypes.js'
import type {
  AddMcpInput,
  AgentCatalogEntry,
  AgentMcpProbe,
  AgentMcpView,
  AgentModelView,
  AgentProviderView,
  UpsertModelInput,
} from './configTypes.js'
import {
  assertHttpUrl,
  describe,
  loadSystemConfig,
  maskSecret,
  writeSystemConfig,
  type SystemConfigLike,
} from './configTools.js'

export class AgentConfigService extends AgentConfigBase {
  /**
   * SDK 支持的客户端协议清单。
   *
   * 为什么从 SDK 读而不是在界面里写死：写死的那份实测有两个是错的 ——
   * anthropic-messages 会被 SDK 直接拒绝，openai-responses 对这个端点返回空。
   * 清单是 SDK 的契约，就该由它给。
   */
  clientTypes(): string[] {
    // 从内置目录里收集**真实出现过**的协议，再补上通用的 openai-chat ——
    // 这样清单不会包含 SDK 不认识的协议（写死的那份实测有两个是错的）。
    const fromCatalog = MODEL_CATALOG.map((e) => e.clientType).filter((c): c is string => !!c)
    return [...new Set(['openai-chat', ...fromCatalog])].sort()
  }

  async models(): Promise<{
    models: AgentModelView[]
    providers: AgentProviderView[]
    defaultRef?: { provider: string; modelId: string }
  }> {
    const cfg = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
    const same = (a?: { provider: string; model_id: string }, b?: { provider: string; model_id: string }) =>
      !!a && !!b && a.provider === b.provider && a.model_id === b.model_id
    const models: AgentModelView[] = cfg.models.map((m) => {
      const env = resolveModelEnv(m.model_id, m.client_type)
      const envKeys = [env?.envKey, env?.envBaseUrlKey].filter((k): k is string => !!k)
      return {
        provider: m.provider,
        modelId: m.model_id,
        ...(m.display_name ? { displayName: m.display_name } : {}),
        hasKey: !!m.api_key,
        ...(m.api_key ? { apiKeyMask: maskSecret(m.api_key) } : {}),
        ...(m.base_url ? { baseUrl: m.base_url } : {}),
        ...(m.client_type ? { clientType: m.client_type } : {}),
        ...(m.context_window ? { contextWindow: m.context_window } : {}),
        vision: m.vision !== false,
        isDefault: same(cfg.default_model, m),
        isVision: same(cfg.vision_model, m),
        envKeys,
      }
    })
    return {
      models,
      providers: MODEL_PROVIDERS.map((info) => ({
        provider: info.id,
        label: info.label,
        known: true,
        ...(info.apiKeyUrl ? { apiKeyUrl: info.apiKeyUrl } : {}),
        ...(info.gatewayBaseUrl ? { gatewayBaseUrl: info.gatewayBaseUrl } : {}),
      })),
      ...(cfg.default_model
        ? { defaultRef: { provider: cfg.default_model.provider, modelId: cfg.default_model.model_id } }
        : {}),
    }
  }

  /** 内置模型目录（界面的「从目录选」用；不写就不写） */
  catalog(): AgentCatalogEntry[] {
    return MODEL_CATALOG.map((e) => ({
      provider: e.provider,
      modelId: e.modelId,
      displayName: e.displayName,
      ...(e.contextWindow ? { contextWindow: e.contextWindow } : {}),
      vision: e.supportsVision !== false,
      ...(e.clientType ? { clientType: e.clientType } : {}),
      ...(modelHomepageUrl(e.provider, e.modelId)
        ? { homepage: modelHomepageUrl(e.provider, e.modelId) }
        : {}),
    }))
  }

  async upsertModel(input: UpsertModelInput): Promise<void> {
    await this.withConfigLock(() => this.writeModel(input))
  }

  /** upsertModel 的实现（调用方已持配置写锁） */
  private async writeModel(input: UpsertModelInput): Promise<void> {
    const provider = input.provider.trim()
    const modelId = input.modelId.trim()
    if (!provider) throw new Error('provider 不能为空')
    if (!modelId) throw new Error('modelId 不能为空')

    const rawBase = (input.baseUrl ?? '').trim()
    const baseUrl = rawBase ? assertHttpUrl(rawBase) : undefined
    const cfg = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
    const existing = cfg.models.find((m) => m.provider === provider && m.model_id === modelId)
    const carried = {
      apiKey: input.apiKey?.trim() || existing?.api_key,
      clientType: input.clientType?.trim() || existing?.client_type || 'openai-chat',
      contextWindow: input.contextWindow ?? existing?.context_window,
      vision: input.vision ?? existing?.vision,
    }
    // SDK 用 ?? 合并 base_url，空串清不掉已存的 —— 要清必须 remove 再 add
    if (existing?.base_url && !rawBase) {
      await removeModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId })
    }
    await addModel(
      this.sdkRoot,
      AGENT_PROJECT_ID,
      {
        provider,
        model_id: modelId,
        api_key: carried.apiKey,
        base_url: baseUrl,
        client_type: carried.clientType,
        ...(carried.contextWindow ? { context_window: carried.contextWindow } : {}),
        vision: carried.vision,
      },
      { setDefault: !!input.setDefault },
    )
  }

  async deleteModel(provider: string, modelId: string): Promise<void> {
    await this.withConfigLock(() => this.writeDeleteModel(provider, modelId))
  }

  /** deleteModel 的实现（调用方已持配置写锁） */
  private async writeDeleteModel(provider: string, modelId: string): Promise<void> {
    await removeModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId })
  }

  /**
   * 保证「test模型」在配置里（用户口径 2026-10-09：模型列表里多一个本地伪造模型）。
   *
   * 幂等：已存在且 base_url 一致时一个字节都不写（每次启动都会调它，不能天天重写配置）；
   * 服务换端口时 base_url 变了要纠正过来。
   *
   * 为什么把登记交给 config 而不是直接调 SDK：本项目所有模型写入都收在这一层
   * （密钥不回传、base_url 校验那两条口径都在这里），散出去必然漂移。
   */
  async ensureTestModel(input: { provider: string; modelId: string; baseUrl: string; apiKey: string }): Promise<void> {
    await this.withConfigLock(() => this.writeEnsureTestModel(input))
  }

  /** ensureTestModel 的实现（调用方已持配置写锁） */
  private async writeEnsureTestModel(input: { provider: string; modelId: string; baseUrl: string; apiKey: string }): Promise<void> {
    const provider = input.provider.trim()
    const modelId = input.modelId.trim()
    const baseUrl = assertHttpUrl(input.baseUrl)
    const cfg = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
    const existing = cfg.models.find((m) => m.provider === provider && m.model_id === modelId)
    if (existing && existing.base_url === baseUrl && !!existing.api_key) return
    await addModel(this.sdkRoot, AGENT_PROJECT_ID, {
      provider,
      model_id: modelId,
      api_key: input.apiKey,
      base_url: baseUrl,
      client_type: 'openai-chat',
      context_window: 200000,
      vision: true,
    })
  }

  /**
   * **按 provider 批量写模型** —— 界面「一个渠道一次配一批模型」的落点。
   *
   * 为什么要有它（而不是界面上循环调 upsertModel）：
   * 1. 一次编辑动辄几十个模型，N 次 HTTP + N 次读改写同一份配置，中途失败会留下**半个渠道**；
   * 2. 「取消勾选的模型要删掉」这件事必须和「新增/更新」在一次调用里做掉，
   *    否则用户取消勾选后旧模型还挂在那里 —— 表现就是「删不干净」。
   *
   * 口径：`removeMissing` 只删**该 provider 下**不在清单里的模型，别的渠道一个不碰。
   */
  async upsertModels(input: {
    provider: string
    modelIds: string[]
    apiKey?: string
    baseUrl?: string
    clientType?: string
    vision?: boolean
    /** 把哪个模型设为默认（通常给列表第一个；不传就不动默认） */
    makeDefault?: string
    /** 是否删掉该 provider 下没被勾选的旧模型（编辑已有渠道时传 true） */
    removeMissing?: boolean
  }): Promise<{ added: string[]; removed: string[] }> {
    // 整批一次持锁：中途让别的写插进来，就会出现「新增了一半」「删旧时又读到旧表」。
    return this.withConfigLock(() => this.writeModels(input))
  }

  /** upsertModels 的实现（调用方已持配置写锁） */
  private async writeModels(input: {
    provider: string
    modelIds: string[]
    apiKey?: string
    baseUrl?: string
    clientType?: string
    vision?: boolean
    makeDefault?: string
    removeMissing?: boolean
  }): Promise<{ added: string[]; removed: string[] }> {
    const provider = input.provider.trim()
    if (!provider) throw new Error('provider 不能为空')
    const modelIds = [...new Set(input.modelIds.map((m) => m.trim()).filter((m) => !!m))]
    if (!modelIds.length) throw new Error('至少勾选一个模型')
    if (input.baseUrl?.trim()) assertHttpUrl(input.baseUrl.trim())

    // 凭据与地址按**渠道**继承：同一 provider 的模型共享一套 key/baseUrl。
    // 不继承的话，「编辑时只补一个模型、密钥留空」会让新模型成为无密钥条目 ——
    // 实测那种模型不会出现在「已配置」列表里（界面上看起来像是没保存上）。
    const cfgBefore = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
    const sibling = cfgBefore.models.find((m) => m.provider === provider)
    const apiKey = input.apiKey?.trim() || sibling?.api_key
    const baseUrl = input.baseUrl?.trim() || sibling?.base_url
    const clientType = input.clientType?.trim() || sibling?.client_type

    for (const modelId of modelIds) {
      await this.writeModel({
        provider,
        modelId,
        ...(apiKey ? { apiKey } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(clientType ? { clientType } : {}),
        ...(typeof input.vision === 'boolean' ? { vision: input.vision } : {}),
      })
    }

    const removed: string[] = []
    if (input.removeMissing) {
      // 重新读（上面刚写进这批模型），按 provider 删掉没勾的
      const cfgAfter = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
      for (const m of cfgAfter.models) {
        if (m.provider !== provider) continue
        if (modelIds.includes(m.model_id)) continue
        await this.writeDeleteModel(provider, m.model_id)
        removed.push(m.model_id)
      }
    }

    if (input.makeDefault) {
      await setDefaultModel(this.sdkRoot, AGENT_PROJECT_ID, {
        provider,
        model_id: input.makeDefault,
      })
    }
    return { added: modelIds, removed }
  }

  async setDefaultModel(provider: string, modelId: string): Promise<void> {
    await this.withConfigLock(() =>
      setDefaultModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId }),
    )
  }

  async setVisionModel(provider: string, modelId: string): Promise<void> {
    await this.withConfigLock(() =>
      setVisionModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId }),
    )
  }

  /** 用哪个模型跑：没指定就用项目默认（会话创建时用） */
  /** 某个模型的上下文窗口（界面算「剩余百分比」用；查不到返回 undefined） */
  /**
   * 问上游要可用模型清单（OpenAI 兼容的 GET {baseUrl}/models）。
   *
   * 为什么值得单开一个口：用户手里是自建网关，模型 ID 有一串（deepseek-auto / hy3 / hy4-preview…），
   * 让他在界面上手打容易打错；直接列出来让他选才是「下拉菜单选择」。
   * 凭据用**已存的那个模型**的（密钥不出服务端）。
   */
  async upstreamModels(
    provider?: string,
    modelId?: string,
    inline?: { baseUrl?: string; apiKey?: string },
  ): Promise<{ ok: boolean; models: string[]; error?: string }> {
    // 表单里刚填的 baseUrl/密钥优先：这样「填完就能拉」——不必先保存一次才看得到模型清单。
    //
    // **两个字段各自独立回落**（这是关键）：编辑已有渠道时，表单里 baseUrl 有值、
    // 而密钥那一格显示的是掩码（调用方已滤掉）→ 若只在"baseUrl 也为空"时才去取已存凭据，
    // 就会出现「一个字段用了表单、另一个却是空」的组合，拿空密钥去认证 → 上游 401。
    const resolved = await this.resolveModel(provider, modelId)
    const inlineBase = (inline?.baseUrl ?? '').trim()
    const inlineKey = (inline?.apiKey ?? '').trim()
    const baseUrl = inlineBase || resolved.baseUrl || ''
    const apiKey = inlineKey || resolved.apiKey || ''
    if (!baseUrl) {
      return { ok: false, models: [], error: '先填 Base URL（例如 http://127.0.0.1:3000/v1）再拉取' }
    }
    const parsed = assertHttpUrl(baseUrl)
    const url = parsed.replace(/\/+$/, '') + '/models'
    try {
      const res = await fetch(url, {
        headers: apiKey ? { authorization: 'Bearer ' + apiKey } : {},
      })
      if (!res.ok) return { ok: false, models: [], error: '上游返回 ' + res.status + '：' + url }
      const body = (await res.json()) as { data?: Array<{ id?: unknown }> }
      const models = (body.data ?? [])
        .map((m) => (typeof m.id === 'string' ? m.id : ''))
        .filter((id) => !!id)
      return { ok: true, models }
    } catch (err) {
      return { ok: false, models: [], error: '拉取失败：' + (err instanceof Error ? err.message : String(err)) }
    }
  }

  async modelContextWindow(provider?: string, modelId?: string): Promise<number | undefined> {
    const cfg = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
    const ref = provider && modelId
      ? cfg.models.find((m) => m.provider === provider && m.model_id === modelId)
      : cfg.default_model
    if (!ref) return undefined
    const entry = cfg.models.find((m) => m.provider === ref.provider && m.model_id === ref.model_id)
    if (entry?.context_window && entry.context_window > 0) return entry.context_window
    // 没在配置里写就查内置目录（deepseek-auto 这类自建网关的模型不在目录里，返回 undefined）
    const fromCatalog = MODEL_CATALOG.find(
      (c) => c.provider === ref.provider && c.modelId === ref.model_id,
    )?.contextWindow
    if (fromCatalog && fromCatalog > 0) return fromCatalog
    // 两边都不知道：交回 undefined，由上层退回「压缩阈值」当分母（见 translate.ts）——
    // 「到 0% 正好触发压缩」这个含义对用户仍然成立，比不显示更有用。
    return undefined
  }

  /** 用哪个模型跑：没指定就用项目默认（会话创建时用） */
  async resolveModel(
    provider?: string,
    modelId?: string,
  ): Promise<{
    provider?: string
    modelId?: string
    configured: boolean
    apiKey?: string
    baseUrl?: string
    /**
     * AgentHub 的客户端协议（如 `deepseek-v4` / `openai-chat` / `ant-messages`）。
     *
     * 为什么必须回传：配置里存了它，而**构造模型对象时它是要的** ——
     * 模型名是"别名"时（如默认的 `deepseek-auto`）SDK 猜不出来，会直接抛
     * "xxx is not supported. Supported client types: …"（2026-10-13 真机踩到：
     * 单轮对话第一次调用就 500）。所以只要配置里有，就一路带下去。
     */
    clientType?: string
    /** 模型的上下文窗口（配置里有就带，SDK 用它夹输出上限） */
    contextWindow?: number
  }> {
    const cfg = await loadProjectConfig(this.sdkRoot, AGENT_PROJECT_ID)
    // 解析口径（顺序很重要）：
    //   有 provider + modelId → 精确那一条；
    //   只有 provider（表单里填了渠道、还没选具体模型）→ 该渠道下的任意一条；
    //   什么都没有 → 项目默认模型。
    //
    // 中间那一档是必须的：此前会直接掉到 default_model，于是给 A 渠道拉模型时凭据可能来自
    // B 渠道的默认模型 —— 用户给 A 配的密钥被静默忽略（表现就是 401）。
    const ref = provider && modelId
      ? cfg.models.find((m) => m.provider === provider && m.model_id === modelId)
      : provider
        ? cfg.models.find((m) => m.provider === provider)
        : cfg.default_model
    if (!ref) return { configured: false }
    const entry = cfg.models.find((m) => m.provider === ref.provider && m.model_id === ref.model_id)
    const env = resolveModelEnv(ref.model_id, entry?.client_type)
    const envKey = env?.envKey ? process.env[env.envKey] : undefined
    const apiKey = entry?.api_key || envKey
    const baseUrl = entry?.base_url || (env?.envBaseUrlKey ? process.env[env.envBaseUrlKey] : undefined)
    return {
      provider: ref.provider,
      modelId: ref.model_id,
      configured: !!apiKey,
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      // 协议与窗口一并带出去：构造模型对象时**必须有**（别名模型猜不出协议，见上面注释）
      ...(entry?.client_type ? { clientType: entry.client_type } : {}),
      ...(entry?.context_window ? { contextWindow: entry.context_window } : {}),
    }
  }

  // -------------------------------------------------- 会话标题模型（自动命名用）

  /** 读「生成标题用哪个模型」的配置（没配 = 用会话默认模型） */
  async titleModel(): Promise<{ provider?: string; modelId?: string }> {
    const stored = await this.promptKv.get<{ provider?: string; modelId?: string }>(
      AGENT_PROMPTS_KV_TYPE,
      AGENT_TITLE_MODEL_KEY,
    )
    return {
      ...(typeof stored?.provider === 'string' && stored.provider ? { provider: stored.provider } : {}),
      ...(typeof stored?.modelId === 'string' && stored.modelId ? { modelId: stored.modelId } : {}),
    }
  }

  /** 写「生成标题用哪个模型」的配置（provider/modelId 都空 = 清掉，回落会话默认模型） */
  async setTitleModel(provider: string | undefined, modelId: string | undefined): Promise<{
    provider?: string
    modelId?: string
  }> {
    const p = provider?.trim()
    const m = modelId?.trim()
    // 给了就先自证能用（凭据解析得出）—— 坏配置宁可存不进去，也不能让自动命名静默坏掉
    if (p && m) {
      const resolved = await this.resolveModel(p, m)
      if (!resolved.configured) {
        throw new Error('该模型没有可用凭据（先在「Provider」页配好密钥，或换一个模型）')
      }
    }
    const value = { ...(p ? { provider: p } : {}), ...(m ? { modelId: m } : {}) }
    await this.promptKv.set(AGENT_PROMPTS_KV_TYPE, AGENT_TITLE_MODEL_KEY, value)
    return value
  }

  /**
   * 用「标题模型」（没配则回落会话默认模型）给一段对话起名。
   *
   * 直接打上游的 chat/completions（一次小请求，非流式、max_tokens 很小），
   * 不经过 SDK 的会话——起名不该在会话里留下痕迹、也不该打扰正在跑的对话。
   * 凭据解析不出（没配密钥 / 地址坏）→ 返回 null，调用方保持现有的「首句截断」标题，不报错。
   */
  async generateSessionTitle(firstText: string): Promise<string | null> {
    const pref = await this.titleModel()
    const resolved = await this.resolveModel(pref.provider, pref.modelId)
    if (!resolved.configured || !resolved.baseUrl) return null
    let base: URL
    try {
      base = new URL(assertHttpUrl(resolved.baseUrl))
    } catch {
      return null
    }
    // 地址不带 /chat/completions 就补上（与 upstreamModels 拼 /models 同一套容错）
    const url = base.pathname.endsWith('/chat/completions')
      ? base
      : new URL(base.origin + base.pathname.replace(/\/+$/, '') + '/chat/completions')
    const prompt =
      '为下面的用户消息起一个不超过 12 个字的中文标题。只输出标题本身，不要标点、不要引号、不要解释。\n\n' +
      firstText.slice(0, 500)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(resolved.apiKey ? { authorization: 'Bearer ' + resolved.apiKey } : {}),
        },
        body: JSON.stringify({
          model: resolved.modelId,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 32,
          temperature: 0.3,
          stream: false,
        }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) return null
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
      }
      const raw = String(body.choices?.[0]?.message?.content ?? '').trim()
      // 清掉模型可能带的引号 / 前缀词，留纯标题；空结果按失败处理
      const title = raw.replace(/^["'“”「『]+|["'“”」』。.]+$/g, '').replace(/^(标题|title)[:：]\s*/i, '').trim()
      return title ? title.slice(0, 30) : null
    } catch {
      return null // 起名失败不打扰对话：保持首句截断的旧标题
    }
  }

  // -------------------------------------------------------------------- MCP

  async mcpServers(): Promise<AgentMcpView[]> {
    await this.ensureInit()
    // 自愈放在**读路径**上：清单缺了自带画布 MCP 就补回来（详见 healBuiltinCanvasMcp）。
    const cfg = await this.healBuiltinCanvasMcp(await loadSystemConfig(this.sdkRoot))
    const isBuiltin = (name: string): boolean => !!this.builtinCanvasUrl && name === this.BUILTIN_CANVAS_MCP
    const entries = cfg.tools?.mcpServers ?? []
    return entries.map((e) => {
      try {
        const resolved = resolveMCPServer(e as never)
        return {
          name: e.name,
          config: e.config as Record<string, unknown>,
          permission: resolved.permission ?? 'auto',
          ...(isBuiltin(e.name) ? { builtin: true } : {}),
        }
      } catch (err) {
        return {
          name: e.name,
          config: e.config as Record<string, unknown>,
          invalid: describe(err),
          ...(isBuiltin(e.name) ? { builtin: true } : {}),
        }
      }
    })
  }

  async addMcpServer(input: AddMcpInput): Promise<AgentMcpView[]> {
    await this.ensureInit()
    await this.withConfigLock(() => this.writeAddMcpServer(input))
    return this.mcpServers()
  }

  /** addMcpServer 的落盘部分（调用方已持配置写锁） */
  private async writeAddMcpServer(input: AddMcpInput): Promise<void> {
    const name = input.name.trim()
    // 名字只是标签，端点路径里的 $smart 照旧写在 url 里。SDK 只认这几个字符，
    // 所以在这里就拦住 —— 否则坏名字要到连接时才以「跳过」的形式暴露，用户看不到原因。
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('MCP 服务名只能包含字母、数字、下划线和短横线（名字只是标签，端点里的 $smart 写在 url 里）')
    const perm = input.permission ? { permission: input.permission } : {}
    let config: Record<string, unknown>
    if (input.kind === 'stdio') {
      const command = (input.command ?? '').trim()
      if (!command) throw new Error('stdio 类型必须填写 command')
      config = { command, args: input.args ?? [], ...perm }
    } else {
      const url = (input.url ?? '').trim()
      if (!url) throw new Error(input.kind + ' 类型必须填写 url')
      assertHttpUrl(url)
      config = { type: input.kind, url, ...perm }
    }
    const entry = { name, config }
    // 写之前先自证能解析：坏条目在被读到时只会静默跳过，用户当下看不到任何问题
    resolveMCPServer(entry as never)
    const cfg = await loadSystemConfig(this.sdkRoot)
    const existing = cfg.tools?.mcpServers ?? []
    const next = [...existing.filter((e) => e.name !== name), entry]
    await writeSystemConfig(this.sdkRoot, { ...cfg, tools: { ...(cfg.tools ?? {}), mcpServers: next } })
  }

  async removeMcpServer(name: string): Promise<AgentMcpView[]> {
    await this.ensureInit()
    await this.withConfigLock(() => this.writeRemoveMcpServer(name))
    return this.mcpServers()
  }

  /** removeMcpServer 的落盘部分（调用方已持配置写锁） */
  private async writeRemoveMcpServer(name: string): Promise<void> {
    // 自带画布 MCP **不许删**（用户口径 2026-10-05）：界面已经不给删除按钮，
    // 这里再拦一道 —— 界面是提示，接口才是真拦截（手搓一个请求也删不掉）。
    if (name === this.BUILTIN_CANVAS_MCP && this.builtinCanvasUrl) {
      throw new Error('「' + this.BUILTIN_CANVAS_MCP + '」是自带画布 MCP，不能删除')
    }
    const cfg = await loadSystemConfig(this.sdkRoot)
    const existing = cfg.tools?.mcpServers ?? []
    const next = existing.filter((e) => e.name !== name)
    if (next.length === existing.length) throw new Error('没有名为「' + name + '」的 MCP 服务')
    await writeSystemConfig(this.sdkRoot, { ...cfg, tools: { ...(cfg.tools ?? {}), mcpServers: next } })
  }

  /** 内置画布 MCP 的服务名（system_config.yaml 里的条目名） */
  readonly BUILTIN_CANVAS_MCP = 'canvas'

  /**
   * 自带画布 MCP 的端点地址；空串 = 这台服务**没启用**它（`builtinCanvasMcp: false`，测试用）。
   *
   * 为什么要记着：读清单时要靠它（a）判断哪条是自带件、给上 builtin 标记；
   * （b）在清单缺了它时补回来。关掉开关的实例不补、也不锁 —— 否则测试隔离就没法做了。
   */
  private builtinCanvasUrl = ''

  /**
   * 把**自身的画布 MCP** 写进 Agent 的 MCP 清单（默认携带，用户零配置）。
   *
   * 用户口径（2026-10-05）：这个画布 MCP 是随 Agent 内置的，用户不用在设置里添任何东西，
   * 开箱就能操作当前画布；@ 出来的节点也靠它去查。
   *
   * 幂等：只补 / 纠正名为 `canvas` 的那一条，不动用户自己配的（如 smart）。
   * URL 变了（换端口）也会更新。
   */
  async ensureBuiltinCanvasMcp(url: string): Promise<void> {
    await this.ensureInit()
    const trimmed = (url ?? '').trim()
    if (!trimmed) return
    this.builtinCanvasUrl = trimmed
    await this.withConfigLock(async () => {
      const cfg = await loadSystemConfig(this.sdkRoot)
      const existing = cfg.tools?.mcpServers ?? []
      const current = existing.find((e) => e.name === this.BUILTIN_CANVAS_MCP)
      if (current && (current.config as { url?: unknown }).url === trimmed && (current.config as { type?: unknown }).type === 'http') {
        return // 已经是它，别白写一次（写会触发 kv 变更广播）
      }
      const entry = { name: this.BUILTIN_CANVAS_MCP, config: { type: 'http' as const, url: trimmed } }
      resolveMCPServer(entry as never)
      const next = [...existing.filter((e) => e.name !== this.BUILTIN_CANVAS_MCP), entry]
      await writeSystemConfig(this.sdkRoot, { ...cfg, tools: { ...(cfg.tools ?? {}), mcpServers: next } })
    })
  }

  /**
   * 读清单时**顺带自愈**：缺了自带画布 MCP 就补回去，保证「每次工作时都有这个工具」。
   *
   * 为什么放在读路径：删它的路径不止一条 —— 磁盘被手改、老数据里从来没写过、
   * 或者别的工具重写了整份 system_config。只在启动时补一次挡不住这些；
   * 每次读清单都补，才是真正的「保证」。
   */
  private async healBuiltinCanvasMcp(cfg: SystemConfigLike): Promise<SystemConfigLike> {
    const url = this.builtinCanvasUrl
    if (!url) return cfg // 这台服务没启用自带件（测试隔离），不补也不锁
    const existing = cfg.tools?.mcpServers ?? []
    const current = existing.find((e) => e.name === this.BUILTIN_CANVAS_MCP)
    if (current && (current.config as { url?: unknown }).url === url) return cfg
    // 落盘要排队：这段是「读整份 → 改 → 写回」，与设置页保存并发时会把刚存的条目盖掉。
    // 排在队里之后**重新读一次**再改，用的就不是外面这份可能已过期的快照。
    return this.withConfigLock(async () => {
      const fresh = await loadSystemConfig(this.sdkRoot)
      const list = fresh.tools?.mcpServers ?? []
      const now = list.find((e) => e.name === this.BUILTIN_CANVAS_MCP)
      if (now && (now.config as { url?: unknown }).url === url) return fresh
      // 补这一条时保持**原有顺序**：已有就原地纠正地址，没有才追加在末尾
      const entry = { name: this.BUILTIN_CANVAS_MCP, config: { type: 'http' as const, url } }
      const next = now
        ? list.map((e) => (e.name === this.BUILTIN_CANVAS_MCP ? entry : e))
        : [...list, entry]
      const healed = { ...fresh, tools: { ...(fresh.tools ?? {}), mcpServers: next } }
      // 写回磁盘（幂等、尽力而为）：下次启动也在；写失败不拦读，仍把补好的这份返回给界面
      await writeSystemConfig(this.sdkRoot, healed).catch((err) =>
        console.warn('[agent] 自动补回画布 MCP 落盘失败：' + String(err)),
      )
      return healed
    })
  }

  /**
   * **主动**连一次 MCP 并列出可用工具（不必先发一句话）。
   *
   * 背景：SDK 的 MCP 连接是**懒加载**的 —— 第一次 listTools() / run() 才真去连，
   * 连完把每个服务的「连了几个工具」写成 mcp_connect_end 事件。所以此前面板上那句
   * 「已连接 MCP：smart(3 个工具)」只有发过消息才看得到，用户想看「现在到底连没连上、
   * 有哪些工具」就只能先发一句话 —— 既别扭又浪费一轮。
   *
   * 这里直接用 SDK 的 McpToolProvider 起一个**一次性探测**：连一次、列出工具、然后关掉。
   * 不复用会话里的那条连接（那样要碰会话生命周期，耦合重），代价是探测会新建一次连接 ——
   * 这是「主动检查」按钮，用户点一次连一次是合理的。
   */
  async probeMcp(names?: string[]): Promise<AgentMcpProbe> {
    await this.ensureInit()
    const entries = (await this.mcpServers()).filter((m) => !m.invalid)
    const wanted = names?.length ? entries.filter((e) => names.includes(e.name)) : entries
    if (!wanted.length) return { ok: true, servers: [], tools: [], warnings: [] }

    // 直接把落盘的条目喂给 SDK 的 provider —— 它内部用同一套 resolveMCPServer 解析，
    // 传输类型（stdio/http/sse）、默认超时、权限档都是 SDK 的契约，抄一份必然漂移。
    const warnings: string[] = []
    const provider = new McpToolProvider(wanted.map((e) => ({ name: e.name, config: e.config })) as never, {
      // stdio 类服务的工作目录：给个稳定且存在的目录，避免它落在进程 cwd 上
      workspaceDir: this.sdkRoot,
      warn: (m: string) => warnings.push(String(m)),
    })
    try {
      const defs = await provider.listTools()
      const servers = (provider.connectResults() ?? []).map((r) => ({
        name: String(r.server ?? ''),
        transport: String(r.transport ?? ''),
        status: String(r.status ?? ''),
        tools: Number(r.tools ?? 0),
        ...(r.error_message ? { error: String(r.error_message) } : {}),
        durationMs: Number(r.duration_ms ?? 0),
      }))
      // 工具名形如 `mcp__smart__canvas_get`；把服务名剥出来，界面按服务分组显示
      const tools = defs.map((d) => {
        const full = String(d.name ?? '')
        const rest = full.startsWith(MCP_TOOL_PREFIX) ? full.slice(MCP_TOOL_PREFIX.length) : full
        const sep = rest.indexOf('__')
        return {
          name: sep >= 0 ? rest.slice(sep + 2) : rest,
          server: sep >= 0 ? rest.slice(0, sep) : '',
          description: String((d as { description?: unknown }).description ?? ''),
          fullName: full,
        }
      })
      const failed = servers.filter((s) => s.status !== 'completed')
      return { ok: failed.length === 0, servers, tools, warnings }
    } finally {
      // 探测完立刻放掉连接：不该因为「点了一下检查」让子进程/连接一直挂着
      /**
       * 用 closeQuietly，不用 `provider.close()`：后者返回 Promise，这里不能 await
       * （探测结果已经拿到，收尾不该再拖住响应），于是它的失败没人接 —— 子进程已经在退出时
       * 关闭会 reject，在 Node 里就是一条 unhandled rejection（进程级告警，可能把后台带崩）。
       * closeQuietly 正是 SDK 为「同步收尾」准备的：吞掉错误、幂等。
       */
      try {
        provider.closeQuietly()
      } catch {
        /* 关不掉不是用户的问题 */
      }
    }
  }

  /** 一次装配会真正拿到哪些工具（界面显示 + 规则列表用） */
  async resolvedTools(): Promise<{ builtin: string[]; mcp: string[]; warnings: string[] }> {
    await this.ensureInit()
    const state = await loadAgentState({ agentId: AGENT_ID, projectId: AGENT_PROJECT_ID, root: this.sdkRoot })
    const toolConfig = buildToolConfig(state)
    const warnings: string[] = []
    const mcp: string[] = []
    for (const entry of toolConfig.mcpServers) {
      try {
        resolveMCPServer(entry)
        mcp.push(entry.name)
      } catch (err) {
        warnings.push(entry.name + ': ' + describe(err))
      }
    }
    return { builtin: toolConfig.customTools.map((t) => t.name), mcp, warnings }
  }
}

export { maskSecret, isSecretMask, assertHttpUrl, templateMissing } from './configTools.js'
export {
  AGENT_PROMPTS_KEY,
  AGENT_PROMPTS_KV_TYPE,
  AGENT_TITLE_MODEL_KEY,
  DEFAULT_PROMPTS,
} from './configTypes.js'
export type {
  AddMcpInput,
  AgentCatalogEntry,
  AgentMcpProbe,
  AgentMcpView,
  AgentModelView,
  AgentProviderView,
  AgentSkillCandidate,
  AgentSkillView,
  PromptPreset,
  UpsertModelInput,
} from './configTypes.js'
