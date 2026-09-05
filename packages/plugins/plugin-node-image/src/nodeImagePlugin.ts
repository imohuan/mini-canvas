/**
 * plugin-node-image —— image 节点插件（dsh 范式：Cordis 式 name/inject/apply，UI(content)+逻辑一体）。
 *
 * UI 与逻辑同包：本文件是插件逻辑，ImageContent.vue 是同包的 content 组件，二者由
 * apply(ctx) 里的 ctx.nodes.register 在一次调用里同时注册——宿主不再手 seed content。
 *
 * 红线：只做最简 image（content 显示 data.imageUrl）。M6 复杂件（裁剪/蒙版/扩展/backend）不在此包。
 */
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import type { NodeStoreService, SaveService } from '@mini-canvas/canvas-core-v2'
import ImageContent from './ImageContent.vue'

/** image 插件暴露给外部的服务形状（content/宿主经 ctx.get('image') 使用） */
export interface ImageNodeService {
  /** 加一个显示指定图片的节点；imageUrl 可为 URL / dataURL / objectURL */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string
  /** 删除节点并落盘 */
  removeNode(id: string): void
}

export const name = 'image'
export const inject = [] as string[]

/**
 * image 节点插件（Cordis 式）。
 * ctx.nodes.register 一次性注册数据(type='image'/label/尺寸) + 展示(content=ImageContent.vue) + 建节点(create)；
 * 另暴露 ctx.get('image') 的 addImageNode/removeNode 服务。
 */
export function apply(ctx: Context) {
  const nodeStore = ctx.get<NodeStoreService>('nodeStore')
  const save = ctx.get<SaveService>('save')

  // 建 image 节点的单一实现。extra 兼容两种传法：直接传 imageUrl 字符串，或 { imageUrl } 对象。
  function createImage(position: { x: number; y: number }, extra?: unknown): string {
    const id = nodeStore.addNode('image', position)
    let url = ''
    if (typeof extra === 'string') url = extra
    else if (extra && typeof extra === 'object') url = String((extra as { imageUrl?: string }).imageUrl ?? '')
    nodeStore.updateNodeData(id, { imageUrl: url })
    return id
  }

  ctx.nodes.register({
    type: 'image',
    label: '图片',
    size: { w: 320, h: 240 },
    content: ImageContent,
    create: createImage,
  })

  // 供开发期 HMR 验证：改本文件内 v 数值后保存，画布内 ctx.get('image-meta').v 实时变化
  ctx.inject('image-meta', { v: 1 })

  ctx.inject('image', {
    addImageNode: (position: { x: number; y: number }, imageUrl: string): string =>
      createImage(position, imageUrl),
    removeNode(id: string): void {
      nodeStore.removeNode(id)
      save.set('graph', nodeStore.getNodes(), 'canvas')
    },
  } satisfies ImageNodeService)
}

/** 兼容旧装配的 PluginModule 出口 */
export const nodeImagePlugin: PluginModule = { name, inject, apply }
