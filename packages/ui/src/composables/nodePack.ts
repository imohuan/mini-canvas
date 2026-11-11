/**
 * nodePack —— 成品应用这一侧用到的「把节点打成包」的共用逻辑（零 Vue、可单测）。
 *
 * ## 为什么住在 packages/ui 而不是插件里
 *
 * 「收藏到资产库」要开**上传弹窗**，而上传弹窗 / 资产清单都是成品应用的东西
 * （只有 packages/ui 拿得到 assets 服务）—— 这正是 uiAssetUploadPlugin 当初住在 ui 的同一条理由。
 *
 * ## 两条路，一个入口
 *
 *   导出下载：build → 把字节存成 .plumenode 文件（浏览器下载）
 *   收藏进库：build → 拼成上传弹窗能吃的 prefill（复用现成的 /api/assets 上传）
 *
 * 打包本身**只能在后台做**（脚本内容在服务器上），所以这里只有"调接口 + 拼数据"。
 */
import { withAdminToken } from '@plume-canvas/canvas-base'

/** 本模块用到的 fetch 最小形状（便于测试注入假货） */
export interface FetchResponseLike {
  ok: boolean
  status: number
  headers?: { get(name: string): string | null }
  /** 可选：只有需要读 JSON 的那条路（base64）才实现 */
  json?(): Promise<unknown>
  /** 可选：只有拿字节那条路才实现 */
  arrayBuffer?(): Promise<ArrayBuffer>
}
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => Promise<FetchResponseLike>

/** 包的后缀（与后台 mime 白名单里的 .plumenode 一致） */
export const PACK_EXT = '.plumenode'

/** 版本后缀的写法（与后台 importPack 同一套：下划线 + 数字） */
export const VERSION_SEP = '_v'

/**
 * 节点包接口的地址：**默认同源**（空串 = 相对当前页面）。
 *
 * 为什么不先问后台要绝对地址（旧实现）：
 *   节点包接口要带 `x-admin-token`，属于带自定义头的跨源请求；dev 下前端在
 *   5288/5299、后台在 8865，若直接按后台自报的 `http://127.0.0.1:8865` 发，
 *   就绕过了 vite 代理、变成浏览器直连另一个源 —— 后台会按来源白名单拒掉，
 *   页面上只看到 `Failed to fetch`（用户 2026-11-05 导出节点包实测）。
 *   同源相对路径经 vite 代理转发，代理那边会把 Origin 归一成后台认识的地址
 *   （见 packages/ui/vite.config.ts），生产形态本来就是同源托管，两种部署一致。
 *
 * `configured` 仍保留：插件自报的地址（`uiNodeBaseUrl`）显式给了就用它，
 * 那是用户自己声明的"另一套后台"。
 */
export async function resolvePackBase(configured?: string, _pageHref?: string): Promise<string> {
  return (configured ?? '').trim().replace(/\/+$/, '')
}

/** 打包结果：字节 + 名字 + 清单 */
export interface PackResult {
  bytes: Uint8Array
  name: string
  /** 包里带了哪些脚本 */
  scripts: string[]
  /** 声明里列了、但机器上没有的脚本（**要如实告诉用户**，不然他以为包是全的） */
  missing: string[]
}

/**
 * 让后台打一个包，拿回字节。
 *
 * 后台可能回"字节"（正常）或"base64 JSON"（没有 c.body 的极简宿主），两种都认 ——
 * 但**认不出就报错**，不返回一个空包冒充成功。
 */
export async function buildPack(
  input: { base: string; canvasId: string; nodeId: string },
  deps: { fetchImpl?: FetchLike } = {},
): Promise<PackResult> {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined)
  if (!fetchImpl) throw new Error('这个环境没有 fetch')
  const res = await fetchImpl(input.base + '/api/node-packages/build', {
    method: 'POST',
    // `/api/node-packages/` 在受保护清单里（能读脚本源码，也能落文件）
    headers: withAdminToken({ 'content-type': 'application/json' }),
    body: JSON.stringify({ canvasId: input.canvasId, nodeId: input.nodeId }),
  })
  const ct = res.headers?.get?.('content-type') ?? ''
  if (!res.ok) {
    throw new Error('打包失败（HTTP ' + res.status + '）')
  }
  if (ct.includes('json')) {
    if (!res.json) throw new Error('后台说回的是 JSON，但它没给 json()')
    const body = (await res.json()) as { ok?: boolean; error?: string; base64?: string; name?: string }
    if (!body.ok) throw new Error(body.error || '打包失败')
    const bytes = base64ToBytes(body.base64 ?? '')
    return { bytes, name: body.name ?? '节点包', scripts: [], missing: [] }
  }
  const buf = await res.arrayBuffer?.()
  if (!buf) throw new Error('后台没回字节')
  // 名字与脚本清单在**响应头**里（字节响应没有 JSON 体可以放它们）——
  // 少了名字，收藏时只能回落成"节点包.plumenode"，用户每次都得手改。
  const head = (n: string): string => res.headers?.get?.(n) ?? ''
  const name = head('x-pack-name') ? decodeURIComponent(head('x-pack-name')) : ''
  const split = (s: string): string[] => (s ? s.split(',').filter(Boolean) : [])
  return {
    bytes: new Uint8Array(buf),
    name,
    scripts: split(head('x-pack-scripts')),
    missing: split(head('x-pack-missing')),
  }
}

