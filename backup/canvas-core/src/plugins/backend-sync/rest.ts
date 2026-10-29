/**
 * backend-sync REST 封装 —— 前端经 REST 与后台画布服务通讯。
 *
 * - 所有调用指向后台 baseUrl（默认 http://localhost:8765）。
 * - 提供：列画布 / 全量拉取 / 批量节点 / 批量连线 / 语义化建节点 / 查节点状态。
 * - 图片节点的 imageUrl 若为后台相对路径(/api/...)，由本层补全为可展示的绝对 URL。
 */
export interface BatchOpResult {
  ok?: boolean
  added?: string[]
  deleted?: string[]
  updated?: string[]
  errors?: { op: string; index: number; message: string }[]
}

export class BackendRest {
  baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
    return (await res.json()) as T
  }

  async listCanvases(): Promise<{ canvases: { id: string; name: string; nodeCount: number; edgeCount: number }[] }> {
    return this.request('/api/canvases')
  }

  async getCanvas(canvasId: string): Promise<{ nodes: any[]; edges: any[] }> {
    return this.request(`/api/canvases/${encodeURIComponent(canvasId)}`)
  }

  async batchNodes(canvasId: string, ops: { add?: any[]; delete?: string[]; update?: any[] }): Promise<BatchOpResult> {
    return this.request(`/api/canvases/${encodeURIComponent(canvasId)}/batch-nodes`, {
      method: 'POST',
      body: JSON.stringify(ops),
    })
  }

  async batchEdges(canvasId: string, ops: { add?: any[]; delete?: string[]; update?: any[] }): Promise<BatchOpResult> {
    return this.request(`/api/canvases/${encodeURIComponent(canvasId)}/batch-edges`, {
      method: 'POST',
      body: JSON.stringify(ops),
    })
  }

  async createNode(canvasId: string, payload: { type: string; args: Record<string, unknown>; position?: { x: number; y: number } }): Promise<any> {
    return this.request(`/api/canvases/${encodeURIComponent(canvasId)}/create-node`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async nodeStatus(canvasId: string, nodeId: string): Promise<any> {
    return this.request(`/api/canvases/${encodeURIComponent(canvasId)}/nodes/${encodeURIComponent(nodeId)}/status`)
  }
}

/**
 * 把节点 data 里后台返回的相对 media 路径补全为可展示 URL。
 * 规则：/api/... 开头 → `${baseUrl}${path}`；http(s) 保留；其余原样。
 */
export function absolutizeMedia(baseUrl: string, value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value.startsWith('/api/')) return `${baseUrl}${value}`
  if (/^https?:|^data:|^blob:|^file:/i.test(value)) return value
  return value
}

/** 深度补全节点 data 中所有形如 imageUrl/sourcePath 的 media 字段为可访问 URL（浅层：单层 data + options 顶层） */
export function withAbsolutizedUrls(baseUrl: string, nodeData: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!nodeData || typeof nodeData !== 'object') return nodeData
  const out: Record<string, unknown> = { ...nodeData }
  const urlKeys = ['imageUrl', 'src', 'url', 'maskUrl']
  for (const k of urlKeys) {
    if (typeof out[k] === 'string') out[k] = absolutizeMedia(baseUrl, out[k])
  }
  // runState 里的结果 url 也要补全（后台结果落在 runState.urls / runState.imageUrl，
  // ImageNode 会把首个结果抬升到顶层 data.imageUrl 供 <img> 展示，必须已是绝对可访问 URL）
  const rs = out.runState
  if (rs && typeof rs === 'object') {
    const rso: Record<string, unknown> = { ...(rs as Record<string, unknown>) }
    if (typeof rso.imageUrl === 'string') rso.imageUrl = absolutizeMedia(baseUrl, rso.imageUrl)
    if (Array.isArray(rso.urls)) rso.urls = rso.urls.map((u) => absolutizeMedia(baseUrl, u))
    out.runState = rso
  }
  return out
}
