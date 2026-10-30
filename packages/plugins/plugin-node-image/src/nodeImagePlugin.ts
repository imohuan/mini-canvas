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
import {
  Service, type PluginModule, type Context, type ConfigSchema, bindTypeDefaultSize,
  DEFAULT_IMAGE_CARD_LIMITS, IMAGE_CARD_LIMIT_KEYS, isMediaCardLimitKey,
} from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import { thumbTierFields, thumbTierKeys } from './thumbTier'
import { imageTitleExtra } from './imageNodeData'
import { followedCardSizePatch, readImageFitLimits } from './imageFit'
import ImageContent from './ImageContent.vue'
import ImageTopToolbar from './ImageTopToolbar.vue'
import ImageFrameOverlay from './ImageFrameOverlay.vue'
import ImageOverlays from './ImageOverlays.vue'
import ImagePaintPanel from './ImagePaintPanel.vue'
import { beginCrop, beginExpand, endEdit, onEditModeChange } from './cropSession'
import { beginPaint, endPaint, isPainting, onPaintModeChange, paintState, redoStroke, undoStroke } from './paintSession'
import { createImageOps, cropImage, downloadImageNode, expandImageNode, paintImageNodes, rotateImage, uploadImage } from './imageOps'
import { pickImageFile } from './imageTransform'
import type { Rect } from '@mini-canvas/canvas-render'
import {
  MEDIA_CREATOR_FIELD,
  type MediaKindCreator,
} from '@mini-canvas/canvas-render'

/** image 插件暴露给外部的服务形状（content/宿主经 ctx.get('image') 使用；形状不变，.vue 零改动） */
export interface ImageNodeService {
  /** 加一个显示指定图片的节点；imageUrl 可为 URL / dataURL / objectURL */
  addImageNode(position: { x: number; y: number }, imageUrl: string): string
  /**
   * 加一个由**持久资源引用**承载的图片节点：只写 resourceId，不写显示地址。
   * 显示地址由内容组件按当前环境 resolve（本地 objectURL / 云端受控路由）。
   * 拿到的是别的插件（视频截图、文件拖入、资产导入）的统一入口。
   */
  addImageNodeFromResource(position: { x: number; y: number }, resourceId: string, meta?: ImageNodeMeta): string
  /** 删除节点并落盘 */
  removeNode(id: string): void
}

/** 按引用建图片节点时可一并写入的元数据（由图片类型自己解释，调用方不拼内部字段） */
export interface ImageNodeMeta {
  name?: string
  width?: number
  height?: number
  /** 源节点：media 入口据此统一算落点并自动连边（旧调用方不传不受影响） */
  sourceNodeId?: string
  gap?: number
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
    const doc = this.ctx.get('doc')
    // 调用方给的是**资源引用**（res-…）时按引用建节点，不再把它当地址写进 imageUrl；
    // 给的是真实地址（外链 / dataURL / 页面上可直接显示的地址）时保留旧行为。
    // TODO(media): `media.put` 落地后，这里改成先存字节再建节点，彻底不写地址。
    const data = /^res-/.test(imageUrl) ? { resourceId: imageUrl } : imageUrl ? { imageUrl } : {}
    return doc.transaction('add-image-node', (tx) => tx.createNode('image', position, data))
  }

  /** 按资源引用建节点：节点里只有 resourceId（迁移期不写显示地址） */
  addImageNodeFromResource(
    position: { x: number; y: number },
    resourceId: string,
    meta?: ImageNodeMeta,
  ): string {
    const doc = this.ctx.get('doc')
    const data: Record<string, unknown> = { resourceId }
    if (meta?.name) data.imageName = meta.name
    if (typeof meta?.width === 'number' && meta.width > 0) data.imageWidth = meta.width
    if (typeof meta?.height === 'number' && meta.height > 0) data.imageHeight = meta.height
    return doc.transaction('add-image-node', (tx) => tx.createNode('image', position, data))
  }

  /** 删除节点：连带清掉与它相连的边与选中态，包一次历史并落盘（统一走 graph）。
   * 资源回收说明（P1-14）：object URL 不在此即时 revoke —— 删除后用户可能 undo 恢复节点，
   * 即时 revoke 会让恢复的图破图。统一由 CanvasHost flushSave 的引用扫描延迟回收
   * （落盘前已确认该 resourceId 不再被任何存活节点引用才 revoke），与 undo 语义兼容。 */
  removeNode(id: string): void {
    this.ctx.get('doc').removeNodes([id])
  }
}

