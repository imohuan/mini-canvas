import type { CanvasPlugin, PluginContext } from '../types'
import { IndexedDBAdapter } from './adapters/IndexedDBAdapter'
import { FileSystemAdapter } from './adapters/FileSystemAdapter'
import { AssetManager } from './adapters/AssetManager'
import { IndexedDBAssetStore } from './adapters/IndexedDBAssetStore'
import { FileSystemAssetStore } from './adapters/FileSystemAssetStore'

export interface StorageOptions {
  [key: string]: unknown
  autoConnect?: boolean
  workspaceName?: string
  dbName?: string
  storeName?: string
}

export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface CanvasData {
  nodes: any[]
  edges: any[]
}

export interface StorageStatus {
  isConnected: boolean
  mode: 'localStorage' | 'filesystem' | 'none'
  workspaceName: string | null
  currentProjectId: string | null
  projectCount: number
}

export interface StorageAPI {
  readonly isConnected: boolean
  readonly status: StorageStatus
  /** 连接文件系统（需要用户点击触发） */
  connect(): Promise<string>
  /** 断开文件系统连接 */
  disconnect(): Promise<void>
  /** 尝试恢复之前的工作区 */
  tryRestore(): Promise<{
    hasPreviousWorkspace: boolean
    workspaceName: string | null
    restored: boolean
    needsUserActivation: boolean
  }>
  /** 创建项目 */
  createProject(name: string): ProjectMeta
  /** 删除项目 */
  deleteProject(id: string): Promise<void>
  /** 切换项目 */
  switchProject(id: string): Promise<{ meta: ProjectMeta; nodes: any[]; edges: any[] } | null>
  /** 获取项目数据 */
  getProject(id: string): Promise<{ meta: ProjectMeta; nodes: any[]; edges: any[] } | null>
  /** 列出所有项目 */
  listProjects(): ProjectMeta[]
  /** 当前项目ID */
  readonly currentProjectId: string | null
  /** 保存画布数据 */
  saveCanvas(nodes: any[], edges: any[]): Promise<void>
  /** 加载画布数据 */
  loadCanvas(projectId: string): Promise<CanvasData>
  /** 资产管理器（图片/视频等二进制资源） */
  readonly assets: AssetManager
}

function sanitizeForSave(nodes: any[], edges: any[]): CanvasData {
  const cleaned = JSON.parse(JSON.stringify({ nodes, edges }))

  for (const n of cleaned.nodes) {
    if (!n.data) continue

    // 清理运行时字段（blob URL 不持久化）
    const runtimeFields = ['imageUrl', 'videoUrl', 'thumbUrl', '_cropRect', '_cropMode']
    for (const key of runtimeFields) {
      delete n.data[key]
    }

    // 清理 values 中的 _url
    if (n.data.values) {
      for (const v of Object.values(n.data.values) as any[]) {
        if (v && typeof v === 'object') {
          delete v._url
        }
      }
    }

    // 过滤无效节点类型
    const validTypes = ['image-input', 'video-generation']
    if (!validTypes.includes(n.type)) {
      n.type = 'image-input'
    }
  }

  cleaned.nodes = cleaned.nodes.filter((n: any) => !n.id?.startsWith('temp-'))
  cleaned.edges = cleaned.edges.filter(
    (e: any) => !e.id?.startsWith('temp-') && !e.data?.isTemp,
  )

  return cleaned
}

// ===== LocalStorage fallback constants =====
const LS_KEY_PROJECT_INDEX = 'canvas-ai:project-index'
const LS_KEY_PREFIX = 'canvas-ai:project:'

