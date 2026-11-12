/**
 * 参考图解析 —— 把节点里的**任何**资源地址翻成 provider 能直接取的 data URL。
 *
 * ## 为什么是「任何地址」而不是白名单
 *
 * 早先这里是**按地址前缀枚举**的：只认 `/api/canvases/<id>/resources/<hash>` 与
 * `/api/assets/files/<hash>` 两种。结果每多一种来源就漏一种，被原样发给 web2api →
 * 它当成自己 uploads 目录下的相对路径去找，报「图片不存在」。已经踩过三次：
 * 资产地址、画布资源地址、**风格库地址 `/api/style-library/file?name=…`**（用户实测的第三次）。
 *
 * 现在改成**通用做法（用户口径）**：
 *   1. 地址不全（相对地址）→ 用本服务的监听地址拼成完整 URL；
 *   2. 不管它是本服务的哪条路由、还是外部地址 → **自己去请求**，把字节取回来；
 *   3. 取到了 → 内嵌成 data URL 交给 provider；取不到 → 原样返回（让上游报错，不编假地址）。
 * 这样以后**新增任何资源来源都自动能用**，不必再回来改这里。
 *
 * ## 为什么交出去的是 data URL 而不是地址
 *
 * cloud-server 与 web2api 是**两个独立服务**（可能不在同一台机器），把地址给它它可能根本取不到
 * （见 TaskDeps.resolveResourceUrl）。所以在本机把字节读出来内嵌 —— 与网络可达性无关。
 *
 * ## 安全边界（**必须有**，否则这就是个 SSRF 洞）
 *
 * 「自己去请求任意地址」等于让画布里的字符串指挥服务器发请求 —— 只允许**本服务自己的地址**
 * （相对路径 或 本机 origin 的绝对地址），别的域名一律不碰、原样交给 provider 去处理。
 * 画布数据是用户自己的，但画布来源可能不可信（导入 / 分享），这条边界不能省。
 */
import { parseAssetNameFromUrl } from '../store/assetStore.js'
import { parseResourceNameFromUrl, type CanvasResourceStore } from '../store/canvasResources.js'
import { mimeFromName, sniffMimeFromHead } from '../store/mime.js'

export interface ResourceResolverDeps {
  /**
   * 画布资源（`/api/canvases/<id>/resources/<hash>` 走它）—— **快路**：
   * 直接读磁盘，不经过 HTTP 自请求（同机同进程，没必要绕一圈）。
   *
   * 只声明 read，不要 readHead：这条路上字节本来就要整份读出来内嵌，嗅探直接看手里这份的**前 16 字节**
   * 即可，再开一次文件纯属多一次 IO（readHead 的价值在资源列表那条**不该整读**的路上）。
   */
  canvasResources: Pick<CanvasResourceStore, 'read'>
  /** 上传资产的字节；名字不合法 / 不存在 → undefined */
  readAssetBytes(name: string): Promise<Uint8Array | undefined>
  /**
   * 通用的「自己把地址取回来」：**本服务自己的地址才允许**（相对路径 / 同 origin 绝对地址）；
   * 别的域名一律返回 undefined（安全边界见文件头）。给了它才能走第 ③ 条通用路。
   *
   * 实现方通常直接调宿主自己的 app.fetch（不真发网络请求 —— 同进程一条内部往返就够）。
   */
  fetchSelfBytes?(url: string): Promise<Uint8Array | undefined>
}

/**
 * 造一个「引用 → data URL」的解析函数（纯依赖注入，便于单测给假货）。
 *
 * 顺序（先快后全，见文件头）：
 *   ① 画布资源（读磁盘，快路）→ ② 上传资产（读磁盘，快路）→ ③ **通用自请求**（任何本服务地址：
 *   风格库 / 特效库 / 以后新增的任何路由）→ 认不出 / 取不到就**原样返回**。
 *
 * 第 ③ 条是这一版的关键：不再枚举地址类型（枚举就会漏，已经漏了三次）。
 * 拿不到 ref 里的文件名时用 URL 的 pathname 兜底给 mime 嗅探用（很多资源没扩展名）。
 */
export function makeResolveResourceUrl(
  deps: ResourceResolverDeps,
): (canvasId: string, ref: string) => Promise<string> {
  return async (canvasId, ref) => {
    // ① 画布资源：走到这里就是本画布目录下的文件，直接读盘
    const resourceName = parseResourceNameFromUrl(ref, canvasId)
    if (resourceName) {
      const bytes = await deps.canvasResources.read(canvasId, resourceName)
      return bytes ? toDataUrl(bytes, resourceName) : ref
    }
    // ② 上传资产：同样是本机文件，直接读盘
    const assetName = parseAssetNameFromUrl(ref)
    if (assetName) {
      const bytes = await deps.readAssetBytes(assetName)
      return bytes ? toDataUrl(bytes, assetName) : ref
    }
    // ③ 通用：任何**本服务自己的**地址（相对路径 / 同 origin 绝对地址）→ 自己请求取字节。
    //    风格库的 `/api/style-library/file?name=…` 就走这条；以后新增路由也自动覆盖。
    //    别的域名不碰（安全边界），由 provider 那边按 URL 形态处理。
    if (deps.fetchSelfBytes) {
      const bytes = await deps.fetchSelfBytes(ref)
      if (bytes && bytes.byteLength > 0) return toDataUrl(bytes, fileNameOf(ref))
    }
    return ref
  }
}

/**
 * 从地址里取一个「文件名」给 mime 用。
 *
 * 兼容两类形态：
 *   - 路径式：`/api/canvases/c1/resources/abc.png` → `abc.png`
 *   - **查询参数式**：`/api/style-library/file?name=xxx.png` → `xxx.png`
 *     （风格库/特效库就是这种；只按路径取会得到 "file"，嗅探不到扩展名）
 */
export function fileNameOf(ref: string): string {
  let pathname = ref
  let search = ''
  try {
    const u = new URL(ref, 'http://x')
    pathname = u.pathname
    search = u.search
  } catch {
    const q = ref.indexOf('?')
    if (q >= 0) {
      pathname = ref.slice(0, q)
      search = ref.slice(q)
    }
  }
  // 查询参数里的 name 优先（风格库形态）
  try {
    const named = new URLSearchParams(search).get('name')
    if (named && /\.[a-z0-9]+$/i.test(named)) return named.slice(named.lastIndexOf('/') + 1)
  } catch {
    /* 解析不了就按路径取 */
  }
  const last = pathname.split('/').filter(Boolean).pop() ?? ''
  return last
}

/**
 * 字节 → data URL。
 *
 * mime 先按名字（有扩展名就够）；名字给不出类型（octet-stream = 没扩展名）时补一次
 * **头部嗅探** —— 画布资源按内容哈希落盘、很多没扩展名，不嗅探的话音频会被当成二进制流发出去。
 */
function toDataUrl(bytes: Uint8Array, name: string): string {
  let mime = mimeFromName(name)
  if (mime === 'application/octet-stream') {
    const sniffed = sniffMimeFromHead(bytes.subarray(0, 16))
    if (sniffed) mime = sniffed
  }
  return 'data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64')
}
