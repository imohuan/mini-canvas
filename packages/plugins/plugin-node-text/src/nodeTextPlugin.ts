/**
 * plugin-node-text —— text 节点插件（dsh 范式：Cordis 式 name/inject/apply，UI(content)+逻辑一体）。
 *
 * UI 与逻辑同包：本文件是插件逻辑，TextContent.vue 是同包的 content 组件，二者由
 * apply(ctx) 里的 ctx.nodes.register 在一次调用里同时注册——宿主不再手 seed content。
 *
 * 作者面只认一个 Context（@mini-canvas/canvas-base 重导出内核），注册走 ctx 能力段(ctx.nodes/ctx.inject)，
 * 卸载由 scope 自动回收，作者不手写 unregister。
 *
 * 依赖方向：本插件只依赖内核(@mini-canvas/canvas-base / canvas-core-v2)，不反向依赖宿主/其它插件。
 * 对外暴露 ctx.get('text') 服务（addTextNode/editText）给 content 组件与宿主调用。
 */
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import type { NodeStoreService, SaveService } from '@mini-canvas/canvas-core-v2'
import TextContent from './TextContent.vue'

/** text 插件暴露给外部的服务形状（content 组件经 ctx.get('text') 使用） */
export interface TextNodeService {
  /** 在画布上放一个文本节点，返回短 id */
  addTextNode(position: { x: number; y: number }): string
  /** 内容组件编辑完调用：改 text 并立即落盘(经 save) */
  editText(id: string, text: string): void
}

/**
 * text 节点插件（Cordis 式：name/inject/apply）。
 *
 * 职责：
 * - ctx.nodes.register 一次性注册：数据(type='text'/label/尺寸) + 展示(content=TextContent.vue)
 *   + 建节点实现(create → addNode + 写默认 text)。
 * - 经 ctx.inject('text') 暴露服务给 content 组件；编辑写回走 nodeStore + save 落盘。
 */
export const name = 'text'
export const inject = [] as string[]

export function apply(ctx: Context) {
  const nodeStore = ctx.get<NodeStoreService>('nodeStore')
  const save = ctx.get<SaveService>('save')

  // 1. 一次自描述注册：数据 + UI(content) + 建节点实现（creator 随插件 scope 自动回收）
  ctx.nodes.register({
    type: 'text',
    label: '文本',
    size: { w: 300, h: 200 },
    content: TextContent,
    create(position) {
      const id = nodeStore.addNode('text', position)
      nodeStore.updateNodeData(id, { text: '双击编辑' })
      return id
    },
  })

  // 2. 暴露给 content 组件/宿主
  ctx.inject('text', {
    addTextNode: (position: { x: number; y: number }): string => {
      const id = nodeStore.addNode('text', position)
      nodeStore.updateNodeData(id, { text: '双击编辑' })
      return id
    },
    editText(id: string, text: string): void {
      nodeStore.updateNodeData(id, { text })
      save.set('graph', nodeStore.getNodes(), 'canvas')
    },
  } satisfies TextNodeService)
}

/** 兼容旧装配的 PluginModule 出口（host 用 :plugins=[...]，与裸 export 等价） */
export const nodeTextPlugin: PluginModule = { name, inject, apply }

