/**
 * textGenerationTools —— 把文本生成后台包成**可注册的工具**（纯逻辑，零 Vue / 零 DOM）。
 *
 * 与图片侧（plugin-tool-image-generation）完全同构，差别只在产物类型：
 *   produces: 'text'，结果走 ToolResult.text（图片侧走 urls）。
 * 于是文本节点面板 ctx.tools.list({ produces: 'text' }) 就能拿到这批工具，
 * 而面板对"模型叫什么、有哪些参数"一无所知 —— 加模型只改本包或后台。
 *
 * 契约唯一来源：packages/kernel/src/toolRegistry.ts。
 * 本文件只**消费**这些形状，不自创字段、不改名。
 *
 * 后台接口形状（packages/mcp-server/src/http/CanvasHttpServer.ts）：
 *   POST /api/tasks          → { ok, taskId, status }
 *   GET  /api/tasks/:taskId  → { ok, task: { status, progress, message, result } }
 *   GET  /api/models         → { ok, models: [...] }
 *
 * 红线：**绝不做假的文本 mock**。拿不到真结果就返回明确错误，让 UI 如实显示失败。
 */
import type { ToolDef, ToolInput, ToolPollFn, ToolPollState, ToolResource, ToolResult, ToolRunContext } from '@mini-canvas/kernel'
import { DEFAULT_BASE_URL, TEXT_MODELS, TEXT_TEMPLATES, paramsOf, type TextModelCapability } from './textModels'

/** 工具分组名（UI 据此归类） */
export const TEXT_GENERATION_GROUP = '文本生成'
/** 工具名前缀：完整名 = text.generate:<modelId> */
export const TOOL_NAME_PREFIX = 'text.generate:'
/** 单次 HTTP 请求超时（ms）；与内核 invoke 的整体轮询超时是两回事 */
export const DEFAULT_REQUEST_TIMEOUT = 30_000

/** 最小 fetch 形状（测试可塞几十行的假 fetch，不必造整个 Response） */
export interface FetchLike {
  (
    url: string,
    init?: {
      method?: string
      headers?: Record<string, string>
      body?: string
      signal?: AbortSignal
    },
  ): Promise<FetchResponseLike>
}

/** 响应最小形状 */
export interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

/** 后台任务记录（只取本文件用到的字段） */
interface BackendTask {
  status?: string
  progress?: number
  message?: string
  error?: string
  result?: { ok?: boolean; urls?: string[]; text?: string; error?: string }
}

/** 建工具的选项 */
export interface TextGenerationToolOptions {
  /** 后台根地址（默认本地 mcp-server） */
  baseUrl?: string
  /** 单次请求超时（ms） */
  timeoutMs?: number
  /** 注入的 fetch（默认读 globalThis.fetch；测试用假 fetch） */
  fetchImpl?: FetchLike
  /** 指定模型表（默认内置 TEXT_MODELS） */
  models?: TextModelCapability[]
  /** 注册时跳过已存在的同名工具（后台表与内置表合并时用） */
  skipExisting?: boolean
}

/** 能接收工具注册的宿主 —— 两种形态都收，便于"在别处单独注册" */
export type ToolRegistrationHost = { tools: ToolRegistrarLike } | ToolRegistrarLike

/** 注册表最小形状（与内核 ToolService 兼容） */
export interface ToolRegistrarLike {
  register(def: ToolDef): unknown
  has?(name: string): boolean
}

/** 从两种宿主形态里取出注册表 */
function registrarOf(host: ToolRegistrationHost): ToolRegistrarLike {
  const maybe = host as { tools?: ToolRegistrarLike }
  return maybe.tools && typeof maybe.tools.register === 'function' ? maybe.tools : (host as ToolRegistrarLike)
}

/** 工具名：text.generate:<modelId> */
export function buildToolName(modelId: string): string {
  return `${TOOL_NAME_PREFIX}${modelId}`
}

/** 取 fetch：优先注入的实现，否则**调用时**读 globalThis.fetch（测试/浏览器都不必改代码） */
function resolveFetch(impl?: FetchLike): FetchLike | undefined {
  if (impl) return impl
  const g = globalThis as { fetch?: FetchLike }
  return typeof g.fetch === 'function' ? g.fetch : undefined
}

