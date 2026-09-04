/**
 * 图片生成模型 —— Provider 对接层（前后端解耦）
 *
 * 设计目标：模型「能力元数据」与「执行 run」未来整体搬到后台。
 * 前端 UI（ImageBottomToolbar）只依赖本文件暴露的**统一函数接口**，
 * 完全不关心数据来自本地常量还是后台 HTTP/MCP。
 *
 * 切换方式：
 *   configureImageModels(backendProvider)   —— 一行切换到后台对接
 *
 * 默认实现 = 内置本地 provider（LOCAL_IMAGE_MODEL_PROVIDER）。
 * 后台就绪后，只需提供一个实现了 ImageModelProvider 接口的对象并调用
 * configureImageModels 注入即可，ImageBottomToolbar 无需任何改动。
 */

import type { SelectOption } from '../../components/Ui'

// ================= 共享类型 =================

/** 上游可接受的资源类型（对应 @ 引用与输入端口） */
export type GenerationInputType = 'image' | 'audio' | 'video'

export interface GenerationTemplate {
  id: string
  name: string
  prompt: string
  forModels?: string[]
}

export interface GenerationResource {
  id: string
  kind: GenerationInputType | 'text'
  name: string
  url?: string
  value?: string
}

export interface GenerationPayload {
  promptText: string
  promptDoc?: any
  resources: GenerationResource[]
  model: string
  ratio?: string
  resolution?: string
  template?: string
}

/** 单个模型的完整能力声明（本地与后台结构一致，可 JSON 序列化） */
export interface ImageModelCapability {
  /** 模型唯一 id（下拉 value，也是后台查找键） */
  model: string
  /** 下拉展示名 */
  label?: string
  /** 支持比例；undefined/空 = 不提供比例选择 */
  ratio?: string[]
  /** 支持分辨率；undefined/空 = 不提供分辨率选择 */
  resolution?: string[]
  /** 接受的资源输入类型；undefined/空 = 全接受 */
  supportsInput?: GenerationInputType[]
  /** 适用模板 id 列表（收窄用）；undefined/空 = 通用 */
  templates?: string[]
  description?: string
  /** [对接提示] 该模型对应的后台执行工具/平台标识（供 run 实现路由，非 UI 用） */
  mcpTool?: string
  /** [对接提示] 调用 mcpTool 时传入的模型名（后台工具要求原样字符串） */
  mcpModel?: string
}

/** 发送参数归一化对象（后端/本地 run 统一收到） */
export interface RunRequest {
  payload: GenerationPayload
  /** 后端可能需要额外身份/端点等字段时在实现内扩展 */
}

// ---------- run 运行契约 ----------

/**
 * 一次生成的终态结果（同步路径直接返回它）。
 * urls：产物地址（图片等）；ok=false 时带 error 说明。
 */
export type GenerationResult =
  | { ok: true; urls: string[]; taskId?: string }
  | { ok: false; error?: string }

/**
 * 轮询进度（异步路径：run 返回一个轮询函数，该函数每次被调用给出当前状态）。
 * - running：还在生成中，carry 可带上后台 taskId / 进度等；框架稍后再次调用轮询函数
 * - done：已出终态结果
 */
export type PollState =
  | { status: 'running'; taskId?: string; progress?: number; message?: string }
  | { status: 'done'; result: GenerationResult }

/**
 * 轮询函数：每调用一次返回最新 PollState。
 * 返回 'done' 即停止轮询；返回 'running' 框架按 interval 继续调用。
 */
export type PollFn = () => Promise<PollState> | PollState

/**
 * run 的返回契约：
 *   - 返回 GenerationResult（或 Promise 解析到它）        → 同步完成
 *   - 返回 PollFn                                        → 异步任务，交给框架轮询直到 done
 */
export type RunOutcome = GenerationResult | PollFn

/**
 * 运行中广播给 UI 的进度快照（executeRun 通过 onProgress 回调对外暴露）。
 * 对 UI 而言这是「运行态」的唯一接口 —— 无论进度来自后台轮询还是事件流，
 * UI 只据此渲染进度条与当前阶段文案，不改动即可对接第三方 API。
 *
 * - progress：0–100 的完成百分比。后台只给阶段（无精确百分比）时可省略，UI 回落为「进行中」动画。
 * - message：当前阶段的人类可读文案（如「提交任务」「采样中 45%」「合成画面」）。
 * - taskId：后台任务 id（如有），UI 可用它做取消/查询。
 */
export interface RunProgress {
  progress?: number
  message?: string
  taskId?: string
}

/**
 * 模型 Provider 抽象：前端唯一依赖的端口。
 * 本地实现与未来后台实现都实现此接口；切换 = 注入不同实现。
 */
