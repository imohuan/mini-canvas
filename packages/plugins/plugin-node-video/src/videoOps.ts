/**
 * videoOps —— 视频节点的各项操作（加载视频 / 裁剪 / 剪辑 / 截图 / 下载）的业务实现。
 *
 * 为什么要单独一层（与图片节点的 imageOps 同因）：同一件事有两个入口 —— **界面按钮**
 * （顶部操作条 / 内容区控件）和**命令**（ctx.commands.register 的 video.upload / video.crop …，
 * 供快捷键、右键菜单、MCP 调用）。两处各写一遍必然漂移，所以实现收敛成纯异步函数，
 * 两边都只是"备好读/写句柄再调它"。
 *
 * 读/写句柄（VideoOpsContext）由调用方注入：
 * - 组件侧：ctx.get('nodeStore').getNode(id).data 读；ctx.get('graph').updateNode 写。
 * - 命令侧：同一对服务，只是从命令的 ctx 上取。
 * 两边都用内核**唯一写入口 graph** → 写回自动进历史、自动落盘、可撤销。
 *
 * 本模块不 import Vue；视频解码只在浏览器存在，故所有异步操作经注入的 VideoTransform 端口，
 * node 环境下调用真实实现会安全返回 null（不会抛）。
 */
import {
  captureFrame,
  downloadVideo,
  pickVideoFile,
  readVideoMeta,
  videoObjectUrl,
  type FrameResult,
  type VideoMeta,
} from './videoTransform'
import { downloadFileName, frameFileName } from './videoNodeData'
import { readVideoFitLimits, videoCardSizePatch, type VideoFitLimits } from './videoFit'
import { clampClipRange, MIN_CLIP_DURATION } from './videoClip'
import { toPixelRect, type Rect } from '@mini-canvas/canvas-render'

/** 操作所需的读/写句柄（组件与命令各备一份，实现只写一遍） */
export interface VideoOpsContext {
  /** 读节点当前 data；节点不存在返回 undefined */
  read(nodeId: string): Record<string, unknown> | undefined
  /**
   * 写回节点 data（务必走内核 graph，带历史与落盘）。
   * @param size 传了就同时写内核**正式尺寸字段** node.size —— 必须与 data 在同一个 patch 里提交，
   *   否则一次换视频/裁剪会记两条撤销记录（用户按一次撤销只退半步）。
   */
  write(nodeId: string, data: Record<string, unknown>, size?: { w: number; h: number }): void
  /** 视频预览上限（配置 videoFitMaxWidth/videoFitMaxHeight）；不注入则回落 560×360 */
  fitLimits?(): VideoFitLimits
  /** 在某位置建一个节点（截图产出图片节点用）；未注入返回 null */
  createNode?(type: string, position: { x: number; y: number }, data: Record<string, unknown>): string | null
  /** 某类型是否已注册（截图要建 image 节点，而图片插件可能没装）；未注入返回 true */
  hasType?(type: string): boolean
  /** 读某节点位置（截图产出的新节点摆在它右边）；未注入返回 null */
  nodePosition?(nodeId: string): { x: number; y: number } | null
  /** 读某节点实测/声明宽度（决定新节点摆多远）；未注入返回 null */
  nodeWidth?(nodeId: string): number | null
}

/** 视频加工端口（读元数据 / 截图 / 下载 / 选文件 / 生成 objectURL）。
 *
 * 抽成端口是为了**可测**：这些操作都要 video 元素与 canvas，node 环境下跑不了真实实现；
 * 单测注入假实现即可验证"算得对不对、写回得对不对"，而不必启动浏览器。
 */
export interface VideoTransform {
  readMeta(url: string): Promise<VideoMeta | null>
  captureFrame(url: string, at: number, crop?: Rect | null): Promise<FrameResult | null>
  download(url: string, fileName: string): boolean
  pickFile(): Promise<File | null>
  objectUrl(blob: Blob): string
}