/** 带超时的 fetch（用 AbortController 触发，不依赖 AbortSignal.timeout 的可用性） */
async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<FetchResponseLike> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined
  try {
    return await fetchImpl(url, { ...init, ...(ctrl ? { signal: ctrl.signal } : {}) })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 资源归一：图片/视频给 url、文本给 value（与后台读取约定一致） */
export function toGenerationResources(resources?: ToolResource[]): Array<Record<string, unknown>> {
  return (resources ?? []).map((r) => {
    const base: Record<string, unknown> = { id: r.id, kind: r.kind }
    if (r.name !== undefined) base.name = r.name
    if (r.kind === 'text') base.value = r.value ?? ''
    else base.url = r.url ?? ''
    return base
  })
}

/** 从 input.params 取一个字符串参数（非字符串/空串视为没给） */
function paramString(input: ToolInput, key: string): string | undefined {
  const v = input.params?.[key]
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** 该模型能接受哪些输入（文本恒可；supportsInput 是额外类型，如多模态读图） */
function acceptsOf(cap: TextModelCapability): ToolDef['accepts'] {
  return [...new Set(['text' as const, ...(cap.supportsInput ?? [])])] as ToolDef['accepts']
}

/**
 * 把后台 task 映射成一轮轮询状态。
 *
 * 文本产物从 task.result.text 取（图片是 urls）—— 两者都透传进 ToolResult，
 * 节点侧按 produces 决定读哪个字段。
 */
function toPollState(task: BackendTask | undefined, taskId: string): ToolPollState {
  const status = task?.status
  if (status === 'error') {
    const error = task?.error || task?.message || task?.result?.error || '后台生成失败'
    return { status: 'done', result: { ok: false, error, taskId } }
  }
  if (status === 'done') {
    if (task?.result?.ok === false) {
      return { status: 'done', result: { ok: false, error: task.result.error || '后台生成失败', taskId } }
    }
    const result: ToolResult = { ok: true, taskId }
    const text = task?.result?.text
    if (typeof text === 'string') result.text = text
    if (task?.result?.urls) result.urls = task.result.urls
    return { status: 'done', result }
  }
  // pending / processing / 未知 → 继续等（未知按"还在跑"处理，比误判失败安全）
  return {
    status: 'running',
    progress: task?.progress,
    message: task?.message || (status === 'pending' ? '任务排队中…' : '生成中…'),
    taskId,
  }
}

/** 提交任务：POST {baseUrl}/api/tasks */
async function submitTask(
  fetchImpl: FetchLike,
  baseUrl: string,
  timeoutMs: number,
  body: Record<string, unknown>,
): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  let res: FetchResponseLike
  try {
    res = await fetchWithTimeout(
      fetchImpl,
      `${baseUrl}/api/tasks`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      timeoutMs,
    )
  } catch (err) {
    return { ok: false, error: `提交生成任务失败：${describeFetchError(err, timeoutMs)}` }
  }
  if (!res.ok) return { ok: false, error: `提交生成任务失败：后台返回 HTTP ${res.status}` }

  let data: { ok?: boolean; taskId?: string; error?: string }
  try {
    data = (await res.json()) as typeof data
  } catch {
    return { ok: false, error: '提交生成任务失败：后台返回的不是合法 JSON' }
  }
  if (!data?.ok) return { ok: false, error: data?.error || '后台未接受生成任务' }
  if (!data.taskId) return { ok: false, error: '后台未返回任务 id（taskId）' }
  return { ok: true, taskId: data.taskId }
}

/** 查询任务：GET {baseUrl}/api/tasks/:taskId */
async function queryTask(
  fetchImpl: FetchLike,
  baseUrl: string,
  timeoutMs: number,
  taskId: string,
): Promise<{ ok: true; task: BackendTask | undefined } | { ok: false; error: string }> {
  let res: FetchResponseLike
  try {
    res = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/tasks/${encodeURIComponent(taskId)}`, {}, timeoutMs)
  } catch (err) {
    return { ok: false, error: `查询生成任务失败：${describeFetchError(err, timeoutMs)}` }
  }
  if (!res.ok) return { ok: false, error: `查询生成任务失败：后台返回 HTTP ${res.status}` }

  let data: { ok?: boolean; task?: BackendTask; error?: string }
  try {
    data = (await res.json()) as typeof data
  } catch {
    return { ok: false, error: '查询生成任务失败：后台返回的不是合法 JSON' }
  }
  if (!data?.ok) return { ok: false, error: data?.error || '查询生成任务失败' }
  // 兼容后台直接返回 task / 包一层 { task } 两种形态
  return { ok: true, task: data.task ?? (data as unknown as BackendTask) }
}

/** 把 fetch/超时异常翻成人能看懂的一句话（区分"超时"与"连不上"） */
function describeFetchError(err: unknown, timeoutMs: number): string {
  const name = (err as { name?: string } | undefined)?.name
  if (name === 'AbortError' || name === 'TimeoutError') return `请求超时（>${timeoutMs}ms）`
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return msg || '网络请求失败'
}

/**
 * 建一个文本模型的生成工具。
 *
 * run 形态与图片侧一致：先 POST 提交任务，成功则**返回 ToolPollFn**（异步），
 * 提交失败直接返回 { ok:false, error }（同步失败）。内核 invoke 负责驱动轮询与转发进度。
 */
export function createTextGenerationTool(
  cap: TextModelCapability,
  options: TextGenerationToolOptions = {},
): ToolDef {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT
  const injectedFetch = options.fetchImpl

  return {
    name: buildToolName(cap.model),
    title: cap.label || cap.model,
    description: cap.description,
    group: TEXT_GENERATION_GROUP,
    produces: 'text',
    accepts: acceptsOf(cap),
    params: paramsOf(cap),
    // 模板：工具的声明式数据（面板渲染"模板"下拉，选中即填进输入框）
    templates: TEXT_TEMPLATES.map((t) => ({ ...t })),
    async run(input: ToolInput, runCtx: ToolRunContext): Promise<ToolResult | ToolPollFn> {
      const fetchImpl = resolveFetch(injectedFetch)
      if (!fetchImpl) {
        return { ok: false, error: '当前环境没有可用的 fetch，无法调用文本生成后台' }
      }

      const submitted = await submitTask(fetchImpl, baseUrl, timeoutMs, {
        kind: 'text',
        canvasId: runCtx.canvasId,
        targetNodeId: runCtx.nodeId,
        model: cap.mcpModel || cap.model,
        promptText: input.prompt,
        thinking: paramString(input, 'thinking'),
        length: paramString(input, 'length'),
        resources: toGenerationResources(input.resources),
      })
      if (!submitted.ok) return { ok: false, error: submitted.error }

      const taskId = submitted.taskId
      // 轮询：查询层任何失败都收敛成终态失败，不返回 running ——
      // 否则内核会一直转到自己的整体超时，用户只能干等。
      const poll: ToolPollFn = async () => {
        const res = await queryTask(fetchImpl, baseUrl, timeoutMs, taskId)
        if (!res.ok) return { status: 'done', result: { ok: false, error: res.error, taskId } }
        return toPollState(res.task, taskId)
      }
      return poll
    },
  }
}

/** 建一批文本生成工具（默认 = 内置模型表）。这是"在别处单独注册复用"的入口。 */
export function createTextGenerationTools(options: TextGenerationToolOptions = {}): ToolDef[] {
  const models = options.models ?? TEXT_MODELS
  return models.map((cap) => createTextGenerationTool(cap, options))
}

/**
 * 把文本生成工具注册进宿主（插件的 ctx，或任何带 tools.register 的对象）。
 *
 * 回收交给内核：ctx.tools.register 内部已用 ctx.effect 登记撤销，插件卸载后工具自动消失，
 * 故此处**不再重复登记**（重复会在同名工具已被顶替时误删他人的工具）。
 */
export function registerTextGenerationTools(
  host: ToolRegistrationHost,
  options: TextGenerationToolOptions = {},
): ToolDef[] {
  const tools = createTextGenerationTools(options)
  const registrar = registrarOf(host)
  if (typeof registrar.register !== 'function') {
    throw new Error('[tools] 注册宿主无效：既不是插件 ctx，也不是带 register 的工具注册表')
  }
  const registered: ToolDef[] = []
  for (const def of tools) {
    if (options.skipExisting && registrar.has?.(def.name)) continue
    registrar.register(def)
    registered.push(def)
  }
  return registered
}

/** 从后台拉模型列表并注册的结果 */
export type RegisterFromBackendResult =
  | { ok: true; registered: string[] }
  | { ok: false; error: string }

/**
 * 拉后台声明的模型并注册（以后加模型只改后台，插件不用发版）。
 * 只注册 kind 为 text（或未声明 kind）的模型 —— 图片/视频模型不该出现在"文本生成"里。
 */
export async function registerFromBackend(
  host: ToolRegistrationHost,
  options: TextGenerationToolOptions = {},
): Promise<RegisterFromBackendResult> {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT
  const fetchImpl = resolveFetch(options.fetchImpl)
  if (!fetchImpl) return { ok: false, error: '当前环境没有可用的 fetch，无法读取后台模型列表' }

  let res: FetchResponseLike
  try {
    res = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/models`, {}, timeoutMs)
  } catch (err) {
    return { ok: false, error: `读取后台模型列表失败：${describeFetchError(err, timeoutMs)}` }
  }
  if (!res.ok) return { ok: false, error: `读取后台模型列表失败：后台返回 HTTP ${res.status}` }

  let data: { ok?: boolean; models?: Array<TextModelCapability & { kind?: string }>; error?: string }
  try {
    data = (await res.json()) as typeof data
  } catch {
    return { ok: false, error: '读取后台模型列表失败：后台返回的不是合法 JSON' }
  }
  if (!data?.ok) return { ok: false, error: data?.error || '读取后台模型列表失败' }

  const models = (Array.isArray(data.models) ? data.models : []).filter(
    (m) => m && typeof m.model === 'string' && m.model && (m.kind === undefined || m.kind === 'text'),
  )
  if (models.length === 0) return { ok: false, error: '后台未声明任何文本生成模型' }

  const tools = registerTextGenerationTools(host, { ...options, models, skipExisting: true })
  return { ok: true, registered: tools.map((t) => t.name) }
}
