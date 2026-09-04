/**
 * plugin-node-image —— image 节点插件（dsh 范式：name/inject/setup 一段式，UI(content)+逻辑一体）。
 *
 * UI 与逻辑同包：本文件是插件逻辑，ImageContent.vue 是同包的 content 组件，二者由
 * registerNodeType(ctx, def) 在一次调用里同时注册——宿主不再手 seed content。
 *
 * 红线：只做最简 image（content 显示 data.imageUrl）。M6 复杂件（裁剪/蒙版/扩展/backend）不在此包。
 */
import type { PluginModule } from '@mini-canvas/canvas-core-v2'
import { registerNodeType } from '@mini-canvas/canvas-core-v2'
import type { NodeStoreService, SaveService, NodeFactoryService } from '@mini-canvas/canvas-core-v2'
import ImageContent from './ImageContent.vue'

/** image 插件暴露给外部的服务形状（content/宿主经 ctx.get('image') 使用） */
export interface ImageNodeService {
  /** 加一个显示指定图片的节点；imageUrl 可为 URL / dataURL / objectURL */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string
  /** 删除节点并落盘 */
  removeNode(id: string): void
}

/**
 * image 节点插件 —— M1 最简 image（红线内）。
 *
 * registerNodeType 一次性注册数据(type='image'/label/尺寸) + 展示(content=ImageContent.vue)；
 * 另暴露 ctx.get('image') 的 addImageNode/removeNode 服务。
 */
export const nodeImagePlugin: PluginModule = {
  name: 'image',
  setup(ctx) {
    registerNodeType(ctx, {
      type: 'image',
      label: '图片',
      defaultSize: { w: 320, h: 240 },
      segments: { content: ImageContent },
    })

    const nodeStore = ctx.get<NodeStoreService>('nodeStore')
    const factory = ctx.get<NodeFactoryService>('nodeFactory')

    // 建 image 节点的单一实现。extra 兼容两种传法：直接传 imageUrl 字符串，或 { imageUrl } 对象。
    function createImage(position: { x: number; y: number }, extra?: unknown): string {
      const id = nodeStore.addNode('image', position)
      let url = ''
      if (typeof extra === 'string') url = extra
      else if (extra && typeof extra === 'object') url = String((extra as { imageUrl?: string }).imageUrl ?? '')
      nodeStore.updateNodeData(id, { imageUrl: url })
      return id
    }
    factory.register('image', createImage)
    ctx.effect(() => () => factory.unregister('image'))

    ctx.inject('image', {
      addImageNode: (position: { x: number; y: number }, imageUrl: string): string =>
        createImage(position, imageUrl),
      removeNode(id: string): void {
        nodeStore.removeNode(id)
        ctx.get<SaveService>('save').set('graph', nodeStore.getNodes(), 'canvas')
      },
    } satisfies ImageNodeService)
  },
}
