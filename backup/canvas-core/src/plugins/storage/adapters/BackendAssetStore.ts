import type { AssetStore, AssetRecord } from './AssetStore'

/**
 * BackendAssetStore —— 把资源字节真正存到后端（mcp-server）画布资源文件夹的 AssetStore 实现。
 *
 * 作为系统默认（IndexedDB/FileSystem）资产存储的**可插拔替换**：接口与 AssetStore 一致，
 * 上传入口（图片/视频 upload、拖拽、粘贴——都经 AssetManager.saveAsset/getObjectURL）零改动，
 * 只是底层字节从"浏览器本地"换到"后端 project-{canvasId}/assets/"。
 *
 * 与后端约定：
 *   POST   /api/canvases/:id/resources          multipart 上传（服务端按 SHA-256 内容去重）
 *   GET    /api/canvases/:id/resources/:assetId 取回字节（assetId 可裸 hash 或带扩展名）
 *   DELETE /api/canvases/:id/resources/:assetId 删除
 *
 * canvasId 用 getter 注入：画布切换时不需重建 store，save/get 打到当前画布。
 */
export class BackendAssetStore implements AssetStore {
  private baseUrl: string
  /** 当前画布 id（每次操作时读取；null 表示未连接画布，save/get 拒绝） */
  private getCanvasId: () => string | null
  /** 本次会话内已见过的资源元数据（后端无 list 端点，用于 list()/has()/clear()） */
  private meta = new Map<string, AssetRecord>()

  constructor(baseUrl: string, getCanvasId: () => string | null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.getCanvasId = getCanvasId
  }

  /** 设置当前画布（切换画布时调用） */
  setCanvasId(canvasId: string | null): void {
    this.getCanvasId = () => canvasId
  }

  private canvas(): string {
    const id = this.getCanvasId()
    if (!id) throw new Error('[BackendAssetStore] 未连接画布，无法保存资源')
    return id
  }

  private resourceUrl(id: string, assetId?: string): string {
    const base = `${this.baseUrl}/api/canvases/${encodeURIComponent(id)}/resources`
    return assetId ? `${base}/${encodeURIComponent(assetId)}` : base
  }

  private recordOf(assetId: string, fileName: string, mimeType: string, size: number): AssetRecord {
    return { assetId, fileName: fileName || 'untitled', mimeType: mimeType || 'application/octet-stream', size, createdAt: Date.now() }
  }

  async save(assetId: string, blob: Blob, fileName?: string, mimeType?: string): Promise<string> {
    const id = this.canvas()
    // 上传后服务端以自身 SHA-256 为准；本地 assetId 也是同一字节的 sha256，二者一致。
    const fd = new FormData()
    fd.append('file', blob, fileName || 'file')
    const res = await fetch(this.resourceUrl(id), {
      method: 'POST',
      body: fd,
    })
    if (!res.ok) throw new Error(`[BackendAssetStore] 上传失败 HTTP ${res.status}`)
    const data = await res.json()
    const serverId = data?.assetId as string | undefined
    const finalId = serverId || assetId
    this.meta.set(finalId, this.recordOf(finalId, data?.name ?? fileName ?? 'file', data?.type ?? mimeType ?? '', Number(data?.size ?? blob.size)))
    return finalId
  }

  async get(assetId: string): Promise<Blob | null> {
    const id = this.getCanvasId()
    if (!id) return null
    const res = await fetch(this.resourceUrl(id, assetId))
    if (!res.ok) return null
    return await res.blob()
  }

  async has(assetId: string): Promise<boolean> {
    // 命中会话内元数据直接 true；否则回源探活
    if (this.meta.has(assetId)) return true
    return (await this.get(assetId)) !== null
  }

  async delete(assetId: string): Promise<void> {
    const id = this.getCanvasId()
    this.meta.delete(assetId)
    if (!id) return
    await fetch(this.resourceUrl(id, assetId), { method: 'DELETE' }).catch(() => {})
  }

  async list(): Promise<AssetRecord[]> {
    return [...this.meta.values()]
  }

  async clear(): Promise<void> {
    for (const id of [...this.meta.keys()]) await this.delete(id)
  }
}