export interface ImageModelProvider {
  /** 全部模型下拉选项（同步返回即可；异步场景可用静态快照 + listModelOptions 轮询） */
  listModelOptions(): SelectOption[]
  /** 按模型 id 取能力；查不到返回 undefined */
  getCapability(modelId: string | undefined): ImageModelCapability | undefined
  /** 该模型可用的模板 */
  listTemplates(modelId: string | undefined): GenerationTemplate[]
  /** 该模型是否接受某类资源输入 */
  acceptsInput(modelId: string | undefined, kind: GenerationInputType | 'text'): boolean
  /**
   * 执行一次生成（点击「发送」触发）。
   * 返回值遵循 RunOutcome 契约：
   *   - 返回/解析到 GenerationResult  → 同步完成
   *   - 返回 PollFn                  → 异步任务，交给 executeRun 轮询直到 done
   * 实现可返回 Promise 包装以上任意一种。
   *
   * ctx.nodeId：发起发送的图片节点 id（后台任务写回该节点的 data.runState 需要）。
   * 本地实现可忽略；后台实现用它 + 自身绑定的 canvasId 调后台任务。
   */
  run(payload: GenerationPayload, ctx?: { nodeId?: string }): RunOutcome | Promise<RunOutcome>
}

// ================= 本地默认 Provider =================

/**
 * 当前实际提供的 5 个图片生成模型（对接 MCP web2api 各平台）。
 *
 * model id → 真实来源：
 *   - apimart-gpt-image-2  → MCP `apimart/generate-image`（APIMart 的 GPT Image 2）
 *   - chatgpt-gpt-image-2  → MCP `chatgpt/generate-image`（ChatGPT 账号版 GPT Image 2）
 *   - doubao-seedream-*    → MCP `doubao`（Seedream 5.0 Lite / 4.5 / 4.0）
 *
 * ratio/resolution/supportsInput 与各平台 MCP 工具 schema 对齐；
 * 分辨率档位只有 APIMart 一家暴露（1k/2k/4k），其余模型不渲染分辨率下拉。
 */
const LOCAL_MODELS: ImageModelCapability[] = [
  {
    model: 'apimart-gpt-image-2',
    label: 'GPT Image 2（APIMart）',
    ratio: ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    resolution: ['1k', '2k', '4k'],
    supportsInput: ['image'],
    description: 'APIMart GPT Image 2，支持比例 + 分辨率档位，可带参考图',
    mcpTool: 'apimart/generate-image',
  },
  {
    model: 'chatgpt-gpt-image-2',
    label: 'GPT Image 2（ChatGPT）',
    ratio: ['1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: 'ChatGPT 账号版 GPT Image 2，无分辨率档位，可带参考图',
    mcpTool: 'chatgpt/generate-image',
  },
  {
    model: 'doubao-seedream-5lite',
    label: 'Seedream 5.0 Lite（豆包）',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 5.0 Lite，智能升级、细节丰富',
    mcpTool: 'doubao/generate-image-chat',
    mcpModel: 'Seedream 5.0 Lite',
  },
  {
    model: 'doubao-seedream-45',
    label: 'Seedream 4.5（豆包）',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 4.5，多图参考、人像自然',
    mcpTool: 'doubao/generate-image-chat',
    mcpModel: 'Seedream 4.5',
  },
  {
    model: 'doubao-seedream-40',
    label: 'Seedream 4.0（豆包）',
    ratio: ['auto', '1:1', '2:3', '3:4', '4:3', '9:16', '16:9'],
    supportsInput: ['image'],
    description: '豆包 Seedream 4.0，精准编辑、特征保持',
    mcpTool: 'doubao/generate-image-chat',
    mcpModel: 'Seedream 4.0',
  },
]

/** 全局共享模板集（4X：全局一套，可按模型收窄） */
const LOCAL_TEMPLATES: GenerationTemplate[] = [
  { id: 'clear', name: '通用·高清写实', prompt: '高清写实风格，主体突出，细节丰富，自然光照' },
  { id: 'blank', name: '留白极简', prompt: '极简留白构图，大面积纯色背景，主体居中' },
  { id: 'poster', name: '海报感', prompt: '电影海报构图，戏剧化光影，居中主体，两侧留白放文字' },
]

function findLocal(modelId: string | undefined): ImageModelCapability | undefined {
  return LOCAL_MODELS.find((m) => m.model === modelId)
}

function acceptsInputOf(cap: ImageModelCapability | undefined, kind: GenerationInputType | 'text'): boolean {
  if (!cap?.supportsInput || cap.supportsInput.length === 0) return true
  if (kind === 'text') return true // 文本始终可作 prompt 内容
  return cap.supportsInput.includes(kind as GenerationInputType)
}

// ================= 本地 Mock Provider =================

/**
 * 生成一张「模拟结果图」的数据 URL（canvas 渐变底 + 提示词片段），
 * 仅用于在真实生成后台接入前驱动 UI 的「成功态」测试，不会落盘。
 */
function mockResultDataUrl(prompt: string): string {
  try {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 320
    const ctx = c.getContext('2d')
    if (!ctx) return ''
    const g = ctx.createLinearGradient(0, 0, 320, 320)
    g.addColorStop(0, '#6d8cff')
    g.addColorStop(0.5, '#a78bfa')
    g.addColorStop(1, '#f472b6')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 320, 320)
    ctx.fillStyle = 'rgba(255,255,255,.92)'
    ctx.font = 'bold 15px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const label = (prompt || '模拟生成').slice(0, 26)
    ctx.fillText(label, 160, 150)
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,.75)'
    ctx.fillText('MOCK 生成图 · 待接入后台', 160, 176)
    return c.toDataURL('image/png')
  } catch {
    return ''
  }
}

