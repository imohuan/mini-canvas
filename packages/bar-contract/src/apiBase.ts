/**
 * apiBase —— 「后台根地址」的唯一校验与拼接规则。
 *
 * 背景（2026-11-05 真机）：设置里 `cloudClientBaseUrl` 被存成了「的」这样一个字符，
 * 云端客户端、风格库、展示台三处各写各的拼接，全都直接把它拼在 `/api/...` 前面，
 * 于是浏览器发出的是 `http://host/%E7%9A%84/api/history` → 404，控制台刷警告。
 *
 * 规则只有一条：**只接受 http(s) 绝对地址**，其余（空串、脏值、相对路径）一律当同源。
 * 这样脏数据最多让请求退回同源，不会再拼出无法访问的 URL。
 *
 * 纯函数、零依赖，业务插件通过 `@mini-canvas/bar-contract` 取用（不互相 import）。
 */

/** 合法后台根地址：http(s) 开头。相对的 `//host` 也按不合法处理（容易被误用成伪协议）。 */
const ABSOLUTE_HTTP = /^https?:\/\/[^/\s]+/i

/**
 * 收下一个「候选服务地址」，返回可以直接拼路径的根地址。
 *
 * - `http://127.0.0.1:8865/` → `http://127.0.0.1:8865`
 * - `''` / `undefined` / `'的'` / `/api` → `''`（同源）
 */
export function normalizeApiBase(candidate: unknown): string {
  if (typeof candidate !== 'string') return ''
  const trimmed = candidate.trim()
  if (!ABSOLUTE_HTTP.test(trimmed)) return ''
  return trimmed.replace(/\/+$/, '')
}

/**
 * 拼后台地址。`base` 为空 = 同源相对路径；`path` 本身是绝对地址时原样返回。
 *
 * 调用方必须先把 base 过一遍 `normalizeApiBase`（或直接用 `apiUrlFrom`）。
 */
export function apiUrl(base: string, path: string): string {
  if (/^https?:/i.test(path)) return path
  if (!base) return path
  return base + (path.startsWith('/') ? path : '/' + path)
}

/** normalize + 拼接一步到位：脏地址自动退回同源。 */
export function apiUrlFrom(candidateBase: unknown, path: string): string {
  return apiUrl(normalizeApiBase(candidateBase), path)
}
