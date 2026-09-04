import type { PluginModule } from '../core'
import type { NodeStoreService } from '../services/nodeStore'
import type { SaveService } from '../services/storage/types'

/** image 插件暴露给外部的服务形状（content/宿主经 ctx.get('image') 使用） */
export interface ImageNodeService {
  /** 加一个显示指定图片的节点；imageUrl 可为 URL / dataURL / objectURL */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string
  /** 删除节点并落盘 */
  removeNode(id: string): void
}

/**
 * image 插件 —— M1 最简 image 节点（开发测试期最小闭环用）。
 *
 * 只做两件事：
 * - 注册 `type:'image'` 节点类型（业务 type，非 v1 'custom'）。
 * - 暴露 ctx.get('image') 服务：加一个显示指定图片的节点。
 *
 * 【红线】禁止把 v1 image 复杂件带进来：裁剪/蒙版/扩展/backend 生成模型/ImageBottomToolbar/AssetStore 资产落盘
 * ——那些全在 M6 另开任务。这里只允许 content=`<img>` + data.imageUrl。
 */
export const nodeImagePlugin: PluginModule = {
  name: 'image',
  setup(ctx) {
    const nodeStore = ctx.get<NodeStoreService>('nodeStore')
    nodeStore.registerType({
      type: 'image',
      label: '图片',
      defaultSize: { w: 320, h: 240 },
    })

    ctx.inject('image', {
      /** 加一个显示指定图片的节点；imageUrl 可为 URL / dataURL / objectURL */
      addImageNode(position: { x: number; y: number }, imageUrl: string): string {
        const id = nodeStore.addNode('image', position)
        nodeStore.updateNodeData(id, { imageUrl })
        return id
      },
      /** 删除节点并落盘 */
      removeNode(id: string): void {
        nodeStore.removeNode(id)
        ctx.get<SaveService>('save').set('graph', nodeStore.getNodes(), 'canvas')
      },
    })
  },
}
