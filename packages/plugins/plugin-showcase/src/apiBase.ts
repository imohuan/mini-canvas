/**
 * apiBase —— 解析"后台半在哪"（面板所有请求都经它拼地址）。
 *
 * ## 为什么不能直接用相对路径
 *
 * 面板若写 `fetch('/api/showcase/meta')`，地址是**当前页面**的 origin。画布界面
 * 可能不是由 cloud-server 托管的（独立 dev server / 别的端口），此时请求打到界面
 * 自己的服务器上，落到 SPA 兜底 → 返回 HTML → 前端 `res.json()` 抛
 * "Unexpected token '<'"（用户实测踩到）。
 *
 * ## 怎么定地址（三级回落）
 *
 * 1. **cloud-client 插件的服务地址配置**（`cloudClientBaseUrl`，设置面板里那一项）——
 *    用户把界面接自己的 cloud-server 时填的就是它，最权威；
 * 2. cloud-client 暴露的运行时服务（`cloud-client` / `cloud-save`）读 baseUrl；
 * 3. 都没有 → 空串 = 同源（界面由 cloud-server 托管时的正常情况）。
 *
 * 这样"同源托管"和"跨源独立界面"两种部署都不用手填地址。
 */
import { withAdminToken } from '@mini-canvas/canvas-base'

/** 从 settings 读 cloud-server 根地址（缺省/未就绪 → 空串 = 同源） */
export function resolveApiBase(ctx: { tryGet<T>(name: string): T | undefined }): string {
  // ① 设置面板里的"服务地址"（与 plugin-cloud-client 共用同一个键）
  const settings = ctx.tryGet<{ get(key: string): unknown }>('settings')
  const fromSettings = settings?.get('cloudClientBaseUrl')
  if (typeof fromSettings === 'string' && fromSettings.trim()) return stripSlash(fromSettings.trim())

  // ② cloud-client 运行时服务（万一 settings 还没就绪，服务已经给出了地址）
  for (const name of ['cloud-client', 'cloud-save']) {
    const svc = ctx.tryGet<{ status?: () => { baseUrl?: string } }>(name)
    const base = svc?.status?.()?.baseUrl
    if (typeof base === 'string' && base.trim()) return stripSlash(base.trim())
  }

  // ③ 同源
  return ''
}

/** 去尾部斜杠，避免拼出 `http://x//api/...` */
function stripSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

/** 把后台路径拼成完整地址（base 为空则保持相对 = 同源） */
export function apiUrl(base: string, path: string): string {
  if (/^https?:/i.test(path)) return path
  return base ? base + (path.startsWith('/') ? path : '/' + path) : path
}

/**
 * 在线测试台发请求时用的头。
 *
 * 为什么要有：`/api/showcase/` 整段在管理令牌清单里（它们能写插件私有 store、起定时器、
 * 注册 MCP 工具）—— 不带令牌的点一下就是 403。GET 带了也无害（服务端不校验读接口）。
 */
export function showcaseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return withAdminToken(extra)
}
