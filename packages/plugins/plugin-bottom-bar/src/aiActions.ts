/**
 * aiActions —— 底栏「AI 按钮」的可配置动作与请求链路。
 *
 * 用户口径（2026-10-26，附截图）：
 * 1. 底栏右侧「翻译 / 提示词优化」按钮要**可配置**：每条 = 图标 + 描述 + 提示词模板；
 *    清单存云端 KV（config/bottomBarAiActions），配置界面挂设置面板「底栏」组
 *    （见 PromptActionSettings.vue：内容插槽 settingsGroup/底栏 优先于 schema 平铺字段）。
 * 2. 点按钮 → 请求后台 AI（POST /api/agent/chat/completion，**不带 model** = 直接用
 *    Agent 插件已配好的默认渠道/模型），流式返回**直接写进底栏输入框**。
 * 3. 提示词模板支持 {{变量}}：{{prompt}} 输入框当前内容、{{nodeType}} 节点类型、
 *    {{action}} 当前动作名、{{nodeId}} 节点 id。认得的替换，不认得的原样保留。
 * 4. 流式写入的历史**分批**落：每 500ms 一次（节拍在 NodeBottomBar 里，这里只管取流与清洗）。
 * 5. 流里「思考」内容要滤掉：think 标签段整块丢弃（跨帧也能接上），
 *    OpenAI 兼容的 delta.reasoning_content 增量一律忽略，只留正文。
 * 6. 失败重试：默认 3 轮（含第一次）；网络错 / 5xx / 429 退避重试，
 *    4xx 参数类错误一次判死（重试也不会成功）。
 */
import { withAdminToken } from '@mini-canvas/canvas-base'

/** 一条可配置的 AI 按钮 */
export interface AiActionConfig {
  /** 唯一 id（KV 里的键；同 id = 覆盖） */
  id: string
  /** 按钮名（aria-label 与配置列表用） */
  name: string
  /** 一句话说明（tooltip） */
  description?: string
  /** 图标（SVG 字符串；空 = 用默认星形 DEFAULT_AI_ICON） */
  icon?: string
  /** 提示词模板；支持 {{prompt}} 等变量（见 TEMPLATE_VARS） */
  template: string
  /** 关掉 = 底栏不渲染这颗按钮（缺省 true） */
  enabled: boolean
  /** 内置项标记（恢复默认用；不特殊对待删除） */
  builtin?: boolean
}

/** 默认图标：四角星 */
export const DEFAULT_AI_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>'

/** 内置默认的两条（截图里那对：文A = 翻译、魔棒 = 提示词优化） */
export const DEFAULT_AI_ACTIONS: readonly AiActionConfig[] = [
  {
    id: 'translate',
    name: '翻译成中文',
    description: '翻译成通顺的中文，顺手改掉错别字（AI 结果直接替换正文）',
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M7 3v2c0 4-2 7-5 8"/><path d="M5 9c1 3 3 5 6 6"/><path d="M14 20l4-9 4 9"/><path d="M15.5 17h5"/></svg>',
    // 用户口径 2026-10-27：默认翻成**中文**（不是英文），并且要「通顺」——
    // 原文里常有错别字、断句、同音字，一并按原意校正，不要逐字硬翻。
    template:
      '把下面的内容翻译成通顺自然的中文，只输出译文，不要任何解释或前后缀。\n' +
      '如果原文有错别字、同音字或明显笔误，按上下文意思改正后再翻译（保持原意，不要擅自增删信息）。\n\n' +
      '{{prompt}}',
    enabled: true,
    builtin: true,
  },
  {
    id: 'optimize',
    name: '提示词优化',
    description: '用 AI 优化当前提示词的表达（结果直接替换正文）',
    // 用户口径 2026-10-27：先修错别字/病句，再补细节；不要凭空编造主体或风格。
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M17.8 6.2 19 5"/><path d="M12.2 6.2 11 5"/><path d="M3 21 12 12"/></svg>',
    template:
      '你是资深的提示词编辑。请把下面这段提示词改得更清楚、更准确：\n' +
      '1. 先改正错别字、同音字、标点与不通顺的句子；\n' +
      '2. 再补齐原文已经暗示、但没写清的细节（主体、动作、风格、光线、构图等），保持原意，不要凭空编造新主体；\n' +
      '3. 语言精炼，去掉重复和口水话。\n' +
      '只输出改好的提示词本身，不要解释、不要加引号或前缀：\n\n{{prompt}}',
    enabled: true,
    builtin: true,
  },
]

