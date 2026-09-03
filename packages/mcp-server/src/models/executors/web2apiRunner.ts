/**
 * Web2apiRunner —— 把一次生成请求转发给 web2api 生成后台。
 *
 * 实现 ModelRunner.run(payload) → RunOutcome：
 * - 找到模型对应的 mcpTool（如 doubao/generate-image-chat）+ mcpModel；
 * - callTool 提交生成，尽力取回 taskId；
 * - 返回 PollFn：每次调用 web2api get-task，running→running(带进度)，done→终态。
 *
 * 依赖 Web2apiClient 已配置（--web2api）；未配置时由上层提供明确错误 runner。
 */
import type { GenerationPayload, ModelRunner, PollFn, PollState, RunOutcome } from '../types'
import { getModelRegistry } from '../ModelRegistry'
import type { Web2apiClient } from '../../client/web2apiClient'

/** 把参考图/音频资源转成 web2api 能识别的 url 数组 */
function toRefUrls(payload: GenerationPayload): string[] {
  return (payload.resources ?? [])
    .filter((r) => r.kind === 'image' && r.url)
    .map((r) => r.url!) as string[]
}

export class Web2apiRunner implements ModelRunner {
  constructor(private client: Web2apiClient) {}

  async run(payload: GenerationPayload): Promise<RunOutcome> {
    const cap = getModelRegistry().getCapability(payload.model)
    const toolName = cap?.mcpTool
    if (!toolName) {
      return { ok: false, error: `[web2api] 模型 ${payload.model} 无对应 web2api 工具(mcpTool)` }
    }

    // 组装 web2api 工具入参（字段名以 web2api schema 为准；此处为通用映射，集中可改）
    const args: Record<string, unknown> = {
      prompt: payload.promptText,
    }
    if (payload.ratio) args.ratio = payload.ratio
    if (payload.resolution) args.resolution = payload.resolution
    if (cap?.mcpModel) args.model = cap.mcpModel
    // 部分平台 generate-image 用 model 名；chatgpt/apimart 用固定模型，无需传
    const refs = toRefUrls(payload)
    if (refs.length > 0) args.referenceImages = refs

    // 提交生成
    let taskId: string | null = null
    try {
      const text = await this.client.callTool(toolName, args)
      taskId = this.client.parseTaskId(text)
    } catch (err) {
      return { ok: false, error: `[web2api] 提交 ${toolName} 失败: ${(err as Error).message}` }
    }
    if (!taskId) {
      return { ok: false, error: `[web2api] ${toolName} 未返回可识别的 taskId（响应: 见日志）。需按 web2api schema 校准解析` }
    }

    // 返回 PollFn：每次查 web2api 任务状态
    const poll: PollFn = async (): Promise<PollState> => {
      let info
      try {
        info = await this.client.getTask(taskId!)
      } catch (err) {
        return { status: 'running', taskId, message: `查询进度失败: ${(err as Error).message}` }
      }
      if (info.done) {
        if (info.error) return { status: 'done', result: { ok: false, error: info.error } }
        const urls = extractUrls(info.resultText)
        return { status: 'done', result: { ok: true, urls, taskId } }
      }
      return { status: 'running', taskId, progress: info.progress, message: info.message }
    }
    return poll
  }
}

/** 从 get-task 结果文本里尽力抽取图片/视频 url（防御性） */
function extractUrls(text: string | undefined): string[] {
  if (!text) return []
  const found: string[] = []
  try {
    const j = JSON.parse(text)
    const candidates = j?.result ?? j?.data?.result ?? j?.urls ?? j
    // 数组
    if (Array.isArray(candidates)) {
      for (const item of candidates) {
        const u = typeof item === 'string' ? item : item?.url ?? item?.src
        if (typeof u === 'string' && /^https?:|^data:|^blob:/i.test(u)) found.push(u)
      }
    }
  } catch { /* 非 JSON 结果，跳过 URL 抽取 */ }
  if (found.length > 0) return [...new Set(found)]
  // 正则兜底抓 http(s) url
  const m = text.match(/https?:\/\/[^\s"'\\)\]]+/g)
  return m ? [...new Set(m)] : []
}
