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
import type { NodeStoreService, SaveService } from '@mini-canvas/canvas-core-v2'
import ImageContent from './ImageContent.vue'
// 设置面板 slothost 测试组件（本插件自定义导航/内容插槽填充）
import DemoSlotNavItem from './settingsDemo/DemoSlotNavItem.vue'
import DemoSlotContent from './settingsDemo/DemoSlotContent.vue'

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
 * image 插件可配置项 schema（P4：模块级 Config）。
 * 字段带 group，内核装配时经 Config 校验+补默认并登记进 settings 单一数据源(scope=image)；
 * 设置面板(PluginSettingsDialog)据此渲染成左侧分组导航 + 右侧 schema 控件。
 *
 * 本插件故意给了**多个分组**来验证设置面板 slothost：
 *   - 「图片」 其右侧**并存**了自定义组件（settingsGroup/图片 插槽 + mode=append）：默认控件与自绘组件同时显示
 *   - 「边框」 其**导航 tab 被 DemoSlotNavItem 顶替**（settingsNav 插槽，id='边框'）
 *   - 「高级」 走默认渲染（无插槽接管）
 * 与 theme-default 的「连线 / 连线动效与箭头」并存，正好测试"跨插件分组合并"。
 */
export const Config: ConfigSchema = {
  // —— 组「图片」：默认 schema 渲染，同时 settingsGroup/图片 以 mode=append 追加自定义组件（并存）——
  cornerRadius: { type: 'number', default: 8, min: 0, max: 40, label: '圆角', group: '图片' },
  showShadow: { type: 'boolean', default: true, label: '阴影', group: '图片' },
  // —— 组「边框」：导航 tab 被 settingsNav 插槽顶替 ——
  borderWidth: { type: 'number', default: 1, min: 0, max: 8, label: '边框粗细', group: '边框' },
  borderColor: { type: 'color', default: '#334155', label: '边框颜色', group: '边框' },
  // —— 组「高级」：走默认渲染（无插槽接管）——
  blurOnLoad: { type: 'boolean', default: false, label: '加载时模糊', group: '高级' },
  lazyLoad: { type: 'boolean', default: true, label: '懒加载', group: '高级' },
}

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

  // 3. 设置面板 slothost 验证：往设置弹窗的插槽塞 occupant（装卸自动回收）
  //    a) settingsNav：id 命中 config 分组「边框」→ 顶替它的默认导航 tab（注入 group/active/onSelect）
  ctx.slots.register('settingsNav', {
    id: '边框',
    order: -1,
    component: DemoSlotNavItem,
  })
  //    b) settingsGroup/图片 + meta.mode='append'：与「图片」默认 schema 控件并存（不接管），
  //       右侧先显示该组默认控件、再追加本组件 —— 验证"默认 + 自定义同时存在"。
  //       若不加 meta（mode 缺省='replace'）则整组接管、隐藏默认控件（向后兼容旧行为）。
  ctx.slots.register('settingsGroup/图片', {
    id: 'image-coexist-demo',
    order: 0,
    component: DemoSlotContent,
    meta: { mode: 'append' },
  })

  // 4. 供开发期 HMR 验证：改本文件内 v 数值后保存，画布内 ctx.get('image-meta').v 实时变化
  ctx.inject('image-meta', { v: 1 })
}

/** 兼容旧装配的 PluginModule 出口（name='image' 供 HMR reload） */
export const nodeImagePlugin: PluginModule = { name, inject, Config, apply }
