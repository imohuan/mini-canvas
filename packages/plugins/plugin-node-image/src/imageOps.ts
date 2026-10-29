/**
 * imageOps —— 图片节点的四个操作（上传 / 裁剪 / 旋转 / 下载）的业务实现。
 *
 * 为什么要单独一层：同一件事有两个入口 —— **界面按钮**（顶部/底部操作条）和**命令**
 * （ctx.commands.register 的 image.upload / image.crop ...，供快捷键、右键菜单、MCP 调用）。
 * 两处各写一遍必然漂移，所以这里把实现收敛成纯异步函数，两边都只是"备好读/写句柄再调它"。
 *
 * 读/写句柄（`ImageOpsContext`）由调用方注入：
 * - 组件侧：ctx.get('doc').getNode(id).data 读；ctx.get('doc').updateNode 写。
 * - 命令侧：同一对服务，只是从命令的 ctx 上取。
 * 两边都用内核**唯一写入口 graph** → 写回自动进历史、自动落盘、可撤销。
 *
 * 本模块只依赖纯工具（imageTransform / imageNodeData / imageExpand）与渲染层的通用几何
 * （@mini-canvas/canvas-render 的 crop/mediaFit），不 import Vue，
 * node 环境下所有图片操作安全地返回 false（环境不支持），不会抛。
 */
import {
  cropToBlob,
  downloadImage,
  pickImageFile,
  readImageSize,
  rotateToBlob,
} from './imageTransform'
import { loadDrawableSource, paintCanvasBlob, releaseDrawable } from './imageBitmap'
import { describeImageMeta, downloadFileName } from './imageNodeData'
import { toPixelRect, type Rect } from '@mini-canvas/canvas-render'
import { cardSizePatch, readImageFitLimits, MIN_CARD_WIDTH, type ImageFitLimits } from './imageFit'
import { expandImage, isExpandEffective, type ExpandBitmapIO } from './imageExpand'
import { renderMaskBlob, renderResultBlob } from './imagePaint'

/** 操作所需的读/写句柄（组件与命令各备一份，实现只写一遍） */
export interface ImageOpsContext {
  /** 读节点当前 data；节点不存在返回 undefined */
  read(nodeId: string): Record<string, unknown> | undefined
  /**
   * 写回节点 data（务必走内核 graph，带历史与落盘）。
   * @param size 传了就同时写内核**正式尺寸字段** node.size —— 必须与 data 在同一个 patch 里提交，
   *   否则一次换图会记两条撤销记录（用户按一次撤销只退半步）。
   */
  write(nodeId: string, data: Record<string, unknown>, size?: { w: number; h: number }): void
  /**
   * 写**派生尺寸**（图片加载后按 naturalWidth/naturalHeight 自动补卡片尺寸）：
   * 落盘但不进撤销栈。
   *
   * 为什么不走 write：那是测量结果、不是用户动作。走可撤销入口会让页面一打开
   * 撤销栈里就多一条“自动测量”，用户按一次 Ctrl+Z 撤销的不是自己刚做的操作
   * （2026-10-27 e2e 实测：建节点后连按两次撤销，只退掉拖动+建节点中的一条）。
   * 与 progress 帧同一语义（doc.updateNodeRuntime）。
   */
  writeMeasured(nodeId: string, data: Record<string, unknown>, size?: { w: number; h: number }): void
  /**
   * 图片预览上限（配置 imageFitMaxWidth/imageFitMaxHeight）。不注入则回落 420×300。
   * 抽成取值器而不是常量：设置面板改完上限后，下一次换图就该按新上限算。
   */
  fitLimits?(): ImageFitLimits
  /** 当前全部节点（找"把它摆在谁左边"时用）；未注入返回 [] */
  listNodes?(): Array<{ id: string; type: string; position: { x: number; y: number }; data?: Record<string, unknown>; size?: { w: number; h: number } }>
  /** 当前全部边（"加素材"要按输入口容量挤最老一条时需要）；未注入返回 [] */
 /**
  * 在一个事务里同时建节点 + 连边（"加素材"必须原子：只能一次 undo）。
  * 未注入时返回 null（调用方据此判断"这个宿主不具备加素材能力"）。
  * 容量/挤出/校验由统一入口 tx.connectEdge 处理（本接口不再单独传 evictEdgeId）。
   * @param edgeDirection 默认 newToTarget（新节点→目标，加素材语义）；targetToNew = 目标→新节点（裁剪语义：原图是上游）
  */
 createNodeWithEdge?(
   type: string,
   position: { x: number; y: number },
   data: Record<string, unknown>,
   target: string,
  edgeDirection?: "newToTarget" | "targetToNew",
 ): string | null
  /**
   * 把一个图片 Blob 存进宿主**资源库**（浏览器里是 IndexedDB）。
   * 返回可写进节点的 `resourceId` 与本次会话可显示的 `url`（objectURL，刷新后由资源库重建）。
   * 资源库不可用（极简宿主 / 单测）时返回 undefined —— 调用方按"这次操作没法持久化"处理，不猜。
   */
  persistImage?(blob: Blob): Promise<{ resourceId: string; url: string } | undefined>
  /**
   * 持久引用 → 当前可显示地址（裁剪/旋转/扩展/下载都要拿真实像素，不能只靠旧 `imageUrl`）。
   * 资源库不可用时返回 undefined —— 调用方放弃这次操作，不猜地址。
   */
  resolveRef?(ref: string): Promise<string | undefined>
  /**
   * 取“现在能真正读到像素”的地址：
   * 旧 `imageUrl` 有就直接用；只有引用时交给资源服务 resolve；都拿不到返回 undefined。
   * 裁剪/旋转/扩展/下载只经这一个口径，不再各自判断字段。
   */
  displayUrlOf?(data: Record<string, unknown> | undefined): Promise<string | undefined>
  /**
   * 在一个事务里批量改图（建节点 + 连边）。绘制保存要一次建两个节点两条边，
   * 一次撤销整体回退 —— 与 createNodeWithEdge 同源，只是批量的。
   */
  transaction?<T>(reason: string, fn: (tx: {
    createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
    connectEdge(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): { edgeId: string; status: string }
  }) => T): T | null
}