/** base64 → 字节（不依赖 Buffer，浏览器里也成立） */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(b64) : ''
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 字节 → Blob（下载 / 上传都用它） */
export function bytesToBlob(bytes: Uint8Array, type = 'application/x-plume-node'): Blob {
  return new Blob([bytes as unknown as BlobPart], { type })
}

/** 包名 → 带后缀的文件名（已经带就不重复加） */
export function packFileName(name: string): string {
  const base = (name || '').trim() || '节点包'
  return base.endsWith(PACK_EXT) ? base : base + PACK_EXT
}

/** 触发一次浏览器下载（组件层不直接碰 DOM，集中在这里，便于测试时替换） */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = bytesToBlob(bytes)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立刻撤销会让部分浏览器来不及取；下一拍再撤销
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 一个文件是不是节点包（按后缀认；大小写不敏感） */
export function isNodePackFile(name: string): boolean {
  return name.toLowerCase().endsWith(PACK_EXT)
}

/** 读一个包里**可预览的那部分**（界面 HTML + 名字），供资产的「预览」用 */
export interface PackPeek {
  html: string
  /** 包里带的脚本名（预览时顺带告诉用户"这个包还带了哪些脚本"） */
  scripts: string[]
  /** 包名（manifest 里的） */
  name: string
}

/**
 * 从资产库里的包**取回并解出界面 HTML**（用户口径 2026-10-14：
 * 「我当前的节点无法进行预览。或者，可以在预览中添加一个 iframe 预览框」）。
 *
 * 为什么要走后台的 read 口而不是前端自己解 ZIP：包就是个 ZIP，前端当然能解，
 * 但解压逻辑已经在后台有一份（带解压炸弹防护）；前端再写一份就是两套实现、迟早漂。
 * 这里只问后台要"解好的那份"。
 */
export async function peekPack(
  assetUrl: string,
  deps: { fetchImpl?: FetchLike } = {},
): Promise<PackPeek> {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined)
  if (!fetchImpl) throw new Error('这个环境没有 fetch')
  const base = await resolvePackBase()
  const res = await fetchImpl(base + '/api/node-packages/read?assetUrl=' + encodeURIComponent(assetUrl))
  if (!res.json) throw new Error('后台没回结果')
  const body = (await res.json()) as {
    ok?: boolean
    error?: string
    html?: string
    manifest?: { name?: string }
    scripts?: Record<string, string>
  }
  if (!res.ok || !body.ok) throw new Error(body.error || '读包失败（HTTP ' + res.status + '）')
  return {
    html: typeof body.html === 'string' ? body.html : '',
    scripts: Object.keys(body.scripts ?? {}),
    name: body.manifest?.name ?? '',
  }
}

/** 导入结果（后台落地之后回给我们的那份） */
export interface ImportResult {
  action: 'as-is' | 'bump'
  version?: number
  /** 改名对照（bump 时非空）——标题里可以直接提示"已升到 _v2" */
  renames: Array<{ from: string; to: string }>
  written: string[]
  skipped: string[]
  /** 要还原成这个节点（前端自己决定放哪、建完选中） */
  node: { type: string; data: Record<string, unknown> }
  html: string
  title: string
}

/**
 * 把一份包交给后台落地（写脚本 + 算好节点数据）。
 *
 * 为什么用 POST 原始字节而不是 multipart：包本来就是一段字节，
 * 多一层表单编码只是多一处能出错的地方（而且后台也不解析表单）。
 */
export async function importPack(
  input: { base: string; bytes: Uint8Array },
  deps: { fetchImpl?: FetchLike } = {},
): Promise<ImportResult> {
  const fetchImpl = deps.fetchImpl ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined)
  if (!fetchImpl) throw new Error('这个环境没有 fetch')
  const res = await fetchImpl(input.base + '/api/node-packages/import', {
    method: 'POST',
    // 导入会往后台写脚本文件 —— 同样要令牌
    headers: withAdminToken({ 'content-type': 'application/x-plume-node' }),
    body: input.bytes,
  })
  if (!res.json) throw new Error('后台没回结果')
  const body = (await res.json()) as { ok?: boolean; error?: string } & Partial<ImportResult>
  if (!res.ok || !body.ok) throw new Error(body.error || '导入失败（HTTP ' + res.status + '）')
  return body as ImportResult
}

