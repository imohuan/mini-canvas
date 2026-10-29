/**
 * projectsApi —— 项目 / 画布 / 资产的后端调用（cloud-server）。
 *
 * 为什么单独一层：项目页与画布工作台都要读同一批数据（项目清单、某项目的画布清单），
 * 集中在这里，两边不各写一份 fetch（地址、错误处理、形状只维护一处）。
 */
import { withAdminToken } from '@mini-canvas/canvas-base'

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
  /** 本机绝对路径（有字节落盘时才有；客户端的引用要用它，见「添加到 Agent」） */
  path?: string
  folderId?: string
  tags?: string[]
  canvasId?: string
  size?: number
  source: 'generated' | 'upload'
  createdAt: number
}
export interface AssetFolderSummary {
  id: string
  name: string
  parentId?: string
  icon?: string
  createdAt: number
}

/** 后端地址：与 cloud-client 同一口径（留空 = 同源）——这里只管相对路径，由同源托管提供 */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  /*
   * 写接口要管理令牌（`POST /api/canvases/*` 在清单里，`/duplicate` 也在）。
   * 统一加在 `req` 这个出口上：GET 带了无害，写请求不会漏。
   * 以前这里裸 fetch —— 「复制画布」点下去就是 403，而且报错只说「请求失败」。
   */
  const res = await fetch(path, init ? { ...init, headers: withAdminToken(headersOf(init)) } : init)
  const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!res.ok || body?.ok === false) throw new Error(body?.error || '请求失败（HTTP ' + res.status + '）')
  return body
}

/** 把 RequestInit.headers 归一成普通对象（Headers / 数组 / 对象三种写法都可能有） */
function headersOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries())
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
/** 复制画布（节点 / 边 / 资源 / 历史；视口不带走）。返回新画布的索引项。 */
export async function duplicateCanvas(id: string): Promise<CanvasSummary> {
  return (await req<{ canvas: CanvasSummary }>('/api/canvases/' + id + '/duplicate', { method: 'POST' }))
    .canvas
}
/** 删除画布（连带它的文件夹与资源） */
export async function deleteCanvas(id: string): Promise<void> {
  await req('/api/canvases/' + id, { method: 'DELETE' })
}

// ==================== 资产 ====================
export async function listAssets(): Promise<AssetSummary[]> {
  return (await req<{ assets: AssetSummary[] }>('/api/assets')).assets ?? []
}

/** 上传资产：字节直传后台（后台按内容落盘并登记 source='upload'） */
export async function uploadAsset(name: string, bytes: ArrayBuffer | Blob, folderId?: string): Promise<AssetSummary> {
  const q = '?name=' + encodeURIComponent(name) + (folderId ? '&folderId=' + encodeURIComponent(folderId) : '')
  /*
   * 走统一的 req 出口（带管理令牌、统一错误文案）。以前这里裸 fetch：
   * 后台把资产上传纳入写接口鉴权后，这条会 403，而且报错只说「上传失败」。
   */
  const body = await req<{ ok?: boolean; asset?: AssetSummary; error?: string }>('/api/assets' + q, {
    method: 'POST',
    body: bytes as BodyInit,
  })
  if (!body?.asset) throw new Error(body?.error || '上传失败')
  return body.asset
}

/** 删除资产（后台按 id 摘除登记；本体文件保留在 assets/files 目录里不回收） */
export async function deleteAsset(id: string): Promise<void> {
  await req('/api/assets/' + id, { method: 'DELETE' })
}

// ==================== 资产文件夹 ====================
export async function listAssetFolders(): Promise<AssetFolderSummary[]> {
  return (await req<{ folders: AssetFolderSummary[] }>('/api/asset-folders')).folders ?? []
}
export async function createAssetFolder(name: string, parentId?: string): Promise<AssetFolderSummary> {
  return (await req<{ folder: AssetFolderSummary }>('/api/asset-folders', json('POST', { name, parentId }))).folder
}
export async function renameAssetFolder(id: string, name: string): Promise<AssetFolderSummary> {
  return (await req<{ folder: AssetFolderSummary }>('/api/asset-folders/' + id, json('PATCH', { name }))).folder
}
/** 更新文件夹图标（空串 = 清除回默认） */
export async function setAssetFolderIcon(id: string, icon: string): Promise<AssetFolderSummary> {
  return (await req<{ folder: AssetFolderSummary }>('/api/asset-folders/' + id, json('PATCH', { icon }))).folder
}
/** 移动文件夹（parentId 空 = 回根；后台拒绝成环） */
export async function moveAssetFolder(id: string, parentId?: string): Promise<AssetFolderSummary> {
  return (await req<{ folder: AssetFolderSummary }>('/api/asset-folders/' + id, json('PATCH', { parentId }))).folder
}
export async function deleteAssetFolder(id: string): Promise<void> {
  await req('/api/asset-folders/' + id, { method: 'DELETE' })
}

// ==================== 资产批量 / 标签 ====================
/** 整组资产挪到某文件夹（folderId 传空 = 回根目录）。「移动到」「添加到」共用。 */
export async function moveAssets(ids: string[], folderId?: string): Promise<void> {
  await req('/api/assets/batch', json('POST', { ids, folderId }))
}
/** 覆盖式设置标签（固定清单） */
export async function setAssetTags(id: string, tags: string[]): Promise<void> {
  await req('/api/assets/' + id, json('PATCH', { tags }))
}
/** 资产改名 */
export async function renameAsset(id: string, name: string): Promise<void> {
  await req('/api/assets/' + id, json('PATCH', { name }))
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
