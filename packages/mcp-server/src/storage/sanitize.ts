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

export const RUNTIME_FIELD_SET = new Set<string>(RUNTIME_FIELDS)

function cloneCanvasData(nodes: unknown[], edges: unknown[]): { nodes: any[]; edges: any[] } {
  return JSON.parse(JSON.stringify({ nodes, edges }))
}

function removeRuntimeData(data: Record<string, unknown>): void {
  for (const key of RUNTIME_FIELDS) delete data[key]
  const values = data.values
  if (!values || typeof values !== 'object') return
  for (const value of Object.values(values as Record<string, unknown>)) {
    if (value && typeof value === 'object') delete (value as Record<string, unknown>)._url
  }
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
