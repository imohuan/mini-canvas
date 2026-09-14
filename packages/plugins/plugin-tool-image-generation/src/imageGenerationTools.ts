/**
 * imageGenerationTools —— 把第三方图片生成后台包成**可注册的工具**（纯逻辑，零 Vue / 零 DOM）。
 *
 * 契约唯一来源：packages/kernel/src/toolRegistry.ts（ToolDef / ToolInput /
 * ToolResource / ToolParamDef / ToolResult / ToolProgress / ToolPollFn）。本文件只**消费**这些形状，
 * 不自创字段、不改名。
 *
 * 后台接口形状（来自 packages/mcp-server/src/http/CanvasHttpServer.ts）：
 *   POST /api/tasks          → { ok, taskId, status }
 *   GET  /api/tasks/:taskId  → { ok, task: { status, progress, message, result } }
 *   GET  /api/models         → { ok, models: [...] }
 *
 * 红线：**绝不做假图 mock**。v1 imageModels.ts 里的 mockResultDataUrl / MOCK_STAGES 不搬 ——
 * 拿不到真结果就返回明确错误，让 UI 显示失败，而不是给一张假图让人以为生成成功了。
 *
 * 依赖方向：只依赖内核的类型契约，不 import 宿主/demo/老版 src。
 */
import type { ToolDef, ToolInput, ToolParamDef, ToolPollFn, ToolPollState, ToolResource, ToolResult, ToolRunContext } from '@mini-canvas/kernel'
import {
  DEFAULT_BASE_URL,
  IMAGE_TEMPLATES,
  IMAGE_MODELS,
  valueLabel,
  type ImageModelCapability,
} from './imageModels'

/** 工具分组名（UI 据此归类；同一批生成工具共用一个分组） */
export const IMAGE_GENERATION_GROUP = '图片生成'
/** 工具名前缀：完整名 = image.generate:<modelId> */
export const TOOL_NAME_PREFIX = 'image.generate:'

/** 单次 HTTP 请求的超时（ms）。注意这与内核 invoke 的整体轮询超时是两回事。 */
export const DEFAULT_REQUEST_TIMEOUT = 30_000

/**
 * 最小 fetch 形状 —— 只用到 method/headers/body/signal 与 ok/status/json。
 * 刻意不写 `typeof fetch`：测试要能塞一个几十行的假 fetch，不必造整个 Response。
 * 真实 fetch 结构上满足本类型（参数更宽、返回更多字段），可直接传入。
 */
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

/** 最小响应形状（真实 Response 结构上满足） */
export interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

/** 工厂/注册的可选项 */
export interface ImageGenerationToolOptions {
  /** 后台根地址（默认 http://127.0.0.1:8765，与 mcp-server 本地端口一致） */
  baseUrl?: string
  /** 注入的 fetch 实现；不给则运行时取 globalThis.fetch（不绑死模块加载时刻） */
  fetchImpl?: FetchLike
  /** 单次 HTTP 请求超时 ms（默认 30s） */
  timeoutMs?: number
  /** 模型能力表；默认用内置 IMAGE_MODELS（registerFromBackend 用它传入后台声明的模型） */
  models?: ImageModelCapability[]
  /**
   * 注册时跳过"已存在同名工具"。默认 false（同名重复注册按内核契约抛错，暴露真冲突）。
   * 打开后用于"内置表已注册、再用后台表补齐"的场景：只补后台独有的新模型，不碰已有工具。
   */
  skipExisting?: boolean
}

/** 后台任务轮询返回里的 task 字段 */
interface BackendTask {
  id?: string
  status?: 'pending' | 'processing' | 'done' | 'error'
  progress?: number
  message?: string
  result?: { ok?: boolean; urls?: string[]; error?: string; taskId?: string }
  error?: string
}

/** 工具注册表的最小形状（ToolService 的子集；自建注册表/内核注册表都满足） */
export interface ToolRegistrarLike {
  register(def: ToolDef): unknown
  /** 可选：判断某工具名是否已注册（供 skipExisting 用；不给则不做跳过） */
  has?(name: string): boolean
}

/**
 * 能接收工具注册的宿主 —— 两种形态都收，便于"在别处单独注册"：
 * - 插件 scope 的 ctx（`{ tools: ToolService }`）：ctx.tools.register 自带 ctx.effect 回收；
 * - 裸工具注册表（ToolRegistry 实例本身）：回收由调用方用 register 的返回值负责。
 */
export type ToolRegistrationHost = { tools: ToolRegistrarLike } | ToolRegistrarLike

