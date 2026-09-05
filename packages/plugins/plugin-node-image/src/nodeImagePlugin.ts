/**
 * plugin-node-image —— image 节点插件（cordis 最新写法：对象插件{name,inject,apply} + Service 子类上架服务）。
 *
 * UI 与逻辑同包：本文件是插件逻辑，ImageContent.vue 是同包的 content 组件，二者由 apply(ctx) 里的
 * ctx.nodes.register 在一次调用里同时注册——宿主不再手 seed content。
 *
 * 相比旧写法（apply 里手写 ctx.inject('image',{…}) 内联对象）的升级：同 plugin-node-text——
 * - 服务收敛成 `ImageService extends Service`：构造 `super(ctx,'image')` 即上架 'image' 服务（随 scope 回收）。
 * - 方法惰性 `this.ctx.get('nodeStore'/'save')` 取现时服务；nodeStore/save 写进 `inject` 硬依赖（宿主恒在，无 PENDING）。
 * - `declare module` 给 `ctx.image` 加直访类型。
 *
 * 红线：只做最简 image（content 显示 data.imageUrl）。M6 复杂件（裁剪/蒙版/扩展/backend）不在此包。
 */
import { Service, type PluginModule, type Context } from '@mini-canvas/canvas-base'
import type { NodeStoreService, SaveService } from '@mini-canvas/canvas-core-v2'
import ImageContent from './ImageContent.vue'

/** image 插件暴露给外部的服务形状（content/宿主经 ctx.get('image') 使用；形状不变，.vue 零改动） */
export interface ImageNodeService {
  /** 加一个显示指定图片的节点；imageUrl 可为 URL / dataURL / objectURL */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string
  /** 删除节点并落盘 */
  removeNode(id: string): void
}

/** 类型增强缝（cordis ch3 声明合并）：宿主/作者 ctx.image 直访时类型为 ImageService */
declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    image: ImageService
  }
}

/** image 插件暴露的服务（Service 子类：cordis 服务类形态）。方法经 this.ctx.get 惰性取现时服务（不缓存）。 */
export class ImageService extends Service implements ImageNodeService {
  constructor(ctx: Context) {
    super(ctx, 'image')
  }

  /** 加一个 image 节点并写 imageUrl；返回短 id */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string {
    const nodeStore = this.ctx.get<NodeStoreService>('nodeStore')
    const id = nodeStore.addNode('image', position)
    nodeStore.updateNodeData(id, { imageUrl })
    return id
  }

  /** 删除节点并立即落盘 */
  removeNode(id: string): void {
    const nodeStore = this.ctx.get<NodeStoreService>('nodeStore')
    const save = this.ctx.get<SaveService>('save')
    nodeStore.removeNode(id)
    save.set('graph', nodeStore.getNodes(), 'canvas')
  }
}

export const name = 'image'
export const inject = ['nodeStore', 'save'] as string[]

/**
 * image 节点插件（cordis 最新写法）。apply 里 new ImageService(ctx) 上架 'image' 服务 + 注册节点
 * (数据/展示/create→ImageService.addImageNode)，并额外 ctx.inject('image-meta',{v}) 供开发期 HMR 演示。
 */
export function apply(ctx: Context) {
  // 1. 构造即上架 'image' 服务（super(ctx,'image') → ctx.provide，随插件 scope 回收）
  const image = new ImageService(ctx)

  // 2. 注册节点类型：create 委托服务（同一实现）。create 只收 position → 建默认空图节点。
  ctx.nodes.register({
    type: 'image',
    label: '图片',
    size: { w: 320, h: 240 },
    content: ImageContent,
    create(position) {
      return image.addImageNode(position, '')
    },
  })

  // 3. 供开发期 HMR 验证：改本文件内 v 数值后保存，画布内 ctx.get('image-meta').v 实时变化
  ctx.inject('image-meta', { v: 1 })
}

/** 兼容旧装配的 PluginModule 出口（name='image' 供 HMR reload） */
export const nodeImagePlugin: PluginModule = { name, inject, apply }