/** 生产实现：全部走浏览器原生能力（见 videoTransform） */
export const defaultTransform: VideoTransform = {
  readMeta: readVideoMeta,
  captureFrame: (url, at, crop) => captureFrame(url, at, crop),
  download: downloadVideo,
  pickFile: pickVideoFile,
  objectUrl: videoObjectUrl,
}

/** 只要"按名字取服务"这一件事的宿主形状（内核 Context 与渲染上下文都满足） */
export interface ServiceGetter {
  get<T = unknown>(name: string): T
}

/** 截图产出的新节点相对视频节点的偏移（摆在右侧同一水平线上） */
export const FRAME_NODE_GAP = 40
/** 视频节点宽度拿不到时的默认值（决定截图节点摆多远） */
const DEFAULT_NODE_WIDTH = 480

/**
 * 用内核服务拼出 ops 读/写句柄 —— 组件与命令共用同一份接线，避免两处各写一遍取值兜底。
 *
 * 服务缺失（纯逻辑测试未注入）时读写都安全降级：读返回 undefined、写 no-op。
 */
export function createVideoOps(svc: ServiceGetter): VideoOpsContext {
  interface NodeLike {
    id: string
    type: string
    position: { x: number; y: number }
    data: Record<string, unknown>
    size?: { w: number; h: number }
  }
  const store = () =>
    svc.get<
      | {
          getNode(id: string): NodeLike | undefined
          getNodes(): NodeLike[]
          types: ReadonlyMap<string, unknown>
        }
      | undefined
    >('nodeStore')
  const graph = () =>
    svc.get<
      | {
          updateNode(id: string, patch: { data: Record<string, unknown>; size?: { w: number; h: number } }): void
          transaction<T>(reason: string, fn: (tx: { createNode(t: string, p: { x: number; y: number }, d?: Record<string, unknown>): string }) => T): T
        }
      | undefined
    >('graph')
  const layout = () =>
    svc.get<{ getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null } | undefined>('nodeLayout')

  return {
    read: (nodeId) => store()?.getNode(nodeId)?.data,
    // size 与 data 在**同一次** updateNode 里提交：内核按 patch 记一条历史 → 一次撤销退干净
    write: (nodeId, data, size) =>
      graph()?.updateNode(nodeId, size !== undefined ? { data, size: { w: size.w, h: size.h } } : { data }),
    // 上限解析只有一份实现（videoFit.readVideoFitLimits）：不在这里再抄一遍"读配置 + 回落"的兜底
    fitLimits: () => readVideoFitLimits(svc),
    hasType: (type) => (store() ? store()!.types.has(type) : true),
    nodePosition: (nodeId) => store()?.getNode(nodeId)?.position ?? null,
    nodeWidth: (nodeId) => {
      const rect = layout()?.getNodeRect(nodeId)
      if (rect && rect.w > 0) return rect.w
      const node = store()?.getNode(nodeId)
      const w = Number(node?.data?.cardWidth) || node?.size?.w || 0
      return w > 0 ? w : null
    },
    createNode: (type, position, data) => {
      const g = graph()
      if (!g) return null
      try {
        return g.transaction('video-create-node', (tx) => tx.createNode(type, position, data))
      } catch {
        return null
      }
    },
  }
}

/** 节点 data 里与视频相关的字段（读时统一收窄，避免到处 as number） */
interface VideoData {
  videoUrl?: string
  videoName?: string
  videoWidth?: number
  videoHeight?: number
  videoDuration?: number
  videoSize?: number
  cropRect?: Rect
}

function asVideoData(data: Record<string, unknown> | undefined): VideoData {
  if (!data) return {}
  const rect = data.cropRect as Rect | undefined
  const validRect =
    rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0 ? rect : undefined
  return {
    videoUrl: typeof data.videoUrl === 'string' ? data.videoUrl : undefined,
    videoName: typeof data.videoName === 'string' ? data.videoName : undefined,
    videoWidth: typeof data.videoWidth === 'number' ? data.videoWidth : undefined,
    videoHeight: typeof data.videoHeight === 'number' ? data.videoHeight : undefined,
    videoDuration: typeof data.videoDuration === 'number' ? data.videoDuration : undefined,
    videoSize: typeof data.videoSize === 'number' ? data.videoSize : undefined,
    cropRect: validRect,
  }
}

