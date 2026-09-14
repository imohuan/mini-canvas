/**
 * 测试用假 fetch —— 本包的核心是"把 HTTP 后台包成工具"，所以测试必须能精确控制
 * 每一次请求的返回（状态码、JSON、抛错、超时），不能依赖真网络。
 *
 * 刻意做得极小：只实现本包用到的形状（url/method/body + ok/status/json），
 * 不引入任何测试库（本包 devDependencies 里没有 fetch-mock）。
 */
import type { FetchLike, FetchResponseLike } from '../imageGenerationTools'

/** 一次被记录下来的请求 */
export interface RecordedRequest {
  url: string
  method: string
  body: Record<string, unknown> | undefined
  headers: Record<string, string> | undefined
}

/** 一个"脚本化的响应"：直接给 JSON，或让 fetch 抛错 */
export type ScriptedResponse =
  | { kind: 'json'; body: unknown; status?: number }
  | { kind: 'throw'; error: Error }
  | { kind: 'invalidJson'; status?: number }

/** 造一个响应对象（真实 Response 的最小等价物） */
function makeResponse(script: ScriptedResponse): FetchResponseLike {
  // 只有 json/invalidJson 两种脚本带可选 status；throw 脚本走不到这里（由调用方直接抛）
  const status = script.kind === 'json' || script.kind === 'invalidJson' ? script.status ?? 200 : 200
  return {
    ok: status >= 200 && status < 300,
    status,
    async json(): Promise<unknown> {
      if (script.kind === 'invalidJson') throw new Error('Unexpected token in JSON')
      return script.kind === 'json' ? script.body : undefined
    },
  }
}

/**
 * 建一个按顺序放行的假 fetch。
 * @param scripts 依次消费的响应脚本；用完后抛错（防止测试里请求次数多于预期而被静默放过）
 */
export function createFakeFetch(scripts: ScriptedResponse[]): {
  fetchImpl: FetchLike
  requests: RecordedRequest[]
} {
  const requests: RecordedRequest[] = []
  let index = 0

  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
      headers: init?.headers,
    })
    const script = scripts[index]
    index += 1
    if (!script) throw new Error('假 fetch 的脚本已用完（本次请求超出预期）')
    if (script.kind === 'throw') throw script.error
    return makeResponse(script)
  }

  return { fetchImpl, requests }
}

/** 便捷：造一个"总是返回同一 JSON"的 fetch（用于只关心轮询结果的用例） */
export function alwaysJson(body: unknown, status = 200): ReturnType<typeof createFakeFetch> {
  const requests: RecordedRequest[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
      headers: init?.headers,
    })
    return makeResponse({ kind: 'json', body, status })
  }
  return { fetchImpl, requests }
}
