export class FileSystemAdapter {
  #handle: FileSystemDirectoryHandle

  constructor(handle: FileSystemDirectoryHandle) {
    this.#handle = handle
  }

  get handle(): FileSystemDirectoryHandle {
    return this.#handle
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
      console.error('[FileSystemAdapter] Failed to write root JSON:', err)
      throw err
    }
  }

  private getProjectDirName(projectId: string): string {
    return `project-${projectId}`
  }

  async readProjectJSON<T>(projectId: string, fileName: string, fallback: T): Promise<T> {
    try {
      const dirName = this.getProjectDirName(projectId)
      const dirHandle = await this.#handle.getDirectoryHandle(dirName, { create: false })
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: false })
      const file = await fileHandle.getFile()
      const text = await file.text()
      return JSON.parse(text) as T
    } catch {
      return fallback
    }
  }

  async writeProjectJSON(projectId: string, fileName: string, data: unknown): Promise<void> {
    try {
      await this.createProjectFolder(projectId)
      const dirName = this.getProjectDirName(projectId)
      const dirHandle = await this.#handle.getDirectoryHandle(dirName, { create: false })
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
      const writable = await (fileHandle as any).createWritable()
      const json = JSON.stringify(data, null, 2)
      await writable.write(json)
      await writable.close()
    } catch (err) {
      console.error('[FileSystemAdapter] Failed to write project JSON:', err)
      throw err
    }
  }

  async createProjectFolder(projectId: string): Promise<void> {
    const dirName = this.getProjectDirName(projectId)
    try {
      await this.#handle.getDirectoryHandle(dirName, { create: true })
    } catch (err) {
      console.error('[FileSystemAdapter] Failed to create project folder:', err)
      throw err
    }
  }

  async deleteProjectFolder(projectId: string): Promise<void> {
    const dirName = this.getProjectDirName(projectId)
    try {
      await this.#handle.removeEntry(dirName, { recursive: true })
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