export const name = 'image'
export const inject = ['doc'] as string[]

/**
 * 节点类型图标（标题左侧与右键"新建节点"共用；opaque 句柄：SVG 字符串或 Vue 组件）。
 * 单一来源 = 本类型注册时声明，无需菜单/标题各自配置。
 */
const NODE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>'

/**
 * image 插件可配置项 schema（P4：模块级 Config）。
 * 字段带 group，内核装配时经 Config 校验+补默认并登记进 settings 单一数据源(scope=image)；
 * 设置内容(PluginSettingsContent)据此渲染成左侧分组导航 + 右侧 schema 控件。
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
  // —— 「布局 / 图片节点尺寸」：新节点默认尺寸（改完实时生效，未 resize 过的节点跟着变）——
  imageDefaultWidth: {
    type: 'number', default: 320, min: 80, max: 2000, step: 10,
    label: '默认宽', group: '布局/图片节点尺寸',
    description: '图片节点没有自己的尺寸时用的宽度（px）。改完立即生效：没被手动拖过尺寸的图片节点会立刻跟着变。',
  },
  imageDefaultHeight: {
    type: 'number', default: 240, min: 80, max: 2000, step: 10,
    label: '默认高', group: '布局/图片节点尺寸',
    description: '图片节点没有自己的尺寸时用的高度（px）。改完立即生效（同上）。',
  },
  // —— 「布局 / 图片节点尺寸」：换图后卡片跟着图片等比缩放 ——
  // 只给「最短边最小 / 最长边最大」两条，横图竖图都按同一套规则，不用再理解宽/高上限。
  [IMAGE_CARD_LIMIT_KEYS.minShortSide]: {
    type: 'number', default: DEFAULT_IMAGE_CARD_LIMITS.minShortSide, min: 40, max: 2000, step: 10,
    label: '最短边最小', group: '布局/图片节点尺寸',
    description: '图片节点卡片最短的一条边至少这么长（px）。小图会等比放大，细长图按这条算。',
  },
  [IMAGE_CARD_LIMIT_KEYS.maxLongSide]: {
    type: 'number', default: DEFAULT_IMAGE_CARD_LIMITS.maxLongSide, min: 120, max: 4000, step: 10,
    label: '最长边最大', group: '布局/图片节点尺寸',
    description: '图片节点卡片最长的一条边最多这么长（px）。特别细长的图会超过它，以最短边为准。',
  },
  // —— 「节点/缩略图」：三档显示（用户口径：三档全部可配；第 1 档是原图，不用配）——
  //
  // 第 2/3 档的**阈值 + 目标框 + 清晰度**都在这里。小图由**本插件用 canvas 现画**
  // （见 thumbCanvas.ts：一份代码两种后端通吃，不依赖后台、不动基础包），
  // 生成结果只放内存、不写节点数据 → 节点里不多存任何字段，旧节点自动具备三档。
  //
  // 键名由 thumbTierFields 统一生成（前缀 image）：图片与视频各一套、互不影响，
  // 且**必须**带前缀 —— settings 是全局同一张表、先声明者独占，通用名会跟别的插件抢键。
  ...thumbTierFields('image', '节点/缩略图', '图片'),
}

/** 本插件声明的缩略图设置键（内容组件按它过滤 settings 变更） */
export const IMAGE_THUMB_KEYS = thumbTierKeys('image')

