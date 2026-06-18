/**
 * usePluginSystem — 插件系统生命周期
 *
 * 负责 PluginManager 创建、install/uninstall、事件桥接、API 获取。
 * 提供 getPluginAPI<T>(name) 供其他 hooks 获取插件 API。
 */
import { PluginManager } from '../plugins/PluginManager'
import { createPluginContext } from '../plugins/PluginContext'
import type { CanvasPlugin } from '../plugins/types'
import { ShortcutManager } from '../plugins/ShortcutManager'
import type { useCanvasFlow } from './useCanvasFlow'

export function usePluginSystem(cf: ReturnType<typeof useCanvasFlow>) {
  const manager = new PluginManager()

  function install(plugins: CanvasPlugin[], configs?: Record<string, Record<string, unknown>>) {
    const list = plugins.map(p => ({
      ...p,
      options: { ...((p as any).options || {}), ...(configs?.[p.name] || {}) },
    }))

    return manager.install({
      plugins: list,
      createContext: (pluginName: string) => createPluginContext(pluginName, {
        canvasId: cf.canvasId,
        vueFlowInstance: cf.vf as any,
        canvasStore: cf.canvas,
        pluginManager: manager as any,
        eventBus: manager.eventBus,
      }),
    })
  }

  function getPluginAPI<T = unknown>(name: string): T | null {
    return manager.getPluginAPI<T>(name)
  }

  function registerVueFlowShortcuts() {
    const mgr = ShortcutManager.getInstance()
    const entries = [
      { id: 'vueflow.delete', command: '删除选中', prop: 'deleteKeyCode', defaultKey: 'Backspace' },
      { id: 'vueflow.selection', command: '框选模式', prop: 'selectionKeyCode', defaultKey: 'Shift' },
      { id: 'vueflow.multi-selection', command: '多选模式', prop: 'multiSelectionKeyCode', defaultKey: 'Control' },
      { id: 'vueflow.zoom', command: '缩放', prop: 'zoomActivationKeyCode', defaultKey: 'Control' },
      { id: 'vueflow.pan', command: '平移画布', prop: 'panActivationKeyCode', defaultKey: 'Space' },
    ]
    for (const e of entries) {
      const currentVal = (cf.vf as any)[e.prop]?.value
      mgr.register({
        id: e.id, command: e.command,
        keys: String(currentVal ?? e.defaultKey),
        handler: () => {}, priority: 0,
        pluginId: 'vueflow', group: 'system', isSystemManaged: true,
      })
    }
  }

  function loadShortcutKeymap() {
    const keymap = cf.canvas.state.shortcutKeymap || {}
    ShortcutManager.getInstance().loadKeymap(keymap)
  }

  function syncVueFlowKeymap() {
    const keymap = cf.canvas.state.shortcutKeymap || {}
    const instance = cf.vf as any
    const map: Record<string, string> = {
      'vueflow.delete': 'deleteKeyCode',
      'vueflow.selection': 'selectionKeyCode',
      'vueflow.multi-selection': 'multiSelectionKeyCode',
      'vueflow.zoom': 'zoomActivationKeyCode',
      'vueflow.pan': 'panActivationKeyCode',
    }
    for (const [id, prop] of Object.entries(map)) {
      const binding = keymap[id]
      if (binding) {
        instance[prop].value = binding
      }
    }
  }

  async function uninstallAll() {
    const loadOrder = manager.getLoadOrder()
    for (const name of loadOrder.reverse()) {
      try {
        await manager.uninstall(name)
      } catch (err) {
        console.error(`[Canvas] 卸载插件 "${name}" 失败:`, err)
      }
    }
  }

  return {
    manager,
    install,
    getPluginAPI,
    registerVueFlowShortcuts,
    loadShortcutKeymap,
    syncVueFlowKeymap,
    uninstallAll,
  }
}
