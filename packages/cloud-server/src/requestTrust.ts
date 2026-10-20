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
   * 保留参数，默认 false。文档已实测：不透明源（Origin: null）永远报
   * cross-site，不存在 same-origin/none 的组合；打开它等于对任意网页开例外。
   */
  allowOpaqueOrigin?: boolean
}

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

  const host = (req.header('host') ?? '').trim()
  if (!host || !opts.trustedHosts.includes(host)) {
    return { ok: false, reason: 'host-not-trusted' }
  }

  const fetchSite = (req.header('sec-fetch-site') ?? '').trim().toLowerCase()
  if (fetchSite === 'cross-site') {
    return { ok: false, reason: 'cross-site' }
  }

  const origin = req.header('origin')
  if (origin !== undefined) {
    if (origin.trim().toLowerCase() === 'null') {
      // 文档实测：不透明源只会是 cross-site，下面这条例外实际上不会命中。
      // 保留它只是为了让参数语义完整，默认关闭。
      if (!opts.allowOpaqueOrigin || (fetchSite !== 'same-origin' && fetchSite !== 'none')) {
        return { ok: false, reason: 'opaque-origin' }
      }
    } else if (origin !== 'http://' + host && origin !== 'https://' + host) {
      if (!(opts.trustedOrigins ?? []).includes(origin)) {
        return { ok: false, reason: 'origin-not-trusted' }
      }
    }
  }

  return { ok: true }
}

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
      return c.json({ ok: false, error: '请求来源不受信任' }, 403)
    }
    await next()
  }
}
