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
import { promises as fs } from 'node:fs'
import path from 'node:path'
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
  systemConfigPath,
  agentStateDir as sdkAgentStateDir,
  skillsDir as sdkSkillsDir,
  agentsMdPath as sdkAgentsMdPath,
  installSkill,
  listInstalledSkills,
  parseSkillFrontmatter,
  removeSkill,
  McpToolProvider,
  MCP_TOOL_PREFIX,
} from '@prismshadow/penguin-core'
import { AGENT_ID, AGENT_PROJECT_ID, agentRoot, agentSkillSources } from './agentPaths.js'
import { KvStore } from '../store/kvStore.js'

/** 去重 + 保证内置项标记正确（写回前统一走一遍） */
function normalizePrompts(list: PromptPreset[]): PromptPreset[] {
  const builtinIds = new Set(DEFAULT_PROMPTS.map((p) => p.id))
  const seen = new Set<string>()
  const out: PromptPreset[] = []
  for (const p of list) {
    const id = String(p.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: String(p.name ?? '').trim() || id,
      text: String(p.text ?? ''),
      ...(builtinIds.has(id) ? { builtin: true } : {}),
    })
  }
  return out
}

export interface AgentProviderView {
  provider: string
  label: string
  known: boolean
  apiKeyUrl?: string
  gatewayBaseUrl?: string
}

export interface AgentModelView {
  provider: string
  modelId: string
  displayName?: string
  hasKey: boolean
  /**
   * 密钥的**掩码预览**（如 `sk-0…6390`）—— 明文永不回传（见类头「密钥只写不回读」）。
   *
   * 为什么要有它：编辑一个已配置的渠道时，界面上必须要看得出「这里已经有密钥了」，
   * 否则用户以为没存、重新拉取时又没带密钥 → 上游 401。
   */
  apiKeyMask?: string
  baseUrl?: string
  clientType?: string
  contextWindow?: number
  vision: boolean
  isDefault: boolean
  isVision: boolean
  envKeys: string[]
}

export interface AgentCatalogEntry {
  provider: string
  modelId: string
  displayName: string
  contextWindow?: number
  vision: boolean
  clientType?: string
  homepage?: string
}

export interface AgentMcpView {
  name: string
  config: Record<string, unknown>
  permission?: string
  invalid?: string
  /**
   * 是不是**随 Agent 自带的**服务（目前只有画布 MCP）。
   *
   * 界面据此不给删除按钮；服务端也拦同名删除请求（两道闸，缺一不可 ——
   * 界面是提示，接口才是真拦截）。
   */
  builtin?: boolean
}

/** 「主动检查 MCP」的返回：每个服务连没连上 + 真正拿到了哪些工具 */
export interface AgentMcpProbe {
  ok: boolean
  servers: Array<{ name: string; transport: string; status: string; tools: number; error?: string; durationMs: number }>
  tools: Array<{ name: string; server: string; description: string; fullName: string }>
  warnings: string[]
}

export interface AgentSkillView {
  name: string
  description: string
  size: number
  fileCount: number
  /** 技能目录的绝对路径（前端拿它拼 SKILL.md 路径，写进引用标记） */
  dir: string
}

export interface AgentSkillCandidate {
  name: string
  description: string
  dir: string
  source: string
  installed: boolean
}

export interface UpsertModelInput {
  provider: string
  modelId: string
  apiKey?: string
  baseUrl?: string
  clientType?: string
  contextWindow?: number
  vision?: boolean
  setDefault?: boolean
}

export interface AddMcpInput {
  name: string
  kind: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  permission?: 'auto' | 'r' | 'rw'
}

/** 一套「模式系统提示词」（全能创作 / 剧本创编 / 用户自建…） */
export interface PromptPreset {
  /** 稳定 id（内置的两条固定为 general / script） */
  id: string
  /** 展示名（下拉里显示的那个名字） */
  name: string
  /** 提示词正文 */
  text: string
  /** 内置项：不可删除（用户可以改名/改内容，但不能删掉这一条） */
  builtin?: boolean
}

