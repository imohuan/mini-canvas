import type { AssetStore, AssetRecord } from './AssetStore'

/**
 * 资产管理器
 *
 * 封装 AssetStore + object URL 缓存管理。
 * 根据 StoragePlugin 的 mode 自动选择 IndexedDBAssetStore 或 FileSystemAssetStore。
 */
export class AssetManager {
  private store: AssetStore | null = null
  private objectURLs = new Map<string, string>()   // assetId → blob URL

  /** 设置底层存储（模式切换时调用） */
  setStore(store: AssetStore | null): void {
    this.revokeAllURLs()
    this.store = store
  }

  getStore(): AssetStore | null {
    return this.store
  }

  /** 计算 blob 内容的 SHA-256 哈希（16进制字符串，用作 assetId） */
  async contentHash(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /** 保存文件并返回 assetId（基于内容哈希，相同文件不重复存储） */
  async saveAsset(blob: Blob, fileName?: string, mimeType?: string): Promise<string> {
    if (!this.store) throw new Error('AssetManager: no store configured')
    const assetId = await this.contentHash(blob)
    // 已存在则直接返回，避免重复存储
    const existing = await this.store.get(assetId)
    if (existing) {
      if (!this.objectURLs.has(assetId)) {
        this.objectURLs.set(assetId, URL.createObjectURL(existing))
      }
      return assetId
    }
    await this.store.save(assetId, blob, fileName, mimeType)
    return assetId
  }

  /** 获取文件 blob */
  async getBlob(assetId: string): Promise<Blob | null> {
    if (!this.store) return null
    return this.store.get(assetId)
  }

  /**
   * 获取可用作 src 的 object URL
   *
   * 有缓存返回缓存，否则从 store 加载 blob 并创建新 URL。
   * 调用方不需要手动 revoke——AssetManager 管理整个生命周期。
   */
  async getObjectURL(assetId: string): Promise<string | null> {
    if (this.objectURLs.has(assetId)) {
      return this.objectURLs.get(assetId)!
    }
    if (!this.store) return null

    const blob = await this.store.get(assetId)
    if (!blob) return null

    const url = URL.createObjectURL(blob)
    this.objectURLs.set(assetId, url)
    return url
  }

  /** 立即创建一个临时的 object URL（不经过 store，用于刚保存后预览） */
  createTempURL(blob: Blob): string {
    return URL.createObjectURL(blob)
  }

  /** 替换 assetId 对应的 object URL（用于 crop 后更新） */
  setObjectURL(assetId: string, blob: Blob): string {
    this.revokeURL(assetId)
    const url = URL.createObjectURL(blob)
    this.objectURLs.set(assetId, url)
    return url
  }

  /** 释放单个 object URL */
  revokeURL(assetId: string): void {
    const url = this.objectURLs.get(assetId)
    if (url) {
      URL.revokeObjectURL(url)
      this.objectURLs.delete(assetId)
    }
  }

  /** 释放所有 object URL */
  revokeAllURLs(): void {
    for (const url of this.objectURLs.values()) {
      URL.revokeObjectURL(url)
    }
    this.objectURLs.clear()
  }

  /** 列出所有资产元数据 */
  async listAssets(): Promise<AssetRecord[]> {
    if (!this.store) return []
    return this.store.list()
  }

  /** 删除资产（同时释放 object URL） */
  async deleteAsset(assetId: string): Promise<void> {
    this.revokeURL(assetId)
    if (this.store) {
      await this.store.delete(assetId)
    }
  }

  /** 清空所有资产 */
  async clearAssets(): Promise<void> {
    this.revokeAllURLs()
    if (this.store) {
      await this.store.clear()
    }
  }

  get objectURLCount(): number {
    return this.objectURLs.size
  }
}
