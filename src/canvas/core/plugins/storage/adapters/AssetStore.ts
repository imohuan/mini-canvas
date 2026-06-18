/**
 * 资产记录——持久化的元数据，不含二进制数据
 */
export interface AssetRecord {
  /** 唯一标识，基于内容 SHA-256 */
  assetId: string
  /** 原始文件名 */
  fileName: string
  /** MIME 类型 */
  mimeType: string
  /** 文件大小（字节） */
  size: number
  /** 创建时间戳 */
  createdAt: number
}

/**
 * 资产存储抽象接口
 *
 * 两种实现：
 * - IndexedDBAssetStore (localStorage 模式，blob 存 IndexedDB)
 * - FileSystemAssetStore (File System 模式，文件存本地文件夹)
 */
export interface AssetStore {
  /** 保存一个二进制文件（assetId 由调用方基于内容哈希计算），返回 assetId */
  save(assetId: string, blob: Blob, fileName?: string, mimeType?: string): Promise<string>

  /** 根据 assetId 获取 Blob */
  get(assetId: string): Promise<Blob | null>

  /** 删除一个资产 */
  delete(assetId: string): Promise<void>

  /** 列出所有资产元数据 */
  list(): Promise<AssetRecord[]>

  /** 检查资产是否存在 */
  has(assetId: string): Promise<boolean>

  /** 清空所有资产 */
  clear(): Promise<void>
}