/** KV 里存提示词清单的 key（type=config） */
export const AGENT_PROMPTS_KEY = 'agent-prompts'

/** 提示词清单住的 KV 作用域（与设置/快捷键同为 config，落在 settings.json） */
export const AGENT_PROMPTS_KV_TYPE = 'config'

/** 会话标题模型配置住的 KV key（type=config；值 { provider?, modelId? }，缺省 = 用会话默认模型） */
export const AGENT_TITLE_MODEL_KEY = 'agent-title-model'

/**
 * 两条内置提示词（用户提供的内容就落在这里）。
 * 它们是用户点名的两个模式，**不允许删除** —— 只允许改名与改正文。
 */
export const DEFAULT_PROMPTS: readonly PromptPreset[] = [
  {
    id: 'general',
    name: '全能创作',
    builtin: true,
    text:
      '# 角色\n你是画布里的创作助手，把用户的想法变成画布上的节点与内容。\n\n' +
      '# 铁律（先读再动手，且只动一张画布）\n' +
      '1. 动手前先读：用 canvas_overview 看画布规模；用户 @ 了节点就用 canvas_get 带 nodeId 查它（不要用本地文件去猜资源路径）。\n' +
      '2. **先确定画布 id**：用户 @ 了节点，画布 id 就是引用里 `画布id#节点id` 的前半段；否则用 canvas_list_canvases 问一次，或直接用用户的画布 id。**之后每一次读写都带上同一个 canvasId** —— 不带会写进 default，用户在自己的画布上什么都看不到。\n' +
      '3. **生成任务 = 在画布上建一个节点**：节点就是任务本体。不要只调 generation_create 去写一个不存在的节点，也不要自己上传产物再手动挂上去。\n\n' +
      '# 生成一个素材的正确流程（以图片为例）\n' +
      '1. 选动作：generation_actions 挑一个 actionId（图片 / 音频 / 视频）。\n' +
      '2. 有参考素材 → 用 canvas_add_media（url / path / dataUrl 均可，type 选 image/video/audio）把它作为对应类型的节点放进画布，拿到它的 nodeId。\n' +
      '3. 建目标节点：canvas_batch_nodes 加一个同类型节点（图片任务→image，视频→video，音频→audio），label 起个能看懂的名字，作者参数（比例等）写进 `barValues`。\n' +
      '4. 下单：generation_create 带上 canvasId、上一步的 nodeId、actionId、prompt、values。需要参考图就把参考图节点也一起在 prompt 里说明。\n' +
      '5. **产物由后台自己写回节点**（节点上的 runState / imageUrl / audioUrl / videoUrl）。不要自己下载产物、不要自己上传、不要用 exec_command 去搬运文件。\n' +
      '6. 收尾：把参考节点与生成节点用 canvas_batch_edges 连起来，再跟用户说一句「已在画布上生成」。\n\n' +
      '# 不要做的事\n' +
      '- 不要用 exec_command / Copy-Item / Invoke-WebRequest 去搬生成产物，那些是后台的活。\n' +
      '- 不要反复 Start-Sleep 等生成；下单后可以 generation_status 隔一会儿查一次，但别空转。\n' +
      '- 不确定「往哪张画布写」时，先 canvas_list_canvases，不要默认写 default。\n\n' +
      '# 说话方式\n用中文，简短直接，先给结果。',
  },
  {
    id: 'script',
    name: '剧本创编',
    builtin: true,
    text:
      '# 角色\n你是剧本编剧助手：**先把剧本写出来让用户确认，确认之后再生成画面/视频**。\n\n' +
      '# 工作方式\n' +
      '- 第一轮只出剧本（分镜 / 台词 / 场景），不要直接生成素材。\n' +
      '- 剧本要落到具体的镜头，一条一条列清楚。\n' +
      '- 等用户说「可以」之后再调用生成工具。\n\n' +
      '# 生成时的铁律（与「全能创作」一致）\n' +
      '- 生成任务 = **在画布上建一个节点**：先 canvas_add_media 放参考素材（有的话，type 选 image/video/audio），再 canvas_batch_nodes 建目标节点，最后 generation_create 下单（带 canvasId + nodeId + actionId）。\n' +
      '- 每次读写都带**用户那张画布的 canvasId**（引用里 `画布id#节点id` 的前半段），不要写进 default。\n' +
      '- 产物由后台自己写回节点；不要自己下载 / 上传 / 搬运文件。\n\n' +
      '# 说话方式\n用中文，简短直接。',
  },
]

