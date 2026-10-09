/**
 * referencePrep —— 下单前把参考图整理成 web2api 能直接用的形态（纯逻辑，node 可单测）。
 *
 * 背景（用户实测 bug）：画布里的素材地址是**本站的相对地址**（/api/canvases/.../resources/x.jpeg、
 * /api/assets/files/x.jpeg），而 web2api 的 referenceImages 只认它能自己取到的形态：
 *   · /<hash>.ext（它 uploads 目录下的文件）
 *   · /api/resources/uploads/<name>（它本机文件）
 *   · http(s):// 绝对地址（它会自己去下载）
 * 裸相对地址原样发过去 → 它按自己的 uploads 目录去找 → 4002「图片不存在」。
 *
 * 方案（用户口径：先上传拿地址、再用地址下单）：用 web2api 已有的 system/upload-resource ——
 * 取字节 → 转 data URL 交上传 → 换回它的 referenceUrl（/<hash>.ext）。
 *
 * 失败的那一项**丢弃并告警**：宁可少一张参考图，也不要把坏地址发给 web2api 让整个任务 4002 失败。
 */

/** 判断某地址是否已经能被 web2api 直接取到（本机文件 / 它能下载的绝对地址） */
export function needsUpload(url: string, webOrigin: string): boolean {
  const u = (url ?? '').trim()
  if (!u) return true
  // data: 直接就是字节；blob: 只有本页面能取 —— 两者都得换成 web2api 的地址
  if (/^(data:|blob:)/i.test(u)) return true
  // 绝对地址：web2api 自己 origin 的地址对它等价于"本机路径"（如 http://localhost:8033/hash.png
  // 就是 uploads 里的文件）→ 裁掉 origin 后按路径规则判；其它站点（图床/CDN/画布服务器）的
  // 地址它会自己去下载 → 原样。
  const origin = (webOrigin ?? '').replace(/\/+$/, '')
  if (/^https?:\/\//i.test(u)) {
    const prefix = origin ? origin.toLowerCase() + '/' : ''
    if (!prefix || !u.toLowerCase().startsWith(prefix)) return false
    return pathNeedsUpload(u.slice(origin.length))
  }
  return pathNeedsUpload(u)
}

/** 路径形态的判定：web2api 本机两种形态原样，其余（本站多层相对地址）要上传 */
function pathNeedsUpload(path: string): boolean {
  // /api/resources/uploads/<name>：它本机文件
  if (path.startsWith('/api/resources/uploads/')) return false
  // 单层 /<hash.ext>：它 uploads 目录下的文件
  if (/^\/[^/]+$/.test(path)) return false
  // 其它路径（/api/canvases/...、/api/assets/files/...、裸文件名）它取不到 → 要上传
  return true
}

/** 上传编排要用的外部能力（生产由 web2apiPlugin 接线，测试注入假货） */
export interface ReferencePrepDeps {
  /** web2api 的 origin（如 http://localhost:8033） */
  webOrigin: string
  /** 取字节（浏览器里用 fetch；测试注入假货）。支持 data:/blob:/相对地址/http 地址 */
  fetchBlob(url: string): Promise<Blob | undefined>
  /** 交给 web2api 上传，返回 referenceUrl */
  upload(content: string, mimeType?: string): Promise<string | undefined>
  onError?(msg: string, err?: unknown): void
}

/** 日志里的地址缩略（data: 地址有几万个字符，不能原样往外打） */
function shortUrl(url: string): string {
  return url.length > 120 ? url.slice(0, 117) + '...' : url
}

/** 调 onError 但不容许它把流程带崩（"失败只丢一项"是硬要求，告警本身不能变成新的失败源） */
function warn(deps: ReferencePrepDeps, msg: string, err?: unknown): void {
  try {
    deps.onError?.(msg, err)
  } catch {
    /* 告警失败就静默：不该因为它把整批参考图带崩 */
  }
}

/** 取一个地址的字节；取不到返回 undefined（不抛） */
async function bytesOf(url: string, deps: ReferencePrepDeps): Promise<Blob | undefined> {
  try {
    const blob = await deps.fetchBlob(url)
    if (!blob || blob.size === 0) {
      warn(deps, '参考图取不到字节，已丢弃：' + shortUrl(url))
      return undefined
    }
    return blob
  } catch (err) {
    warn(deps, '参考图取字节失败，已丢弃：' + shortUrl(url), err)
    return undefined
  }
}

/** 字节 → data URL（浏览器用原生 FileReader；node 下回退 Buffer 拼 base64） */
async function toDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('FileReader 读取失败'))
      reader.readAsDataURL(blob)
    })
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const nodeBuffer = (
    globalThis as unknown as { Buffer?: { from(bytes: Uint8Array): { toString(encoding: string): string } } }
  ).Buffer
  if (nodeBuffer && typeof nodeBuffer.from === 'function') {
    const base64 = nodeBuffer.from(bytes).toString('base64')
    return 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + base64
  }
  throw new Error('当前环境既没有 FileReader 也没有 Buffer，无法把参考图转成 data URL')
}

/** 单张参考图：该传的传，该留的留；失败只丢这一张（返回 undefined） */
async function prepareOne(url: string, deps: ReferencePrepDeps): Promise<string | undefined> {
  // 空地址没法取字节（浏览器里 fetch('') 会去请求当前页面）→ 直接丢
  if ((url ?? '').trim() === '') {
    warn(deps, '参考图地址为空，已丢弃')
    return undefined
  }
  if (!needsUpload(url, deps.webOrigin)) return url
  const blob = await bytesOf(url, deps)
  if (!blob) return undefined
  try {
    const content = await toDataUrl(blob)
    const referenceUrl = await deps.upload(content, blob.type || undefined)
    if (typeof referenceUrl !== 'string' || !referenceUrl) {
      warn(deps, '参考图上传未返回地址，已丢弃：' + shortUrl(url))
      return undefined
    }
    return referenceUrl
  } catch (err) {
    warn(deps, '参考图上传失败，已丢弃：' + shortUrl(url), err)
    return undefined
  }
}

/**
 * 把一批参考图地址整理成 web2api 可直接用的形态（**保序**，失败只丢那一个）：
 * - data: / blob: / 本站相对地址（/api/canvases/...、/api/assets/files/...）→ 先取字节上传 → 用返回的 referenceUrl；
 * - http(s):// 其它服务的绝对地址 → 原样（web2api 自己会下载）；
 * - web2api 自己的地址（webOrigin 前缀、/api/resources/uploads/...、/<hash.ext>）→ 原样。
 */
export async function prepareReferenceImages(urls: string[], deps: ReferencePrepDeps): Promise<string[]> {
  const out: string[] = []
  for (const url of urls ?? []) {
    const ready = await prepareOne(url, deps)
    if (ready) out.push(ready)
  }
  return out
}