/** KV 裸键（config 作用域；路径 = /api/kv/config/bottomBarAiActions） */
export const AI_ACTIONS_KV_KEY = 'bottomBarAiActions'

// ==================== 配置变更的**实时生效**事件 ====================

/**
 * 「底栏 AI 按钮清单保存成功」这条系统事件的名字与载荷（唯一一份）。
 *
 * 用户口径（2026-10-27）：「保存之后，它并没有实时生效，只有我重新触发这个下拉菜单，
 * 它才生效」。根因：设置页把清单写进云端 KV 后没人通知底栏 —— 底栏只在挂载时拉一次，
 * 挂着的底栏一直用旧清单，直到下次重挂载。
 *
 * 做法（与 agent:ref-click 同一条路）：设置页保存成功后 ctx.emit 广播；底栏组件
 * ctx.on 监听并立即重拉清单。两边互不 import 组件，只共享这个常量。
 *
 * 载荷：actions = 保存后的**完整清单**（底栏直接采用，省一次网络往返；
 * 同时保留 baseUrl 供多标签页场景自校 —— 别的标签页收到后自己重拉）。
 */
export const AI_ACTIONS_CHANGED_EVENT = 'bottom-bar:ai-actions-changed'

export interface AiActionsChangedPayload {
  /** 保存后的完整清单（监听方直接用它，不必再发一次 GET） */
  actions: AiActionConfig[]
  /** 本次保存用的后台地址（空 = 同源）；跨标签页的监听方据此自行重拉 */
  baseUrl?: string
}

// 模块加载时登记：dev 下 emit 未登记的事件名会 warn（每个名字只提示一次）。
registerEventName(AI_ACTIONS_CHANGED_EVENT)

/** 模板里认得的变量（设置页的提示 chips 也用这份） */
export const TEMPLATE_VARS: readonly { token: string; description: string }[] = [
  { token: '{{prompt}}', description: '输入框当前内容' },
  { token: '{{nodeType}}', description: '节点类型（image / text / video / audio）' },
  { token: '{{action}}', description: '当前选中的动作 / 模型名' },
  { token: '{{nodeId}}', description: '当前节点 id' },
]