/**
 * 图片加工端口（上传读文件 / 测尺寸 / 裁剪 / 旋转 / 下载）。
 *
 * 抽成端口是为了**可测**：这些操作都要 FileReader/canvas，node 环境下跑不了真实实现；
 * 单测注入假实现即可验证"算得对不对、写回得对不对"，而不必启动浏览器。
 */
export interface ImageTransform {
  readImageSize(url: string): Promise<{ width: number; height: number } | null>
  cropToBlob(
    url: string,
    rect: Rect,
    baseWidth: number,
    baseHeight: number,
  ): Promise<{ blob: Blob; width: number; height: number } | null>
  rotateToBlob(url: string, degrees: number): Promise<{ blob: Blob; width: number; height: number } | null>
  downloadImage(url: string, fileName: string): boolean
  pickImageFile(): Promise<File | null>
}

/** 生产实现：全部走浏览器原生能力（见 imageTransform） */
export const defaultTransform: ImageTransform = {
  readImageSize,
  cropToBlob,
  rotateToBlob,
  downloadImage,
  pickImageFile,
}

/** 扩展的生产实现：取图 → 画到更大画布 → 释放（见 imageBitmap） */
export const defaultExpandIO: ExpandBitmapIO = {
  load: (url) => loadDrawableSource(url),
  paint: (bounds, draw, source) => paintCanvasBlob(bounds.width, bounds.height, (c2d) => draw(c2d, source)),
  release: (source) => releaseDrawable(source),
}

/** 只要"按名字取服务"这一件事的宿主形状（内核 Context 与渲染上下文都满足） */
export interface ServiceGetter {
  get<T = unknown>(name: string): T
}

/**
 * 用内核服务拼出 ops 读/写句柄 —— 组件与命令共用同一份接线，避免两处各写一遍取值兜底。
 *
 * - 读：nodeStore.getNode(id).data（节点已删 → undefined，操作自行放弃）
 * - 写：graph.updateNode(id, { data }) —— 内核唯一写入口，自动进历史 + 调度落盘，天然可撤销
 *
 * 服务缺失（纯逻辑测试未注入）时读写都安全降级：读返回 undefined、写 no-op。
 */
