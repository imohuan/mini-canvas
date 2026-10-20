/**
 * api —— 与后台半说话的**纯函数**（无状态、无 Vue）。
 *
 * 地址解析照 plugin-showcase 的 apiBase（同一个坑同一个解）：画布界面可能与
 * cloud-server 不同源（ui 单独 dev），写死相对路径会打到界面自己的服务器上、
 * 收到 SPA 的 HTML，前端 res.json() 报 "Unexpected token '<'"。三级回落：
 *   ① 设置里的「服务地址」（cloudClientBaseUrl，与 cloud-client 共用）；
 *   ② cloud-client / cloud-save 运行时服务给的 baseUrl；
 *   ③ 空串 = 同源（界面由 cloud-server 托管时的正常情况）。
 */
import type { StyleMeta, StylePage, StyleSort } from './types'
import { withAdminToken } from '@mini-canvas/canvas-base'

/**
 * 素材库种类：「风格库」与「特效库」共用同一套后台逻辑（路由前缀不同）。
 * 数据层靠它决定打哪个前缀；UI 层靠它决定点卡片时做什么（详情 / 全屏预览）。
 */
export type LibraryKind = 'style' | 'effect'

/** 种类 → 路由前缀（与后台半 server.ts 的 LIBRARIES 对齐） */
export function prefixOf(kind: LibraryKind): string {
  return kind === 'effect' ? '/api/effect-library' : '/api/style-library'
}

/**
 * 通用取值器：宿主 ctx 的最小面（任何 ctx 都满足）。
 *
 * 签名刻意用「非泛型 (name) => unknown」：kernel 的 PluginScope.tryGet 是泛型的，
 * 泛型函数可赋给非泛型签名（返回 unknown），反向则不行 —— 收窄到这里两边都能传。
 */
export interface CtxLike {
  tryGet(name: string): unknown
}

function stripSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

/** 解析后台根地址（见文件头三级回落） */
export function resolveApiBase(ctx: CtxLike | undefined): string {
  const settings = ctx?.tryGet('settings') as { get(key: string): unknown } | undefined
  const fromSettings = settings?.get('cloudClientBaseUrl')
  if (typeof fromSettings === 'string' && fromSettings.trim()) return stripSlash(fromSettings.trim())

  for (const name of ['cloud-client', 'cloud-save']) {
    const svc = ctx?.tryGet(name) as { status?: () => { baseUrl?: string } } | undefined
    const base = svc?.status?.()?.baseUrl
    if (typeof base === 'string' && base.trim()) return stripSlash(base.trim())
  }
  return ''
}

/** 拼完整地址（base 为空 = 同源相对路径） */
export function apiUrl(base: string, path: string): string {
  if (/^https?:/i.test(path)) return path
  return base ? base + (path.startsWith('/') ? path : '/' + path) : path
}

/** 把"后台回了 HTML"翻成人话（多半是地址不对或后台半没生效） */
export function friendlyError(raw: string): string {
  if (/Unexpected token '<'|<!doctype|not valid json/i.test(raw)) {
    return (
      '后台没应答 JSON（收到的是网页）。两种可能：① 画布界面不是由 cloud-server 托管，' +
      '需在「设置 → 常规 → 云端客户端 → 服务地址」填 cloud-server 地址；' +
      '② 后台半是重启/安装后才生效的，确认「风格库」的后台那一半已安装。'
    )
  }
  return raw
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(friendlyError('后台返回的不是 JSON：' + text.slice(0, 120)))
  }
  if (!res.ok) {
    const err = (body as { error?: string }).error
    throw new Error(err || '请求失败 HTTP ' + res.status)
  }
  return body as T
}

export interface FetchItemsParams {
  offset: number
  limit: number
  category?: string
  q?: string
  sort?: StyleSort
}

/** 拉取一页素材（kind 决定打哪个库的路由前缀） */
export function fetchItems(base: string, kind: LibraryKind, p: FetchItemsParams): Promise<StylePage> {
  const qs = new URLSearchParams()
  qs.set('offset', String(p.offset))
  qs.set('limit', String(p.limit))
  if (p.category) qs.set('category', p.category)
  if (p.q) qs.set('q', p.q)
  if (p.sort && p.sort !== 'default') qs.set('sort', p.sort)
  return getJson<StylePage>(apiUrl(base, prefixOf(kind) + '/items?' + qs.toString()))
}

/** 拉概览 */
export function fetchMeta(base: string, kind: LibraryKind): Promise<StyleMeta> {
  return getJson<StyleMeta>(apiUrl(base, prefixOf(kind) + '/meta'))
}

/** 读当前生效的资源目录 */
export async function fetchSettings(base: string, kind: LibraryKind): Promise<{ ok: boolean; root: string; overridden: boolean }> {
  return getJson(apiUrl(base, prefixOf(kind) + '/settings'))
}

/** 改资源目录（后台会先自证目录可读，再落盘 + 重扫） */
export async function putRoot(base: string, kind: LibraryKind, root: string): Promise<{ ok: boolean; root: string; itemCount?: number }> {
  const res = await fetch(apiUrl(base, prefixOf(kind) + '/settings'), {
    method: 'PUT',
    // `PUT /api/style-library/settings` 在首版令牌清单里（能改读取根目录）
    headers: withAdminToken({ 'content-type': 'application/json' }),
    body: JSON.stringify({ root }),
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; root?: string; itemCount?: number }
  if (!res.ok || body.ok === false) throw new Error(body.error || '保存失败 HTTP ' + res.status)
  return { ok: true, root: body.root ?? root, ...(body.itemCount !== undefined ? { itemCount: body.itemCount } : {}) }
}

/** 重扫目录 */
export async function reload(base: string, kind: LibraryKind): Promise<{ ok: boolean; itemCount: number }> {
  // `POST .../reload` 同样在清单里；两个库（style / effect）共用这一段，前缀由 kind 决定
  const res = await fetch(apiUrl(base, prefixOf(kind) + '/reload'), { method: 'POST', headers: withAdminToken() })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; itemCount?: number; error?: string }
  if (!res.ok) throw new Error(body.error || '重扫失败 HTTP ' + res.status)
  return { ok: body.ok === true, itemCount: body.itemCount ?? 0 }
}
