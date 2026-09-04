import type { PluginModule } from '../core'
import type { NodeStoreService } from '../services/nodeStore'
import type { SaveService } from '../services/storage/types'
import type { NodeFactoryService } from '../services/nodeFactory'

/** text 插件暴露给外部的服务形状（content 组件经 ctx.get('text') 使用） */
export interface TextNodeService {
  /** 在画布上放一个文本节点，返回短 id */
  addTextNode(position: { x: number; y: number }): string
  /** 内容组件编辑完调用：改 text 并立即落盘(经 save) */
  editText(id: string, text: string): void
}

/**
 * text 插件 —— text 节点插件（M1/M3）。
 *
 * 职责：
 * - 注册 'text' 节点类型（业务 type，非 v1 'custom'）。
 * - 经 nodeFactory.register('text', creator) 提供**一份**建节点能力（命令/菜单/宿主都走它，不各自抄）；
 *   同时暴露 ctx.get('text') 的 addTextNode/editText 给内容组件(M1 兼容)。
 * - 编辑写回走 nodeStore + save 落盘。
 */
export const nodeTextPlugin: PluginModule = {
  name: 'text',
  deps: [],
  setup(ctx) {
    const nodeStore = ctx.get<NodeStoreService>('nodeStore')
    const factory = ctx.get<NodeFactoryService>('nodeFactory')

    // 1. 注册节点类型
    nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })

    // 2. 建节点的单一实现：建 + 写默认 text
    function createText(position: { x: number; y: number }): string {
      const id = nodeStore.addNode('text', position)
      nodeStore.updateNodeData(id, { text: '双击编辑' })
      return id
    }
    factory.register('text', createText)

    // 3. 暴露给内容组件/老调用方的服务
    ctx.inject('text', {
      addTextNode: createText,
      /** 编辑完写回并落盘 */
      editText(id: string, text: string): void {
        nodeStore.updateNodeData(id, { text })
        ctx.get<SaveService>('save').set('graph', nodeStore.getNodes(), 'canvas')
      },
    } satisfies TextNodeService)
  },
}