export function createImageOps(svc: ServiceGetter): ImageOpsContext {
  /** 内核节点（只要本文件用到的几个字段） */
  interface NodeLike {
    id: string
    type: string
    position: { x: number; y: number }
    data: Record<string, unknown>
  }
  /** 事务里可用的写句柄（建节点 / 连边） */
  interface TxLike {
    createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
    addEdge(input: { source: string; target: string }): string
    /** 统一入口：校验 + 满额挤出 + 落边（与 graph.connectEdge 同一实现） */
    connectEdge(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): { edgeId: string; status: string }
    removeEdges(ids: string[]): number
  }
  /**
   * 读/写统一走 doc 门面（设计文档 §4.1：nodeStore+edgeStore+graph 合并后的正式名字；
   * 5c 起那四个老名已下线，doc 是唯一来源）。
   * 缺 doc（纯逻辑测试未注入图服务）时读写都安全降级：读返回 undefined、写 no-op。
   */
  type ImageDocPort = {
    getNode(id: string): NodeLike | undefined
    getNodes(): NodeLike[]
    types: ReadonlyMap<string, { inputs?: Array<{ port?: string; capacity?: number }> }>
    getEdges(): Array<{ id: string; source: string; target: string }>
    updateNode(id: string, patch: { data: Record<string, unknown>; size?: { w: number; h: number } }): void
    /** 写派生尺寸：落盘但不进撤销栈 */
    updateNodeRuntime?(id: string, patch: { data: Record<string, unknown>; size?: { w: number; h: number } }): void
    transaction<T>(reason: string, fn: (tx: TxLike) => T): T
  }
  const doc = (): ImageDocPort | undefined =>
    svc.get<ImageDocPort | undefined>('doc') ?? undefined

  /**
   * 图片 Blob → 资源库。资源库不可用（没装 resources 的极简宿主）→ undefined：
   * 调用方据此放弃这次操作，而不是退回 base64（那正是我们要摆脱的东西）。
   */
  const resources = (): {
    /** 存字节 → 持久引用（本地库 id / 云端内容哈希） */
    put(blob: Blob, opts?: { kind?: string; name?: string }): Promise<string>
    /** 持久引用 → 当前可显示地址（本地现建临时 objectURL、云端拼服务器地址） */
    resolve(ref: string): Promise<string | undefined>
  } | undefined => svc.get<never>('resources')

  const persistImage = async (blob: Blob): Promise<{ resourceId: string; url: string } | undefined> => {
    const store = resources()
    if (!store) return undefined
    // 只存字节、拿回持久引用；显示地址由 resolve 现算（本地是临时 objectURL，刷新后会换新的）
    const resourceId = await store.put(blob, { kind: 'image', ...(blob instanceof File && blob.name ? { name: blob.name } : {}) })
    const url = await store.resolve(resourceId)
    return url ? { resourceId, url } : undefined
  }

  return {
    read: (nodeId) => doc()?.getNode(nodeId)?.data,
    // size 与 data 在**同一次** updateNode 里提交：内核按 patch 记一条历史 → 一次撤销退干净
    write: (nodeId, data, size) =>
      doc()?.updateNode(nodeId, size !== undefined ? { data, size: { w: size.w, h: size.h } } : { data }),
    // 派生尺寸：有 runtime 写口就用它（落盘、不进历史）；极简宿主没有该口时退回普通写。
    writeMeasured: (nodeId, data, size) => {
      const patch = size !== undefined ? { data, size: { w: size.w, h: size.h } } : { data }
      const d = doc()
      if (d?.updateNodeRuntime) d.updateNodeRuntime(nodeId, patch)
      else d?.updateNode(nodeId, patch)
    },
    fitLimits: () => readImageFitLimits(svc),
    listNodes: () => (doc()?.getNodes() ?? []).map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data, size: (n as { size?: { w: number; h: number } }).size })),
    createNodeWithEdge: (type, position, data, target, edgeDirection = 'newToTarget') => {
      const g = doc()
      if (!g) return null
      try {
        return g.transaction('add-image-source', (tx) => {
          const id = tx.createNode(type, position, data)
          // 挤出/校验统一走 connectEdge（节点先建，再连边——满额会自动挤掉最老一条）
          // 方向由调用方声明：加素材 = 新节点是上游；裁剪出图 = 原图（target）是上游
          tx.connectEdge(
            edgeDirection === 'targetToNew'
              ? { source: target, target: id, sourceHandle: 'source', targetHandle: 'target' }
              : { source: id, target, sourceHandle: 'source', targetHandle: 'target' },
          )
          return id
        })
      } catch {
        return null
      }
    },
    persistImage,
    resolveRef: async (ref) => {
      try {
        return await resources()?.resolve(ref)
      } catch {
        return undefined
      }
    },
    // 裁/转/扩/下载的取图口径：旧地址优先（可能还没迁移），否则按引用现取
    displayUrlOf: async (data) => {
      const direct = typeof data?.imageUrl === 'string' ? data.imageUrl : ''
      if (direct) return direct
      const ref = typeof data?.resourceId === 'string' ? data.resourceId : ''
      if (!ref) return undefined
      try {
        return (await resources()?.resolve(ref)) || undefined
      } catch {
        return undefined
      }
    },
    transaction: <T,>(reason: string, fn: (tx: {
      createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
      connectEdge(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): { edgeId: string; status: string }
    }) => T): T | null => {
      const g = doc()
      if (!g) return null
      try {
        return g.transaction(reason, fn)
      } catch {
        return null
      }
    },
  }
}