/** 设置页的图标预设（自定义 = 任意外面没有的 svg 字符串） */
export const AI_ICON_PRESETS: readonly { key: string; label: string; svg: string }[] = [
  { key: 'translate', label: '翻译（文A）', svg: DEFAULT_AI_ACTIONS[0].icon! },
  { key: 'wand', label: '魔棒', svg: DEFAULT_AI_ACTIONS[1].icon! },
  { key: 'sparkle', label: '星星', svg: DEFAULT_AI_ICON },
  {
    key: 'chat',
    label: '对话气泡',
    svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  },
  { key: 'sparkles', label: '多颗星', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3l1.6 3.9L16.5 8.5l-3.9 1.6L11 14l-1.6-3.9L5.5 8.5l3.9-1.6z"/><path d="M18 14l.9 2.1 2.1.9-2.1.9L18 20l-.9-2.1-2.1-.9 2.1-.9z"/></svg>',
  },
  { key: 'pen', label: '笔', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  },
  { key: 'wandStars', label: '魔棒+星', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M17.8 6.2 19 5"/><path d="M12.2 6.2 11 5"/><path d="M3 21 12 12"/></svg>',
  },
  { key: 'check', label: '对勾', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  },
  { key: 'spellCheck', label: '拼写检查', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16l6-12 6 12"/><path d="M9 12h6"/><path d="M3 21l3-3 3 3"/><path d="M15 21l3-3 3 3"/></svg>',
  },
  { key: 'languages', label: '多语言', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>',
  },
  { key: 'text', label: '文字', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M12 20V4"/><path d="M8 20h8"/></svg>',
  },
  { key: 'quote', label: '引号', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h4v4a4 4 0 0 1-4 4z"/><path d="M14 7h4v4a4 4 0 0 1-4 4z"/></svg>',
  },
  { key: 'bolt', label: '闪电', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  },
  { key: 'lightbulb', label: '灯泡', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.7V17h5.2v-1.4c0-.7.3-1.3.9-1.7A6 6 0 0 0 12 3z"/></svg>',
  },
  { key: 'wandSparkles2', label: '星星笔', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l9-9"/><path d="M12.5 6.5 15 4l2.5 2.5L15 9z"/><path d="M18 12l1.2 2.8L22 16l-2.8 1.2L18 20l-1.2-2.8L14 16l2.8-1.2z"/></svg>',
  },
  { key: 'search', label: '放大镜', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  },
  { key: 'star', label: '五角星', svg:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6L3.2 9.5l6.1-.9z"/></svg>',
  },
]

// ==================== 后台地址：直接取 Agent 插件的配置 ====================

/**
 * AI 请求该打到哪个后台。
 *
 * 用户口径（2026-10-27）：「这边本身就是使用 Agent 之间配置的这个数据」——
 * 地址取 plugin-agent 的 `agentBaseUrl`（留空 = 与画布同源），渠道与模型也是 Agent 里
 * 配好的默认那条。底栏**不另存一份地址**：两份配置一定会漂移（改了 Agent、底栏还打旧端口），
 * 而且用户根本没必要在这里再填一次。
 *
 * 兜底顺序：settings.agentBaseUrl（Agent 的 Config 登记项）→ ctx.get('agent').state.baseUrl
 * （Agent 服务上那份运行时值）→ ''（同源）。
 */
export function resolveAgentBaseUrl(ctx: {
  tryGet<T>(name: string): T | undefined
}): string {
  const settings = ctx.tryGet<{ get(key: string): string | number | boolean }>('settings')
  const fromSettings = settings?.get('agentBaseUrl')
  if (typeof fromSettings === 'string' && fromSettings) return fromSettings.trim()
  const agent = ctx.tryGet<{ state?: { baseUrl?: string } }>('agent')
  const fromService = agent?.state?.baseUrl
  return typeof fromService === 'string' ? fromService.trim() : ''
}

/** 从 KV 原始值归一成可用清单：丢非法项；非数组（从未配置）→ 内置默认 */
export function normalizeAiActions(raw: unknown): AiActionConfig[] {
  if (!Array.isArray(raw)) return DEFAULT_AI_ACTIONS.map((a) => ({ ...a }))
  const out: AiActionConfig[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const template = typeof o.template === 'string' ? o.template : ''
    if (!id || !template.trim()) continue
    out.push({
      id,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : id,
      ...(typeof o.description === 'string' && o.description ? { description: o.description } : {}),
      ...(typeof o.icon === 'string' && o.icon ? { icon: o.icon } : {}),
      template,
      enabled: o.enabled !== false,
      ...(o.builtin === true ? { builtin: true } : {}),
    })
  }
  return out
}

const TEMPLATE_TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** 渲染模板：认得的 {{key}} 替换成 vars[key]；不认得的原样保留（让用户看见写错的变量名） */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return (template ?? '').replace(TEMPLATE_TOKEN_RE, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : whole,
  )
}

// ==================== 流式「思考」过滤 ====================

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

