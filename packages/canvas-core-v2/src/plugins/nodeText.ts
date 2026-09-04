import type { PluginModule } from '../core'
import type { NodeStoreService } from '../services/nodeStore'
import type { SaveService } from '../services/storage/types'

/** text 插件暴露给外部的服务形状（content 组件经 ctx.get('text') 使用） */
export interface TextNodeService {
  /** 在画布上放一个文本节点，返回短 id */
  addTextNode(position: { x: number; y: number }): string
  /** 内容组件编辑完调用：改 text 并立即落盘(经 save) */
  editText(id: string, text: string): void
}

/**
 * text 插件 —— M4 最小节点插件，验证"插件经 ctx.get 用服务"。
 *
 * 职责：
 * - 注册 'text' 节点类型（业务 type，非 v1 的 'custom'）。
 * - 经 ctx.get('nodeStore') 建/改节点；经 ctx.get('save') 把画布图落盘。
 * - 一段式 setup，无 uninstall —— 卸载自动回收（M1 内核保证）。
 */
export const nodeTextPlugin: PluginModule = {
  name: 'text',
  deps: [], // 不静态依赖别的插件（服务经 ctx.get，运行期缺失会抛）
  setup(ctx) {
    // 1. 注册节点类型
    const nodeStore = ctx.get<NodeStoreService>('nodeStore')
    nodeStore.registerType({
      type: 'text',
      label: '文本',
      defaultSize: { w: 300, h: 200 },
    })

    // 2. 提供一个"在画布上放一个文本节点"的服务（可被外部/命令调用）
    ctx.inject('text', {
      addTextNode(position: { x: number; y: number }): string {
        const id = nodeStore.addNode('text', position)
        nodeStore.updateNodeData(id, { text: '双击编辑' })
        return id
      },
      /** 内容组件编辑完调用：改 text 并立即落盘(经 save) */
      editText(id: string, text: string): void {
        nodeStore.updateNodeData(id, { text })
        ctx.get<SaveService>('save').set('graph', nodeStore.getNodes(), 'canvas')
      },
    } satisfies TextNodeService)
  },
}