/** Mock 生成的推进阶段（文案贴近真实采样流程，便于日后对照后台字段） */
const MOCK_STAGES: { progress: number; message: string }[] = [
  { progress: 8, message: '提交任务，等待排队…' },
  { progress: 22, message: '解析提示词与参考图…' },
  { progress: 38, message: '构图布局…' },
  { progress: 55, message: '细节采样中 55%…' },
  { progress: 74, message: '细节采样中 74%…' },
  { progress: 90, message: '后处理与画面合成…' },
]

/** Mock 出片前的模拟耗时（后台无真实任务时，让进度条能逐段推进） */
const MOCK_STEP_DELAY = 650

/**
 * 内置本地 Provider —— 目前是「模拟后台」占位实现：
 * run 返回一个 PollFn，逐段返回 running 进度，最后 done。
 * 这等价于未来第三方后台的异步形态（后台 run 也是返回 PollFn），
 * 因此 UI 不做任何改动即可无缝切换到真实 provider。
 *
 * 结果可控，便于人工验证 UI：
 *   - 提示词为空 或 包含「失败」→ 模拟异步失败（触发错误 notify 的 UI 路径）
 *   - 其余 → 模拟异步成功，返回一张 mock 生成图（data URL）
 */
export const LOCAL_IMAGE_MODEL_PROVIDER: ImageModelProvider = {
  listModelOptions: () => LOCAL_MODELS.map((m) => ({ label: m.label || m.model, value: m.model })),
  getCapability: (modelId) => findLocal(modelId),
  listTemplates: (modelId) =>
    LOCAL_TEMPLATES.filter(
      (t) => !t.forModels || t.forModels.length === 0 || (modelId && t.forModels.includes(modelId)),
    ),
  acceptsInput: (modelId, kind) => acceptsInputOf(findLocal(modelId), kind),
  run: (payload, _ctx) => {
    console.log('[model] 生成请求（本地 MOCK 模拟后台）', payload.model, payload.promptText)

    // 用提示词决定成败：便于通过真实 UI 触发「失败 notify」测试
    const trimmed = (payload.promptText || '').trim()
    const shouldFail = trimmed === '' || trimmed.includes('失败')

    // 失败时先走几步再报错，模拟真实任务中途出错
    const failStages: { progress: number; message: string }[] = [
      { progress: 10, message: '校验输入…' },
      { progress: 34, message: '加载生成模型…' },
    ]
    const stages = shouldFail ? failStages : MOCK_STAGES
    const taskId = shouldFail ? `mock-fail` : `mock-${Date.now().toString(36)}`
    let i = 0

    // 返回 PollFn（异步契约）——等价于后台返回的轮询函数：
    // 每次调用推进一段 running，段末补一个「真实处理耗时」；走完返回 done 终态。
    return async (): Promise<PollState> => {
      if (i < stages.length) {
        const s = stages[i]
        i += 1
        await new Promise((r) => setTimeout(r, MOCK_STEP_DELAY))
        return { status: 'running', progress: s.progress, message: s.message, taskId }
      }
      if (shouldFail) {
        return {
          status: 'done',
          result: {
            ok: false,
            error: trimmed === ''
              ? '提示词为空，无法生成画面'
              : '模拟后台生成失败（触发错误通知路径）',
          },
        }
      }
      const url = mockResultDataUrl(payload.promptText)
      return { status: 'done', result: { ok: true, urls: url ? [url] : [], taskId } }
    }
  },
}

// ================= Provider 单例 + 切换端口 =================