/** buf 结尾若是 tag 的前缀，返回那段尾巴长度（跨帧的半个标签先扣住，等下一帧拼齐） */
function partialTagSuffixLength(buf: string, tag: string): number {
  const max = Math.min(buf.length, tag.length - 1)
  for (let len = max; len > 0; len--) {
    if (buf.endsWith(tag.slice(0, len))) return len
  }
  return 0
}

/**
 * 流式文本过滤器：喂增量、吐**可见正文**。
 *
 * - think 标签段（含跨帧切开的半个标签）整块丢弃；
 * - 流结束（end()）时思考还没闭合 → 剩余全丢。
 */
export class StreamTextFilter {
  private buffer = ''
  private inThink = false

  /** 喂一段增量，返回本次可以输出的正文（可能为空串） */
  push(delta: string): string {
    this.buffer += delta
    let out = ''
    for (;;) {
      if (this.inThink) {
        const end = this.buffer.indexOf(THINK_CLOSE)
        if (end === -1) {
          const hold = partialTagSuffixLength(this.buffer, THINK_CLOSE)
          this.buffer = hold > 0 ? this.buffer.slice(this.buffer.length - hold) : ''
          return out
        }
        this.buffer = this.buffer.slice(end + THINK_CLOSE.length)
        this.inThink = false
        // 思考段后面通常跟一个换行：吃掉，正文别空一行开头
        this.buffer = this.buffer.replace(/^\r?\n/, '')
        continue
      }
      const start = this.buffer.indexOf(THINK_OPEN)
      if (start === -1) {
        const hold = partialTagSuffixLength(this.buffer, THINK_OPEN)
        const safe = hold > 0 ? this.buffer.slice(0, this.buffer.length - hold) : this.buffer
        out += safe
        this.buffer = this.buffer.slice(safe.length)
        return out
      }
      out += this.buffer.slice(0, start)
      this.buffer = this.buffer.slice(start + THINK_OPEN.length)
      this.inThink = true
    }
  }

  /** 流结束：冲掉残余（思考未闭合 → 全丢；否则吐出最后的正文尾巴） */
  end(): string {
    const rest = this.inThink ? '' : this.buffer
    this.buffer = ''
    return rest
  }
}

// ==================== 请求（流式 + 重试） ====================

export const DEFAULT_RETRY_ROUNDS = 3
const RETRY_BASE_MS = 400
const RETRY_MAX_MS = 4000

export interface AiRequestOptions {
  /** 提示词模板（含 {{变量}}） */
  template: string
  /** 模板变量 */
  vars: Record<string, string>
  /** 后台根地址（空 = 与画布同源，与 Agent 插件同一口径） */
  baseUrl?: string
  /** 重试轮数（含第一次；缺省 3） */
  retryRounds?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  /** 每段**过滤后**的正文增量（写入输入框用） */
  onDelta?: (delta: string) => void
  /** 退避等待（测试注入假时钟） */
  sleep?: (ms: number) => Promise<void>
}

export type AiRequestResult =
  | { ok: true; text: string; attempts: number }
  | { ok: false; error: string; attempts: number }

/** 服务端错误体 → 人话（chat/completion 的错误形状 { error: { message } }） */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } | string }
    if (typeof data.error === 'string') return data.error
    if (data.error?.message) return data.error.message
  } catch {
    /* 非 JSON 错误体：退回状态码 */
  }
  return '请求失败（HTTP ' + res.status + '）'
}

