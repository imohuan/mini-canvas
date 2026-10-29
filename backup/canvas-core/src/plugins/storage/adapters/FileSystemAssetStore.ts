import type { AssetStore, AssetRecord } from './AssetStore'

interface ManifestEntry {
  fileName: string
  mimeType: string
  size: number
  createdAt: number
  /** 磁盘上的实际文件名（可能不同于原始文件名，避免冲突） */
  diskName: string
}

type Manifest = Record<string, ManifestEntry>

const MANIFEST_FILE = '_manifest.json'
const ASSETS_DIR = 'assets'

export class FileSystemAssetStore implements AssetStore {
  #manifest: Manifest | null = null
  #projectDirHandle: FileSystemDirectoryHandle

  constructor(projectDirHandle: FileSystemDirectoryHandle) {
    this.#projectDirHandle = projectDirHandle
  }

  async #getAssetsDir(): Promise<FileSystemDirectoryHandle> {
    try {
      return await this.#projectDirHandle.getDirectoryHandle(ASSETS_DIR, { create: true })
    } catch {
      return this.#projectDirHandle.getDirectoryHandle(ASSETS_DIR, { create: true })
    }
  }

  async #loadManifest(): Promise<Manifest> {
    if (this.#manifest) return this.#manifest
    try {
      const dir = await this.#getAssetsDir()
      const fileHandle = await dir.getFileHandle(MANIFEST_FILE, { create: false })
      const file = await fileHandle.getFile()
      const text = await file.text()
      this.#manifest = JSON.parse(text)
    } catch {
      this.#manifest = {}
    }
    return this.#manifest!
  }

  async #saveManifest(): Promise<void> {
    if (!this.#manifest) return
    try {
      const dir = await this.#getAssetsDir()
      const fileHandle = await dir.getFileHandle(MANIFEST_FILE, { create: true })
      const writable = await (fileHandle as any).createWritable()
      await writable.write(JSON.stringify(this.#manifest, null, 2))
      await writable.close()
    } catch (err) {
      console.error('[FileSystemAssetStore] Failed to save manifest:', err)
    }
  }

  #extFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/ogg': '.ogv',
      'video/quicktime': '.mov',
    }
    return map[mimeType] || '.bin'
  }

  async save(assetId: string, blob: Blob, fileName?: string, mimeType?: string): Promise<string> {
    const manifest = await this.#loadManifest()
    // 已存在则跳过写入
    if (manifest[assetId]) return assetId

    const mime = mimeType || blob.type || 'application/octet-stream'
    const ext = this.#extFromMime(mime)
    const safeFileName = fileName
      ? assetId + '_' + fileName
      : assetId + ext

    const dir = await this.#getAssetsDir()
    const fileHandle = await dir.getFileHandle(safeFileName, { create: true })
    const writable = await (fileHandle as any).createWritable()
    await writable.write(blob)
    await writable.close()

    manifest[assetId] = {
      fileName: fileName || safeFileName,
      mimeType: mime,
      size: blob.size,
      createdAt: Date.now(),
      diskName: safeFileName,
    }

    await this.#saveManifest()
    return assetId
  }

  async get(assetId: string): Promise<Blob | null> {
    const manifest = await this.#loadManifest()
    const entry = manifest[assetId]
    if (!entry) return null

    try {
      const dir = await this.#getAssetsDir()
      const fileHandle = await dir.getFileHandle(entry.diskName, { create: false })
      return fileHandle.getFile()
    } catch (err) {
      console.error('[FileSystemAssetStore] Failed to get asset:', assetId, err)
      return null
    }
  }

  async delete(assetId: string): Promise<void> {
    const manifest = await this.#loadManifest()
    const entry = manifest[assetId]
    if (!entry) return

    try {
      const dir = await this.#getAssetsDir()
      await dir.removeEntry(entry.diskName)
    } catch (err) {
      console.error('[FileSystemAssetStore] Failed to delete asset file:', entry.diskName, err)
    }

    delete manifest[assetId]
    await this.#saveManifest()
  }

  async has(assetId: string): Promise<boolean> {
    const manifest = await this.#loadManifest()
    return assetId in manifest
  }

  async list(): Promise<AssetRecord[]> {
    const manifest = await this.#loadManifest()
    return Object.entries(manifest).map(([assetId, entry]) => ({
      assetId,
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      size: entry.size,
      createdAt: entry.createdAt,
    }))
  }

  async clear(): Promise<void> {
    try {
      const parentHandle = this.#projectDirHandle
      await parentHandle.removeEntry(ASSETS_DIR, { recursive: true })
    } catch {
      // 目录可能已不存在
    }
    this.#manifest = {}
  }
}
