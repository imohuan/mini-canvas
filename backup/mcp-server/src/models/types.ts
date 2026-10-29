/**
 * 后台生成模型契约 —— 由前端 imageModels.ts 的纯数据/契约部分移植而来。
 *
 * 设计：模型"能力声明"与"执行 run"都在后台。
 * - ModelCapability 描述模型支持哪些配置（比例/分辨率/可带参考图），可 JSON 序列化；
 * - ModelRunner.run(req) 返回 RunOutcome：
 *     · 返回/解析到 GenerationResult → 同步完成；
 *     · 返回 PollFn → 异步任务，由 TaskManager 定时轮询直至 done。
 * 前端 UI（ImageBottomToolbar）与后台统一用这份契约；后台把结果经 SSE 广播。
 */

// ================= 共享类型 =================

/** 上游可接受的资源类型（对应 @ 引用与输入端口） */
export type GenerationInputType = 'image' | 'audio' | 'video'

export interface GenerationResource {
  id?: string
  kind: GenerationInputType | 'text'
  name?: string
  url?: string
  value?: string
}

/** 发送载荷（模型 + 比例/分辨率 + prompt + 参考图 url） */
export interface GenerationPayload {
  promptText: string
  promptDoc?: unknown
  resources: GenerationResource[]
  model: string
  ratio?: string
  resolution?: string
  template?: string
}

/** 单个模型的完整能力声明（结构同前端 imageModels.ImageModelCapability，可 JSON 序列化） */
export interface ImageModelCapability {
  /** 模型唯一 id（后台查找键，也是 AI 传 model 的值） */
  model: string
  label?: string
  /** 支持比例；undefined/空 = 不提供比例选择 */
  ratio?: string[]
  /** 支持分辨率；undefined/空 = 不提供分辨率选择 */
  resolution?: string[]
  /** 接受的资源输入类型；undefined/空 = 全接受 */
  supportsInput?: GenerationInputType[]
  description?: string
  /** 该模型对应的真实生成平台/工具标识（供 run 实现路由，非 UI 用） */
  mcpTool?: string
  /** 调用平台工具时传入的模型名（平台要求原样字符串） */
  mcpModel?: string
  /** 生成类型分组：image/video/audio */
  kind: 'image' | 'video' | 'audio'
  /** 该模型对应的 run 处理器 id（ModelRegistry 内查找） */
  runnerId?: string
}

// ---------- run 运行契约 ----------

/** 一次生成的终态结果（同步路径直接返回它） */
export type GenerationResult =
  | { ok: true; urls: string[]; taskId?: string }
  | { ok: false; error?: string }

/** 轮询进度（异步路径：run 返回一个轮询函数，每次调用给出当前状态） */
export type PollState =
  | { status: 'running'; taskId?: string; progress?: number; message?: string }
  | { status: 'done'; result: GenerationResult }

/** 轮询函数：每调用一次返回最新 PollState；返回 'done' 即停止 */
export type PollFn = () => Promise<PollState> | PollState

/** run 的返回契约：GenerationResult=同步；PollFn=异步（TaskManager 轮询） */
export type RunOutcome = GenerationResult | PollFn

/** 运行中广播给 UI 的进度快照（转成 data.runState 写回节点） */
export interface RunProgress {
  progress?: number
  message?: string
  taskId?: string
}

/** 单个模型 run 执行器（后台注册，含真实生成调用，如 web2api） */
export interface ModelRunner {
  run(payload: GenerationPayload): RunOutcome | Promise<RunOutcome>
}
