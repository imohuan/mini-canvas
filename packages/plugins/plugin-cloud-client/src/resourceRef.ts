/**
 * 画布内资源引用（res:<hash>）的解析。
 *
 * ## 为什么节点里存的是 res:<hash> 而不是完整地址
 * 完整地址（/api/canvases/<画布id>/resources/<hash>）里带着**画布 id**，
 * 于是"复制整个画布文件夹"这件事就不成立了：复制成新画布后，地址里还写着原画布 id，
 * 不是显示错东西就是 404。存画布内相对引用，文件夹搬到哪都能用。
 *
 * ## 什么时候把它变成真地址
 * **渲染前**（载入 / 合并落地时），不是存的时候。所以这个模块是纯函数：
 * 给一串节点，把里面的 res: 展开成当前画布的可请求地址。
 *
 * 之所以要单独一层而不是塞进各个渲染组件：那九个媒体字段散在五个节点类型里，
 * 各写一遍必然漏。一处展开、渲染组件照旧读原值。
 */
import { RESOURCE_REF_PREFIX, RESOURCE_URL_FIELDS, CANVAS_ID } from './keys.js'

/** 资源名白名单（与后端一致：16 位十六进制 + 可选扩展名） */
const RESOURCE_NAME_RE = /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i

export function isResourceRef(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(RESOURCE_REF_PREFIX)
}

/** res:<hash> → <hash>；不是引用或名字不合法 → undefined */
export function parseResourceRef(ref: unknown): string | undefined {
  if (!isResourceRef(ref)) return undefined
  const name = ref.slice(RESOURCE_REF_PREFIX.length)
  return RESOURCE_NAME_RE.test(name) ? name : undefined
}

/**
 * 把一条引用解析成可请求的地址。
 *
 * 非引用（老数据里的 /uploads/... 或绝对地址）**原样返回** ——
 * 老数据不该因为这次改造而裂图。
 */
export function resolveRef(ref: unknown, canvasId: string = CANVAS_ID): string | undefined {
  if (typeof ref !== 'string' || ref === '') return undefined
  const name = parseResourceRef(ref)
  if (!name) return ref
  return '/api/canvases/' + canvasId + '/resources/' + name
}

/**
 * 反解：把"当前画布下的资源地址"换回 res:<hash>（写回云端 / 判断是否已上传时用）。
 * 认不出来就返回原值（不猜）。
 */
export function toRef(url: unknown, canvasId: string = CANVAS_ID): string | undefined {
  if (typeof url !== 'string' || url === '') return undefined
  const prefix = '/api/canvases/' + canvasId + '/resources/'
  if (url.startsWith(prefix)) {
    const name = url.slice(prefix.length)
    return RESOURCE_NAME_RE.test(name) ? RESOURCE_REF_PREFIX + name : url
  }
  return url
}

/** 一个节点的 data（只关心资源字段） */
export interface NodeWithData {
  id: string
  data?: Record<string, unknown>
}

/**
 * 把一批节点里的 res: 引用展开成真地址。
 *
 * @returns 需要更新的补丁（**只回真的变过的那些**，没变的不回 —— 免得白白触发一次落盘）
 */
export function expandNodes(
  nodes: readonly NodeWithData[],
  canvasId: string = CANVAS_ID,
): Array<{ id: string; data: Record<string, unknown> }> {
  const patches: Array<{ id: string; data: Record<string, unknown> }> = []
  for (const node of nodes) {
    const data = node.data
    if (!data) continue
    let changed = false
    const next: Record<string, unknown> = {}
    for (const field of RESOURCE_URL_FIELDS) {
      const value = data[field]
      if (!isResourceRef(value)) continue
      const resolved = resolveRef(value, canvasId)
      if (resolved !== value) {
        next[field] = resolved
        changed = true
      }
    }
    if (changed) patches.push({ id: node.id, data: next })
  }
  return patches
}

/**
 * 反向：把一批节点里的"本画布资源地址"收回 res:（推回云端前用）。
 * 与 expandNodes 配对，保证**存在磁盘上的永远是 res:**。
 */
export function shrinkNodes(
  nodes: readonly NodeWithData[],
  canvasId: string = CANVAS_ID,
): Array<{ id: string; data: Record<string, unknown> }> {
  const prefix = '/api/canvases/' + canvasId + '/resources/'
  const patches: Array<{ id: string; data: Record<string, unknown> }> = []
  for (const node of nodes) {
    const data = node.data
    if (!data) continue
    let changed = false
    const next: Record<string, unknown> = {}
    for (const field of RESOURCE_URL_FIELDS) {
      const value = data[field]
      if (typeof value === 'string' && value.startsWith(prefix)) {
        const shrunk = toRef(value, canvasId)
        if (shrunk !== value) {
          next[field] = shrunk
          changed = true
        }
      }
    }
    if (changed) patches.push({ id: node.id, data: next })
  }
  return patches
}

/**
 * 有没有还没上传的本地地址（dataURL / blob:）。
 *
 * 后台拿不到这两种地址 —— 所以下单前必须先上传成资源、换成 res:。
 */
export function pendingUploadFields(data: Record<string, unknown> | undefined): string[] {
  if (!data) return []
  const out: string[] = []
  for (const field of RESOURCE_URL_FIELDS) {
    const v = data[field]
    if (typeof v === 'string' && /^(data:|blob:)/i.test(v)) out.push(field)
  }
  return out
}