/** 当前生效的 provider（默认本地占位） */
let currentProvider: ImageModelProvider = LOCAL_IMAGE_MODEL_PROVIDER

/**
 * 【对接函数】一行切换到其它实现（如后台 HTTP/MCP Provider）。
 * 传 null/undefined 回落到内置本地 Provider。
 *
 * 后台接入示例：
 *   import { configureImageModels } from '.../imageModels'
 *   import { BackendImageModelProvider } from '.../backendImageModelProvider'
 *   configureImageModels(BackendImageModelProvider)
 */
export function configureImageModels(provider: ImageModelProvider | null | undefined): void {
  currentProvider = provider ?? LOCAL_IMAGE_MODEL_PROVIDER
}

/** 供需要读当前 provider 的调用方使用 */
export function getImageModelProvider(): ImageModelProvider {
  return currentProvider
}

// ================= UI 稳定函数接口 =================
// ImageBottomToolbar 只 import 以下函数，不直接触碰 provider 字段，
// 保证后台接入时工具栏零改动。

/** 全部模型下拉选项（随 provider 实时取） */
export function listModelOptions(): SelectOption[] {
  return currentProvider.listModelOptions()
}

/** 按 id 取模型能力 */
export function getModel(modelId: string | undefined): ImageModelCapability | undefined {
  return currentProvider.getCapability(modelId)
}

/** 该模型是否接受某类资源输入 */
export function modelAcceptsInput(cap: ImageModelCapability | undefined, kind: GenerationInputType | 'text'): boolean {
  return currentProvider.acceptsInput(cap?.model, kind)
}

/** 该模型可用模板 */
export function templatesForModel(modelId: string | undefined): GenerationTemplate[] {
  return currentProvider.listTemplates(modelId)
}

/**
 * 选项值 → 展示标签的映射（value 保持英文原值传给后台，仅 UI 显示中文）。
 * 比例与分辨率共用；特殊值可在此扩展。
 */
const VALUE_LABELS: Record<string, string> = {
  auto: '自动',
}

/** 单个比例/分辨率值 → 选项；无特殊映射时 label 用原值 */
function toSelect(v: string): SelectOption {
  return { label: VALUE_LABELS[v] ?? v, value: v }
}

/** 某模型能力 → 比例下拉选项 */
export function ratioOptions(cap: ImageModelCapability | undefined): SelectOption[] {
  return (cap?.ratio ?? []).map(toSelect)
}

/** 某模型能力 → 分辨率下拉选项 */
export function resolutionOptions(cap: ImageModelCapability | undefined): SelectOption[] {
  return (cap?.resolution ?? []).map(toSelect)
}

/**
 * executeRun —— 统一的生成驱动入口。
 *
 * 按 run 契约分派：
 *   1) 调用 provider.run(payload)，得到 RunOutcome；
 *   2) 若是 GenerationResult（同步）→ 直接作为终态返回；
 *   3) 若是 PollFn（异步）→ 驱动轮询：按 interval 反复调用轮询函数，
 *      直到返回 status='done'（此时携带终态结果）或触发 stop/超时。
 *
 * 异步期间，每拿到一个 status='running' 的进度都通过 onProgress 广播给 UI，
 * 让进度条/阶段文案实时刷新。UI 只依赖 onProgress 与终态结果，无需关心进度来源。
 *
 * @param payload    生成载荷
 * @param options    interval=轮询间隔 ms；timeoutMs=最大等待（超时按失败返回）；
 *                   onProgress=运行中进度回调（每个 running 态触发一次）
 */
export async function executeRun(
  payload: GenerationPayload,
  options: { interval?: number; timeoutMs?: number; onProgress?: (p: RunProgress) => void; nodeId?: string } = {},
): Promise<GenerationResult> {
  const { interval = 2000, timeoutMs = 300_000, onProgress, nodeId } = options
  const outcome = await currentProvider.run(payload, { nodeId })

  // 同步结果：直接返回
  if (typeof outcome !== 'function') return outcome

  // 异步：outcome 是轮询函数，驱动它直到 done
  const startedAt = Date.now()
  let last: PollState | undefined
  while (true) {
    last = await outcome()
    if (last.status === 'running') {
      // 把 running 态翻译成 UI 进度快照广播出去
      onProgress?.({
        progress: last.progress,
        message: last.message,
        taskId: last.taskId,
      })
      if (Date.now() - startedAt > timeoutMs) {
        console.error('[imageModels] 生成轮询超时', payload.model)
        return { ok: false, error: '生成轮询超时' }
      }
      await new Promise((r) => setTimeout(r, interval))
      continue
    }
    // done：返回终态结果
    return last.result
  }
}