/** 节点 data 里与图片相关的字段（读时统一收窄，避免到处 as number） */
interface ImageData {
  imageUrl?: string
  imageName?: string
  imageWidth?: number
  imageHeight?: number
  imageSize?: number
}

/**
 * 写进节点 data 的图片来源字段（**唯一出口**）。
 *
 * 目标形态：只写 `resourceId`。
 * // 迁移期：旧渲染路径 / 旧存档仍读 `imageUrl`，因此这里同时写一份显示地址；
 * // 等内容组件全量走 resolve、旧存档下线后，删掉 imageUrl 这一行即可，不必逐处改调用方。
 */
export function imageSourceFields(resourceId: string, displayUrl?: string): Record<string, unknown> {
  const fields: Record<string, unknown> = { resourceId }
  if (displayUrl) fields.imageUrl = displayUrl
  return fields
}

function asImageData(data: Record<string, unknown> | undefined): ImageData {
  if (!data) return {}
  return {
    imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
    imageName: typeof data.imageName === 'string' ? data.imageName : undefined,
    imageWidth: typeof data.imageWidth === 'number' ? data.imageWidth : undefined,
    imageHeight: typeof data.imageHeight === 'number' ? data.imageHeight : undefined,
    imageSize: typeof data.imageSize === 'number' ? data.imageSize : undefined,
  }
}

/**
 * 换图后的统一写回：data + 卡片尺寸**一次写完**（用户要求"节点宽高跟图片一致"的落点）。
 *
 * 为什么收成一个函数：上传 / 裁剪 / 旋转 /（生成出图在 imageRun 里）四处都要做这件事，
 * 各写一遍必然漂移；而且"尺寸拿不到就保持原尺寸不动"这条规矩只该写一次。
 * 尺寸算不出来（图片尺寸缺失/非法）时补丁为 null → 只写 data，绝不猜一个尺寸。
 */
function writeImageData(
  ctx: ImageOpsContext,
  nodeId: string,
  data: Record<string, unknown>,
  imageWidth: unknown,
  imageHeight: unknown,
): void {
  const sizes = cardSizePatch(imageWidth, imageHeight, ctx.fitLimits?.())
  // 只写正式尺寸 size（唯一正身）：卡片镜像 data.cardWidth/cardHeight 由 nodeStore 自动补齐。
  ctx.write(nodeId, data, sizes?.size)
}

/**
 * 上传：File → 资源库（IndexedDB）→ 节点只留 resourceId + objectURL。
 *
 * - 字节进资源库、节点里不塞 base64：刷新后按 resourceId 从库里重建地址显示（不再撑大 localStorage）；
 * - 同时写 imageName / imageWidth / imageHeight / imageSize，供状态栏展示与裁剪换算；
 * - 一并把卡片尺寸按"等比 + 封顶"调成跟图片一致（用户要求：上传后节点宽高跟图片一致）；
 * - 尺寸由图片元素实测（读不到就只写 url，不猜尺寸）。
 * @returns 是否写成功（节点不存在 / 环境不支持 / 读取失败 / 没有资源库 → false）
 */
