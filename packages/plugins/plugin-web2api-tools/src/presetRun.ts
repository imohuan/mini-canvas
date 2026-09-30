/**
 * presetRun —— 跑一次预置动作（纯逻辑：只认下面这几个注入的依赖，零 ctx / 零 Vue，node 可单测）。
 *
 * 流程：
 * 1. 组参数 —— chat-auto 模式把媒体参数拼进 prompt 前缀（chatAutoPrompt.ts）；
 *    plain 模式直接当工具参数传（音频类工具的文本参数名是 text，不是 prompt）；
 * 2. 调 MCP 工具（deps.callTool）；
 * 3. 折响应（mcpParse.ts）：有资源 → 同步完成；只有 taskId → 返回**轮询函数**等异步任务。
 *
 * 为什么把"跑"与"接线"分开：底栏动作的 run/resume 是最值得单测的一段（分支多：
 * 同步/异步、成功/失败、任务终态、超时），但它只依赖"能调工具、能查任务、能睡、能读配置"
 * 几件事 —— 做成 RunDeps 注入，测试里给假货即可，不必起服务、不必起 Vue。
 */
import type { ToolOutcome, ToolPollFn, ToolPollState, ToolResult } from '@mini-canvas/kernel'
import { buildChatAutoPrompt } from './chatAutoPrompt'
import {
  isTaskDone,
  isTaskStalled,
  resultFromCall,
  urlsFromTask,
  type McpToolCallResult,
  type McpTaskDetail,
} from './mcpParse'
import type { Web2ApiPreset } from './presets'

/** 跑一次动作要用的外部能力（生产由 web2apiPlugin 注入真实现） */
export interface RunDeps {
  /** 调一个 MCP 工具（不传 cookieId —— 服务端按账号状态自动选号） */
  callTool(tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: McpToolCallResult; error?: string }>
  /** 查任务详情（system/get-task） */
  getTask(taskId: string): Promise<{ ok: boolean; data?: McpTaskDetail; error?: string }>
  /** 取消服务端任务（web2api 的 POST /api/tasks/:id/cancel） */
  cancelTask(taskId: string): Promise<{ ok: boolean; error?: string }>
  /** 服务端 origin（相对资源地址补全用） */
  origin(): string
  /** 轮询间隔与超时（读设置） */
  config(): { pollIntervalMs: number; timeoutMs: number }
  now(): number
  sleep(ms: number): Promise<void>
}

/** 一次动作调用的输入（底栏给的三样 + 预置声明） */
export interface RunInput {
  preset: Web2ApiPreset
  prompt: string
  values: Record<string, unknown>
  /** 上游图片素材（chat-auto 的 referenceImages） */
  referenceImages: string[]
}

/** 文本类工具的参数名（音频工具收 text；图像/视频收 prompt） */
function textKeyOf(tool: string): 'prompt' | 'text' {
  return tool === 'doubao/tts' || tool === 'volcengine/generate-audio' ? 'text' : 'prompt'
}

/** 只保留有值的参数（空串/undefined 不发给服务端，免得覆盖服务端默认） */
function cleanValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

/** 组一次工具调用的参数（导出以备单测直接核对参数名） */
export function buildToolArgs(input: RunInput): Record<string, unknown> {
  const { preset, prompt, values, referenceImages } = input
  if (preset.promptMode === 'chat-auto') {
    const args: Record<string, unknown> = {
      prompt: buildChatAutoPrompt(
        {
          mode: preset.mediaMode ?? (preset.nodeType === 'video' ? 'video' : 'image'),
          model: values.model,
          ratio: values.ratio,
          durationSec: values.durationSec,
          style: values.style,
        },
        prompt,
      ),
    }
    if (referenceImages.length > 0) args.referenceImages = referenceImages
    return args
  }
  // plain：参数直接传（文本参数名随平台而异）
  const args: Record<string, unknown> = { ...cleanValues(values) }
  args[textKeyOf(preset.tool)] = prompt
  if (referenceImages.length > 0) args.referenceImages = referenceImages
  return args
}

/** 单次任务查询 → 轮询状态（run 与 resume 共用同一份判定） */
export async function pollOnce(taskId: string, deps: RunDeps): Promise<ToolPollState> {
  const res = await deps.getTask(taskId)
  if (!res.ok) {
    // 查不到任务：不是终态，把原因报给用户但继续（服务重启后任务可能真没了 —— 超时兜底）
    return { status: 'running', message: res.error ?? '任务查询失败', taskId }
  }
  const detail = res.data
  const status = detail?.status
  // 暂停 / 轮询中断：任务既不前进也不结束，必须收敛成"停住了"，否则 UI 永远停在那个百分比
  if (isTaskStalled(status)) {
    const why = status === 'paused' ? '任务被暂停' : '轮询中断'
    return {
      status: 'done',
      result: { ok: false, error: (detail?.message || why) + '（可在 web2api 里恢复或重试）', taskId },
    }
  }
  if (status === 'failed') {
    return { status: 'done', result: { ok: false, error: detail?.message || '任务执行失败', taskId } }
  }
  if (status === 'cancelled') {
    return { status: 'done', result: { ok: false, error: detail?.message || '任务已取消', taskId } }
  }
  if (status === 'completed' || isTaskDone(status)) {
    const urls = urlsFromTask(detail, deps.origin())
    if (urls.length === 0) {
      return { status: 'done', result: { ok: false, error: '任务完成但没有产出资源', taskId } }
    }
    return { status: 'done', result: { ok: true, urls, taskId } }
  }
  return {
    status: 'running',
    message: detail?.message || '生成中…',
    progress: typeof detail?.progress === 'number' ? detail.progress : undefined,
    taskId,
  }
}

/**
 * 造一个"轮询到终态"的函数（run 与刷新续查走**同一份**实现，不各写一遍）。
 *
 * 超时由这里自己兜（读设置的 web2apiTimeoutMs）：底栏 taskRuntime 的默认超时是 5 分钟，
 * 对视频生成太短；但那是共享组件，本插件不为了自己改它的口径 —— 自己判超时后返回 done，
 * 效果一样且不影响别的插件。
 */
export function makeTaskPoll(taskId: string, deps: RunDeps, startedAt = deps.now()): ToolPollFn {
  return async (): Promise<ToolPollState> => {
    const { timeoutMs } = deps.config()
    if (deps.now() - startedAt > timeoutMs) {
      const minutes = Math.max(1, Math.round(timeoutMs / 60000))
      return { status: 'done', result: { ok: false, error: '任务超时（已等待 ' + minutes + ' 分钟）', taskId } }
    }
    return pollOnce(taskId, deps)
  }
}

/**
 * 跑一次动作。
 * @returns 同步结果（ToolResult），或异步任务的**轮询函数**（由底栏 taskRuntime 驱动）。
 */
export async function runPreset(
  input: RunInput,
  deps: RunDeps,
  runCtx?: { signal?: AbortSignal },
): Promise<ToolOutcome> {
  const args = buildToolArgs(input)
  const called = await deps.callTool(input.preset.tool, args)
  if (!called.ok) return { ok: false, error: called.error ?? 'web2api 调用失败' }

  const result: ToolResult = resultFromCall(called.data, deps.origin())
  // 异步任务：第一次只回 taskId、没有资源 → 交给轮询
  if (result.ok && !result.urls?.length && result.taskId) {
    const taskId = result.taskId
    const poll = makeTaskPoll(taskId, deps)
    return async (): Promise<ToolPollState> => {
      if (runCtx?.signal?.aborted) {
        return { status: 'done', result: { ok: false, error: '已取消', taskId } }
      }
      return poll()
    }
  }
  return result
}
