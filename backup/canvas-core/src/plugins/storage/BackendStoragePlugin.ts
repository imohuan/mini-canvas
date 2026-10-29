import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { AssetManager } from './adapters/AssetManager'
import { BackendAssetStore } from './adapters/BackendAssetStore'

export interface BackendStorageAPI {
  /** 资产管理者：底层 BackendAssetStore，资源字节真存后端画布资源文件夹 */
  assets: AssetManager
  /** 切换当前画布（上传/读取打到的目标画布） */
  setCanvas(canvasId: string | null): void
  /** 当前画布 id */
  canvasId(): string | null
  backendStore: BackendAssetStore
}

/**
 * BackendStoragePlugin —— 系统默认本地存储(StoragePlugin/IndexedDB)的**可插拔替换**。
 *
 * 约定：插件 name 也用 'storage'，让节点插件 `context.getPluginAPI('storage')?.assets`
 * 命中同一入口——但这里的 assets 底层是 BackendAssetStore（字节传后端 project-{canvas}/assets/，
 * 按内容 SHA-256 去重），而非浏览器 IndexedDB。
 *
 * - 装上它：图片/视频 upload、拖拽、粘贴都走"存后端"，刷新/换浏览器不丢。
 * - 不装它（根页等）：照旧走本地 StoragePlugin/IndexedDB，互不影响。
 * 上传入口代码零改动，只换底层 store。
 */
export interface BackendStorageOptions extends Record<string, unknown> {
  baseUrl?: string
  /** 实时提供当前画布 id（如跟随 BackendSync 的 ctrl.canvasId）；null=未连接画布 */
  getCanvasId?: () => string | null
}

export const BackendStoragePlugin: CanvasPlugin<BackendStorageOptions, BackendStorageAPI> = {
  name: 'storage',
  version: '1.0.0',
  dependencies: [],

  install(_context: PluginContext, options: BackendStorageOptions = {}) {
    const baseUrl = options.baseUrl ?? 'http://localhost:8765'
    let internalCanvasId: string | null = null
    const getCanvasId = options.getCanvasId ?? (() => internalCanvasId)
    const backendStore = new BackendAssetStore(baseUrl, getCanvasId)
    const assets = new AssetManager()
    assets.setStore(backendStore)

    const api: BackendStorageAPI = {
      assets,
      backendStore,
      setCanvas(id: string | null): void {
        internalCanvasId = id
        backendStore.setCanvasId(id)
      },
      canvasId(): string | null {
        return getCanvasId()
      },
    }

    return {
      api,
      uninstall() {
        assets.revokeAllURLs()
      },
    }
  },
}
