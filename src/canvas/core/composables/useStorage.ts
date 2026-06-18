/**
 * @deprecated 旧兼容层。新代码请用：
 * - 组件：usePluginApi<StorageAPI>('storage')
 * - 插件：context.getPluginAPI<StorageAPI>('storage')
 */
/**
 * useStorage — 存储状态管理 + 模块级单例
 *
 * 提供 reactive storageState（供 Pannel 展示）和存储操作方法。
 * 通过模块级单例 export 让 ImageTopToolbar / FileDropPlugin 等非 setup 上下文直接访问 AssetManager。
 */
import { ref, nextTick } from 'vue'
import type { StorageAPI, StorageStatus, ProjectMeta } from '../plugins/storage/StoragePlugin'
import type { AssetManager } from '../plugins/storage/adapters/AssetManager'
import type { Node, Edge } from '@vue-flow/core'
import type { usePluginSystem } from './usePluginSystem'
import type { useCanvasFlow } from './useCanvasFlow'

// ===========================
// 模块级单例 — 给非 setup 上下文使用
// ===========================
let _storageApi: StorageAPI | null = null

/** 设置当前 StorageAPI 实例（由 Canvas.vue 在插件安装完成后调用） */
export function setStorageApi(api: StorageAPI | null): void {
  _storageApi = api
}

/** 获取当前 StorageAPI 实例（供任意模块导入使用） */
export function getStorageApi(): StorageAPI | null {
  return _storageApi
}

/** 获取 AssetManager（供 ImageTopToolbar / FileDropPlugin 直接导入） */
export function getAssetManager(): AssetManager | null {
  return _storageApi?.assets ?? null
}

// ===========================
// Hook
// ===========================
export function useStorage(
  ps: ReturnType<typeof usePluginSystem>,
  cf: ReturnType<typeof useCanvasFlow>,
) {
  const storageState = ref<StorageStatus & { projects: ProjectMeta[] }>({
    isConnected: false,
    mode: 'localStorage',
    workspaceName: null,
    currentProjectId: null,
    projectCount: 0,
    projects: [],
  })

  function refresh() {
    const api = ps.getPluginAPI<StorageAPI>('storage')
    if (!api) return
    _storageApi = api  // 更新单例
    storageState.value = {
      ...api.status,
      projects: api.listProjects?.() || [],
    }
  }

  function connect() {
    const api = ps.getPluginAPI<StorageAPI>('storage')
    if (api) { api.connect().then(() => refresh()) }
  }

  function disconnect() {
    const api = ps.getPluginAPI<StorageAPI>('storage')
    if (api) { api.disconnect().then(() => refresh()) }
  }

  function createProject(name: string) {
    const api = ps.getPluginAPI<StorageAPI>('storage')
    if (api) { api.createProject(name); refresh() }
  }

  function deleteProject(id: string) {
    const api = ps.getPluginAPI<StorageAPI>('storage')
    if (api) { api.deleteProject(id).then(() => refresh()) }
  }

  async function switchProject(id: string) {
    const api = ps.getPluginAPI<StorageAPI>('storage')
    if (!api) return
    const result = await api.switchProject(id)
    if (result) {
      const nodeIds = cf.vf.getNodes.value.map((n: Node) => n.id)
      const edgeIds = cf.vf.getEdges.value.map((e: Edge) => e.id)
      cf.vf.removeNodes(nodeIds)
      cf.vf.removeEdges(edgeIds)
      nextTick(() => {
        cf.vf.addNodes(result.nodes || [])
        cf.vf.addEdges(result.edges || [])
      })
    }
    refresh()
  }

  function listenEvents() {
    const bus = ps.manager.eventBus
    bus.on('storage:status', refresh)
    bus.on('storage:project-created', refresh)
    bus.on('storage:project-deleted', refresh)
    bus.on('storage:project-switched', refresh)
    bus.on('storage:connected', refresh)
    bus.on('storage:disconnected', refresh)
  }

  function init() {
    listenEvents()
    nextTick(refresh)
  }

  return {
    storageState,
    connect,
    disconnect,
    createProject,
    deleteProject,
    switchProject,
    init,
  }
}
