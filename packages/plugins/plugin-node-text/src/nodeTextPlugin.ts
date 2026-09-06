/**
 * plugin-node-text —— text 节点插件（cordis 最新写法：对象插件{name,inject,apply} + Service 子类上架服务）。
 *
 * UI 与逻辑同包：本文件是插件逻辑，TextContent.vue 是同包的 content 组件，二者由 apply(ctx) 里的
 * ctx.nodes.register 在一次调用里同时注册——宿主不再手 seed content。
 *
 * 相比旧写法（apply 里手写 ctx.inject('text',{…}) 内联对象）的升级：
 * - 服务定义收敛成 `TextService extends Service`：构造 `super(ctx,'text')` 即把实例上架为 'text' 服务
 *   （随插件 scope 自动回收，卸载即移除，无需手写撤销）。
 * - 方法内**惰性 `this.ctx.get('nodeStore'/'save')` 取现时服务、不缓存**：避免卸载残留/换实例时拿旧引用；
 *   nodeStore/save 同时写进 `inject` 硬依赖（宿主恒在、start 前注入 → 无 PENDING 风险；缺则让插件
 *   PENDING 而非 ctx.get 静默返 undefined，更 cordis 规范）。
 * - `declare module '@mini-canvas/canvas-core-v2'` 给 `ctx.text` 加直访类型（运行靠服务解析 Proxy），
 *   宿主/作者可 `ctx.text` 直访或 `ctx.get<TextService>('text')` 类型安全消费。
 *
 * 依赖方向：只依赖内核(@mini-canvas/canvas-base / canvas-core-v2)，不反向依赖宿主/其它插件。
 */
import { Service, type PluginModule, type Context } from '@mini-canvas/canvas-base'
import type { NodeStoreService, SaveService } from '@mini-canvas/canvas-core-v2'
import TextContent from './TextContent.vue'

/** text 插件暴露给外部的服务形状（content 组件经 ctx.get('text') 使用；形状保持不变，.vue 零改动） */
export interface TextNodeService {
  /** 在画布上放一个文本节点，返回短 id */
  addTextNode(position: { x: number; y: number }): string
  /** 内容组件编辑完调用：改 text 并立即落盘(经 save) */
  editText(id: string, text: string): void
}

/** 类型增强缝（cordis ch3 声明合并）：宿主/作者 ctx.text 直访时类型为 TextService */
declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    text: TextService
  }
}

/**
 * text 插件暴露的服务（Service 子类：cordis 服务类形态）。
 * 构造 `super(ctx,'text')` 即把本实例以 'text' 名上架到 ctx 服务表；方法经 `this.ctx.get` 惰性取现时
 * nodeStore/save（不缓存，避免卸载残留/换实例脏引用）。节点注册的 create 也委托本服务，单一实现。
 */
export class TextService extends Service implements TextNodeService {
  constructor(ctx: Context) {
    super(ctx, 'text')
  }

  addTextNode(position: { x: number; y: number }): string {
    const nodeStore = this.ctx.get<NodeStoreService>('nodeStore')
    const id = nodeStore.addNode('text', position)
    nodeStore.updateNodeData(id, { text: '双击编辑' })
    return id
  }

  editText(id: string, text: string): void {
    const nodeStore = this.ctx.get<NodeStoreService>('nodeStore')
    const save = this.ctx.get<SaveService>('save')
    nodeStore.updateNodeData(id, { text })
    save.set('graph', nodeStore.getNodes(), 'canvas')
  }
}

export const name = 'text'
export const inject = ['nodeStore', 'save'] as string[]

/**
 * text 节点插件（cordis 最新写法：Service 子类暴露服务 + inject 硬依赖）。
 * apply 里一次自描述注册：数据(type='text') + 展示(content=TextContent.vue) + 建节点(create→TextService.addTextNode)，
 * 并 new TextService(ctx) 上架 'text' 服务；二者皆随本插件 scope 自动回收。
 */
export function apply(ctx: Context) {
  // 1. 构造即上架 'text' 服务（super(ctx,'text') → ctx.provide，随插件 scope 回收）
  const text = new TextService(ctx)

  // 2. 注册节点类型：数据/尺寸 + content 组件 + create 委托服务（同一实现，避免散落两处建节点逻辑）
  //    内容类型声明：text 输出产 text；输入口收 text（文本文案只收文本；图片/视频喂不进文本）。
  ctx.nodes.register({
    type: 'text',
    label: '文本',
    size: { w: 300, h: 200 },
    inputs: [{ port: 'target', acceptsTypes: ['text'], capacity: 1 }],
    outputs: [{ port: 'source', contentType: 'text' }],
    content: TextContent,
    create(position) {
      return text.addTextNode(position)
    },
  })
}

/** 兼容旧装配的 PluginModule 出口（host 用 :plugins=[...]，与裸 export 等价；name='text' 供 HMR reload） */
export const nodeTextPlugin: PluginModule = { name, inject, apply }
