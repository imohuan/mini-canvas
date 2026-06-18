import type { CanvasPlugin, PluginContext } from '../types'

export interface AutoSaveOptions {
  interval?: number // debounce ms (default: 1000)
  enabled?: boolean // default: true
  [key: string]: unknown
}

export interface AutoSaveAPI {
  /** 监听自动保存事件 */
  on(event: string, handler: (...args: any[]) => void): void
  /** 取消监听 */
  off(event: string, handler: (...args: any[]) => void): void
  /** 获取当前是否脏数据 */
  get isDirty(): boolean
  /** 获取自动保存是否启用 */
  get isEnabled(): boolean
  /** 手动触发保存 */
  saveNow(): Promise<void>
  /** 设置启用/禁用 */
  setEnabled(v: boolean): void
}

export const AutoSavePlugin: CanvasPlugin<AutoSaveOptions, AutoSaveAPI> = {
  name: 'auto-save',
  version: '0.2.0',
  dependencies: ['storage'],

  async install(context: PluginContext, options: AutoSaveOptions) {
    const interval = options.interval ?? 1000
    let enabled = options.enabled ?? true
    let dirty = false
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    let isHistoryRestoring = false

    // ---- Storage API access ----
    function getStorageAPI(): any {
      const storagePlugin = context.getPlugin('storage') as any
      return storagePlugin?.api ?? null
    }

    // ---- Debounced save ----
    function markDirty() {
      if (!enabled || isHistoryRestoring) return
      dirty = true
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(performSave, interval)
    }

    async function performSave() {
      if (!dirty) return
      const storage = getStorageAPI()
      if (!storage || !storage.isConnected || !storage.currentProjectId) return

      try {
        const nodes = context.actions.getNodes()
        const edges = context.actions.getEdges()
        await storage.saveCanvas(nodes, edges)
        dirty = false
        const payload = { time: Date.now(), nodeCount: nodes.length, edgeCount: edges.length }
        context.emit('auto-save:saved', payload)
        window.dispatchEvent(new CustomEvent('auto-save:saved', { detail: payload }))
      } catch (err) {
        context.logger.error('[AutoSave] Save failed:', err)
      }
    }

    // ---- Emergency save on page close ----
    function handleBeforeUnload() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      performSave()
    }

    // ---- Event listeners — context.on() 返回取消函数，无需手动管理 listenerMap ----
    const offNodesChange = context.on('nodesChange', () => markDirty())
    const offEdgesChange = context.on('edgesChange', () => markDirty())
    const offNodeDragStop = context.on('nodeDragStop', () => markDirty())
    const offConnect = context.on('connect', () => markDirty())

    const offHistoryStateChange = context.on('history:state-change', ({ isRestoring: r }: any) => {
      isHistoryRestoring = !!r
    })
    const offSaveNow = context.on('auto-save:save-now', () => performSave())
    const offToggle = context.on('auto-save:toggle', (data: any) => {
      enabled = data?.enabled ?? !enabled
      if (enabled && dirty) markDirty()
    })

    window.addEventListener('beforeunload', handleBeforeUnload)

    // ---- External listener map (for AutoSaveAPI.on/off) ----
    const externalListeners = new Map<string, Set<(...args: any[]) => void>>()

    const api: AutoSaveAPI = {
      on(event: string, handler: (...args: any[]) => void) {
        if (!externalListeners.has(event)) externalListeners.set(event, new Set())
        externalListeners.get(event)!.add(handler)
        context.on(event, handler)
      },
      off(event: string, handler: (...args: any[]) => void) {
        context.off(event, handler)
        externalListeners.get(event)?.delete(handler)
      },
      get isDirty() { return dirty },
      get isEnabled() { return enabled },
      saveNow: () => performSave(),
      setEnabled(v: boolean) { enabled = v; if (enabled && dirty) markDirty() },
    }

    return {
      api,
      uninstall() {
        if (saveTimer) clearTimeout(saveTimer)
        window.removeEventListener('beforeunload', handleBeforeUnload)
        offNodesChange()
        offEdgesChange()
        offNodeDragStop()
        offConnect()
        offHistoryStateChange()
        offSaveNow()
        offToggle()
        for (const [event, handlers] of externalListeners) {
          for (const h of handlers) context.off(event, h)
        }
        externalListeners.clear()
      },
    }
  },
}
