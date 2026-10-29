import { ShortcutManager } from '../plugins/ShortcutManager'

/**
 * 提取 Canvas.vue 中的快捷键管理逻辑
 * 注意：此模块仅提供函数定义，Canvas.vue 需要手动集成
 */
export function useCanvasShortcuts(canvas: any, vueFlowInstance: any) {
  function toVueFlowKey(key: string): string {
    const map: Record<string, string> = {
      Backspace: 'Backspace', Delete: 'Delete',
      Shift: 'Shift', Control: 'Control', Alt: 'Alt', Meta: 'Meta',
      Escape: 'Escape', Enter: 'Enter', Space: ' ',
    }
    return map[key] ?? key
  }

  function syncVueFlowKeymap() {
    const keymap = canvas.state.core.shortcutKeymap || {}
    const mgr = ShortcutManager.getInstance()
    const entries = [
      { shortcutId: 'vueflow.delete', vfProp: 'deleteKeyCode' },
      { shortcutId: 'vueflow.selection', vfProp: 'selectionKeyCode' },
      { shortcutId: 'vueflow.multi-selection', vfProp: 'multiSelectionKeyCode' },
      { shortcutId: 'vueflow.zoom', vfProp: 'zoomActivationKeyCode' },
      { shortcutId: 'vueflow.pan', vfProp: 'panActivationKeyCode' },
    ]
    for (const { shortcutId, vfProp } of entries) {
      const entries = (mgr as any).exportKeymap?.() || {}; const entry = entries[shortcutId]
      const key = keymap[shortcutId] ?? (entry as any)?.keys
      if (key) (vueFlowInstance as any)[vfProp].value = toVueFlowKey(key)
    }
  }

  function persistShortcutKeymap() {
    canvas.state.core.shortcutKeymap = ShortcutManager.getInstance().exportKeymap()
  }

  return { toVueFlowKey, syncVueFlowKeymap, persistShortcutKeymap }
}