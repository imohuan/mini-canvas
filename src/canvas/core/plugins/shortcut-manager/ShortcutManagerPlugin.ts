import type { CanvasPlugin, PluginContext } from '../types'
import ShortcutHelpPanel from './ShortcutHelpPanel.vue'
import { createApp, h } from 'vue'

export const ShortcutManagerPlugin: CanvasPlugin = {
  name: 'shortcut-manager',
  version: '0.1.0',

  install(context: PluginContext, _options: Record<string, unknown>) {
    const logger = context.logger
    let appInstance: any = null
    let container: HTMLDivElement | null = null

    function mountHelpPanel() {
      if (container) return
      container = document.createElement('div')
      container.id = 'shortcut-help-panel'
      context.mountOverlay(container, 'root')

      appInstance = createApp({
        render() {
          return h(ShortcutHelpPanel, {
            onClose: unmountHelpPanel,
          })
        },
      })
      appInstance.mount(container)
    }

    function unmountHelpPanel() {
      if (appInstance) {
        appInstance.unmount()
        appInstance = null
      }
      if (container) {
        context.unmountOverlay(container)
        container = null
      }
    }

    context.registerShortcut('ctrl+/', mountHelpPanel, '快捷键帮助')
    logger.info('ShortcutManagerPlugin ready')

    return {
      uninstall() {
        unmountHelpPanel()
        context.unregisterShortcut('ctrl+/')
      },
    }
  },
}
