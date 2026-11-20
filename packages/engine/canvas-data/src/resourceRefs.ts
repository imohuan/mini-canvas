/**
 * resourceRefs —— 「资源引用 ↔ 地址」与「节点类型 → 地址字段」的唯一实现（纯函数，零 Vue / 零 DOM）。
 *
 * ## 为什么要有这个文件
 *
 * 同一件事以前散在很多地方各写一份：后台拼地址、前端反解引用、每张映射表各记一套，
 * 结果必然漂移 —— 2026-11-20 的「图片 17 重新生成还是旧图」就是地址换了、引用没换造成的。
 * 规则只此一处，别的包要么 import，要么（产物必须自包含的插件）就地复制并由测试逐字比对。
 *
 * ## 数据契约
 *
 * - 节点长期只保存**引用**（`<画布id>/<hashName>`，例如 `default/181b08e5281278b6.jpeg`）；
 * - **地址**是引用的投影：`/api/canvases/<画布id>/resources/<hashName>`，现用现推，不另存一份。
 */

/** 资源地址前缀（同源相对路径；不带 origin，换机器/换端口都不失效） */
export const CANVAS_RESOURCE_PATH = '/api/canvases/'

/** 资源名白名单：内容寻址（16 位十六进制）或覆盖槽位（slot-…），都可带白名单扩展名 */
const RESOURCE_NAME_RE = /^([0-9a-f]{16}|slot-[A-Za-z0-9_-]{1,64})(\.[a-z0-9]+)?$/i
/** 画布 id 白名单（与路由/存储同口径） */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 这个字符串像不像一个合法资源名（哈希或槽位） */
export function isResourceName(name: string): boolean {
  return RESOURCE_NAME_RE.test(name)
}

/** 这个字符串是不是一个合法**逻辑引用** `<画布id>/<资源名>`（不含 URL 形态） */
export function isResourceRef(ref: string): boolean {
  const s = (ref ?? '').trim()
  const i = s.indexOf('/')
  if (i <= 0 || i !== s.lastIndexOf('/')) return false
  return CANVAS_ID_RE.test(s.slice(0, i)) && isResourceName(s.slice(i + 1))
}

/**
 * 引用 `<画布id>/<hashName>` → 可访问地址。
 * 形状不对（空、多段斜杠、段名非法）返回 undefined —— 不猜。
 */
export function resourceUrlOfRef(ref: string): string | undefined {
  const s = (ref ?? '').trim()
  if (!s) return undefined
  const i = s.indexOf('/')
  if (i <= 0 || i !== s.lastIndexOf('/')) return undefined
  const canvasId = s.slice(0, i)
  const name = s.slice(i + 1)
  if (!CANVAS_ID_RE.test(canvasId) || !isResourceName(name)) return undefined
  return CANVAS_RESOURCE_PATH + canvasId + '/resources/' + name
}

/**
 * 同源资源地址 → 引用 `<画布id>/<hashName>`。
 *
 * 宽容度说明：允许带 origin（绝对地址）与 `?v=` 版本号 —— 这两者在真实数据里都出现过
 *（旧存档的绝对地址、产物字段的防缓存版本号）。外站地址与资产库地址（`/api/assets/…`）不认识，返回 undefined。
 */
export function resourceRefOfUrl(url: string): string | undefined {
  const s = String(url ?? '').trim().split('?')[0].split('#')[0]
  if (!s) return undefined
  const i = s.indexOf(CANVAS_RESOURCE_PATH)
  if (i < 0) return undefined
  const rest = s.slice(i + CANVAS_RESOURCE_PATH.length)
  const sep = '/resources/'
  const j = rest.indexOf(sep)
  if (j <= 0) return undefined
  const canvasId = rest.slice(0, j)
  const name = rest.slice(j + sep.length)
  if (name.includes('/') || !CANVAS_ID_RE.test(canvasId) || !isResourceName(name)) return undefined
  return canvasId + '/' + name
}

/**
 * 节点类型 → 产物地址写进哪个字段。
 *
 * 一张表管到底：后台写产物、云端恢复、兜底对账都读它。以前四份表各记一套，
 * 少一个 `ui` / `audio` 就会「任务成功但卡片空白」。
 */
const MEDIA_URL_FIELDS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  image: ['imageUrl'],
  video: ['videoUrl'],
  audio: ['audioUrl'],
  /** 可视化节点：产物地址在 uiOutputUrl，类型另有 uiOutputType */
  ui: ['uiOutputUrl'],
  '3d-preview': ['imageUrl'],
  'image-compare': ['leftImageUrl', 'rightImageUrl'],
}

/** 已知媒体地址字段（类型未知时按"节点上现有的键"兜底） */
export const RESOURCE_URL_FIELDS = [
  'imageUrl',
  'videoUrl',
  'audioUrl',
  'posterUrl',
  'thumbUrl',
  'maskUrl',
  'panoUrl',
  'leftImageUrl',
  'rightImageUrl',
  'uiOutputUrl',
] as const

/** 媒体地址字段的字面量联合（落盘清理、归属修复按它遍历） */
export type ResourceUrlField = (typeof RESOURCE_URL_FIELDS)[number]

/**
 * 某节点恢复/写入产物时该用哪些地址字段。
 *
 * 先按类型声明走（节点自己读哪个键是确定的）；类型未知时才退回扫 data 里现有的键。
 * `node.data.nodeType` 是旧存档的类型镜像，一并认。
 */