export async function uploadImage(
  ctx: ImageOpsContext,
  nodeId: string,
  file: Blob,
  transform: ImageTransform = defaultTransform,
): Promise<boolean> {
  const current = ctx.read(nodeId)
  if (!current) return false
  if (!ctx.persistImage) return false
  // 先登记字节（拿到 objectURL 才能量尺寸），再写回；任何一步失败都放弃，不留半截数据
  const persisted = await ctx.persistImage(file)
  if (!persisted) return false
  const size = await transform.readImageSize(persisted.url)
  // 唯一出口：resourceId 是主字段；迁移期同时写显示地址（见 imageSourceFields 注释）
  const patch: Record<string, unknown> = imageSourceFields(persisted.resourceId, persisted.url)
  const name = (file as File).name
  if (typeof name === 'string' && name) patch.imageName = name
  if (typeof (file as File).size === 'number') patch.imageSize = (file as File).size
  if (size) {
    patch.imageWidth = size.width
    patch.imageHeight = size.height
  }
  // 尺寸与 data 同一次写回（一次撤销退干净）；size 拿不到时 writeImageData 会自动跳过尺寸
  writeImageData(ctx, nodeId, { ...current, ...patch }, size?.width, size?.height)
  return true
}

/**
 * 裁剪：按"图片像素坐标"的矩形裁出新图，**新建一个下游图片节点**装它（不覆盖当前节点）。
 *
 * 当前节点保持原图不动；新节点的 label 按"裁剪 N"累加取名（扫描画布取最大号+1，撤销/删中间节点后也不撞名）。
 * 建节点 + 连边（当前节点 → 新节点）包在同一个事务里：一次 undo 一起退。
 * @returns 是否写成功（节点不存在 / 没有图 / 环境不支持 / 建节点失败 → false）
 */
export async function cropImage(
  ctx: ImageOpsContext,
  nodeId: string,
  rect: Rect,
  transform: ImageTransform = defaultTransform,
): Promise<boolean> {
  const current = ctx.read(nodeId)
  const data = asImageData(current)
  // 取图口径统一：有旧地址用它，只有引用时先 resolve —— 截图/后台建的节点只有 resourceId
  const sourceUrl = ctx.displayUrlOf ? await ctx.displayUrlOf(current) : data.imageUrl
  if (!sourceUrl) return false
  const pixels = toPixelRect(rect)
  if (pixels.width <= 0 || pixels.height <= 0) return false
  const result = await transform.cropToBlob(sourceUrl, pixels, data.imageWidth ?? 0, data.imageHeight ?? 0)
  if (!result) return false
  if (!ctx.persistImage) return false
  const persisted = await ctx.persistImage(result.blob)
  if (!persisted) return false

  // 定位：原图右边缘 + 间隔（CROP_NODE_GAP）。多个裁剪结果会往右排开，不叠在原图上
  const source = ctx.listNodes?.()?.find((n) => n.id === nodeId)
  const sourceWidth = source?.size?.w ?? (source?.data?.cardWidth as number | undefined) ?? MIN_CARD_WIDTH
  const position = {
    x: (source?.position.x ?? 0) + sourceWidth + CROP_NODE_GAP,
    y: source?.position.y ?? 0,
  }
  // 名字：扫当前画布所有 image 节点里"裁剪 N"的 N，取最大值+1（撤销/删中间节点后也不撞名）
  const label = nextCropLabel(
    (ctx.listNodes?.() ?? []).map((n) => ({ type: n.type, data: n.data ?? {} })),
  )
  const cropData: Record<string, unknown> = {
    label,
    ...imageSourceFields(persisted.resourceId, persisted.url),
    imageWidth: result.width,
    imageHeight: result.height,
    imageName: label,
  }
    // 原子性/校验/连边统一交给 createNodeWithEdge（内部 graph.transaction：一次撤销退干净）
  // 原图是上游、裁剪结果是下游（用户拖线方向：从原图拉到空白处出新图）
  const newId = ctx.createNodeWithEdge?.('image', position, cropData, nodeId, 'targetToNew')
  return typeof newId === 'string' && newId.length > 0
}

/**
 * 旋转：顺时针转 90°（图片像素级重绘，不是 CSS 旋转），原地替换（新字节进资源库）。
 * 90°/270° 会交换宽高，一并写回，后续裁剪才不会错位。
 * @returns 是否写成功
 */