/** 从两种宿主形态里取出注册表 */
function registrarOf(host: ToolRegistrationHost): ToolRegistrarLike {
  const maybe = host as { tools?: ToolRegistrarLike }
  return maybe.tools && typeof maybe.tools.register === 'function' ? maybe.tools : (host as ToolRegistrarLike)
}

/** 工具名：image.generate:<modelId> */
export function buildToolName(modelId: string): string {
  return `${TOOL_NAME_PREFIX}${modelId}`
}

/**
 * 取 fetch：优先注入的实现；否则在**调用时**读 globalThis.fetch。
 * 不绑死模块加载时刻，Node 测试里塞假 fetch、浏览器里用真 fetch 都不必改代码。
 */
function resolveFetch(impl?: FetchLike): FetchLike | undefined {
  if (impl) return impl
  const g = globalThis as { fetch?: FetchLike }
  return typeof g.fetch === 'function' ? g.fetch : undefined
}

/**
 * 带超时的 fetch。超时用 AbortController 触发（而非依赖 AbortSignal.timeout 的可用性）。
 * 无论成功失败都清掉定时器，避免测试里留下悬挂 timer。
 */
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

/**
 * 资源归一：**图片给 url、文本给 value**（与后台 GenerationResource 的读取约定一致）。
 * 文本不带 url、图片不带 value，避免后台拿到空字符串混淆"没有"和"空内容"。
 */
export function toGenerationResources(resources?: ToolResource[]): Array<Record<string, unknown>> {
  return (resources ?? []).map((r) => {
    const base: Record<string, unknown> = { id: r.id, kind: r.kind }
    if (r.name !== undefined) base.name = r.name
    if (r.kind === 'text') base.value = r.value ?? ''
    else base.url = r.url ?? ''
    return base
  })
}

