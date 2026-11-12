/**
 * 请求来源边界：Host 白名单 + Origin 白名单 + Sec-Fetch-Site。
 *
 * 只作用于 /api/* 与 /mcp。OPTIONS 一律放行：预检不带令牌，也不带除 Origin
 * 以外的信任信息，拦住它会让所有带自定义头的跨源请求在预检阶段失败。
 */

export interface RequestTrustOptions {
  /** 如 ['127.0.0.1:8865', 'localhost:8865']，不带 scheme。 */
  trustedHosts: string[]
  /** 如 ['http://localhost:5288']，不带尾斜杠。 */
  trustedOrigins?: string[]
  /**
   * 只对**指定路径**放行的来源（精确前缀 → 允许的路径前缀）。
   *
   * 为什么需要它：独立调试源上跑的是**用户写的 HTML**。它能带短令牌把产物写回自己那个
   * 节点，但**不该**因此被当成可信来源 —— 否则它读 KV、整画布覆盖全都能做。
   * 所以它只出现在这条窄通道里，而不是 `trustedOrigins`。
   */
  scopedOrigins?: Array<{ origin: string; paths: string[] }>
  /**
   * 保留参数，默认 false。文档已实测：不透明源（Origin: null）永远报
   * cross-site，不存在 same-origin/none 的组合；打开它等于对任意网页开例外。
   */
  allowOpaqueOrigin?: boolean
  /**
   * 来源边界拒掉一个**写请求**时回调（宿主用它写审计）。
   *
   * 为什么在这里：这条中间件在令牌中间件之前就返回 403，后面的审计根本不会跑；
   * 而真实场景里最该留痕的恰好是这一类（恶意 Origin、伪造 Host、不透明源）。
   */
  onReject?: (input: {
    method: string
    path: string
    reason: string
    header: (n: string) => string | undefined
  }) => Promise<void>
}

/** 会被来源边界拦下的写方法（读请求被拒不记，免得刷屏） */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface TrustRequestLike {
  method: string
  path: string
  header(name: string): string | undefined
}

export type TrustResult = { ok: true } | { ok: false; reason: string }

function inScope(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp?')
}

export function checkRequestTrust(req: TrustRequestLike, opts: RequestTrustOptions): TrustResult {
  const method = req.method.toUpperCase()
  if (method === 'OPTIONS') return { ok: true }
  if (!inScope(req.path)) return { ok: true }

  // Host 头大小写不敏感（RFC 7230），这里统一小写再比：白名单里存的都是小写。
  const host = (req.header('host') ?? '').trim().toLowerCase()
  if (!host || !opts.trustedHosts.includes(host)) {
    return { ok: false, reason: 'host-not-trusted' }
  }

  const fetchSite = (req.header('sec-fetch-site') ?? '').trim().toLowerCase()
  if (fetchSite === 'cross-site') {
    return { ok: false, reason: 'cross-site' }
  }

  const rawOrigin = req.header('origin')
  if (rawOrigin !== undefined) {
    // Origin 的 **scheme 与 host 都大小写不敏感**（`HTTP://LOCALHOST:8865` 是合法的）。
    // 原来直接字符串比，反代 / 自定义客户端发大写就会被当成恶意来源拒掉。
    const origin = normalizeOrigin(rawOrigin)
    if (origin === 'null') {
      // 文档实测：不透明源只会是 cross-site，下面这条例外实际上不会命中。
      // 保留它只是为了让参数语义完整，默认关闭。
      if (!opts.allowOpaqueOrigin || (fetchSite !== 'same-origin' && fetchSite !== 'none')) {
        return { ok: false, reason: 'opaque-origin' }
      }
    } else if (origin !== 'http://' + host && origin !== 'https://' + host) {
      if (!(opts.trustedOrigins ?? []).map(normalizeOrigin).includes(origin)) {
        // 兜底：只在「这条来源 + 这个路径前缀」同时命中时才放行（调试页写产物那条窄通道）。
        const scoped = (opts.scopedOrigins ?? []).find((s) => normalizeOrigin(s.origin) === origin)
        if (!scoped || !scoped.paths.some((p) => matchPath(p, req.path))) {
          return { ok: false, reason: 'origin-not-trusted' }
        }
      }
    }
  }

  return { ok: true }
}

/**
 * 窄通道的路径匹配：`*` 匹配**一段**（不含 `/`），其余按字面比。
 *
 * 例：模式 `/api/canvases/<任意一段>/resources` 命中 `/api/canvases/c1/resources`，
 * 不命中 `/api/canvases/c1/nodes`，也不命中深一层的路径。
 */
export function matchPath(pattern: string, pathname: string): boolean {
  const pp = pattern.split('/')
  const sp = pathname.split('/')
  if (pp.length !== sp.length) return false
  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '*') {
      if (!sp[i]) return false
      continue
    }
    if (pp[i] !== sp[i]) return false
  }
  return true
}

/**
 * 把 Origin 归一成 `scheme://host[:port]`（scheme 与 host 小写、去掉尾斜杠）。
 *
 * 解析不了就原样返回（交给后面的白名单去拒）。`null` 原样返回 —— 它是特殊值，不是 URI。
 */
export function normalizeOriginEntry(raw: string): string {
  const s = raw.trim()
  if (s.toLowerCase() === 'null') return 'null'
  try {
    const u = new URL(s)
    return u.origin
  } catch {
    return s
  }
}

/** 同上的别名（内部调用点用这个名字读起来更顺） */
const normalizeOrigin = normalizeOriginEntry

export function createRequestTrust(
  opts: RequestTrustOptions,
): (c: any, next: () => Promise<void>) => Promise<unknown> {
  return async (c: any, next: () => Promise<void>): Promise<unknown> => {
    const req: TrustRequestLike = {
      method: c.req.method,
      path: c.req.path,
      header: (name: string) => c.req.header(name),
    }
    const verdict = checkRequestTrust(req, opts)
    if (!verdict.ok) {
      /*
       * 记一条审计：这条链在**令牌中间件之前**就断了，所以 ①.3 / ①.4 都不会跑。
       * 不记的话，「谁在尝试从网页里改我的画布」这个问题永远答不出来 ——
       * 而恰好这类请求（恶意 Origin / 伪造 Host / 不透明源）最该被记下来。
       * 只在写方法上记：读请求被拒（DNS 重绑定探路）不值得刷屏。
       */
      if (WRITE_METHODS.has(req.method.toUpperCase())) {
        await opts.onReject?.({ ...req, reason: verdict.reason })
      }
      return c.json({ ok: false, error: '请求来源不受信任' }, 403)
    }
    await next()
  }
}
