/**
 * 画布数据清洗（保存前调用）
 *
 * 与 canvas-core `packages/canvas-core/src/plugins/storage/sanitizeForSave.ts`
 * 保持格式一致（同构 JSON），确保前后端互读。零依赖纯函数。
 *
 * 来源：@mini-canvas/canvas-core（复制并保持结构不变）
 */

/** 运行时字段，保存时不落盘（blob URL / 裁剪状态等） */
const RUNTIME_FIELDS = [
  'imageUrl', 'videoUrl', 'thumbUrl', 'maskUrl', 'panoUrl',
  'leftImageUrl', 'rightImageUrl', '_overlay', '_cropRect', '_cropMode',
  '_expandRect', '_expandMode', '_maskMode', '_maskConfig', '_editing',
] as const

/** 媒体 URL 字段：blob:/data: 临时 URL 不落盘，http(s) 持久 URL 保留 */
const MEDIA_URL_FIELDS = [
  'imageUrl', 'videoUrl', 'thumbUrl', 'maskUrl', 'panoUrl', 'leftImageUrl', 'rightImageUrl',
] as const

function isTemporaryUrl(value: unknown): boolean {
  return typeof value === 'string' && /^(blob:|data:)/i.test(value)
}

function removeRuntimeData(data: Record<string, unknown>): void {
  for (const key of RUNTIME_FIELDS) {
    // 媒体 URL 字段：仅删除 blob:/data: 临时值，保留 http(s) 持久 URL
    if ((MEDIA_URL_FIELDS as readonly string[]).includes(key)) {
      if (isTemporaryUrl(data[key])) delete data[key]
      continue
    }
    delete data[key]
  }
  const values = data.values
  if (!values || typeof values !== 'object') return
  for (const value of Object.values(values as Record<string, unknown>)) {
    if (value && typeof value === 'object' && isTemporaryUrl((value as Record<string, unknown>)._url)) {
      delete (value as Record<string, unknown>)._url
    }
  }
}

function cloneCanvasData(nodes: unknown[], edges: unknown[]): { nodes: any[]; edges: any[] } {
  return JSON.parse(JSON.stringify({ nodes, edges }))
}

export function sanitizeForSave(nodes: unknown[], edges: unknown[]): { nodes: any[]; edges: any[] } {
  const cleaned = cloneCanvasData(nodes, edges)
  for (const node of cleaned.nodes) {
    if (node.data && typeof node.data === 'object') removeRuntimeData(node.data)
  }
  cleaned.nodes = cleaned.nodes.filter(
    (node) =>
      node.type !== 'tempTarget' &&
      !String(node.id ?? '').startsWith('temp-') &&
      !node.data?.isTemp,
  )
  cleaned.edges = cleaned.edges.filter(
    (edge) => !String(edge.id ?? '').startsWith('temp-') && !edge.data?.isTemp,
  )
  return cleaned
}
