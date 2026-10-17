/**
 * canvasPathsShared —— 从 cloud-server 的 canvasPaths.ts 复制的最小集。
 *
 * 为什么复制而不是 import：本插件是外挂单文件后台（data: URL 加载，裸模块名解析不了），
 * 只能用相对路径引本包内的文件。canvasPaths 在另一个包里 —— 复制一份并让测试盯着一致
 * （与 VIRTUAL_CANVAS_PREFIX 副本的同一套做法）。
 */
import path from 'node:path'

/** 上游素材一条（与前端 uiData.UpstreamItem 同形，本包内自声明避免跨文件循环） */
export interface UpstreamItemLike {
  refName: string
  kind: string
  url?: string
  value?: string
  nodeId?: string
}


/** 画布 id 白名单：字母 / 数字 / 下划线 / 连字符，1-64 位（与 cloud-server 同源） */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isSafeCanvasId(id: string): boolean {
  return CANVAS_ID_RE.test(id)
}

/** 某个画布的资源目录：<数据根>/canvases/<id>/resources */
export function canvasResourcesDir(root: string, id: string): string {
  if (!isSafeCanvasId(id)) throw new Error('[canvasPathsShared] 非法画布 id: ' + id)
  return root + '/canvases/' + id + '/resources'
}

/** 调试文件子目录（本模块专用的一层） */
export const DEBUG_SUBDIR = 'debug'

/**
 * 调试文件名白名单（读取路由的唯一通行证）。
 * 形态：debug-<nodeId>[-vN].html | context-<nodeId>[-vN].js | sdk-<nodeId>[-vN].js
 * nodeId / 版本段都是字母数字下划线连字符 —— 单段、无路径分隔符，穿越拼不出来。
 */
const DEBUG_FILE_RE = /^(debug|context|sdk)-[A-Za-z0-9_-]{1,64}(-v[A-Za-z0-9_-]{0,63})?\.(html|js)$/

export function isSafeDebugFileName(name: string): boolean {
  return DEBUG_FILE_RE.test(name)
}

/** 把白名单校验 + 目录前缀复核合成一步：返回安全绝对路径，不合法返回 undefined */
export function resolveDebugFile(root: string, canvasId: string, name: string): string | undefined {
  if (!isSafeCanvasId(canvasId) || !isSafeDebugFileName(name)) return undefined
  const dir = path.join(canvasResourcesDir(root, canvasId), DEBUG_SUBDIR)
  const abs = path.resolve(dir, name)
  // 双保险：resolve 之后必须仍落在 debug/ 目录内（正则已排除分隔符，这条是兜底）
  const prefix = path.resolve(dir) + path.sep
  if (!abs.startsWith(prefix)) return undefined
  return abs
}

