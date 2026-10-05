/**
 * projectsApi —— 项目 / 画布 / 资产的后端调用（cloud-server）。
 *
 * 为什么单独一层：项目页与画布工作台都要读同一批数据（项目清单、某项目的画布清单），
 * 集中在这里，两边不各写一份 fetch（地址、错误处理、形状只维护一处）。
 */

export interface ProjectSummary {
  id: string
  name: string
  createdAt: number
  canvasCount: number
}
export interface CanvasSummary {
  id: string
  name: string
  projectId: string
  createdAt: number
}
export interface AssetSummary {
  id: string
  name: string
  kind: 'image' | 'video' | 'audio' | 'other'
  url: string
  canvasId?: string
  size?: number
  source: 'generated' | 'upload'
  createdAt: number
}

/** 后端地址：与 cloud-client 同一口径（留空 = 同源）——这里只管相对路径，由同源托管提供 */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!res.ok || body?.ok === false) throw new Error(body?.error || '请求失败（HTTP ' + res.status + '）')
  return body
}

// ==================== 项目 ====================
export async function listProjects(): Promise<ProjectSummary[]> {
  return (await req<{ projects: ProjectSummary[] }>('/api/projects')).projects ?? []
}
export async function createProject(name: string): Promise<ProjectSummary> {
  return (await req<{ project: ProjectSummary }>('/api/projects', json('POST', { name }))).project
}
export async function deleteProject(id: string): Promise<void> {
  await req('/api/projects/' + id, { method: 'DELETE' })
}
export async function renameProject(id: string, name: string): Promise<ProjectSummary> {
  return (await req<{ project: ProjectSummary }>('/api/projects/' + id, json('PATCH', { name }))).project
}

// ==================== 画布 ====================
export async function listCanvases(projectId: string): Promise<CanvasSummary[]> {
  return (await req<{ canvases: CanvasSummary[] }>('/api/projects/' + projectId + '/canvases')).canvases ?? []
}
export async function createCanvas(projectId: string, name: string): Promise<CanvasSummary> {
  return (await req<{ canvas: CanvasSummary }>('/api/projects/' + projectId + '/canvases', json('POST', { name }))).canvas
}
export async function renameCanvas(id: string, name: string): Promise<void> {
  await req('/api/canvases/' + id + '/meta', json('PATCH', { name }))
}

// ==================== 资产 ====================
export async function listAssets(): Promise<AssetSummary[]> {
  return (await req<{ assets: AssetSummary[] }>('/api/assets')).assets ?? []
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