export const StoragePlugin: CanvasPlugin<StorageOptions, StorageAPI> = {
  name: 'storage',
  version: '0.2.0',
  dependencies: [],

  async install(context: PluginContext, options: StorageOptions) {
    const dbName = options.dbName ?? 'canvas-ai-db'
    const storeName = options.storeName ?? 'handles'
    const indexedDB = new IndexedDBAdapter(dbName, storeName)
    let fsAdapter: FileSystemAdapter | null = null
    let isConnected = false
    let connectionMode: 'localStorage' | 'filesystem' | 'none' = 'localStorage'
    let currentProjectId: string | null = null
    const projectIndex: ProjectMeta[] = []
    const canvasDataCache = new Map<string, CanvasData>()
    const assetManager = new AssetManager()

    // localStorage 模式 — 初始化 IndexedDB 资产存储
    assetManager.setStore(new IndexedDBAssetStore())

    // ===== LocalStorage helpers =====
    function loadProjectsFromLocalStorage(): ProjectMeta[] {
      try {
        const raw = localStorage.getItem(LS_KEY_PROJECT_INDEX)
        return raw ? JSON.parse(raw) : []
      } catch {
        return []
      }
    }

    function saveProjectsToLocalStorage(): void {
      localStorage.setItem(LS_KEY_PROJECT_INDEX, JSON.stringify(projectIndex))
    }

    function saveCanvasToLocalStorage(projectId: string, data: CanvasData): void {
      localStorage.setItem(`${LS_KEY_PREFIX}${projectId}`, JSON.stringify(data))
    }

    function loadCanvasFromLocalStorage(projectId: string): CanvasData {
      try {
        const raw = localStorage.getItem(`${LS_KEY_PREFIX}${projectId}`)
        return raw ? JSON.parse(raw) : { nodes: [], edges: [] }
      } catch {
        return { nodes: [], edges: [] }
      }
    }

    function buildStatus(): StorageStatus {
      return {
        isConnected,
        mode: connectionMode,
        workspaceName: fsAdapter ? 'File System' : (isConnected ? 'localStorage' : null),
        currentProjectId,
        projectCount: projectIndex.length,
      }
    }

    function emitStatus() {
      context.emit('storage:status', buildStatus())
    }

    /**
     * 恢复资源 URL — 刷新后 blob URL 失效，从已持久化的 assetId 重建
     * setTimeout 确保在画布节点完成初始加载后执行
     */
    let _restoreTimer: ReturnType<typeof setTimeout> | null = null
    function scheduleRestoreAssetURLs() {
      if (_restoreTimer) clearTimeout(_restoreTimer)
      _restoreTimer = setTimeout(async () => {
        try {
          const nodes = context.actions.getNodes()
          console.log(`[Storage:restore] 开始巡检，画布节点数=${nodes.length}`, nodes.map(n => ({ id: n.id, assetId: (n.data as any)?.assetId, imageUrl: typeof (n.data as any)?.imageUrl === 'string' ? `${(n.data as any).imageUrl.slice(0, 60)}...` : (n.data as any)?.imageUrl, nodeType: (n.data as any)?.nodeType })))
          if (nodes.length === 0) {
            console.log('[Storage:restore] 画布无节点，跳过')
            return
          }
          let restored = 0
          let skipped = 0
          let failed = 0
          for (const node of nodes) {
            const data = node.data as any
            if (!data?.assetId) continue
            const url = data.nodeType === 'video' ? data.videoUrl : data.imageUrl
            // blob: URL 刷新后必然失效 → 需要强制恢复
            const needRestore = !url || (typeof url === 'string' && url.startsWith('blob:'))
            if (!needRestore) {
              skipped++
              continue
            }
            const key = data.nodeType === 'video' ? 'videoUrl' : 'imageUrl'
            console.log(`[Storage:restore] 尝试恢复: nodeId=${node.id}, assetId=${data.assetId}, 旧URL=${typeof url === 'string' ? url.slice(0, 50) + '...' : '无'}`)
            const newUrl = await assetManager.getObjectURL(data.assetId)
            if (newUrl) {
              context.actions.updateNode(node.id, { data: { ...data, [key]: newUrl } })
              restored++
              console.log(`[Storage:restore] ✅ 已恢复: nodeId=${node.id}`)
            } else {
              failed++
              console.warn(`[Storage:restore] ❌ getObjectURL 返回 null: nodeId=${node.id}, assetId=${data.assetId}`)
            }
          }
          console.log(`[Storage:restore] 完成: 恢复=${restored}, 跳过=${skipped}, 失败=${failed}`)
        } catch (err) {
          console.error('[Storage:restore] 异常:', err)
          context.logger.warn('[Storage] restoreAssetURLs 失败:', err)
        }
      }, 300)
    }

    // ===== Auto-create default project on first load =====
    async function ensureDefaultProject(): Promise<void> {
      const saved = loadProjectsFromLocalStorage()
      if (saved.length > 0) {
        projectIndex.length = 0
        projectIndex.push(...saved)
        currentProjectId = projectIndex[0].id
        return
      }

      if (fsAdapter) {
        const fsIndex = await fsAdapter.readRootJSON<ProjectMeta[]>('canvas-ai-project-index.json', [])
        if (fsIndex.length > 0) {
          projectIndex.length = 0
          projectIndex.push(...fsIndex)
          currentProjectId = projectIndex[0].id
          return
        }
      }

      const defaultProject: ProjectMeta = {
        id: 'default',
        name: '默认项目',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      projectIndex.push(defaultProject)
      saveProjectsToLocalStorage()
      currentProjectId = 'default'
      context.emit('storage:project-created', { project: defaultProject })
    }

    const api: StorageAPI = {
      get isConnected() {
        return isConnected
      },

      get status() {
        return buildStatus()
      },

      async connect() {
        if (!('showDirectoryPicker' in window)) {
          isConnected = true
          connectionMode = 'localStorage'
          emitStatus()
          context.emit('storage:connected', { workspaceName: 'localStorage' })
          return 'localStorage'
        }

        try {
          const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' })
          await indexedDB.saveHandle(handle)
          fsAdapter = new FileSystemAdapter(handle)
          isConnected = true
          connectionMode = 'filesystem'

          // 先同步项目索引
          const fsIndex = await fsAdapter.readRootJSON<ProjectMeta[]>('canvas-ai-project-index.json', [])
          for (const p of fsIndex) {
            if (!projectIndex.some((existing) => existing.id === p.id)) {
              projectIndex.push(p)
            }
          }
          saveProjectsToLocalStorage()

          // 确保 currentProjectId 存在（切换 AssetStore 之前必须确定）
          if (!currentProjectId) {
            if (projectIndex.length > 0) {
              currentProjectId = projectIndex[0].id
            } else {
              // 自动创建默认项目
              const defaultProject: ProjectMeta = {
                id: 'default',
                name: '默认项目',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
              projectIndex.push(defaultProject)
              saveProjectsToLocalStorage()
              currentProjectId = 'default'
              context.emit('storage:project-created', { project: defaultProject })
            }
          }

          // 切换到文件系统资产存储
          {
            const projDirName = `project-${currentProjectId}`
            const projDirHandle = await handle.getDirectoryHandle(projDirName, { create: true })
            assetManager.setStore(new FileSystemAssetStore(projDirHandle))
          }

          // 恢复资源 URL（刷新后 blob URL 失效）
          scheduleRestoreAssetURLs()

          emitStatus()
          context.emit('storage:connected', { workspaceName: handle.name })
          return handle.name
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            isConnected = true
            connectionMode = 'localStorage'
            emitStatus()
            return 'localStorage'
          }
          throw err
        }
      },

      async disconnect() {
        fsAdapter = null
        isConnected = false
        connectionMode = 'none'
        currentProjectId = null
        projectIndex.length = 0
        canvasDataCache.clear()
        assetManager.revokeAllURLs()
        assetManager.setStore(new IndexedDBAssetStore())  // fallback
        await indexedDB.clearHandle()
        emitStatus()
        context.emit('storage:disconnected', {})
      },

      async tryRestore() {
        const handle = await indexedDB.getHandle()
        if (!handle) {
          await ensureDefaultProject()
          isConnected = true
          connectionMode = 'localStorage'
          emitStatus()
          return {
            hasPreviousWorkspace: false,
            workspaceName: 'localStorage',
            restored: true,
            needsUserActivation: false,
          }
        }

        try {
          const perm = await (handle as any).requestPermission({ mode: 'readwrite' })
          if (perm !== 'granted') {
            return {
              hasPreviousWorkspace: true,
              workspaceName: handle.name,
              restored: false,
              needsUserActivation: false,
            }
          }
        } catch {
          return {
            hasPreviousWorkspace: true,
            workspaceName: handle.name,
            restored: false,
            needsUserActivation: true,
          }
        }

        fsAdapter = new FileSystemAdapter(handle)
        isConnected = true
        connectionMode = 'filesystem'

        // 先同步项目索引
        const fsIndex = await fsAdapter.readRootJSON<ProjectMeta[]>('canvas-ai-project-index.json', [])
        projectIndex.length = 0
        projectIndex.push(...fsIndex)

        // 确保 currentProjectId 存在（切换 AssetStore 之前必须确定）
        if (!currentProjectId) {
          if (projectIndex.length > 0) {
            currentProjectId = projectIndex[0].id
          } else {
            const defaultProject: ProjectMeta = {
              id: 'default',
              name: '默认项目',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
            projectIndex.push(defaultProject)
            saveProjectsToLocalStorage()
            currentProjectId = 'default'
            context.emit('storage:project-created', { project: defaultProject })
          }
        }

        // 切换到文件系统资产存储
        {
          const projDirName = `project-${currentProjectId}`
          const projDirHandle = await handle.getDirectoryHandle(projDirName, { create: true })
          assetManager.setStore(new FileSystemAssetStore(projDirHandle))
        }

        // 恢复资源 URL
        scheduleRestoreAssetURLs()

        emitStatus()
        context.emit('storage:connected', { workspaceName: handle.name })
        return {
          hasPreviousWorkspace: true,
          workspaceName: handle.name,
          restored: true,
          needsUserActivation: false,
        }
      },

      createProject(name: string) {
        const project: ProjectMeta = {
          id: `project-${Date.now()}`,
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        projectIndex.push(project)
        saveProjectsToLocalStorage()

        if (fsAdapter) {
          fsAdapter.writeRootJSON('canvas-ai-project-index.json', projectIndex).catch(() => {})
        }

        context.emit('storage:project-created', { project })
        return project
      },

      async deleteProject(id: string) {
        const idx = projectIndex.findIndex((p) => p.id === id)
        if (idx >= 0) projectIndex.splice(idx, 1)
        canvasDataCache.delete(id)
        localStorage.removeItem(`${LS_KEY_PREFIX}${id}`)
        saveProjectsToLocalStorage()

        if (fsAdapter) {
          await fsAdapter.deleteProjectFolder(id)
          await fsAdapter.writeRootJSON('canvas-ai-project-index.json', projectIndex)
        }

        if (currentProjectId === id) {
          currentProjectId = projectIndex.length > 0 ? projectIndex[0].id : null
        }
        emitStatus()
        context.emit('storage:project-deleted', { projectId: id })
      },

      async switchProject(id: string) {
        const meta = projectIndex.find((p) => p.id === id)
        if (!meta) return null
        currentProjectId = id

        // 切换文件系统资产目录
        if (fsAdapter && connectionMode === 'filesystem') {
          fsAdapter.handle.getDirectoryHandle(`project-${id}`, { create: true }).then((dirHandle) => {
            assetManager.setStore(new FileSystemAssetStore(dirHandle))
            scheduleRestoreAssetURLs()
          }).catch(() => {})
        }

        const data = await this.loadCanvas(id)
        meta.updatedAt = Date.now()
        saveProjectsToLocalStorage()
        emitStatus()
        context.emit('storage:project-switched', { projectId: id, meta })
        return { meta, ...data }
      },

      async getProject(id: string) {
        const meta = projectIndex.find((p) => p.id === id)
        if (!meta) return null
        const data = await this.loadCanvas(id)
        return { meta, ...data }
      },

      listProjects() {
        return [...projectIndex]
      },

      get currentProjectId() {
        return currentProjectId
      },

      get assets() {
        return assetManager
      },

      async saveCanvas(nodes: any[], edges: any[]) {
        if (!currentProjectId) return

        const cleaned = sanitizeForSave(nodes, edges)
        canvasDataCache.set(currentProjectId, cleaned)

        saveCanvasToLocalStorage(currentProjectId, cleaned)

        const proj = projectIndex.find((p) => p.id === currentProjectId)
        if (proj) {
          proj.updatedAt = Date.now()
          saveProjectsToLocalStorage()
        }

        if (fsAdapter) {
          try {
            await fsAdapter.writeProjectJSON(currentProjectId, 'project.json', cleaned)
            await fsAdapter.writeRootJSON('canvas-ai-project-index.json', projectIndex)
          } catch (err) {
            context.logger.warn('[Storage] FS save failed, data saved to localStorage:', err)
          }
        }

        context.emit('storage:saved', { projectId: currentProjectId })
      },

      async loadCanvas(projectId: string) {
        if (canvasDataCache.has(projectId)) {
          return canvasDataCache.get(projectId)!
        }
        const cached = loadCanvasFromLocalStorage(projectId)
        if (cached.nodes.length > 0 || cached.edges.length > 0) {
          // 为每个有 assetId 的节点恢复 runtime object URL
          for (const node of cached.nodes) {
            if (node.data?.assetId) {
              const url = await assetManager.getObjectURL(node.data.assetId)
              if (url) {
                if (node.data.nodeType === 'video') {
                  node.data.videoUrl = url
                } else {
                  node.data.imageUrl = url
                }
              }
            }
          }
          canvasDataCache.set(projectId, cached)
          return cached
        }
        return { nodes: [], edges: [] }
      },
    }

    // Auto-connect on install
    if (options.autoConnect !== false) {
      try {
        await api.tryRestore()
      } catch {
        isConnected = true
        connectionMode = 'localStorage'
        await ensureDefaultProject()
        emitStatus()
      }
    }

    return { api }
  },
}