export function apply(ctx: Context) {
  // 1. 构造即上架 'image' 服务（super(ctx,'image') → ctx.provide，随插件 scope 回收）
  const image = new ImageService(ctx)

  // 1.5 本包**不接触底栏**（用户口径 2026-10-29）。
  //
  // 底栏是独立插件（plugin-bottom-bar），"底栏上出现哪些模型"由 cloud-client 统一从后台
  // 拉清单后注册（见 plugin-cloud-client/src/plugin.ts 的 reloadActions）。图片插件再调一次
  // publishToolActions 就是第二支笔往同一张表里写 —— 重复项、归属说不清，还逼着本插件
  // import 另一个插件（插件之间不互相 import，这是硬规则）。
  //
  // 因此这里只剩一件事：把图片的**操作实现**装配好，供下面的命令使用。
  const ops = createImageOps(ctx)

  // 1.6 两根状态栏都注册进 nodeToolbar（用户口径 2026-10-29 重构）：
  //
  //   - 默认模式：上栏 = 图片自己的操作条（上传/裁剪/扩展 + 插件插进来的按钮），
  //     下栏不声明（= 沿用 bottom-bar 注册的默认生成 UI）；
  //   - 裁剪/扩展模式：只接管**下栏**（顶栏的确认/取消仍由 ImageTopToolbar 按会话自己切）。
  //
  // 为什么上栏要注册成「默认模式」而不是继续用节点类型的 out:top 段：
  // 状态栏的内容必须走同一条解析链路（nodeToolbar），否则「默认 / 功能模式」两套入口会打架。
  // 节点类型不再声明 out:top 段，避免同一个位置出现两份内容。
  //
  // 不 import @mini-canvas/plugin-theme-default / plugin-bottom-bar —— 插件之间不互相
  // import 是硬规则；服务名与 ui 目录名才是跨插件公共契约。
  const registerToolbar = (): boolean => {
    const svc = ctx.tryGet<{
      registerMode?(mode: unknown): void
    } | undefined>('nodeToolbar')
    if (!svc?.registerMode) return false
    svc.registerMode({
      id: 'default',
      types: ['image'],
      title: '图片默认状态栏',
      topBar: ImageTopToolbar,
      order: 100,
    })
    // 用户口径 2026-10-29（截图）：裁剪/扩展只显示**顶栏**（确认/取消/比例都在顶栏），
    // 底栏整格不显示（bottomBar: null）—— 不在底部重复一套控制栏。
    svc.registerMode({ id: 'image/crop', types: ['image'], title: '裁剪图片', bottomBar: null })
    svc.registerMode({ id: 'image/expand', types: ['image'], title: '扩展图片', bottomBar: null })
    svc.registerMode({
      id: 'image/paint',
      types: ['image'],
      title: '绘制图片',
      topBar: ImagePaintPanel,
      bottomBar: null,
    })
    return true
  }
  if (!registerToolbar()) {
    // 主题还没装（装配顺序在后/热装）：等它上架再注册一次
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerToolbar()) off.dispose()
    })
  }

  // 1.7 编辑态 ↔ 状态栏模式自动同步（同一份会话，两处 UI 不会各说各话）：
  //     进裁剪/扩展 → 下栏切到对应 panel；确认/取消 → 退出模式回到默认生成 UI。
  //     监听放在这里而不是 cropSession 内部：那份是纯状态，只负责「记着自己正在编辑」。
  const offEditMode = onEditModeChange((nodeId, mode) => {
    const svc = ctx.tryGet<{
      enter?(nodeId: string, modeId: string): void
      exit?(nodeId: string): void
    } | undefined>('nodeToolbar')
    if (!svc) return
    if (mode === 'crop') svc.enter?.(nodeId, 'image/crop')
    else if (mode === 'expand') svc.enter?.(nodeId, 'image/expand')
    else svc.exit?.(nodeId)
  })
  ctx.effect(() => () => offEditMode())

  // 1.7b 绘制态 ↔ 状态栏模式自动同步（与 cropSession 同一条规矩）
  const offPaintMode = onPaintModeChange((nodeId, mode) => {
    const svc = ctx.tryGet<{
      enter?(nodeId: string, modeId: string): void
      exit?(nodeId: string): void
    } | undefined>('nodeToolbar')
    if (!svc) return
    if (mode === 'paint') svc.enter?.(nodeId, 'image/paint')
    else svc.exit?.(nodeId)
  })
  ctx.effect(() => () => offPaintMode())

  // 2. 注册节点类型：create 委托服务（同一实现）。create 只收 position → 建默认空图节点。
  //    内容类型声明：image 输出产 image；输入口收 text+image（文生图/图生图），视频喂不进图片。
    //    segments：除 content 外再挂"顶部操作条"一段 —— 壳（BaseNode）注册了段才渲染。
    //    本包**不注册底栏段**（out:bottom）：底栏归 plugin-bottom-bar，模型清单归 cloud-client。
  ctx.nodes.register({
    type: 'image',
    label: '图片',
    nameTemplate: '图片 {{ID}}',
    description: '在画布中添加一张图片',
    // 数据契约（docs/design/node-data-and-upstream-contract.md）：
    // 对外产出 image 槽；节点数据只保存持久资源引用 resourceId，不保存显示地址。
    produces: { image: { kind: 'image', refField: 'resourceId' } },
    icon: NODE_ICON,
    // 标题右侧显示原图分辨率（1920×1080）：派生值按 data 现算，不写进 data ——
    // 尺寸一变就写一次 data 会让每次裁剪/旋转多出一条撤销记录。
    titleExtra: imageTitleExtra,
    size: { w: 320, h: 240 },
    // 不声明 capacity = **不限条数**：图片节点可以同时接多个上游素材（文生图 / 多图参考）。
    // 以前这里写 capacity:1 把它限成一条，用户实测报的「图片输入端口分明可以添加多条连接线」就是它。
    // 视频也收：截图就是“视频 → 新图片”这条连线（media.addNode 给了 sourceNodeId 会自动连边）。
    // 图片本身不播放视频，它接的是“从这段视频里取出来的一帧”；这条边记的是来源关系。
    inputs: [{ port: 'target', acceptsTypes: ['text', 'image', 'video'] }],
    outputs: [{ port: 'source', contentType: 'image' }],
    // 保留卡片边框（2026-10-12 用户口径翻案）：以前为"图片贴边"声明 frameless 关掉外壳那圈 1px 边框，
    // 但**空节点**和**白底图片**就与画布背景糊在一起了 —— 用户分不清节点边界在哪。
    // 边框是共享外壳（BaseNode 的 .v2-card）画的，不是图片插件自己画的；这里只是不声明 frameless，走默认。
    // （图片仍是内容铺满：1px 边框由 border-box 吃掉，不产生额外间隙。）
    // 加载态用默认尺寸（用户口径 2026-10-10）：图片节点一旦有图，node.size 就被按那张图的真实比例
    // 写死（9:16 竖图 → 169×300）。于是**重新生成**时卡片仍是竖版，用户看到"重新生成就变竖屏"。
    // 声明本能力后：跑任务期间卡片按设置里配的「默认宽/默认高」显示，跑完立刻回到新图比例。
    // 只改渲染、不动 node.size —— 生成失败/取消时原图与尺寸原样还在。
    loadingDefaultSize: true,
    in: ImageContent,
    segments: {
      // 编辑浮层（裁剪框/扩展框）画在**卡片外面**：内容段住在 overflow:hidden 的裁剪层里，
      // 浮层挂那儿会被卡片边界切掉（用户实测报的「裁剪区域被节点切掉」）。
      // 扩展框还要能画到卡片之外（扩出来的部分本来就在原图外面），只有这一层做得到。
       'over:inset': ImageOverlays,
    },
    create(position, extra) {
      // extra 里带 imageUrl 时直接建出有图的节点（右键菜单 / 资产「添加到画布」/ command:create-node 都走这里）。
      // 之前忽略了 extra —— 于是这类调用建出来的是**空白图片节点**（用户实测报过）。
      const url = (extra as { imageUrl?: unknown } | undefined)?.imageUrl
      return image.addImageNode(position, typeof url === 'string' ? url : '')
    },
  })

  // 媒体创建器：别的插件（视频截图、文件拖入、资产导入、AI 工具）要“放一张图”时，
  // 经 media 能力路由到这里，由图片插件自己写标准字段；调用方不需要知道 image 服务。
  const mediaField = ctx.registryOf<MediaKindCreator>(MEDIA_CREATOR_FIELD)
  mediaField.add(
    'image',
    {
      addNode: (request) => image.addImageNodeFromResource(request.position, request.resourceId, {
        name: typeof request.meta?.name === 'string' ? request.meta.name : undefined,
        width: typeof request.meta?.width === 'number' ? request.meta.width : undefined,
        height: typeof request.meta?.height === 'number' ? request.meta.height : undefined,
      }),
      applyToNode: (request) => {
        const doc = ctx.get('doc')
        const node = doc.getNode(request.nodeId)
        if (!node || node.type !== 'image') return false
        doc.updateNode(request.nodeId, { data: { resourceId: request.resourceId } })
        return true
      },
    },
    { id: 'node-image' },
  )

  // 2b. 默认尺寸接设置面板：改完**实时**生效（没 resize 过的图片节点立刻跟着变）
  bindTypeDefaultSize(ctx, 'image', { w: 320, h: 240 }, { widthKey: 'imageDefaultWidth', heightKey: 'imageDefaultHeight' })

  // 最短边 / 最长边一改，画布上**已有**的图片节点也按新规则重算（用户要的实时效果）。
  // 只碰有真实图片尺寸的节点；量不到尺寸的保持原样，不猜。
  // 写派生尺寸优先走 updateNodeRuntime：落盘但不占撤销栈 —— 改设置不该让用户按 Ctrl+Z 撤销。
  const settingsForFit = ctx.tryGet<{
    onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
  }>('settings')
  const offImageFit = settingsForFit?.onChange((key) => {
    if (!isMediaCardLimitKey(key, IMAGE_CARD_LIMIT_KEYS)) return
    const doc = ctx.tryGet<{
      getNodes(): Array<{ id: string; type: string; data?: Record<string, unknown> }>
      updateNodeRuntime?(id: string, patch: { size: { w: number; h: number } }): void
      updateNode?(id: string, patch: { size: { w: number; h: number } }): void
    }>('doc')
    if (!doc) return
    const limits = readImageFitLimits(ctx)
    for (const node of doc.getNodes()) {
      if (node.type !== 'image') continue
      const patch = followedCardSizePatch(node.data, limits)
      if (!patch) continue
      if (doc.updateNodeRuntime) doc.updateNodeRuntime(node.id, { size: patch.size })
      else doc.updateNode?.(node.id, { size: patch.size })
    }
  })
  if (offImageFit) ctx.effect(() => () => offImageFit.dispose())

  // 3. 命令：界面按钮与命令走**同一批实现**（uploadImage/cropImage/rotateImage/downloadImageNode）——
  //    按钮是"组件自己调实现"，命令是"外部（快捷键/右键菜单/MCP）按 id 调"，两条路不各写一遍。
  //    payload 约定：{ nodeId: string }（节点级操作）；裁剪确认额外给 rect（图片像素矩形）。
  ctx.commands.register({
    id: 'image:upload',
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
    id: 'image:crop',
    title: '裁剪图片',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      beginCrop(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'image:crop-confirm',
    title: '确认裁剪',
    run: async (_c, payload) => {
      const { nodeId, rect } = (payload ?? {}) as { nodeId?: string; rect?: Rect }
      if (!nodeId || !rect) return false
      const ok = await cropImage(ops, nodeId, rect)
      endEdit(nodeId)
      return ok
    },
  })
  ctx.commands.register({
    id: 'image:crop-cancel',
    title: '取消裁剪',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      endEdit(nodeId)
      return true
    },
  })
  // —— 图片扩展（Outpaint）：把画面往外扩出一圈透明画布，等着交给生成模型填内容 ——
  ctx.commands.register({
    id: 'image:expand',
    title: '扩展图片',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      beginExpand(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'image:expand-confirm',
    title: '确认扩展',
    run: async (_c, payload) => {
      const { nodeId, rect } = (payload ?? {}) as { nodeId?: string; rect?: Rect }
      if (!nodeId || !rect) return false
      const ok = await expandImageNode(ops, nodeId, rect)
      endEdit(nodeId)
      return ok
    },
  })
  ctx.commands.register({
    id: 'image:expand-cancel',
    title: '取消扩展',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      endEdit(nodeId)
      return true
    },
  })
  // —— 绘制（擦除/重绘的统一入口）：会话笔迹 → 两个图片节点（蒙版 + 结果）——
  ctx.commands.register({
    id: 'image:paint-confirm',
    title: '保存绘制',
    run: async (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      if (!isPainting(nodeId)) return false
      const strokes = paintState(nodeId).strokes
      if (strokes.length === 0) return false
      const ok = await paintImageNodes(ops, nodeId, { strokes })
      if (ok) endPaint(nodeId)
      return ok
    },
  })
  ctx.commands.register({
    id: 'image:paint-cancel',
    title: '取消绘制',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      endPaint(nodeId)
      return true
    },
  })
  // 撤销/清空：浮层组件直接改会话里的同一份数组 —— 命令只做桥（面板 → 命令 → 浮层响应式重画）。
  ctx.commands.register({
    id: 'image:paint-undo',
    title: '撤销绘制笔迹',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      if (!isPainting(nodeId)) return false
      undoStroke(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'image:paint-redo',
    title: '重做绘制笔迹',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      if (!isPainting(nodeId)) return false
      redoStroke(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'image:paint-clear',
    title: '清空绘制笔迹',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      if (!isPainting(nodeId)) return false
      const s = paintState(nodeId)
      s.strokes = []
      s.redo = []
      return true
    },
  })
  ctx.commands.register({
    id: 'image:rotate',
    title: '旋转图片',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return rotateImage(ops, nodeId)
    },
  })
  ctx.commands.register({
    id: 'image:download',
    title: '下载图片',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return downloadImageNode(ops, nodeId)
    },
  })
}

/** 兼容旧装配的 PluginModule 出口（name='image' 供 HMR reload） */
export const nodeImagePlugin: PluginModule = { name, inject, Config, apply }