/**
 * 卡片尺寸该按谁算：**裁过就按裁框**（显示的就是那一块），没裁按整幅画面。
 * 抽成一处是因为它被"换视频 / 裁剪确认 / 恢复整幅"三处共用，抄三遍必然漂移。
 */
export function displaySizeOf(data: Record<string, unknown> | undefined): { width: number; height: number } {
  const v = asVideoData(data)
  if (v.cropRect) return { width: v.cropRect.width, height: v.cropRect.height }
  return { width: Number(v.videoWidth) || 0, height: Number(v.videoHeight) || 0 }
}

/**
 * 换视频后的统一写回：data + 卡片尺寸**一次写完**。
 *
 * 尺寸算不出（元数据没读出来/非法）时只写 data 并**清掉旧尺寸** —— 不能留着上一段视频的
 * 卡片尺寸（那会让新视频被硬塞进旧比例里）。
 */
function writeVideoData(ctx: VideoOpsContext, nodeId: string, data: Record<string, unknown>): void {
  const sizes = videoCardSizePatch(data.videoWidth, data.videoHeight, ctx.fitLimits?.())
  if (!sizes) {
    ctx.write(nodeId, data)
    return
  }
  ctx.write(nodeId, { ...data, cardWidth: sizes.cardWidth, cardHeight: sizes.cardHeight }, sizes.size)
}

/**
 * 载入一段视频：读元数据 → 写 url/名字/尺寸/时长/大小 + 卡片跟比例。
 *
 * 两个刻意的取舍：
 * - **换视频会清掉裁剪框**（cropRect 与 clip 都清）：它们是上一段视频的内容，留着必然错位；
 * - **保留一条历史**：整个换视频过程只写一次库（元数据读完再写），不会先写 url 再补尺寸。
 *
 * @param url 已就绪的视频地址（objectURL / dataURL / 远程 URL）
 * @param extra 额外要一起写进 data 的字段（如 resourceId）—— 与本次写入**同一条历史**
 * @returns 是否写成功（节点不存在 / 地址为空 → false）
 */
export async function loadVideo(
  ctx: VideoOpsContext,
  nodeId: string,
  url: string,
  metaIn?: { name?: string; size?: number },
  extra?: Record<string, unknown>,
  transform: VideoTransform = defaultTransform,
): Promise<boolean> {
  if (!url || !ctx.read(nodeId)) return false
  const meta = await transform.readMeta(url)
  const patch: Record<string, unknown> = {
    videoUrl: url,
    // 全新的画面：裁剪框与剪辑范围都属于上一段视频，一并清掉
    cropRect: undefined,
    clipStart: undefined,
    clipEnd: undefined,
    ...(extra ?? {}),
  }
  if (metaIn?.name) patch.videoName = metaIn.name
  if (typeof metaIn?.size === 'number') patch.videoSize = metaIn.size
  if (meta) {
    patch.videoWidth = meta.width
    patch.videoHeight = meta.height
    patch.videoDuration = meta.duration
  }
  writeVideoData(ctx, nodeId, { ...(ctx.read(nodeId) ?? {}), ...patch })
  return true
}

/**
 * 上传视频文件：File → objectURL → 载入。
 *
 * 为什么视频不像图片那样转 dataURL：几十兆的视频转 base64 会膨胀约三分之一，
 * 写进 localStorage 直接撑爆配额、刷新反而丢数据。objectURL 当前会话可见，
 * 配合宿主 resources 服务登记回收（删除/撤销语义与图片一致）。
 *
 * @param registerResource 可选：把 objectURL 登记进宿主资源表并写 resourceId（供引用扫描回收）
 */
