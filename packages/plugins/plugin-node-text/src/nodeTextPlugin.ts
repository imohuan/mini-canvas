/**
 * plugin-node-text —— text 节点插件（dsh 范式：name/inject/setup 一段式，UI(content)+逻辑一体）。
 *
 * UI 与逻辑同包：本文件是插件逻辑，TextContent.vue 是同包的 content 组件，二者由
 * registerNodeType(ctx, def) 在一次调用里同时注册——宿主不再手 seed content。
 *
 * 依赖方向：本插件只依赖内核(@mini-canvas/canvas-core-v2)，不反向依赖宿主/其它插件。
 * 对外暴露 ctx.get('text') 服务（addTextNode/editText）给 content 组件与宿主调用。
 */
import type { PluginModule } from '@mini-canvas/canvas-core-v2'
import { registerNodeType } from '@mini-canvas/canvas-core-v2'
import type { NodeStoreService, SaveService, NodeFactoryService } from '@mini-canvas/canvas-core-v2'
import TextContent from './TextContent.vue'

/** text 插件暴露给外部的服务形状（content 组件经 ctx.get('text') 使用） */
export interface TextNodeService {
  /** 在画布上放一个文本节点，返回短 id */
  addTextNode(position: { x: number; y: number }): string
  /** 内容组件编辑完调用：改 text 并立即落盘(经 save) */
  editText(id: string, text: string): void
}

/**
 * text 节点插件（M1/M3 最小版）。
 *
 * 职责：
 * - registerNodeType 一次性注册：数据(type='text'/label/尺寸) + 展示(content=TextContent.vue)。
 * - 经 nodeFactory 提供一份建节点能力，并暴露 ctx.get('text') 服务给 content 组件。
 * - 编辑写回走 nodeStore + save 落盘。
 */
export const nodeTextPlugin: PluginModule = {
  name: 'text',
  deps: [],
  setup(ctx) {
    // 1. 一次自描述注册：数据 + UI(content) 一体落表
    registerNodeType(ctx, {
      type: 'text',
      label: '文本',
      defaultSize: { w: 300, h: 200 },
      segments: { content: TextContent },
    })

    const nodeStore = ctx.get<NodeStoreService>('nodeStore')
    const factory = ctx.get<NodeFactoryService>('nodeFactory')

    // 2. 建节点的单一实现：建 + 写默认 text
    function createText(position: { x: number; y: number }): string {
      const id = nodeStore.addNode('text', position)
      nodeStore.updateNodeData(id, { text: '双击编辑' })
      return id
    }
    factory.register('text', createText)

    // 3. 暴露给 content 组件/宿主
    ctx.inject('text', {
      addTextNode: createText,
      editText(id: string, text: string): void {
        nodeStore.updateNodeData(id, { text })
        ctx.get<SaveService>('save').set('graph', nodeStore.getNodes(), 'canvas')
      },
    } satisfies TextNodeService)
  },
}