export async function rotateImage(
  ctx: ImageOpsContext,
  nodeId: string,
  transform: ImageTransform = defaultTransform,
): Promise<boolean> {
  const current = ctx.read(nodeId)
  const sourceUrl = ctx.displayUrlOf ? await ctx.displayUrlOf(current) : asImageData(current).imageUrl
  if (!sourceUrl) return false
  const result = await transform.rotateToBlob(sourceUrl, 90)
  if (!result) return false
  if (!ctx.persistImage) return false
  const persisted = await ctx.persistImage(result.blob)
  if (!persisted) return false
  // 90°/270° 宽高互换 → 卡片跟着新比例重算（旋转也该"节点宽高跟图片一致"）
  writeImageData(ctx, nodeId, {
    ...ctx.read(nodeId),
    ...imageSourceFields(persisted.resourceId, persisted.url),
    imageWidth: result.width,
    imageHeight: result.height,
    imageSize: undefined,
  }, result.width, result.height)
  return true
}

/**
 * 下载：把当前图片按清洗后的文件名另存（浏览器触发下载）。
 * 非浏览器环境返回 false。
 */
export function downloadImageNode(
  ctx: ImageOpsContext,
  nodeId: string,
  transform: ImageTransform = defaultTransform,
): Promise<boolean> {
  const data = asImageData(ctx.read(nodeId))
  return (async () => {
    const sourceUrl = ctx.displayUrlOf ? await ctx.displayUrlOf(ctx.read(nodeId)) : data.imageUrl
    if (!sourceUrl) return false
    return transform.downloadImage(sourceUrl, downloadFileName(data.imageName))
  })()
}

/** 状态栏文案（文件名 / 尺寸·大小）——组件直接用，避免文案散在模板里 */

// ==================== 绘制保存 ====================

/**
 * 绘制保存：按会话笔迹生成两张图（蒙版 + 挖洞结果），新建两个 image 节点，
 * 都从原图连过来（一次撤销整体回退）。原图不动。
 *
 * 蒙版坐标系 = 归一化（0~1，相对卡片），保存时按蒙版尺寸（原图像素）换算；
 * 笔刷半径也按「半径/卡片宽」的比值存，所以卡片被拖大拖小不影响结果。
 *
 * 蒙版尺寸取原图真实像素（resolveRef 后读位图尺寸），退化到显示尺寸（data.imageWidth/imageHeight）。
 */
export interface PaintSaveInput {
  /** 归一化笔迹（浮层草稿） */
  strokes: Array<{ kind: 'paint' | 'erase'; radiusRatio: number; shape: 'round' | 'square'; points: Array<{ x: number; y: number }> }>
}

export async function paintImageNodes(
  ctx: ImageOpsContext,
  nodeId: string,
  input: PaintSaveInput,
): Promise<boolean> {
  const current = ctx.read(nodeId)
  const data = asImageData(current)
  if (!current) return false
  if (!ctx.persistImage) return false
  if (!ctx.transaction) return false
  // 取原图地址（裁剪/扩展/下载同一条口径）
  const sourceUrl = ctx.displayUrlOf ? await ctx.displayUrlOf(current) : data.imageUrl
  if (!sourceUrl) return false
  // 没有笔迹就不生成（避免保存出一个全透明的空结果）
  const strokes = input.strokes
  if (strokes.length === 0) return false

  // 蒙版尺寸：优先按原图真实像素（读位图），拿不到再退到显示尺寸
  let maskW = data.imageWidth ?? 0
  let maskH = data.imageHeight ?? 0
  if (maskW <= 0 || maskH <= 0) {
    const size = await readImageSize(sourceUrl)
    if (size) {
      maskW = size.width
      maskH = size.height
    }
  }
  if (maskW <= 0 || maskH <= 0) return false

  // 生成两张图
  const maskBlob = await renderMaskBlob(strokes, maskW, maskH)
  if (!maskBlob) return false
  const result = await renderResultBlob(sourceUrl, strokes, maskW, maskH)
  if (!result || !result.blob) return false

  // 存资源库
  const maskPersisted = await ctx.persistImage(maskBlob)
  const resultPersisted = await ctx.persistImage(result.blob)
  if (!maskPersisted || !resultPersisted) return false

  // 定位：结果图贴原图右侧，蒙版再往右一格（宽度按结果图实际宽算，不叠在一起）
  const source = ctx.listNodes?.()?.find((n) => n.id === nodeId)
  const sourceWidth = source?.size?.w ?? (source?.data?.cardWidth as number | undefined) ?? MIN_CARD_WIDTH
  const y = source?.position.y ?? 0
  const baseName = (source?.data?.label as string | undefined) || ''
  const base = baseName.replace(/\s*\d+$/, '') || '图片'
  try {
    return ctx.transaction('paint-save', (tx) => {
      const resultId = tx.createNode('image', { x: (source?.position.x ?? 0) + sourceWidth + PAINT_NODE_GAP, y }, {
        label: base + ' 结果',
        ...imageSourceFields(resultPersisted.resourceId, resultPersisted.url),
        imageWidth: result.width,
        imageHeight: result.height,
        imageName: base + ' 结果',
      })
      const maskId = tx.createNode('image', { x: (source?.position.x ?? 0) + sourceWidth + PAINT_NODE_GAP * 2 + result.width, y }, {
        label: base + ' 蒙版',
        ...imageSourceFields(maskPersisted.resourceId, maskPersisted.url),
        imageWidth: maskW,
        imageHeight: maskH,
        imageName: base + ' 蒙版',
      })
      tx.connectEdge({ source: nodeId, target: resultId, sourceHandle: 'source', targetHandle: 'target' })
      tx.connectEdge({ source: nodeId, target: maskId, sourceHandle: 'source', targetHandle: 'target' })
      return true
    }) ?? false
  } catch {
    return false
  }
}

