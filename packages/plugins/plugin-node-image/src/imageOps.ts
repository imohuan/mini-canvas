/**
 * imageOps —— 图片节点的四个操作（上传 / 裁剪 / 旋转 / 下载）的业务实现。
 *
 * 为什么要单独一层：同一件事有两个入口 —— **界面按钮**（顶部/底部操作条）和**命令**
 * （ctx.commands.register 的 image.upload / image.crop ...，供快捷键、右键菜单、MCP 调用）。
 * 两处各写一遍必然漂移，所以这里把实现收敛成纯异步函数，两边都只是"备好读/写句柄再调它"。
 *
 * 读/写句柄（`ImageOpsContext`）由调用方注入：
 * - 组件侧：ctx.get('nodeStore').getNode(id).data 读；ctx.get('graph').updateNode 写。
 * - 命令侧：同一对服务，只是从命令的 ctx 上取。
 * 两边都用内核**唯一写入口 graph** → 写回自动进历史、自动落盘、可撤销。
 *
 * 本模块只依赖纯工具（imageTransform / cropGeometry / imageNodeData），不 import Vue，
 * node 环境下所有图片操作安全地返回 false（环境不支持），不会抛。
 */
import {
  fileToDataUrl,
  cropToDataUrl,
  downloadImage,
  pickImageFile,
  readImageSize,
  rotateToDataUrl,
} from './imageTransform'
import { describeImageMeta, downloadFileName } from './imageNodeData'
import { toCropPixels, type Rect } from './cropGeometry'
import { cardSizePatch, readImageFitLimits, type ImageFitLimits } from './imageFit'
// 输入口满额时"该挤掉哪条边"与宿主拖线连接是**同一条**规则（FIFO 挤最老）。
// 复用渲染层的纯函数而不是在本包再写一遍：两处各写一份，迟早会在"谁算最老"上分叉。
import { oldestIncomingToEvict } from '@mini-canvas/canvas-render'

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
   * 图片预览上限（配置 imageFitMaxWidth/imageFitMaxHeight）。不注入则回落 420×300。
   * 抽成取值器而不是常量：设置面板改完上限后，下一次换图就该按新上限算。
   */
  fitLimits?(): ImageFitLimits
  /** 当前全部节点（找"把它摆在谁左边"时用）；未注入返回 [] */
  listNodes?(): Array<{ id: string; type: string; position: { x: number; y: number } }>
  /** 当前全部边（"加素材"要按输入口容量挤最老一条时需要）；未注入返回 [] */
  listEdges?(): Array<{ id: string; source: string; target: string }>
  /**
   * 本节点输入口最多能接几条入边（节点类型声明里的 capacity；未声明/查不到按 1）。
   * "加素材"要跟拖线连接守同一条规矩：超了就把最老的一条挤掉，而不是无限往上加。
   */
  inputCapacity?(nodeId: string): number
  /**
   * 在一个事务里同时建节点 + 连边（"加素材"必须原子：只能一次 undo）。
   * @param evictEdgeId 若给了，同一事务里先删这条旧边再连新边（输入口容量满时挤最老一条）
   * 未注入时返回 null（调用方据此判断"这个宿主不具备加素材能力"）。
   */
  createNodeWithEdge?(
    type: string,
    position: { x: number; y: number },
    data: Record<string, unknown>,
    target: string,
    evictEdgeId?: string,
  ): string | null
}

/**
 * 图片加工端口（上传读文件 / 测尺寸 / 裁剪 / 旋转 / 下载）。
 *
 * 抽成端口是为了**可测**：这些操作都要 FileReader/canvas，node 环境下跑不了真实实现；
 * 单测注入假实现即可验证"算得对不对、写回得对不对"，而不必启动浏览器。
 */