export async function uploadVideo(
  ctx: VideoOpsContext,
  nodeId: string,
  file: Blob,
  transform: VideoTransform = defaultTransform,
  registerResource?: (url: string, file: Blob) => string | undefined,
): Promise<boolean> {
  if (!ctx.read(nodeId)) return false
  const url = transform.objectUrl(file)
  if (!url) return false
  const name = (file as File).name
  // 资源登记**先做、且不单独写库**：resourceId 随本次载入一起提交，
  // 于是"换视频"对用户始终是**一次撤销**就退回原样（分两次写会让撤销只退半步）。
  const resourceId = registerResource?.(url, file)
  return loadVideo(
    ctx,
    nodeId,
    url,
    {
      ...(typeof name === 'string' && name ? { name } : {}),
      ...(typeof (file as File).size === 'number' ? { size: (file as File).size } : {}),
    },
    resourceId ? { resourceId } : undefined,
    transform,
  )
}

/**
 * 确认裁剪：把裁剪框写进 data，并让**卡片尺寸跟着裁框比例**（用户看到的就是裁出来的那块）。
 *
 * 刻意不做视频转码（与 v1 一致）：不引入 wasm/ffmpeg，也不用 MediaRecorder 实时重录
 * （要播完整段、时长与体积都不可控）。裁剪是**取景式**的 —— 画面按框放大并偏移，
 * 框外部分被卡片裁掉；因此裁剪**不改变视频文件**，随时可以恢复整幅画面。
 *
 * @param rect 视频像素坐标的裁剪框（已在覆盖层里收敛过，这里再夹一次底）
 */
export function cropVideo(ctx: VideoOpsContext, nodeId: string, rect: Rect): boolean {
  const current = ctx.read(nodeId)
  const data = asVideoData(current)
  if (!current || !data.videoWidth || !data.videoHeight) return false
  const pixels = toPixelRect(rect)
  if (pixels.width <= 0 || pixels.height <= 0) return false
  // 夹进原画面内（脏数据不该写进库）
  const bounded: Rect = {
    x: Math.min(Math.max(0, pixels.x), Math.max(0, data.videoWidth - 1)),
    y: Math.min(Math.max(0, pixels.y), Math.max(0, data.videoHeight - 1)),
    width: Math.min(pixels.width, data.videoWidth),
    height: Math.min(pixels.height, data.videoHeight),
  }
  const sizes = videoCardSizePatch(bounded.width, bounded.height, ctx.fitLimits?.())
  const next: Record<string, unknown> = { ...current, cropRect: bounded }
  if (sizes) {
    next.cardWidth = sizes.cardWidth
    next.cardHeight = sizes.cardHeight
    ctx.write(nodeId, next, sizes.size)
    return true
  }
  ctx.write(nodeId, next)
  return true
}

/**
 * 恢复整幅画面：清掉裁剪框，卡片尺寸回到原始视频比例。
 * 与 cropVideo 是逆操作 —— 裁剪既然是取景式的，就该随时能退回去。
 */
export function resetCrop(ctx: VideoOpsContext, nodeId: string): boolean {
  const current = ctx.read(nodeId)
  if (!current) return false
  const next: Record<string, unknown> = { ...current, cropRect: undefined }
  return writeWithSize(ctx, nodeId, next, Number(current.videoWidth), Number(current.videoHeight))
}

/** 写 data 并同时把卡片调成给定画面尺寸的比例（拿不到尺寸就只写 data） */
function writeWithSize(
  ctx: VideoOpsContext,
  nodeId: string,
  data: Record<string, unknown>,
  width: unknown,
  height: unknown,
): boolean {
  const sizes = videoCardSizePatch(width, height, ctx.fitLimits?.())
  if (!sizes) {
    ctx.write(nodeId, data)
    return true
  }
  ctx.write(
    nodeId,
    { ...data, cardWidth: sizes.cardWidth, cardHeight: sizes.cardHeight },
    sizes.size,
  )
  return true
}

