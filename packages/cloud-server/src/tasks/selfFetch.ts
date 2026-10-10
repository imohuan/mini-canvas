/**
 * selfFetch —— 「服务器自己把画布里的地址取回来」。
 *
 * ## 为什么需要它（用户实测的第三次同类 bug）
 *
 * 参考图解析早先是**按地址前缀枚举**的（只认画布资源 + 上传资产两条）。
 * 每多一种资源来源就漏一种，被原样发给 web2api → 它当成自己 uploads 目录下的相对文件找，
 * 报「图片不存在」。已经漏过三次：资产地址 → 画布资源地址 → **风格库地址**
 * （`/api/style-library/file?name=…`，用户 2026-10-10 实测）。
 *
 * 用户口径：**不要再枚举**。地址不全就用本服务地址拼全，然后不管它是哪条路由，自己去请求。
 *
 * ## 怎么取（不真发网络请求）
 *
 * 本进程里直接调自己的 Hono app.fetch —— 一条内部往返，不出网卡、不依赖端口 / 防火墙，
 * 也不受「服务还在启动中」影响。资源路由本来就是把文件字节读出来回给调用方，走内部调用等价。
 *
 * ## 安全边界（**必须有**）
 *
 * 「按画布里的字符串发请求」= 典型 SSRF 面。这里只允许**本服务自己的地址**：
 *   - 相对路径（`/api/...`）→ 直接交给 app.fetch；
 *   - 绝对地址 → **host 必须与本机监听地址一致**（127.0.0.1 / localhost / 本机 hostname，
 *     端口相同或省略）；别的域名一律拒绝（返回 undefined），由 provider 按 URL 形态自行处理。
 * 画布可能来自导入 / 分享 —— 这条边界不能省。
 *
 * 另加两个上限：单次请求超时、响应体大小上限（避免一个超大文件把内存吃满）。
 */

/** 允许自请求的最大响应体（字节）：64MB。超了就当取不到（交给 provider 自己想办法）。 */
const MAX_BYTES = 64 * 1024 * 1024
/** 单次自请求超时（ms） */
const FETCH_TIMEOUT_MS = 30_000

export interface SelfFetchDeps {
  /** 宿主自己的 fetch（Hono 的 app.fetch） */
  fetch: (req: Request) => Response | Promise<Response>
  /** 本服务的监听地址（用于判断"是不是自己的地址"），如 `http://127.0.0.1:8865` */
  origin(): string
}

/** 本机别名：这些名字指的是**同一台机器**（用户浏览器里存的地址可能是其中任意一个） */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * 判断一个绝对地址是不是本服务自己。
 *
 * 判定规则（宽严相济）：
 *   - **主机**：完全相等，或**两边都是本机别名**（127.0.0.1 / localhost / ::1 互相等价）。
 *     为什么不能只比字符串：前端存进画布的完整地址可能是 `http://localhost:8865/...`，
 *     而服务自报的 origin 是 `http://127.0.0.1:8865` —— 字符串比就把它当成"别人"，
 *     于是这条参考图又退回裸地址发出去（实测踩到）。
 *   - **端口**：必须一致（省略即默认端口）。别的主机一律拒绝（SSRF 边界）。
 */
function isSelfUrl(url: string, selfOrigin: string): boolean {
  let target: URL
  let self: URL
  try {
    target = new URL(url)
    self = new URL(selfOrigin)
  } catch {
    return false
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
  // 主机：相等，或两边都是本机别名（localhost ≡ 127.0.0.1 ≡ ::1）
  const sameHost =
    target.hostname === self.hostname ||
    (LOOPBACK_HOSTS.has(target.hostname.toLowerCase()) && LOOPBACK_HOSTS.has(self.hostname.toLowerCase()))
  if (!sameHost) return false
  // 端口：目标没写就是默认端口（80/443）；写了就必须与自身一致（自身也可能是默认端口）
  const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80')
  const selfPort = self.port || (self.protocol === 'https:' ? '443' : '80')
  return targetPort === selfPort
}

/**
 * 拿回来的字节是不是「媒体」（图片/视频/音频）—— 按**文件头**判，不信 Content-Type。
 *
 * 为什么必须判（实测的坑）：路由不存在 / 插件没加载时，静态兜底会把 index.html 返回给任何 GET，
 * 于是"取字节"成功拿到一段 HTML，内嵌成 data URL 发出去，上游把它当图片解 → 报错。
 * 这里认常见的媒体头；认不出就**不当媒体**（宁可退回原地址让上游自己处理，也不发假图）。
 */
export function looksLikeMedia(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false
  const b = bytes
  // PNG / JPEG / GIF / BMP / WEBP(RIFF) / AVIF-MP4(ftyp) / PDF 不算 / SVG（文本形态另判）
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true // PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true // JPEG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true // GIF
  if (b[0] === 0x42 && b[1] === 0x4d) return true // BMP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return true // RIFF (WEBP/WAV)
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true // ftyp (MP4/AVIF/MOV)
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return true // OggS
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true // ID3 (mp3)
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true // WebM/Matroska
  // SVG：文本形态，前若干字节里出现 <svg 才算
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, Math.min(512, b.byteLength))).toLowerCase()
  if (head.includes('<svg')) return true
  return false
}

/**
 * 造一个「取本服务自己的字节」的函数。
 *
 * @returns 取到 → 字节；不是本服务地址 / 取不到 / 超限 / 非 2xx → undefined
 */
export function makeFetchSelfBytes(deps: SelfFetchDeps): (url: string) => Promise<Uint8Array | undefined> {
  return async (url) => {
    const raw = (url ?? '').trim()
    if (!raw) return undefined
    // 相对路径 → 补成完整地址；绝对地址 → 必须是自己的 host:port
    let target: string
    if (raw.startsWith('/')) {
      target = deps.origin().replace(/\/+$/, '') + raw
    } else if (/^https?:\/\//i.test(raw)) {
      if (!isSelfUrl(raw, deps.origin())) return undefined
      target = raw
    } else {
      // 其它形态（data: / blob: / 裸文件名）不归这里管
      return undefined
    }
    try {
      const res = await deps.fetch(new Request(target, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }))
      if (!res.ok) return undefined
      /**
       * **必须校验拿回来的是不是媒体**。
       *
       * 踩过的坑（实测）：路由不存在 / 插件没加载时，静态兜底会把 **index.html** 返回给任何 GET
       * —— 于是"取字节"成功拿到一段 HTML，内嵌成 data URL 发出去，上游把它当图片解 → 报错。
       * 所以按 Content-Type 与头部字节双重把关：不是 图片/视频/音频 就直接判"没取到"。
       */
      const ct = (res.headers.get('content-type') ?? '').toLowerCase()
      if (ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) return undefined
      const len = Number(res.headers.get('content-length') ?? '0')
      if (Number.isFinite(len) && len > MAX_BYTES) return undefined
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return undefined
      // 头部再核一遍：不是媒体就当没取到（Content-Type 可能撒谎或缺失）
      if (!looksLikeMedia(buf)) return undefined
      return buf
    } catch {
      // 超时 / 路由不存在 / 网络错误：都当"取不到"，交给上游按原样处理
      return undefined
    }
  }
}
