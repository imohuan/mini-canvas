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
    name: '翻译',
    description: '把输入框内容翻译成英文（AI 结果直接替换正文）',
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M7 3v2c0 4-2 7-5 8"/><path d="M5 9c1 3 3 5 6 6"/><path d="M14 20l4-9 4 9"/><path d="M15.5 17h5"/></svg>',
    template: '将下面的内容翻译成地道的英文，只输出译文，不要任何解释或前后缀：\n\n{{prompt}}',
    enabled: true,
    builtin: true,
  },
  {
    id: 'optimize',
    name: '提示词优化',
    description: '用 AI 优化当前提示词的表达（结果直接替换正文）',
    icon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M17.8 6.2 19 5"/><path d="M12.2 6.2 11 5"/><path d="M3 21 12 12"/></svg>',
    template:
      '你是资深的 AI 提示词工程师。请优化下面的提示词：补全主体、风格、构图、光影等关键要素，保持原意，语言精炼。直接输出优化后的提示词，不要任何解释：\n\n{{prompt}}',
    enabled: true,
    builtin: true,
  },
]

/** KV 裸键（config 作用域；路径 = /api/kv/config/bottomBarAiActions） */
export const AI_ACTIONS_KV_KEY = 'bottomBarAiActions'

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
]

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