export interface ImageTransform {
  fileToDataUrl(file: Blob): Promise<string>
  readImageSize(url: string): Promise<{ width: number; height: number } | null>
  cropToDataUrl(
    url: string,
    rect: Rect,
    baseWidth: number,
    baseHeight: number,
  ): Promise<{ dataUrl: string; width: number; height: number } | null>
  rotateToDataUrl(url: string, degrees: number): Promise<{ dataUrl: string; width: number; height: number } | null>
  downloadImage(url: string, fileName: string): boolean
  pickImageFile(): Promise<File | null>
}

/** 生产实现：全部走浏览器原生能力（见 imageTransform） */
export const defaultTransform: ImageTransform = {
  fileToDataUrl,
  readImageSize,
  cropToDataUrl,
  rotateToDataUrl,
  downloadImage,
  pickImageFile,
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
    removeEdges(ids: string[]): number
  }
  const store = () =>
    svc.get<
      | {
          getNode(id: string): NodeLike | undefined
          getNodes(): NodeLike[]
          types: ReadonlyMap<string, { inputs?: Array<{ port?: string; capacity?: number }> }>
        }
      | undefined
    >('nodeStore')
  const edgeStore = () =>
    svc.get<{ getEdges(): Array<{ id: string; source: string; target: string }> } | undefined>('edgeStore')
  const graph = () =>
    svc.get<
      | {
          updateNode(
            id: string,
            patch: { data: Record<string, unknown>; size?: { w: number; h: number } },
          ): void
          transaction<T>(reason: string, fn: (tx: TxLike) => T): T
        }
      | undefined
    >('graph')

  return {
    read: (nodeId) => store()?.getNode(nodeId)?.data,
    // size 与 data 在**同一次** updateNode 里提交：内核按 patch 记一条历史 → 一次撤销退干净
    write: (nodeId, data, size) =>
      graph()?.updateNode(nodeId, size !== undefined ? { data, size: { w: size.w, h: size.h } } : { data }),
    fitLimits: () => readImageFitLimits(svc),
    listNodes: () => (store()?.getNodes() ?? []).map((n) => ({ id: n.id, type: n.type, position: n.position })),
    listEdges: () => edgeStore()?.getEdges() ?? [],
    inputCapacity: (nodeId) => {
      const node = store()?.getNode(nodeId)
      const def = node ? store()?.types.get(node.type) : undefined
      const input = def?.inputs?.find((i) => !i.port || i.port === 'target') ?? def?.inputs?.[0]
      // 与内核"缺省即 1"一致：节点没声明容量就按 1 条算
      return input?.capacity && input.capacity > 0 ? input.capacity : 1
    },
    createNodeWithEdge: (type, position, data, target, evictEdgeId) => {
      const g = graph()
      if (!g) return null
      try {
        return g.transaction('add-image-source', (tx) => {
          const id = tx.createNode(type, position, data)
          // 输入口满了：先挤掉最老一条（与拖线连接同一套 FIFO 语义），再连新的
          if (evictEdgeId) tx.removeEdges([evictEdgeId])
          tx.addEdge({ source: id, target })
          return id
        })
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
  if (!sizes) {
    ctx.write(nodeId, data)
    return
  }
  ctx.write(
    nodeId,
    { ...data, cardWidth: sizes.cardWidth, cardHeight: sizes.cardHeight },
    sizes.size,
  )
}

/**
 * 上传：File → dataURL 写回节点。
 *
 * - 一律转 dataURL（不用 objectURL）：刷新后仍然显示，这是"刷新不丢"的前提；
 * - 同时写 imageName / imageWidth / imageHeight / imageSize，供状态栏展示与裁剪换算；
 * - 一并把卡片尺寸按"等比 + 封顶"调成跟图片一致（用户要求：上传后节点宽高跟图片一致）；
 * - 尺寸由图片元素实测（读不到就只写 url，不猜尺寸）。
 * @returns 是否写成功（节点不存在 / 环境不支持 / 读取失败 → false）
 */
export async function uploadImage(
  ctx: ImageOpsContext,
  nodeId: string,
  file: Blob,
  transform: ImageTransform = defaultTransform,
): Promise<boolean> {
  const current = ctx.read(nodeId)
  if (!current) return false
  let dataUrl: string
  try {
    dataUrl = await transform.fileToDataUrl(file)
  } catch {
    return false
  }
  if (!dataUrl) return false
  const size = await transform.readImageSize(dataUrl)
  const patch: Record<string, unknown> = { imageUrl: dataUrl }
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
 * 裁剪：按"图片像素坐标"的矩形裁出新图，**原地替换** imageUrl（不新建节点）。
 *
 * 矩形先收敛成整像素（toCropPixels），再交给 canvas 绘制；成功后同步更新宽高，
 * 使后续裁剪/状态栏按新尺寸工作。
 * @returns 是否写成功
 */
export async function cropImage(
  ctx: ImageOpsContext,
  nodeId: string,
  rect: Rect,
  transform: ImageTransform = defaultTransform,
): Promise<boolean> {
  const data = asImageData(ctx.read(nodeId))
  if (!data.imageUrl) return false
  const pixels = toCropPixels(rect)
  if (pixels.width <= 0 || pixels.height <= 0) return false
  const result = await transform.cropToDataUrl(data.imageUrl, pixels, data.imageWidth ?? 0, data.imageHeight ?? 0)
  if (!result) return false
  writeImageData(ctx, nodeId, {
    ...ctx.read(nodeId),
    imageUrl: result.dataUrl,
    imageWidth: result.width,
    imageHeight: result.height,
    // 裁剪后原图字节数不再代表内容，清掉避免状态栏显示过期大小
    imageSize: undefined,
  }, result.width, result.height)
  return true
}

/**
 * 旋转：顺时针转 90°（图片像素级重绘，不是 CSS 旋转），原地替换 imageUrl。
 * 90°/270° 会交换宽高，一并写回，后续裁剪才不会错位。
 * @returns 是否写成功
 */
export async function rotateImage(
  ctx: ImageOpsContext,
  nodeId: string,
  transform: ImageTransform = defaultTransform,
): Promise<boolean> {
  const data = asImageData(ctx.read(nodeId))
  if (!data.imageUrl) return false
  const result = await transform.rotateToDataUrl(data.imageUrl, 90)
  if (!result) return false
  // 90°/270° 宽高互换 → 卡片跟着新比例重算（旋转也该"节点宽高跟图片一致"）
  writeImageData(ctx, nodeId, {
    ...ctx.read(nodeId),
    imageUrl: result.dataUrl,
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
): boolean {
  const data = asImageData(ctx.read(nodeId))
  if (!data.imageUrl) return false
  return transform.downloadImage(data.imageUrl, downloadFileName(data.imageName))
}

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

/**
 * 加素材：把一张本地图片变成"连进本节点的上游素材"。
 *
 * 为什么要单独这层：面板点加号要的不是"换掉本节点的图"（那是上传），而是**新建一个上游图片节点并连到本节点**
 * —— 它随后会出现在素材行里、能被 @ 引用、能作为生成输入。
 *
 * 关键点（顺序不能反）：**先读文件成功，再建节点**。先建后读会在读失败时留下一个空图节点，
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

  let dataUrl: string
  try {
    dataUrl = await transform.fileToDataUrl(file)
  } catch {
    return null
  }
  if (!dataUrl) return null

  const size = await transform.readImageSize(dataUrl)
  const data: Record<string, unknown> = { imageUrl: dataUrl }
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

  // 输入口容量约束：满了就挤最老一条（与拖线连接同一套 FIFO 语义），否则会连出超过声明的入边数
  const capacity = ctx.inputCapacity?.(targetId) ?? 1
  const incoming = (ctx.listEdges?.() ?? []).filter((e) => e.target === targetId)
  const evictEdgeId = oldestIncomingToEvict({ edges: incoming, target: targetId, capacity }) ?? undefined

  return ctx.createNodeWithEdge('image', position, data, targetId, evictEdgeId)
}
