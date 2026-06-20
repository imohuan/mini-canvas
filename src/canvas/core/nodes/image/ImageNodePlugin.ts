import { markRaw } from 'vue'
import { ImageNode } from './index'
import ImageUploadButton from './ImageUploadButton.vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'

const uploadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`
const cropSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`
const filterSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke-linecap="round"/></svg>`
const rotateSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`
const downloadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

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

    context.toolbars.register('node:image', { id: 'image.upload', source: 'node:image', commandId: 'image.upload', position: 'top', title: '上传图片', tooltip: '点击上传本地图片', nodeTypes: ['image'], order: 10, customRender: markRaw(ImageUploadButton) })
    context.toolbars.register('node:image', { id: 'image.crop', source: 'node:image', commandId: 'image.crop', position: 'top', title: '裁剪', icon: cropSvg, tooltip: '裁剪图片', nodeTypes: ['image'], order: 20 })
    context.toolbars.register('node:image', { id: 'image.filter', source: 'node:image', commandId: 'image.filter', position: 'top', title: '滤镜', icon: filterSvg, nodeTypes: ['image'], order: 30, dropdown: [{ id: 'image.filter.none', title: '无滤镜' }, { id: 'image.filter.grayscale', title: '黑白' }, { id: 'image.filter.sepia', title: '复古' }] })
    context.toolbars.register('node:image', { id: 'image.rotate', source: 'node:image', commandId: 'image.rotate', position: 'bottom', title: '旋转', icon: rotateSvg, nodeTypes: ['image'], order: 10 })
    context.toolbars.register('node:image', { id: 'image.download', source: 'node:image', commandId: 'image.download', position: 'bottom', title: '下载', icon: downloadSvg, nodeTypes: ['image'], order: 20 })

    return {
      uninstall() {
        context.canvasNodes.unregister('image')
        context.toolbars.unregisterSource('node:image')
      },
    }
  },
}