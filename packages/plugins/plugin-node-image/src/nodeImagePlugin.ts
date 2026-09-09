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
import { Service, type PluginModule, type Context, type ConfigSchema } from '@mini-canvas/canvas-base'
import type { GraphDocumentService } from '@mini-canvas/canvas-core-v2'
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

  /** 加一个 image 节点并写 imageUrl；返回短 id（统一走 graph 唯一写入口） */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string {
    const graph = this.ctx.get<GraphDocumentService>('graph')
    return graph.transaction('add-image-node', (tx) => tx.createNode('image', position, { imageUrl }))
  }

  /** 删除节点：连带清掉与它相连的边与选中态，包一次历史并落盘（统一走 graph）。
   * 资源回收说明（P1-14）：object URL 不在此即时 revoke —— 删除后用户可能 undo 恢复节点，
   * 即时 revoke 会让恢复的图破图。统一由 CanvasHost flushSave 的引用扫描延迟回收
   * （落盘前已确认该 resourceId 不再被任何存活节点引用才 revoke），与 undo 语义兼容。 */
  removeNode(id: string): void {
    this.ctx.get<GraphDocumentService>('graph').removeNodes([id])
  }
}

export const name = 'image'
export const inject = ['graph'] as string[]

/**
 * image 插件可配置项 schema（P4：模块级 Config）。
 * 字段带 group，内核装配时经 Config 校验+补默认并登记进 settings 单一数据源(scope=image)；
 * 设置面板(PluginSettingsDialog)据此渲染成左侧分组导航 + 右侧 schema 控件。
 *
 * 分组命名约定：`一级/二级`（左侧一级导航、右侧二级页签条），一级按"画布对象"归类、跨插件聚合。
 * image 节点字段归一级「节点」的 `节点/图片节点`；边框颜色字段归一级「常规」的 `常规/主题配色`（配色集中调）。
 * 视觉/外观相关的进阶编排（预览UI、字段渲染器下发）见 docs/代码开发/plugins/plugin-theme-default.md。
 */
export const Config: ConfigSchema = {
  // —— 「节点 / 图片节点」：image 节点的外观与加载行为（非颜色）——
  cornerRadius: {
    type: 'number', default: 8, min: 0, max: 40, label: '圆角', group: '节点/图片节点',
    description: '图片四角的圆角半径（px）。0 = 直角，越大越圆润。',
  },
  showShadow: {
    type: 'boolean', default: true, label: '阴影', group: '节点/图片节点',
    description: '是否给图片节点外圈画一层柔和阴影，让它从画布背景上浮起来。',
  },
  borderWidth: {
    type: 'number', default: 1, min: 0, max: 8, label: '边框粗细', group: '节点/图片节点',
    description: '图片节点边框的粗细（px）。0 = 不画边框。',
  },
  blurOnLoad: {
    type: 'boolean', default: false, label: '加载时模糊', group: '节点/图片节点',
    description: '图片还没加载完时先以模糊占位显示，加载完成再变清晰（适合大图，视觉更平滑）。',
  },
  lazyLoad: {
    type: 'boolean', default: true, label: '懒加载', group: '节点/图片节点',
    description: '开启后图片进入可视区域附近才真正开始加载，滚动到很远处的图不浪费带宽。',
  },
  // —— 颜色统一归「常规/主题配色」——
  borderColor: {
    type: 'color', default: '#334155', label: '边框颜色', group: '常规/主题配色',
    description: '图片节点边框的颜色（开了边框后才显示）。',
  },
}

export function apply(ctx: Context) {
  // 1. 构造即上架 'image' 服务（super(ctx,'image') → ctx.provide，随插件 scope 回收）
  const image = new ImageService(ctx)

  // 2. 注册节点类型：create 委托服务（同一实现）。create 只收 position → 建默认空图节点。
  //    内容类型声明：image 输出产 image；输入口收 text+image（文生图/图生图），视频喂不进图片。
  ctx.nodes.register({
    type: 'image',
    label: '图片',
    size: { w: 320, h: 240 },
    inputs: [{ port: 'target', acceptsTypes: ['text', 'image'], capacity: 1 }],
    outputs: [{ port: 'source', contentType: 'image' }],
    content: ImageContent,
    create(position) {
      return image.addImageNode(position, '')
    },
  })

  // 3. 供开发期 HMR 验证：改本文件内 v 数值后保存，画布内 ctx.get('image-meta').v 实时变化
  ctx.inject('image-meta', { v: 1 })
}

/** 兼容旧装配的 PluginModule 出口（name='image' 供 HMR reload） */
export const nodeImagePlugin: PluginModule = { name, inject, Config, apply }






