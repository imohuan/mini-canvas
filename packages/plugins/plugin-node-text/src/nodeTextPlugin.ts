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
 * - `declare module '@mini-canvas/canvas-data'` 给 `ctx.text` 加直访类型（运行靠服务解析 Proxy），
 *   宿主/作者可 `ctx.text` 直访或 `ctx.get<TextService>('text')` 类型安全消费。
 *
 * 依赖方向：只依赖内核(@mini-canvas/canvas-base / canvas-data)，不反向依赖宿主/其它插件。
 */
import { Service, type PluginModule, type Context } from '@mini-canvas/canvas-base'
import type { GraphDocumentService } from '@mini-canvas/canvas-data'
import TextContent from './TextContent.vue'
import TextGeneratePanel from './TextGeneratePanel.vue'

/** text 插件暴露给外部的服务形状（content 组件经 ctx.get('text') 使用；形状保持不变，.vue 零改动） */
export interface TextNodeService {
  /** 在画布上放一个文本节点，返回短 id */
  addTextNode(position: { x: number; y: number }): string
  /** 内容组件编辑完调用：改 text 并立即落盘(经 save) */
  editText(id: string, text: string): void
  /** 复制一份本节点（内容一起带走），落在原节点右下 24px；返回新节点 id（源不存在则空串） */
  duplicateTextNode(id: string): string
}

/** 类型增强缝（cordis ch3 声明合并）：宿主/作者 ctx.text 直访时类型为 TextService */
declare module '@mini-canvas/canvas-data' {
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

  /** 内部统一走 graph 唯一写入口（历史 + 提交落盘），不直接改 nodeStore/save */
  private graph(): GraphDocumentService {
    return this.ctx.get<GraphDocumentService>('graph')
  }

  addTextNode(position: { x: number; y: number }): string {
    return this.graph().transaction('add-text-node', (tx) => {
      // 建节点只写内容字段。用户明确表示字号/加粗/颜色/对齐这些"样式"概念对文本节点没有意义，
      // 整条样式链路（顶部操作条 + patchTextData + 样式字段）已删除，data 不再有样式残留。
      const id = tx.createNode('text', position, { text: '双击编辑' })
      return id
    })
  }

  editText(id: string, text: string): void {
    this.graph().updateNode(id, { data: { text } })
  }

  /**
   * 复制节点：把源节点的 text 抄到新节点，位置右下方偏移 24px。
   * 只带 text 一个业务字段（不整包拷 data，避免把 _overlay 之类的会话态一起复制过去）。
   */
  duplicateTextNode(id: string): string {
    const graph = this.graph()
    const source = graph.getNode(id)
    if (!source) return ''
    const data: Record<string, unknown> = { text: source.data.text }
    const position = { x: source.position.x + 24, y: source.position.y + 24 }
    return graph.transaction('duplicate-text-node', (tx) => tx.createNode('text', position, data))
  }
}

export const name = 'text'
export const inject = ['graph'] as string[]

/**
 * 节点类型图标（标题左侧与右键"新建节点"共用；opaque 句柄：SVG 字符串或 Vue 组件）。
 * 单一来源 = 本类型注册时声明，无需菜单/标题各自配置。
 */
const NODE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>'

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
  //    segments：只挂"底部生成控制栏"一段——顶部操作条（加粗/字号/颜色/对齐）已被用户要求删除
  //    （对文本节点没有意义）；壳（BaseNode）注册了段才渲染。
  //    底部栏按用户要求做成与图片节点同款的"输入框 + 下拉 + 发送"：文本会用 AI 生成，
  //    能产出文本的工具由工具插件经 ctx.tools 注册，本包只消费（认不清任何模型名）。
  //    字数/行数统计、复制/删除动作并入该栏（原独立状态栏职责）。
  //    段组件只收到 { id, data }，选中态由组件自行订阅内核 selection（且仅单选时显示）。
  ctx.nodes.register({
    type: 'text',
    label: '文本',
    icon: NODE_ICON,
    size: { w: 300, h: 200 },
    inputs: [{ port: 'target', acceptsTypes: ['text'], capacity: 1 }],
    outputs: [{ port: 'source', contentType: 'text' }],
    // 声明支持 resize：BaseNode 据类型能力显示右下拖柄（尺寸写回 node.data.cardWidth/Height）。
    resizable: true,
    content: TextContent,
    segments: {
      'bottom-toolbar': TextGeneratePanel,
    },
    create(position) {
      return text.addTextNode(position)
    },
  })

  // 3. 命令：底部条的按钮与命令走**同一批服务方法**——按钮是"组件自己调实现"，
  //    命令是"外部（快捷键/右键菜单/MCP）按 id 调"，两条路不各写一遍。
  //    payload 约定：{ nodeId: string }。
  ctx.commands.register({
    id: 'text.duplicate',
    title: '复制文本节点',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return Boolean(text.duplicateTextNode(nodeId))
    },
  })
  ctx.commands.register({
    id: 'text.delete',
    title: '删除文本节点',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      ctx.get<GraphDocumentService>('graph').removeNodes([nodeId])
      return true
    },
  })
}

/** 兼容旧装配的 PluginModule 出口（host 用 :plugins=[...]，与裸 export 等价；name='text' 供 HMR reload） */
export const nodeTextPlugin: PluginModule = { name, inject, apply }
