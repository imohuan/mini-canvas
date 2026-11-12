/**
 * 给所有后台请求带上登录凭据（一次装好，四十多处调用点不用逐个改）。
 *
 * 为什么要在全局 fetch 上做：需要带会话的请求分散在 ui、plugin-manager、plugin-agent、
 * plugin-bottom-bar、plugin-node-ui、plugin-style-library 等几十处；逐个加
 * `credentials: 'include'` 一定会漏，漏掉的表现是“登录了但保存 403”。
 *
 * 只改**指向后台**的请求：同源的 `/api/...`（cloud-server 托管版、dev 的 vite 代理
 * 都走这条）。跨源后台（`cloudClientBaseUrl` 配成绝对地址）由 cloud-client 自己带凭据。
 * 第三方网站（生成平台、图片 CDN）不加凭据，避免把 cookie 发给别人。
 */
const originalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined

function isBackendUrl(url: string): boolean {
  if (url.startsWith('/api/') || url.startsWith('api/')) return true
  try {
    const u = new URL(url, window.location.href)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/** 安装一次；重复调用是幂等的 */
export function installAuthCredentials(): void {
  if (!originalFetch || typeof window === 'undefined') return
  const holder = window as unknown as { __plumeAuthFetch?: boolean }
  if (holder.__plumeAuthFetch) return
  holder.__plumeAuthFetch = true
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!isBackendUrl(url)) return originalFetch(input as never, init)
    return originalFetch(input as never, { ...(init ?? {}), credentials: init?.credentials ?? 'include' })
  }) as typeof fetch
}
