/**
 * uiOrigin —— 问后台要它自己的地址（**唯一的前后端接口**，纯逻辑，可注入 fetch 单测）。
 *
 * ## 为什么要这一步
 *
 * 节点里渲染的页面住在**不透明源**的 iframe 沙箱里（sandbox="allow-scripts"），
 * 它发出的请求全算跨源（Origin: null）。而它该连的地址**不是**前端自己的地址：
 *
 * - 生产形态：cloud-server 直接托管界面 → 同源，正好就是后台；
 * - dev：前端在 5288、后台在 8865 → 前端那个源经 vite 代理转发，跨源写请求的预检会被拦死
 *   （2026-10-12 实测：直连 8865 的 PUT 通、经代理的 PUT 失败）。
 *
 * 所以让**后台自报**：`GET {base}/api/node-ui/info` → `{ ok, origin }`。
 * 谁报的地址，就是页面该连的地址 —— 生产与 dev 两条路都成立，不用猜。
 *
 * ## 后台那半在哪
 *
 * 本包的 src/server.ts（打成 dist/server.js 丢进 cloud-server 的 server-plugins）。
 * 它只提供这一个查询接口；**生成交给 Agent**，后台不再自己调模型。
 */

/** 本模块用到的 fetch 最小形状（便于测试注入假货） */
export interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchResponseLike>

/** 取 fetch：优先注入的实现，否则**调用时**读 globalThis.fetch */
function resolveFetch(impl?: FetchLike): FetchLike | undefined {
  if (impl) return impl
  const g = globalThis as { fetch?: FetchLike }
  return typeof g.fetch === 'function' ? g.fetch : undefined
}

/**
 * 问后台它是谁。
 *
 * 拿不到就返回空串 —— 调用方回落「同源」，那是生产形态下本来正确的答案；
 * 纯前端（没有后台）时这里失败也不该报错，只是生成的页面没有接口可调。
 */
export async function fetchBackendOrigin(
  baseUrl?: string,
  deps: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<string> {
  const fetchImpl = resolveFetch(deps.fetchImpl)
  if (!fetchImpl) return ''
  const base = (baseUrl ?? '').replace(/\/+$/, '')
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined
  const timer = ctrl ? setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 5000) : undefined
  try {
    const res = await fetchImpl(base + '/api/node-ui/info', {
      method: 'GET',
      ...(ctrl ? { signal: ctrl.signal } : {}),
    })
    if (!res.ok) return ''
    const body = (await res.json()) as { origin?: unknown } | undefined
    return typeof body?.origin === 'string' ? body.origin : ''
  } catch {
    return ''
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

