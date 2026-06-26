export class FileSystemAdapter {
  #handle: FileSystemDirectoryHandle
  /** 缓存项目目录 handle，减少 root handle 调用次数 */
  #projectDirs = new Map<string, FileSystemDirectoryHandle>()

  constructor(handle: FileSystemDirectoryHandle) {
    this.#handle = handle
  }

  get handle(): FileSystemDirectoryHandle {
    return this.#handle
  }

  /** 无效化缓存（handle 恢复时调用） */
  invalidateCache() {
    this.#projectDirs.clear()
  }

  async readRootJSON<T>(fileName: string, fallback: T): Promise<T> {
    try {
      const fileHandle = await this.#handle.getFileHandle(fileName, { create: false })
      const file = await fileHandle.getFile()
      const text = await file.text()
      return JSON.parse(text) as T
    } catch {
      return fallback
    }
  }

  async writeRootJSON(fileName: string, data: unknown): Promise<void> {
    try {
      const fileHandle = await this.#handle.getFileHandle(fileName, { create: true })
      const writable = await (fileHandle as any).createWritable()
      const json = JSON.stringify(data, null, 2)
      await writable.write(json)
      await writable.close()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        console.warn('[FileSystemAdapter] Root handle became invalid. Data saved to localStorage fallback.')
        this.#projectDirs.clear()
      } else {
        console.error('[FileSystemAdapter] Failed to write root JSON:', err)
      }
      throw err
    }
  }

  private getProjectDirName(projectId: string): string {
    return `project-${projectId}`
  }

  async readProjectJSON<T>(projectId: string, fileName: string, fallback: T): Promise<T> {
    try {
      let dirHandle = this.#projectDirs.get(projectId)
      if (!dirHandle) {
        const dirName = this.getProjectDirName(projectId)
        dirHandle = await this.#handle.getDirectoryHandle(dirName, { create: false })
        this.#projectDirs.set(projectId, dirHandle)
      }
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: false })
      const file = await fileHandle.getFile()
      const text = await file.text()
      return JSON.parse(text) as T
    } catch (err) {
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        console.warn('[FileSystemAdapter] Handle invalidated during read, clearing cache.')
        this.#projectDirs.clear()
      }
      return fallback
    }
  }

  async writeProjectJSON(projectId: string, fileName: string, data: unknown): Promise<void> {
    try {
      // 使用缓存的项目目录 handle，避免每次都操作 root handle
      let dirHandle = this.#projectDirs.get(projectId)
      if (!dirHandle) {
        await this.createProjectFolder(projectId)
        const dirName = this.getProjectDirName(projectId)
        dirHandle = await this.#handle.getDirectoryHandle(dirName, { create: false })
        this.#projectDirs.set(projectId, dirHandle)
      }

      const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
      const writable = await (fileHandle as any).createWritable()
      const json = JSON.stringify(data, null, 2)
      await writable.write(json)
      await writable.close()
    } catch (err) {
      // InvalidStateError: handle 缓存状态失效，清除缓存让下次重建
      if (err instanceof DOMException && err.name === 'InvalidStateError') {
        console.warn('[FileSystemAdapter] Handle invalidated, clearing cache. Data in localStorage is safe.')
        this.#projectDirs.clear()
      } else {
        console.error('[FileSystemAdapter] Failed to write project JSON:', err)
      }
      throw err
    }
  }

  async createProjectFolder(projectId: string): Promise<void> {
    const dirName = this.getProjectDirName(projectId)
    try {
      const dirHandle = await this.#handle.getDirectoryHandle(dirName, { create: true })
      this.#projectDirs.set(projectId, dirHandle)
    } catch (err) {
      console.error('[FileSystemAdapter] Failed to create project folder:', err)
      throw err
    }
  }

  async deleteProjectFolder(projectId: string): Promise<void> {
    const dirName = this.getProjectDirName(projectId)
    try {
      await this.#handle.removeEntry(dirName, { recursive: true })
      this.#projectDirs.delete(projectId)
    } catch (err) {
      console.error('[FileSystemAdapter] Failed to delete project folder:', err)
      throw err
    }
  }

  async fileExists(path: string): Promise<boolean> {
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) return false

    try {
      let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = this.#handle

      for (let i = 0; i < parts.length; i++) {
        const dirHandle = currentHandle as FileSystemDirectoryHandle
        const isLast = i === parts.length - 1

        if (isLast) {
          await dirHandle.getFileHandle(parts[i], { create: false })
          return true
        } else {
          currentHandle = await dirHandle.getDirectoryHandle(parts[i], { create: false })
        }
      }

      return true
    } catch {
      return false
    }
  }
}