/**
 * 确认剪辑：把 [start, end] 写进 data（秒）。播放器据此只播这一段。
 * @returns 是否写成功（节点不存在 / 没有视频 → false）
 */
export function clipVideo(
  ctx: VideoOpsContext,
  nodeId: string,
  start: number,
  end: number,
  minDuration = MIN_CLIP_DURATION,
): boolean {
  const current = ctx.read(nodeId)
  const data = asVideoData(current)
  if (!current || !data.videoUrl) return false
  const range = clampClipRange({ start, end, duration: data.videoDuration ?? 0, minDuration })
  ctx.write(nodeId, { ...current, clipStart: range.start, clipEnd: range.end })
  return true
}

/** 恢复整段：清掉剪辑范围 */
export function resetClip(ctx: VideoOpsContext, nodeId: string): boolean {
  const current = ctx.read(nodeId)
  if (!current) return false
  ctx.write(nodeId, { ...current, clipStart: undefined, clipEnd: undefined })
  return true
}

/**
 * 截图：把某一时刻的画面变成一个新的 **image 节点**（摆在视频节点右侧）。
 *
 * 为什么不原地替换：截图的意义是"从视频里取一张图继续用"，它应该成为独立的素材，
 * 能连给别的节点、能被生成模型吃进去 —— 与 v1 makeImageNodeFromFrame 的意图一致。
 *
 * 两处刻意的不做：
 * - **不写 cardWidth/cardHeight**：图片节点自己会在挂载时按图片比例补齐尺寸
 *   （见 plugin-node-image 的 missingCardSizePatch）—— 在这里再算一遍必然与图片插件的规则漂移；
 * - **裁剪框存在时只截框内**（用户的直觉：我裁了就该拿到裁好的图）。
 *
 * @returns 新节点 id；失败（没视频 / 图片插件没装 / 截不到帧）返回 null
 */
export async function captureFrameNode(
  ctx: VideoOpsContext,
  nodeId: string,
  at: number,
  transform: VideoTransform = defaultTransform,
): Promise<string | null> {
  const data = asVideoData(ctx.read(nodeId))
  if (!data.videoUrl || !ctx.createNode) return null
  // 截图产出的是 image 节点：图片插件没装就别建（建了也渲染不出来，会变成孤儿类型）
  if (ctx.hasType && !ctx.hasType('image')) return null
  const frame = await transform.captureFrame(data.videoUrl, at, data.cropRect ?? null)
  if (!frame) return null

  const source = ctx.nodePosition?.(nodeId) ?? { x: 0, y: 0 }
  const width = ctx.nodeWidth?.(nodeId) ?? DEFAULT_NODE_WIDTH
  const position = { x: source.x + width + FRAME_NODE_GAP, y: source.y }
  return ctx.createNode('image', position, {
    imageUrl: frame.dataUrl,
    imageName: frameFileName(data.videoName, at),
    imageWidth: frame.width,
    imageHeight: frame.height,
  })
}

/** 下载视频（文件名按 downloadFileName 清洗）；非浏览器环境返回 false */
export function downloadVideoNode(
  ctx: VideoOpsContext,
  nodeId: string,
  transform: VideoTransform = defaultTransform,
): boolean {
  const data = asVideoData(ctx.read(nodeId))
  if (!data.videoUrl) return false
  return transform.download(data.videoUrl, downloadFileName(data.videoName))
}

/** 状态栏文案（名字 / 尺寸·时长·大小）——组件直接用，避免文案散在模板里 */
export function readVideoSummary(data: Record<string, unknown> | undefined): {
  name: string
  width: number
  height: number
  duration: number
} {
  const v = asVideoData(data)
  return {
    name: v.videoName || '未命名视频',
    width: v.videoWidth ?? 0,
    height: v.videoHeight ?? 0,
    duration: v.videoDuration ?? 0,
  }
}
