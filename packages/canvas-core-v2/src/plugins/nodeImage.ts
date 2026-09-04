import type { PluginModule } from '../core'
import type { NodeStoreService } from '../services/nodeStore'
import type { SaveService } from '../services/storage/types'
import type { NodeFactoryService } from '../services/nodeFactory'

/** image 插件暴露给外部的服务形状（content/宿主经 ctx.get('image') 使用） */
export interface ImageNodeService {
  /** 加一个显示指定图片的节点；imageUrl 可为 URL / dataURL / objectURL */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string
  /** 删除节点并落盘 */
  removeNode(id: string): void
}

/**
 * image 插件 —— M1 最简 image 节点（红线内）。
 *
 * 只做：注册 `type:'image'` + 经 nodeFactory.register('image', creator) 提供一份建节点能力，
 * 另暴露 ctx.get('image') 的 addImageNode/removeNode(M1 兼容)。
 *
 * 【红线】禁止把 v1 image 复杂件带进来：裁剪/蒙版/扩展/backend 生成模型/ImageBottomToolbar/AssetStore ——
 * 那些全在 M6 另开任务。这里只允许 content=`<img>` + data.imageUrl。
 */
export const nodeImagePlugin: PluginModule = {
  name: 'image',
  setup(ctx) {
    const nodeStore = ctx.get<NodeStoreService>('nodeStore')
    const factory = ctx.get<NodeFactoryService>('nodeFactory')
    nodeStore.registerType({
      type: 'image',
      label: '图片',
      defaultSize: { w: 320, h: 240 },
    })

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
