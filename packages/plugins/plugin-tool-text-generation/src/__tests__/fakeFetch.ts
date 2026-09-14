/**
 * 假 fetch —— 让工具逻辑（提交/轮询/错误收敛）全部能在 node 里测，不碰真网络。
 * 与图片侧同款：记录请求、按脚本依次返回响应。
 */
import type { FetchLike, FetchResponseLike } from '../textGenerationTools'

/** 一次脚本化响应：状态码 + JSON 体（或抛错） */
export interface ScriptedResponse {
  status?: number
  json?: unknown
  /** 设为 true 时本次调用抛错（模拟网络故障/超时） */
  throwError?: Error
}

/** 记录下来的请求 */
export interface RecordedRequest {
  url: string
  method: string
  body: Record<string, unknown> | null
}

/** 按脚本返回响应的假 fetch；脚本用尽后重复最后一条 */
export function createFakeFetch(
  script: ScriptedResponse[],
): { fetchImpl: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  let i = 0

  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    })
    const step = script[Math.min(i, script.length - 1)]
    i += 1
    if (step?.throwError) throw step.throwError
    const status = step?.status ?? 200
    const res: FetchResponseLike = {
      ok: status >= 200 && status < 300,
      status,
      json: async () => step?.json ?? {},
    }
    return res
  }
  return { fetchImpl, requests }
}

/** 恒返回同一 JSON 的假 fetch（单步场景用） */
export function alwaysJson(json: unknown, status = 200): { fetchImpl: FetchLike; requests: RecordedRequest[] } {
  return createFakeFetch([{ json, status }])
}