/** 从 input.params 里取一个字符串参数（非字符串/空串视为没给） */
function paramString(input: ToolInput, key: string): string | undefined {
  const v = input.params?.[key]
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** 由能力声明生成参数 schema：声明了 ratio/resolution 才给对应下拉，选项 label 映射成中文 */
function paramsOf(cap: ImageModelCapability): ToolParamDef[] {
  const params: ToolParamDef[] = []
  const ratio = cap.ratio ?? []
  if (ratio.length > 0) {
    params.push({
      key: 'ratio',
      label: '比例',
      type: 'select',
      options: ratio.map((v) => ({ label: valueLabel(v), value: v })),
      // 默认第一项：与内核 resolveToolParams 的回落口径一致（"不选"对多数 API 是非法输入）
      default: ratio[0],
      description: '生成图片的画幅比例（原值直接传给后台）。',
    })
  }
  const resolution = cap.resolution ?? []
  if (resolution.length > 0) {
    params.push({
      key: 'resolution',
      label: '分辨率',
      type: 'select',
      options: resolution.map((v) => ({ label: valueLabel(v), value: v })),
      default: resolution[0],
      description: '生成图片的分辨率档位（只有部分模型支持）。',
    })
  }
  return params
}

/**
 * accepts：该模型能吃的输入资源类型 + 'text'（文本始终能作 prompt）。
 * 去重保持顺序：text 在前，其后是模型声明支持的媒体类型。
 */
function acceptsOf(cap: ImageModelCapability): ToolDef['accepts'] {
  const kinds = ['text' as const, ...(cap.supportsInput ?? [])]
  return [...new Set(kinds)] as ToolDef['accepts']
}

/** 把后台返回的 task 映射成一轮轮询状态 */
function toPollState(task: BackendTask | undefined, taskId: string): ToolPollState {
  const status = task?.status
  if (status === 'error') {
    const error = task?.error || task?.message || task?.result?.error || '后台生成失败'
    return { status: 'done', result: { ok: false, error, taskId } }
  }
  if (status === 'done') {
    // 后台标记完成但结果自身是失败（result.ok === false）→ 仍按失败上报，不伪造 urls
    if (task?.result?.ok === false) {
      return { status: 'done', result: { ok: false, error: task.result.error || '后台生成失败', taskId } }
    }
    return { status: 'done', result: { ok: true, urls: task?.result?.urls ?? [], taskId } }
  }
  // pending / processing / 未知 → 继续等（未知按"还在跑"处理，比误判成失败安全）
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
  // 兼容后台直接返回 task / 包一层 { task } 两种形态（v1 也这么兜底过）
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
 * 建一个模型的生成工具。
 *
 * run 的形态：先 POST 提交任务，成功后**返回 ToolPollFn**（异步）；提交失败则直接返回
 * { ok:false, error }（同步失败）。内核 ToolRegistry.invoke 会替调用方驱动轮询到 done 并转发进度，
 * 所以节点 UI 只需处理一种返回形态。
 */
export function createImageGenerationTool(
  cap: ImageModelCapability,
  options: ImageGenerationToolOptions = {},
): ToolDef {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT
  const injectedFetch = options.fetchImpl

  return {
    name: buildToolName(cap.model),
    title: cap.label || cap.model,
    description: cap.description,
    group: IMAGE_GENERATION_GROUP,
    produces: 'image',
    accepts: acceptsOf(cap),
    params: paramsOf(cap),
    // 模板：工具的声明式数据（面板渲染"模板"下拉，选中即填进输入框），加模板不用改节点
    templates: IMAGE_TEMPLATES.map((t) => ({ ...t })),
    async run(input: ToolInput, runCtx: ToolRunContext): Promise<ToolResult | ToolPollFn> {
      const fetchImpl = resolveFetch(injectedFetch)
      if (!fetchImpl) {
        return { ok: false, error: '当前环境没有可用的 fetch，无法调用图片生成后台' }
      }

      const submitted = await submitTask(fetchImpl, baseUrl, timeoutMs, {
        kind: 'image',
        canvasId: runCtx.canvasId,
        targetNodeId: runCtx.nodeId,
        model: cap.model,
        promptText: input.prompt,
        ratio: paramString(input, 'ratio'),
        resolution: paramString(input, 'resolution'),
        resources: toGenerationResources(input.resources),
      })
      if (!submitted.ok) return { ok: false, error: submitted.error }

      const taskId = submitted.taskId
      // 轮询：任何查询层失败（HTTP 非 200 / 后台 !ok / 网络异常 / 超时）都收敛成终态失败，
      // 不返回 running —— 否则内核会一直转到它的整体超时，用户只能干等。
      const poll: ToolPollFn = async () => {
        const res = await queryTask(fetchImpl, baseUrl, timeoutMs, taskId)
        if (!res.ok) return { status: 'done', result: { ok: false, error: res.error, taskId } }
        return toPollState(res.task, taskId)
      }
      return poll
    },
  }
}

/**
 * 建一批生成工具（默认 = 内置 5 个模型）。这是"在别处单独注册复用"的入口：
 * 拿到 ToolDef[] 后可注册进任意符合 ToolService 契约的注册表。
 */
export function createImageGenerationTools(options: ImageGenerationToolOptions = {}): ToolDef[] {
  const models = options.models ?? IMAGE_MODELS
  return models.map((cap) => createImageGenerationTool(cap, options))
}

/**
 * 把生成工具注册进宿主（插件的 ctx，或任何带 tools.register 的对象）。
 *
 * 回收：ctx.tools.register 内部已用 ctx.effect 登记撤销（ToolRegistry.register 返回的 Disposable
 * 只在"仍是自己"时才删），插件卸载后工具自动消失，故此处**不再重复登记回收**——
 * 重复登记会在同名工具已被别的插件顶替时误删他人的工具。传入裸注册表时，回收由调用方
 * 用自己的 Disposable 机制负责（register 的返回值已被丢弃，由调用方自行保管）。
 *
 * @returns 本次注册的 ToolDef[]（调用方可据此展示/再注册）
 */
export function registerImageGenerationTools(
  host: ToolRegistrationHost,
  options: ImageGenerationToolOptions = {},
): ToolDef[] {
  const tools = createImageGenerationTools(options)
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
 * GET {baseUrl}/api/models → { ok, models: [...] }；只注册 kind 为 image（或未声明 kind）的模型——
 * 视频/音频模型不该出现在"图片生成"工具里。
 */
export async function registerFromBackend(
  host: ToolRegistrationHost,
  options: ImageGenerationToolOptions = {},
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

  let data: { ok?: boolean; models?: Array<ImageModelCapability & { kind?: string }>; error?: string }
  try {
    data = (await res.json()) as typeof data
  } catch {
    return { ok: false, error: '读取后台模型列表失败：后台返回的不是合法 JSON' }
  }
  if (!data?.ok) return { ok: false, error: data?.error || '读取后台模型列表失败' }

  const models = (Array.isArray(data.models) ? data.models : []).filter(
    (m) => m && typeof m.model === 'string' && m.model && (m.kind === undefined || m.kind === 'image'),
  )
  if (models.length === 0) return { ok: false, error: '后台未声明任何图片生成模型' }

  const tools = registerImageGenerationTools(host, { ...options, models, skipExisting: true })
  return { ok: true, registered: tools.map((t) => t.name) }
}
