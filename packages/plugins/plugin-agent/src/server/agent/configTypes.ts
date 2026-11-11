/**
 * Agent 配置面的公开视图、提示词常量与提示词归一化。
 *
 * 从 config.ts 原样搬出；这里只放数据形状与纯函数，不含服务逻辑。
 */

/** 去重 + 保证内置项标记正确（写回前统一走一遍） */
export function normalizePrompts(list: PromptPreset[]): PromptPreset[] {
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

/** 一次「模型连通性测试」的结果（真实发一条很小的对话请求） */
export interface AgentModelProbe {
  ok: boolean
  /** 实际成功的协议；全部失败时为空串 */
  clientType: string
  /** 依次试过哪些协议（自动检测时会有多条） */
  tried: Array<{ clientType: string; ok: boolean; durationMs: number; error?: string }>
  /** 成功那次的总耗时 */
  latencyMs: number
  /** 模型回了什么（截断到一小段，给用户做“确实通了”的证据） */
  reply?: string
  error?: string
  /** 结论来自非流式兜底（某些兼容网关流式缺 usage 字段） */
  fallback?: 'non-stream'
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
  /** 出厂默认的名字与正文（界面「恢复默认」用；内置项才有） */
  defaultName?: string
  defaultText?: string
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

