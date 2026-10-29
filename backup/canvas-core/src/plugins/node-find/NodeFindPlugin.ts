import { createApp, h } from 'vue'
import type { CanvasPlugin, PluginContext } from '../types'
import NodeFindOverlay from './NodeFindOverlay.vue'

export const NodeFindPlugin: CanvasPlugin = {
  name: 'node-find',
  version: '1.0.0',

  install(context: PluginContext) {
    let appInstance: ReturnType<typeof createApp> | null = null
    let containerEl: HTMLDivElement | null = null

    function openOverlay() {
      if (appInstance) return

      containerEl = document.createElement('div')
      document.body.appendChild(containerEl)

      const nodes = context.actions.getNodes()

      appInstance = createApp({
        render() {
          return h(NodeFindOverlay, {
            nodes,
            onFocus(nodeId: string) {
              const node = nodes.find(n => n.id === nodeId)
              if (node) {
                context.viewport.setCenter(
                  node.position.x + 128,
                  node.position.y + 128,
                  1,
                )
              }
            },
            onClose: closeOverlay,
          })
        },
      })

      appInstance.mount(containerEl)
    }

    function closeOverlay() {
      if (appInstance) {
        appInstance.unmount()
        appInstance = null
      }
      if (containerEl) {
        containerEl.remove()
        containerEl = null
      }
    }

    context.registerShortcut('ctrl+f', openOverlay, '搜索节点')

    return {
      uninstall() {
        context.unregisterShortcut('ctrl+f')
        closeOverlay()
      },
    }
  },
}
