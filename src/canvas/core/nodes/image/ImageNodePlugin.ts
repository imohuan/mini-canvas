import { markRaw } from 'vue'
import { ImageNode } from './index'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'

export const ImageNodePlugin: CanvasPlugin = {
  name: 'node:image',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'image',
      node: markRaw(ImageNode),
      label: '图片',
      defaultSize: { cardWidth: 360, cardHeight: 270 },
      menuItem: { label: '图片', description: '创建图片节点', icon: 'image' },
      canReceiveInput: true,
      resizable: false,
    })
    return {
      uninstall() { context.canvasNodes.unregister('image') },
    }
  },
}