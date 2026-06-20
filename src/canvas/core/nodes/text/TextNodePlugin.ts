import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { TextNode, TextTopToolbar, TextBottomToolbar } from './index'

export const TextNodePlugin: CanvasPlugin = {
  name: 'node:text',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'text',
      node: markRaw(TextNode),
      topToolbar: markRaw(TextTopToolbar),
      bottomToolbar: markRaw(TextBottomToolbar),
      label: '文本',
      defaultSize: { cardWidth: 300, cardHeight: 200 },
      menuItem: { label: '文本', description: '创建文本节点', icon: 'text' },
      canReceiveInput: false,
      resizable: true,
    })
    return {
      uninstall() { context.canvasNodes.unregister('text') },
    }
  },
}