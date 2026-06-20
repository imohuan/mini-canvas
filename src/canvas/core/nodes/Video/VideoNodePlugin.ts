import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import { VideoNode } from './index'

export const VideoNodePlugin: CanvasPlugin = {
  name: 'node:video',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'video',
      node: markRaw(VideoNode),
      label: '视频',
      defaultSize: { cardWidth: 480, cardHeight: 320 },
      menuItem: { label: '视频', description: '创建视频节点', icon: 'video' },
      canReceiveInput: true,
      resizable: false,
    })
    return {
      uninstall() { context.canvasNodes.unregister('video') },
    }
  },
}