/** 绘制结果与原图右边缘的间隔（与裁剪的 CROP_NODE_GAP 同一套规矩） */
export const PAINT_NODE_GAP = 100

/** 状态栏文案（文件名 / 尺寸·大小）——组件直接用，避免文案散在模板里 */
export function readImageSummary(data: Record<string, unknown> | undefined): { name: string; meta: string } {
  const img = asImageData(data)
  return {
    name: img.imageName || '未命名图片',
    meta: describeImageMeta({ width: img.imageWidth, height: img.imageHeight, size: img.imageSize }),
  }
}

/** 「加素材」时新节点相对本节点的偏移（与 v1 一致：摆在左边同一水平线上） */
export const SOURCE_NODE_OFFSET = { x: -260, y: 0 }

/** 裁剪出的新节点与原图右边缘的间隔（用户要求：别贴太近，留 100px） */
export const CROP_NODE_GAP = 100

/** 裁剪节点名的前缀（扫描/生成都用它） */
export const CROP_LABEL_PREFIX = '裁剪'

/**
 * 下一个可用的裁剪节点名：扫描现有 image 节点里"裁剪 N"的 N，取最大值 + 1。
 *
 * 为什么不存计数器：计数器要么进 data（污染节点数据）、要么在插件内存里（撤销/刷新后与画布对不上）。
 * 扫描是幂等的：不管撤销几次、删掉中间哪个，算出来的名字都不会和画布上的撞车。
 * 第一个叫「裁剪」，第二个起叫「裁剪 2」「裁剪 3」……
 */
export function nextCropLabel(
  nodes: Array<{ type: string; data?: Record<string, unknown> }>,
): string {
  let max = 0
  const re = new RegExp('^' + CROP_LABEL_PREFIX + '\\s*(\\d+)$')
  const used = new Set<string>()
  for (const n of nodes) {
    if (n.type !== 'image') continue
    const label = (n.data as Record<string, unknown> | undefined)?.label
    if (typeof label !== 'string') continue
    used.add(label.trim())
    const m = re.exec(label.trim())
    if (!m) continue
    const num = Number.parseInt(m[1], 10)
    if (!Number.isNaN(num) && num > max) max = num
  }
  // 画布上已经有裸的「裁剪」→ 这次必须带号（从 2 起），不跟它撞车
  if (used.has(CROP_LABEL_PREFIX)) {
    const n = max + 1 === 1 ? 2 : max + 1
    return CROP_LABEL_PREFIX + ' ' + String(n)
  }
  // 第一个裁剪节点：光秃秃的「裁剪」，不带号
  return max === 0 ? CROP_LABEL_PREFIX : CROP_LABEL_PREFIX + ' ' + String(max + 1)
}