export function mediaUrlFieldsOf(node: { type?: string; data?: Record<string, unknown> }): string[] {
  const mirrored = typeof node.data?.nodeType === 'string' ? node.data.nodeType : ''
  const declared = MEDIA_URL_FIELDS_BY_TYPE[node.type || mirrored]
  if (declared) return [...declared]
  return RESOURCE_URL_FIELDS.filter((key) => typeof node.data?.[key] === 'string')
}

/**
 * 节点类型的**主**产物地址字段（后台写产物时用；同类型多槽时取第一个）。
 * 认不出类型退回 imageUrl（图片是最常见的产物）。
 */
export function mediaUrlFieldOf(nodeType: string | undefined): string {
  return MEDIA_URL_FIELDS_BY_TYPE[nodeType ?? '']?.[0] ?? 'imageUrl'
}

/** 节点类型 / 字段 → 资源种类（决定落盘分类与解析后端） */
export function mediaKindOf(nodeType: string | undefined, field?: string): 'image' | 'video' | 'audio' {
  if (field === 'videoUrl' || nodeType === 'video') return 'video'
  if (field === 'audioUrl' || nodeType === 'audio') return 'audio'
  return 'image'
}

/**
 * 产物文件名 → 内容类型。
 *
 * 与各节点插件的 `outputTypeForName` 同一口径（认不出当图片），但**多认**视频/音频的少量常见后缀
 * （m4v / mkv / aac / flac / opus）—— 以前后台把这些算视频、UI 却当图片，端口类型就错了。
 */
export function mediaTypeOfName(name: string): 'image' | 'video' | 'audio' | 'text' {
  const ext = (String(name ?? '').match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? '').toLowerCase()
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio'
  if (['txt', 'md', 'json', 'csv'].includes(ext)) return 'text'
  return 'image'
}

/**
 * 能直接交给 <img> / <video> / 纹理加载器的地址（http(s) / blob / data / 同源根路径）。
 *
 * 历史原因：有一代写入方把**已解析好的地址**塞进了 resourceId。读到这种值时不必再问资源服务
 * （问了也只会原样回来，还可能因为 HEAD 失败反而取不到）。
 */
export function isDisplayUrl(value: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:blob:|data:)/i.test(value) || value.startsWith('/')
}

/** 资源服务里解析要用到的最小形状（各节点插件共用） */
export interface ResourceResolvePort {
  resolve(ref: string): Promise<string | undefined>
}

/** 从 ctx 取资源服务；取不到 / 没有 resolve 返回 undefined（极简宿主、单测桩） */
export function resourceResolvePort(
  ctx: { tryGet?(name: string): unknown; get?(name: string): unknown } | undefined,
): ResourceResolvePort | undefined {
  if (!ctx) return undefined
  const port = (typeof ctx.tryGet === 'function'
    ? ctx.tryGet('resources')
    : typeof ctx.get === 'function'
      ? ctx.get('resources')
      : undefined) as ResourceResolvePort | undefined
  return port && typeof port.resolve === 'function' ? port : undefined
}

/** 节点 data 里的「引用 + 显示地址」两件套（迁移期并存） */
export interface MediaSourceFields {
  /** 持久资源引用（目标形态，唯一应当长期保存的字段） */
  resourceId: string
  /** 迁移期显示地址（新写入不再只写它；旧存档回退用） */
  legacyUrl: string
}

/** 读节点上的引用与旧地址；都不是字符串时给空串 */
export function readMediaSourceFields(
  data: Record<string, unknown> | undefined,
  urlField: string,
): MediaSourceFields {
  const resourceId = typeof data?.resourceId === 'string' ? data.resourceId : ''
  const legacyUrl = typeof data?.[urlField] === 'string' ? (data[urlField] as string) : ''
  return { resourceId, legacyUrl }
}

/**
 * 节点 data → 「当前能直接放出来的地址」。**图片 / 视频 / 音频 / 对比 / 3D / 网格切分都走这一处。**
 *
 * 顺序固定：引用 → 资源服务 resolve → 迁移期回退旧地址；两者都没有给空串。
 * 结果只用于渲染，调用方**不得写回 data**（"只存引用"这条规矩靠这一点成立）。
 *
 * 为什么必须收成一处：以前 image / image-compare / 3d-preview 各写一份，连"引用本身已经是地址"
 * 这种兜底都只有 3D 那份有 —— 同一种数据在不同节点上表现不同，最难查。
 */
export async function resolveMediaSrc(
  ctx: { tryGet?(name: string): unknown; get?(name: string): unknown } | undefined,
  data: Record<string, unknown> | undefined,
  urlField: string,
): Promise<string> {
  const { resourceId, legacyUrl } = readMediaSourceFields(data, urlField)
  if (!resourceId) return legacyUrl
  // 旧写入方可能把"已解析好的地址"塞进引用：那它本身就是地址，别再问资源服务。
  if (isDisplayUrl(resourceId)) return resourceId
  const port = resourceResolvePort(ctx)
  if (port) {
    try {
      const url = await port.resolve(resourceId)
      if (url) return url
    } catch {
      // 资源服务异常按"取不到"处理，下面回退旧地址（不能让整张卡片渲染失败）
    }
  }
  return legacyUrl
}
