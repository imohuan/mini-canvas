const RUNTIME_FIELDS = ['imageUrl', 'videoUrl', 'thumbUrl', 'maskUrl', 'leftImageUrl', 'rightImageUrl', '_overlay', '_cropRect', '_cropMode', '_expandRect', '_expandMode', '_maskMode', '_maskConfig'] as const

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
  cleaned.nodes = cleaned.nodes.filter(node => node.type !== 'tempTarget' && !String(node.id ?? '').startsWith('temp-') && !node.data?.isTemp)
  cleaned.edges = cleaned.edges.filter(edge => !String(edge.id ?? '').startsWith('temp-') && !edge.data?.isTemp)
  return cleaned
}