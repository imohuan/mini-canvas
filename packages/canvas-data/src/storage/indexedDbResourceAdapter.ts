/**
 * IndexedDbResourceAdapter —— 本地资源后端（浏览器 IndexedDB）。
 *
 * 它是 **StorageAdapter 的"资源形式"孔位**（storage/types.ts 里的 put/resolve/removeResource）：
 * 文本形式（get/set/remove）留空不实现 —— 本地文本存储是 LocalStorageAdapter 的活，
 * 资源二进制走这个。一个 type 一个激活 adapter，资源那一格就是它。
 *
 * 两条不变量（用户明确要求）：
 * 1. **节点里只存 ref（id），绝不存 URL** —— URL 是临时的，刷新后就作废；
 * 2. **显示地址每次现算**：由 ref 取回字节 → 新建一个 objectURL。刷新后由 restore 再算一次。
 */
import type { ResourceAdapter, StorageAdapterCapability, ResourcePutOptions } from './types'

/** 库里存的一条记录 */
interface StoredResource {
  kind: string
  name?: string
  resource: Blob
}

const DB_NAME = 'mini-canvas-resources'
const STORE_NAME = 'blobs'

/** IndexedDB 可用的环境才建本地资源后端；Node / SSR 返回 undefined。 */
export function createIndexedDbResourceAdapter(): ResourceAdapter | undefined {
  if (typeof indexedDB === 'undefined') return undefined

  let dbPromise: Promise<IDBDatabase> | undefined
  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return dbPromise
  }

  const withStore = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const request = fn(tx.objectStore(STORE_NAME))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error)
    })
  }

  /** 自增 id（库内唯一即可；引用形态与云端不同，这正是 adapter 该自己决定的事） */
  let seq = 0
  const newId = (): string => {
    seq += 1
    const tail = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
    return `res-${seq}-${tail}`
  }

  /** 已建过的临时地址：同一 ref 多次 resolve 复用，避免每次调用都漏一个 objectURL */
  const urlCache = new Map<string, string>()

  const capability: StorageAdapterCapability = { list: false, transactional: false, offline: true }

  return {
    id: 'indexeddb-resource',
    capability,

    async putResource(blob: Blob, opts: ResourcePutOptions = {}): Promise<string> {
      // 调用方指定了 ref 就用它（名字可推算的资源靠这个"先查有没有、没有才造"）；
      // 没给或名字太长（IndexedDB 键没有硬上限，但太长的键不利于诊断）才自命名。
      const id = opts.ref && opts.ref.length <= 200 ? opts.ref : newId()
      const record: StoredResource = {
        kind: opts.kind ?? 'blob',
        ...(opts.name !== undefined ? { name: opts.name } : {}),
        resource: blob,
      }
      await withStore('readwrite', (store) => store.put(record, id))
      // 覆盖写要把旧的临时地址作废 —— 同一个 ref 内容变了，缓存的 objectURL 会指向旧字节
      const stale = urlCache.get(id)
      if (stale) {
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(stale)
        urlCache.delete(id)
      }
      return id
    },

    /**
     * 按 ref 现算显示地址。
     *
     * **这里是"临时地址"的唯一产地**：取回字节 → 新建 objectURL。
     * 刷新后内存里的地址没了，下次 resolve 再建一个新的 —— 所以它不该被存进任何地方。
     */
    async resolveResource(ref: string): Promise<string | undefined> {
      const cached = urlCache.get(ref)
      if (cached) return cached
      const stored = await withStore<StoredResource | undefined>('readonly', (store) => store.get(ref))
      if (!stored || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined
      const url = URL.createObjectURL(stored.resource)
      urlCache.set(ref, url)
      return url
    },

    async removeResource(ref: string): Promise<void> {
      const url = urlCache.get(ref)
      if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
      urlCache.delete(ref)
      await withStore('readwrite', (store) => store.delete(ref))
    },
  }
}
