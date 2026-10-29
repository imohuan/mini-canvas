export class IndexedDBAdapter {
  private dbName: string
  private storeName: string

  constructor(dbName: string, storeName: string) {
    this.dbName = dbName
    this.storeName = storeName
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName)
        }
      }

      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`))
      }
    })
  }

  async saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    try {
      const db = await this.openDB()
      const tx = db.transaction(this.storeName, 'readwrite')
      const store = tx.objectStore(this.storeName)
      store.put(handle, 'directoryHandle')
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(new Error(`Transaction failed: ${tx.error?.message}`))
      })
      db.close()
    } catch (err) {
      console.error('[IndexedDBAdapter] Failed to save handle:', err)
      throw err
    }
  }

  async getHandle(): Promise<FileSystemDirectoryHandle | null> {
    try {
      const db = await this.openDB()
      const tx = db.transaction(this.storeName, 'readonly')
      const store = tx.objectStore(this.storeName)
      const request = store.get('directoryHandle')
      const handle: FileSystemDirectoryHandle | undefined = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(new Error(`Get failed: ${request.error?.message}`))
      })
      db.close()
      return handle ?? null
    } catch (err) {
      console.error('[IndexedDBAdapter] Failed to get handle:', err)
      return null
    }
  }

  async clearHandle(): Promise<void> {
    try {
      const db = await this.openDB()
      const tx = db.transaction(this.storeName, 'readwrite')
      const store = tx.objectStore(this.storeName)
      store.delete('directoryHandle')
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(new Error(`Transaction failed: ${tx.error?.message}`))
      })
      db.close()
    } catch (err) {
      console.error('[IndexedDBAdapter] Failed to clear handle:', err)
      throw err
    }
  }
}