/** 消费一条 SSE 流（chat/completion 的 OpenAI chunk 形状），返回过滤后的全文或流级错误 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onDelta: ((delta: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const filter = new StreamTextFilter()
  let buffer = ''
  let full = ''
  let streamError = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') continue
      let parsed: {
        error?: { message?: string } | string
        choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>
      }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }
      if (parsed && parsed.error) {
        streamError = typeof parsed.error === 'string' ? parsed.error : parsed.error.message ?? 'AI 返回错误'
        continue
      }
      const delta = parsed?.choices?.[0]?.delta
      if (!delta) continue
      // 思考增量（OpenAI 兼容的 reasoning_content）：一律丢弃，只留正文
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) continue
      const piece = typeof delta.content === 'string' ? delta.content : ''
      if (!piece) continue
      const visible = filter.push(piece)
      if (visible) {
        full += visible
        onDelta?.(visible)
      }
    }
    if (signal?.aborted) break
  }
  const tail = filter.end()
  if (tail) {
    full += tail
    onDelta?.(tail)
  }
  if (streamError) return { ok: false, error: streamError }
  if (!full.trim()) return { ok: false, error: '模型没有返回内容' }
  return { ok: true, text: full }
}

/**
 * 请求一次 AI（流式 + 退避重试）。
 *
 * body 不带 model / provider → 后台 resolveModel 落到 Agent 插件配好的**项目默认模型**
 * （用户口径：渠道与模型直接用 Agent 里已配好的那套）。
 */
export async function requestAiText(opts: AiRequestOptions): Promise<AiRequestResult> {
  const rounds = Math.max(1, Math.floor(opts.retryRounds ?? DEFAULT_RETRY_ROUNDS))
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  if (!f) return { ok: false, error: '当前环境没有可用的 fetch', attempts: 0 }
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  const content = renderTemplate(opts.template, opts.vars)
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let lastError = ''
  let attempt = 0
  for (;;) {
    attempt += 1
    if (opts.signal?.aborted) return { ok: false, error: '已取消', attempts: attempt - 1 }
    try {
      const res = await f(base + '/api/agent/chat/completion', {
        method: 'POST',
        headers: withAdminToken({ 'content-type': 'application/json', accept: 'text/event-stream' }),
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content }] }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
      if (!res.ok) {
        lastError = await readErrorBody(res)
        // 4xx（参数/鉴权类）重试也不会成功，一次判死；5xx 与 429 才值得退避重试
        if (res.status < 500 && res.status !== 429) break
      } else if (res.body) {
        const r = await consumeStream(res.body, opts.onDelta, opts.signal)
        if (r.ok) return { ok: true, text: r.text, attempts: attempt }
        lastError = r.error
      } else {
        lastError = '响应没有内容'
      }
    } catch (err) {
      if (opts.signal?.aborted) return { ok: false, error: '已取消', attempts: attempt }
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt >= rounds) break
    await sleep(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1)))
  }
  return { ok: false, error: lastError || 'AI 请求失败', attempts: attempt }
}

// ==================== 配置清单的云端 KV 读写 ====================

const CONFIG_BUCKET_PATH = '/api/kv/config?values=1'
const ACTIONS_PATH = '/api/kv/config/' + AI_ACTIONS_KV_KEY

function cloneDefaults(): AiActionConfig[] {
  return DEFAULT_AI_ACTIONS.map((a) => ({ ...a }))
}

/** 读配置清单：KV 没存过（或后台没起）→ 内置默认；存过（哪怕空数组）→ 用户自己的清单 */
export async function loadAiActions(
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<AiActionConfig[]> {
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  if (!f) return cloneDefaults()
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  try {
    const res = await f(base + CONFIG_BUCKET_PATH, { headers: { accept: 'application/json' } })
    if (!res.ok) return cloneDefaults()
    const body = (await res.json()) as { values?: Record<string, unknown> } | null
    const raw = body?.values?.[AI_ACTIONS_KV_KEY]
    if (raw === undefined) return cloneDefaults()
    return normalizeAiActions(raw)
  } catch {
    return cloneDefaults()
  }
}

/** 整包写回配置清单（KV 的 value 契约 { value }） */
export async function saveAiActions(
  list: AiActionConfig[],
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; error?: string }> {
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  if (!f) return { ok: false, error: '当前环境没有可用的 fetch' }
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  try {
    const res = await f(base + ACTIONS_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: list }),
    })
    if (!res.ok) return { ok: false, error: await readErrorBody(res) }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
