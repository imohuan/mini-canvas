import type { AssetStore, AssetRecord } from './AssetStore'

interface DBRecord extends AssetRecord {
  blob: Blob
}

const DB_NAME = 'canvas-ai-assets'
const STORE_NAME = 'assets'
const DB_VERSION = 1

export class IndexedDBAssetStore implements AssetStore {
  private db: IDBDatabase | null = null
  private openPromise: Promise<IDBDatabase> | null = null

  private openDB(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db)
    if (this.openPromise) return this.openPromise

    this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'assetId' })
        }
      }
      req.onsuccess = () => {
        this.db = req.result
        resolve(this.db!)
      }
      req.onerror = () => {
        this.openPromise = null
        reject(req.error)
      }
    })
    return this.openPromise
  }

  async save(assetId: string, blob: Blob, fileName?: string, mimeType?: string): Promise<string> {
    const db = await this.openDB()
    // 已存在则跳过写入
    const existing = await this.get(assetId)
    if (existing) return assetId

    const record: DBRecord = {
      assetId,
      fileName: fileName || 'untitled',
      mimeType: mimeType || blob.type || 'application/octet-stream',
      size: blob.size,
      blob,
      createdAt: Date.now(),
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(record)
      tx.oncomplete = () => resolve(assetId)
      tx.onerror = () => reject(tx.error)
    })
  }

  async get(assetId: string): Promise<Blob | null> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(assetId)
      req.onsuccess = () => {
        const record = req.result as DBRecord | undefined
        resolve(record?.blob ?? null)
      }
      req.onerror = () => reject(req.error)
    })
  }

  async delete(assetId: string): Promise<void> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.delete(assetId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async has(assetId: string): Promise<boolean> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getKey(assetId)
      req.onsuccess = () => resolve(req.result !== undefined)
      req.onerror = () => reject(req.error)
    })
  }

  async list(): Promise<AssetRecord[]> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAll()
      req.onsuccess = () => {
        const records = (req.result as DBRecord[]).map(({ blob: _blob, ...meta }) => meta)
        resolve(records)
      }
      req.onerror = () => reject(req.error)
    })
  }

  async clear(): Promise<void> {
    const db = await this.openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
