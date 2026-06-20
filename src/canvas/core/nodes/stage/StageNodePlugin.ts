import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { StageNode } from './index'

export const StageNodePlugin: CanvasPlugin = {
  name: 'node:stage',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'stage',
      node: markRaw(StageNode),
      label: '导演台',
      defaultSize: { cardWidth: 320, cardHeight: 320 },
      menuItem: { label: '导演台', description: '创建编排节点', icon: 'layers', badge: 'NEW' },
      canReceiveInput: true,
      resizable: false,
    })
    return {
      uninstall() { context.canvasNodes.unregister('stage') },
    }
  },
}