export class AgentConfigService {
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

  /** Agent 的系统提示词（agent_state/AGENTS.md） */
  async systemPrompt(): Promise<string> {
    await this.ensureInit()
    try {
      return await fs.readFile(sdkAgentsMdPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID), 'utf8')
    } catch {
      return ''
    }
  }

  /** 写入系统提示词（空串也允许 —— 那就是「没有额外指令」） */
  async setSystemPrompt(text: string): Promise<void> {
    await this.ensureInit()
    const target = sdkAgentsMdPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text, 'utf8')
  }

  /**
   * 临场把 AGENTS.md 换成这段文本，返回**还原函数**（模式系统提示词用）。
   *
   * 为什么用这个手法（与 subsetMcp 同款）：SDK 只在**建会话时**读一次 AGENTS.md
   * 来组装系统提示词。所以「建会话前换成模式提示词、建完立刻还原」正好卡在那个点上 ——
   * 既让这一条会话用上模式提示词，又不永久改动 AGENTS.md（用户自己的系统提示词还在）。
   *
   * 还原失败不抛（宁可留下模式提示词，也不能让建会话这一步崩掉）。
   */
  async withSystemPrompt(text: string): Promise<() => Promise<void>> {
    await this.ensureInit()
    // 取互斥锁：一次只容一个「换 → 建会话 → 还原」走完（见 acquirePromptLock 的说明）。
    // 锁一直握到还原（返回的 restore 里释放），所以并发建会话不会互相覆盖 AGENTS.md。
    const release = await this.acquirePromptLock()
    const target = sdkAgentsMdPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
    const previous = await fs.readFile(target, 'utf8').catch(() => '')
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text, 'utf8')
    return async () => {
      try {
        await fs.writeFile(target, previous, 'utf8')
      } catch {
        /* 还原失败：保住眼下这条会话，别把错抛出去 */
      } finally {
        // 无论还原成败都要放锁，否则后面排队的建会话全卡死
        release()
      }
    }
  }

  private readonly skillSources: string[]
  /**
   * 首次初始化只做一次。
   *
   * 为什么必须串起来：设置页一次要读模型 / 技能 / MCP 三份，它们是并行的；
   * 而每份都会 loadAgentState({init:{}})，尚未初始化时三条并发初始化会抢着写同一批文件 ——
   * Windows 上表现为 rename EPERM（实测 `AGENTS.md` 撞车）。
   * 所以先 await 这一条，后续读一律不带 init（只读，不写）。
   */
  private initPromise?: Promise<void>

  /**
   * AGENTS.md 临时替换的**互斥锁**（一次只容一个「换 → 建会话 → 还原」走完）。
   *
   * 为什么必须有：`withSystemPrompt` 是「读旧值 → 写新值 → 建会话 → 还原旧值」，
   * 且**建会话在中间**（SDK 那时才读 AGENTS.md）。两个并发 createSession
   * （用户连点两次 / 两个画布同时开）会交错：A 读旧、B 读旧、A 写、B 写、A 还原、B 还原 ——
   * 最后谁写谁赢，可能把用户的系统提示词覆盖掉。
   * 锁要**一直握到还原**，所以不是简单的任务链，而是一个带排队的信号量。
   */
  private promptLock: Promise<void> = Promise.resolve()

  /** 排队取锁；返回释放函数 */
  private async acquirePromptLock(): Promise<() => void> {
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    const prior = this.promptLock
    this.promptLock = prior.then(() => mine)
    await prior
    return release
  }

  constructor(private readonly dataRoot: string, skillSources?: string[]) {
    this.skillSources = skillSources ?? agentSkillSources()
  }

  /**
   * 提示词清单的落点：与设置 / 快捷键同一条 KV（`{dataRoot}/settings.json` 的 `config` 桶）。
   *
   * 用户口径：提示词存在后台，用已有的 storeAdapter（KV）保存 —— 于是换台机器也在，
   * 且与「设置」这条已验证的链路同源，不必再开新存储。
   */
  private get promptKv(): KvStore {
    return new KvStore(this.dataRoot)
  }

  /**
   * 读提示词清单。**首次为空时落上两条内置**，之后永远以 KV 里的为准。
   *
   * 为什么首次要落盘（而不是「读不到就现返回默认」）：用户改了内置项的正文之后，
   * 「读不到就返回默认」会把他的修改一直盖掉 —— 只有真的存过一次，修改才留得住。
   */
  async prompts(): Promise<PromptPreset[]> {
    const stored = await this.promptKv.get<PromptPreset[]>(AGENT_PROMPTS_KV_TYPE, AGENT_PROMPTS_KEY)
    if (Array.isArray(stored) && stored.length) return normalizePrompts(stored)
    const seed = DEFAULT_PROMPTS.map((p) => ({ ...p }))
    await this.promptKv.set(AGENT_PROMPTS_KV_TYPE, AGENT_PROMPTS_KEY, seed)
    return seed
  }

  /**
   * 整包写回提示词清单。
   *
   * 校验两件事：
   * 1. **内置项不允许被删**：传来的清单里必须仍含两个内置 id，缺了就补回（以默认内容为底）；
   * 2. id 唯一、name 非空 —— 否则下拉里会出现两个同名项。
   */
  async savePrompts(list: unknown): Promise<PromptPreset[]> {
    const incoming = Array.isArray(list) ? (list as PromptPreset[]) : []
    const byId = new Map<string, PromptPreset>()
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') continue
      const id = String((raw as PromptPreset).id ?? '').trim()
      const name = String((raw as PromptPreset).name ?? '').trim()
      const text = String((raw as PromptPreset).text ?? '')
      if (!id || !name) continue
      byId.set(id, { id, name, text, ...(raw.builtin ? { builtin: true } : {}) })
    }
    // 内置项必须在：被删掉的补回来（正文用默认；用户改过的会以传入的为准）
    for (const d of DEFAULT_PROMPTS) {
      const cur = byId.get(d.id)
      if (!cur) byId.set(d.id, { ...d })
      else byId.set(d.id, { ...cur, builtin: true })
    }
    const next = normalizePrompts([...byId.values()])
    await this.promptKv.set(AGENT_PROMPTS_KV_TYPE, AGENT_PROMPTS_KEY, next)
    return next
  }

  /** SDK 的数据根（全局配置住它下面） */
  private get sdkRoot(): string {
    return agentRoot(this.dataRoot)
  }

  /** 数据根（fork 写 Trace 种子要按它推 Trace 目录；只给服务内部用） */
  get dataDir(): string {
    return this.dataRoot
  }

  /** 保证 Agent 已经初始化（幂等、串行），之后所有读都可以安全并行 */
  private ensureInit(): Promise<void> {
    this.initPromise ??= loadAgentState({
      agentId: AGENT_ID,
      projectId: AGENT_PROJECT_ID,
      root: this.sdkRoot,
      init: {},
    })
      .then(() => undefined)
      .catch((err) => {
        // 初始化失败不要把它钉死在这里：下次调用应当重试（用户可能刚修好权限）
        this.initPromise = undefined
        throw err
      })
    return this.initPromise
  }

  // ------------------------------------------------------------------ 模型

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
      await this.upsertModel({
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
        await removeModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: m.model_id })
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
    await setDefaultModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId })
  }

  async setVisionModel(provider: string, modelId: string): Promise<void> {
    await setVisionModel(this.sdkRoot, AGENT_PROJECT_ID, { provider, model_id: modelId })
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
    return this.mcpServers()
  }

  async removeMcpServer(name: string): Promise<AgentMcpView[]> {
    await this.ensureInit()
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
    return this.mcpServers()
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
    // 补这一条时保持**原有顺序**：已有就原地纠正地址，没有才追加在末尾
    const entry = { name: this.BUILTIN_CANVAS_MCP, config: { type: 'http' as const, url } }
    const next = current
      ? existing.map((e) => (e.name === this.BUILTIN_CANVAS_MCP ? entry : e))
      : [...existing, entry]
    const healed = { ...cfg, tools: { ...(cfg.tools ?? {}), mcpServers: next } }
    // 写回磁盘（幂等、尽力而为）：下次启动也在；写失败不拦读，仍把补好的这份返回给界面
    await writeSystemConfig(this.sdkRoot, healed).catch((err) =>
      console.warn('[agent] 自动补回画布 MCP 落盘失败：' + String(err)),
    )
    return healed
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
      try {
        provider.close()
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

  // ------------------------------------------------------------------- 技能

  async skills(): Promise<AgentSkillView[]> {
    await this.ensureInit()
    const installed = await listInstalledSkills(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
    const dir = sdkSkillsDir(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
    const out: AgentSkillView[] = []
    for (const s of installed) {
      let size = 0
      let fileCount = 0
      try {
        const files = await walk(path.join(dir, s.name))
        fileCount = files.length
        const md = files.find((f) => f.rel.toLowerCase() === 'skill.md')
        size = md ? (await fs.stat(md.abs)).size : 0
      } catch {
        /* 目录在列举与 stat 之间消失：按空处理 */
      }
      out.push({ name: s.name, description: s.description ?? '', size, fileCount, dir: path.join(dir, s.name) })
    }
    return out
  }

  async skillCandidates(): Promise<AgentSkillCandidate[]> {
    const installedNames = new Set((await this.skills()).map((s) => s.name))
    const found: AgentSkillCandidate[] = []
    for (const root of this.skillSources) {
      let entries
      try {
        entries = await fs.readdir(root, { withFileTypes: true })
      } catch {
        continue // 来源目录不存在不是错误
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue
        const dir = path.join(root, e.name)
        let md: string
        try {
          md = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')
        } catch {
          continue
        }
        const meta = parseSkillFrontmatter(md)
        const name = (meta?.name ?? e.name).trim()
        found.push({
          name,
          description: meta?.description ?? '',
          dir,
          source: root,
          installed: installedNames.has(name),
        })
      }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name))
  }

  async importSkill(dir: string): Promise<string> {
    const resolved = path.resolve(dir)
    // 只允许来源目录下的目录：UI 不该能让我们读任意路径
    const allowed = this.skillSources.some((root) => {
      const rel = path.relative(path.resolve(root), resolved)
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
    })
    if (!allowed) throw new Error('该目录不在已配置的技能来源中：' + dir)
    const files = await walk(resolved)
    const mdEntry = files.find((f) => f.rel.toLowerCase() === 'skill.md')
    if (!mdEntry) throw new Error('目录中没有 SKILL.md：' + dir)
    const content = await fs.readFile(mdEntry.abs, 'utf8')
    const meta = parseSkillFrontmatter(content)
    const name = (meta?.name ?? path.basename(resolved)).trim()
    const aux: Record<string, string> = {}
    for (const f of files) {
      if (f.rel.toLowerCase() === 'skill.md') continue
      aux[f.rel] = (await fs.readFile(f.abs)).toString('utf8')
    }
    await installSkill(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID, { name, content, files: aux })
    return name
  }

  async removeSkill(name: string): Promise<void> {
    await removeSkill(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID, name)
  }

  /** 读某个技能的 SKILL.md 全文（界面选了技能时要塞进 [use_skills] 块） */
  async readSkillFile(name: string): Promise<string | undefined> {
    try {
      const dir = sdkSkillsDir(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
      return await fs.readFile(path.join(dir, name, 'SKILL.md'), 'utf8')
    } catch {
      return undefined
    }
  }

  /**
   * 临时把 MCP 清单收窄成指定的几个，返回还原函数。
   *
   * SDK 在**会话第一次 run 时**才读 system_config.yaml 去连 MCP，所以
   * 「建会话之前换成子集、建完立刻还原」正好卡在这个点中间 —— 界面按对话选 MCP 就靠它。
   */
  async subsetMcp(names: string[]): Promise<() => Promise<void>> {
    await this.ensureInit()
    const cfg = await loadSystemConfig(this.sdkRoot)
    const all = cfg.tools?.mcpServers ?? []
    const kept = all.filter((e) => names.includes(e.name))
    await writeSystemConfig(this.sdkRoot, { ...cfg, tools: { ...(cfg.tools ?? {}), mcpServers: kept } })
    return async () => {
      await writeSystemConfig(this.sdkRoot, cfg)
    }
  }

  /** 设置页要显示这层数据落在哪（诊断用） */
  systemConfigPath(): string {
    return systemConfigPath(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
  }

  stateDir(): string {
    return sdkAgentStateDir(this.sdkRoot, AGENT_PROJECT_ID, AGENT_ID)
  }
}

/** base_url 必须是完整 http(s) 地址 */
/**
 * 密钥的**掩码预览**：保留前缀与末 4 位，中间一律打点。
 *
 * 目的只有一个：让界面能显示「这里已经有密钥了」。不追求任何可逆性 ——
 * 明文永不出服务端（见类头「密钥只写不回读」），这里给的也只是一块"有值"的证据。
 * 太短的密钥（< 9）整串打点，避免把短密钥本身漏出去。
 */
export function maskSecret(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (s.length < 9) return '••••••'
  return s.slice(0, 3) + '…' + s.slice(-4)
}

/**
 * 判断一个串是不是 maskSecret 产出的**掩码**（而不是用户真输的密钥）。
 *
 * 为什么需要它：界面会把已存密钥的掩码显示在输入框里，保存/拉取时又会把它原样回传。
 * 若不拦住，掩码会被当成新密钥写进配置 —— 该渠道立刻变成「用错误密钥认证」→ 上游 401；
 * 或者被拿去请求上游，同样 401。两种表现用户都只会看到「编辑一次就坏了」。
 */
export function isSecretMask(value: string): boolean {
  const v = (value ?? '').trim()
  if (!v) return false
  // maskSecret 只有两种形态：短密钥的整串圆点、长密钥的 `xxx…yyyy`
  return v === '••••••' || /^.{3}….{4}$/.test(v)
}

/** base_url 必须是完整 http(s) 地址 */
export function assertHttpUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('地址必须是完整地址（例如 http://127.0.0.1:3000/v1），当前填的是「' + raw + '」')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('地址只支持 http/https，当前是「' + parsed.protocol + '」')
  }
  return raw
}

/** 递归列目录（相对路径 + 绝对路径） */
async function walk(dir: string, prefix = ''): Promise<Array<{ abs: string; rel: string }>> {
  const out: Array<{ abs: string; rel: string }> = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const rel = prefix ? prefix + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...(await walk(abs, rel)))
    else if (e.isFile()) out.push({ abs, rel })
  }
  return out
}

interface SystemConfigLike {
  tools?: { mcpServers?: Array<{ name: string; config: Record<string, unknown> }> }
  [k: string]: unknown
}

/** 读 Agent 的 system_config.yaml（未初始化时带 init 建一份，避免首次进设置页就报错） */
async function loadSystemConfig(root: string): Promise<SystemConfigLike> {
  // 不带 init：初始化由 AgentConfigService.ensureInit 串行负责（并发初始化会撞车）
  const state = await loadAgentState({ agentId: AGENT_ID, projectId: AGENT_PROJECT_ID, root })
  return state.systemConfig as unknown as SystemConfigLike
}

/** 写回 system_config.yaml（SDK 无公开写入口，直接写 YAML；形状永远是 SDK 自己加载出来的那份） */
async function writeSystemConfig(root: string, cfg: unknown): Promise<void> {
  const yaml = await import('yaml')
  const target = systemConfigPath(root, AGENT_PROJECT_ID, AGENT_ID)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, yaml.stringify(cfg, { lineWidth: 0 }), 'utf8')
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
