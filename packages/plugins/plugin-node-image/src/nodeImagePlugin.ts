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
import type { GraphDocumentService } from '@mini-canvas/canvas-data'
import { DEFAULT_IMAGE_FIT_LIMITS } from './imageFit'
import ImageContent from './ImageContent.vue'
import ImageTopToolbar from './ImageTopToolbar.vue'
import ImageGeneratePanel from './ImageGeneratePanel.vue'
import { beginCrop, endCrop } from './cropSession'
import { createImageOps, cropImage, downloadImageNode, rotateImage, uploadImage } from './imageOps'
import { pickImageFile } from './imageTransform'
import type { Rect } from './cropGeometry'

/** image 插件暴露给外部的服务形状（content/宿主经 ctx.get('image') 使用；形状不变，.vue 零改动） */
export interface ImageNodeService {
  /** 加一个显示指定图片的节点；imageUrl 可为 URL / dataURL / objectURL */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string
  /** 删除节点并落盘 */
  removeNode(id: string): void
}

/** 类型增强缝（cordis ch3 声明合并）：宿主/作者 ctx.image 直访时类型为 ImageService */
declare module '@mini-canvas/canvas-data' {
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
 * 节点类型图标（标题左侧与右键"新建节点"共用；opaque 句柄：SVG 字符串或 Vue 组件）。
 * 单一来源 = 本类型注册时声明，无需菜单/标题各自配置。
 */
const NODE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>'

/**
 * image 插件可配置项 schema（P4：模块级 Config）。
 * 字段带 group，内核装配时经 Config 校验+补默认并登记进 settings 单一数据源(scope=image)；
 * 设置面板(PluginSettingsDialog)据此渲染成左侧分组导航 + 右侧 schema 控件。
 *
 * 分组命名约定：`一级/二级`（左侧一级导航、右侧二级页签条），一级按"画布对象"归类、跨插件聚合。
 * 本包只声明真正读得到的项（图片尺寸上限，归一级「布局」）。
 *
 * 已删除（曾声明但**全仓无人读取**，等于设置界面里改了不生效的死配置）：
 * cornerRadius / showShadow / borderWidth / borderColor / blurOnLoad / lazyLoad。
 * 其中边框那几项尤其误导 —— 实测问"为什么图片会长出边框"时才发现，边框其实来自**共享外壳**
 * （BaseNode），图片插件只是声明了一个没人读的调节项。真要支持"图片可调边框/圆角"时再加，
 * 那时一次性把实现与测试一起补上；现在留着只会让人以为能调。
 */
export const Config: ConfigSchema = {
  // —— 「布局 / 图片节点尺寸」：换图后卡片跟着图片等比缩放时的封顶 ——
  // 键名必须带本包前缀：内核 settings 是全局同一张表、先声明者独占，
  // 叫 "maxWidth" 这种通用名会和其他插件抢同一个键。
  imageFitMaxWidth: {
    type: 'number', default: DEFAULT_IMAGE_FIT_LIMITS.maxWidth, min: 120, max: 2000, step: 10,
    label: '图片预览上限宽', group: '布局/图片节点尺寸',
    description: '上传/换图后，图片节点卡片的最大宽度（px）。图片比这个宽就等比缩小，不会放大。',
  },
  imageFitMaxHeight: {
    type: 'number', default: DEFAULT_IMAGE_FIT_LIMITS.maxHeight, min: 120, max: 2000, step: 10,
    label: '图片预览上限高', group: '布局/图片节点尺寸',
    description: '上传/换图后，图片节点卡片的最大高度（px）。图片比这个高就等比缩小，不会放大。',
  },
}

export function apply(ctx: Context) {
  // 1. 构造即上架 'image' 服务（super(ctx,'image') → ctx.provide，随插件 scope 回收）
  const image = new ImageService(ctx)

  // 2. 注册节点类型：create 委托服务（同一实现）。create 只收 position → 建默认空图节点。
  //    内容类型声明：image 输出产 image；输入口收 text+image（文生图/图生图），视频喂不进图片。
  //    segments：除 content 外再挂"顶部操作条 / 底部生成面板"两段 —— 壳（BaseNode）注册了段才渲染，
  //    段组件只收到 { id, data }，选中态由组件自己订阅内核 selection（useSoleNodeSelected：
  //    仅"恰好选中一个且是我"时显示，多选时上下控制栏一起收起）。
  //    底部面板承担两件事：① 生成控制栏（选模型/参数/写提示词 → 调 ctx.tools 出图）；
  //    ② 图片本身的加工（旋转/下载）。既有能力与生成共存，不互相挡路。
  //    注意：面板**不注册任何工具**（模型提供方由独立工具插件经 ctx.tools.register 提供），
  //    本包只消费 ctx.tools —— 加一个模型不用改本包。
  ctx.nodes.register({
    type: 'image',
    label: '图片',
    icon: NODE_ICON,
    size: { w: 320, h: 240 },
    // 不声明 capacity = **不限条数**：图片节点可以同时接多个上游素材（文生图 / 多图参考），
    // 底部生成面板的素材行本就是按「所有连进来的上游」渲染的（见 panelSource 的 collectUpstreamMaterials）。
    // 以前这里写 capacity:1 把它限成一条，用户实测报的「图片输入端口分明可以添加多条连接线」就是它。
    inputs: [{ port: 'target', acceptsTypes: ['text', 'image'] }],
    outputs: [{ port: 'source', contentType: 'image' }],
    // 无卡片边框：图片是**内容铺满整张卡**的，外壳那圈 1px 边框对它没有分层价值，
    // 只会变成内容边缘多余的一圈缝（用户实测报的"图片边上还有一像素边距"就是它）。
    // 选中环不受影响：环是 ::after 的 box-shadow，与边框互相独立。
    frameless: true,
    content: ImageContent,
    segments: {
      'top-toolbar': ImageTopToolbar,
      'bottom-toolbar': ImageGeneratePanel,
    },
    create(position) {
      return image.addImageNode(position, '')
    },
  })

  // 3. 命令：界面按钮与命令走**同一批实现**（uploadImage/cropImage/rotateImage/downloadImageNode）——
  //    按钮是"组件自己调实现"，命令是"外部（快捷键/右键菜单/MCP）按 id 调"，两条路不各写一遍。
  //    payload 约定：{ nodeId: string }（节点级操作）；裁剪确认额外给 rect（图片像素矩形）。
  const ops = createImageOps(ctx)
  ctx.commands.register({
    id: 'image.upload',
    title: '上传图片',
    run: async (_c, payload) => {
      const { nodeId, file } = (payload ?? {}) as { nodeId?: string; file?: Blob }
      if (!nodeId) return false
      if (file) return uploadImage(ops, nodeId, file)
      // 无文件（快捷键/菜单触发）：开系统选图框，选中后复用同一上传实现
      const picked = await pickImageFile()
      return picked ? uploadImage(ops, nodeId, picked) : false
    },
  })
  ctx.commands.register({
    id: 'image.crop',
    title: '裁剪图片',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      beginCrop(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'image.cropConfirm',
    title: '确认裁剪',
    run: async (_c, payload) => {
      const { nodeId, rect } = (payload ?? {}) as { nodeId?: string; rect?: Rect }
      if (!nodeId || !rect) return false
      const ok = await cropImage(ops, nodeId, rect)
      endCrop(nodeId)
      return ok
    },
  })
  ctx.commands.register({
    id: 'image.cropCancel',
    title: '取消裁剪',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      endCrop(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'image.rotate',
    title: '旋转图片',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return rotateImage(ops, nodeId)
    },
  })
  ctx.commands.register({
    id: 'image.download',
    title: '下载图片',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return downloadImageNode(ops, nodeId)
    },
  })

  // 4. 供开发期 HMR 验证：改本文件内 v 数值后保存，画布内 ctx.get('image-meta').v 实时变化
  ctx.inject('image-meta', { v: 1 })
}

/** 兼容旧装配的 PluginModule 出口（name='image' 供 HMR reload） */
export const nodeImagePlugin: PluginModule = { name, inject, Config, apply }