/**
* 确认扩展：把画面往外扩出一圈透明画布，**原地替换** imageUrl（与裁剪同一套语义）。
 *
 * 为什么原地替换而不是新建节点（与 v1 不同）：用户的心智是「把这张图改一下」而不是「多出一张图」，
 * 与裁剪保持一致也让撤销栈干净。真想要一份新的，复制节点即可。
 *
 * 两点刻意的不做：
 * - **扩展没实际变大就不写库**（用户把框又拖回去了）：写一条空历史只是噪音；
 * - 尺寸与 data **同一次写回**：否则一次扩展记两条撤销记录，用户按一次撤销只退半步。
 *
 * @returns 是否写成功（节点不存在 / 没有图 / 环境不支持 / 没实际扩大 → false）
 */
export async function expandImageNode(
  ctx: ImageOpsContext,
  nodeId: string,
  rect: Rect,
  io: ExpandBitmapIO = defaultExpandIO,
): Promise<boolean> {
  const current = ctx.read(nodeId)
  const data = asImageData(current)
  if (!data.imageWidth || !data.imageHeight) return false
  const sourceUrl = ctx.displayUrlOf ? await ctx.displayUrlOf(current) : data.imageUrl
  if (!sourceUrl) return false
  // 没实际扩大（框仍包着原图尺寸）→ 不写库，避免一条什么都没改的历史
  if (!isExpandEffective(rect, data.imageWidth, data.imageHeight)) return false
  const result = await expandImage(sourceUrl, rect, data.imageWidth, data.imageHeight, io)
  if (!result) return false
  if (!ctx.persistImage) return false
  const persisted = await ctx.persistImage(result.blob)
  if (!persisted) return false
  // 扩出来的图是**新位图**：原图的字节数/文件名不再代表它，清掉避免状态栏显示过期信息
  writeImageData(
    ctx,
    nodeId,
    {
      ...ctx.read(nodeId),
      ...imageSourceFields(persisted.resourceId, persisted.url),
      imageWidth: result.width,
      imageHeight: result.height,
      imageSize: undefined,
    },
    result.width,
    result.height,
  )
  return true
}

/**
 * 加素材：把一张本地图片变成"连进本节点的上游素材"。
 *
 * 为什么要单独这层：面板点加号要的不是"换掉本节点的图"（那是上传），而是**新建一个上游图片节点并连到本节点**
 * —— 它随后会出现在素材行里、能被 @ 引用、能作为生成输入。
 *
 * 关键点（顺序不能反）：**先把文件存进资源库、再建节点**。先建后存会在存失败时留下一个空图节点，
 * 用户看到"点了加号多出来一个空框"。
 *
 * @param at 新节点位置（调用方按本节点位置算好；不传则落在本节点左侧 SOURCE_NODE_OFFSET）
 * @returns 新节点 id；失败（读文件失败 / 节点不存在 / 建不出来）返回 null
 */
export async function addSourceNode(
  ctx: ImageOpsContext,
  targetId: string,
  file: Blob,
  at?: { x: number; y: number },
  transform: ImageTransform = defaultTransform,
): Promise<string | null> {
  if (!ctx.createNodeWithEdge || !ctx.read(targetId)) return null

  if (!ctx.persistImage) return null
  const persisted = await ctx.persistImage(file)
  if (!persisted) return null

  const size = await transform.readImageSize(persisted.url)
  const data: Record<string, unknown> = imageSourceFields(persisted.resourceId, persisted.url)
  const name = (file as File).name
  if (typeof name === 'string' && name) data.imageName = name
  if (typeof (file as File).size === 'number') data.imageSize = (file as File).size
  if (size) {
    data.imageWidth = size.width
    data.imageHeight = size.height
  }

  const target = ctx
    .listNodes?.()
    ?.find((n) => n.id === targetId)
  const position = at ?? {
    x: (target?.position.x ?? 0) + SOURCE_NODE_OFFSET.x,
    y: (target?.position.y ?? 0) + SOURCE_NODE_OFFSET.y,
  }

  // 容量/挤出/校验**不在这里算**：统一入口 graph.connectEdge 已经做了（校验 → 满额挤老边 → 落边）。
  // 这里以前自己调 oldestIncomingToEvict 算一遍，跟内核的判定漂移过（handle 匹配 bug）。
  return ctx.createNodeWithEdge('image', position, data, targetId)
}
