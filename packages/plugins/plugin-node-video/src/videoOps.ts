/**
 * videoOps —— 视频节点的各项操作（加载视频 / 裁剪 / 剪辑 / 截图 / 下载）的业务实现。
 *
 * 为什么要单独一层（与图片节点的 imageOps 同因）：同一件事有两个入口 —— **界面按钮**
 * （顶部操作条 / 内容区控件）和**命令**（ctx.commands.register 的 video.upload / video.crop …，
 * 供快捷键、右键菜单、MCP 调用）。两处各写一遍必然漂移，所以实现收敛成纯异步函数，
 * 两边都只是"备好读/写句柄再调它"。
 *
 * 读/写句柄（VideoOpsContext）由调用方注入：
 * - 组件侧：ctx.get('doc').getNode(id).data 读；ctx.get('doc').updateNode 写。
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
import type { Services } from '@mini-canvas/canvas-base'

/** 操作所需的读/写句柄（组件与命令各备一份，实现只写一遍） */
export interface VideoOpsContext {
  /** 读节点当前 data；节点不存在返回 undefined */
  read(nodeId: string): Record<string, unknown> | undefined
  /**
   * 写回节点 data（务必走内核 graph，带历史与落盘）。
   * @param size 传了就同时写内核**正式尺寸字段** node.size —— 必须与 data 在同一个 patch 里提交，
   *   否则一次换视频/裁剪会记两条撤销记录（用户按一次撤销只退半步）。
   * @param unset 要**删除**的 data 键（内核 data 是浅合并，给 undefined 删不掉键，
   *   必须走内核 dataUnset 才真的移除）
   */
  write(nodeId: string, data: Record<string, unknown>, size?: { w: number; h: number }, unset?: string[]): void
  /** 视频预览上限（配置 videoFitMaxWidth/videoFitMaxHeight）；不注入则回落 560×360 */
  fitLimits?(): VideoFitLimits
  /**
   * 【迁移期保留】在某位置建一个节点。
   *
   * 截图**不再**走这里：直接建 image 节点等于替图片插件写它的字段。
   * 现在只有历史调用方可能用到，新代码请用 addImageNodeFromResource。
   */
  createNode?(type: string, position: { x: number; y: number }, data: Record<string, unknown>): string | null
  /** 某类型是否已注册（截图要建 image 节点，而图片插件可能没装）；未注入返回 true */
  hasType?(type: string): boolean
  /**
   * 图片节点插件公开的“按资源引用建节点”入口。
   *
   * 优先走 `media` 能力（若宿主已提供），否则回落到 `image` 服务；
   * 两者都拿不到 = 宿主没装图片节点 → 截图**明确失败**，不建孤儿节点。
   */
  addImageNodeFromResource?(
    position: { x: number; y: number },
    resourceId: string,
    meta?: { name?: string; width?: number; height?: number },
  ): string | null
  /** 读某节点位置（截图产出的新节点摆在它右边）；未注入返回 null */
  nodePosition?(nodeId: string): { x: number; y: number } | null
  /** 读某节点实测/声明宽度（决定新节点摆多远）；未注入返回 null */
  nodeWidth?(nodeId: string): number | null
  /**
   * 建一个节点并连线（同一事务，一次撤销退干净）。
   *
   * 方向 `targetToNew` = 传入的 target 是**上游**、新节点在下游（裁剪就是这条：
   * 原视频 → 裁出来的新视频）。缺省 `newToTarget` = 新节点是上游（加素材）。
   * @returns 新节点 id；拿不到图服务 / 建失败 → null
   */
  createNodeWithEdge?(
    type: string,
    position: { x: number; y: number },
    data: Record<string, unknown>,
    target: string,
    edgeDirection?: 'newToTarget' | 'targetToNew',
  ): string | null
  /** 画布上的全部节点（取名累加、算摆放位置用）；未注入返回空数组 */
  listNodes?(): Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown>; size?: { w: number; h: number } }>
  /**
   * 把一段图片字节存进宿主资源库，返回可写进节点的引用 + 显示地址。
   * 截图产出的是**新图片**，必须走这条（与图片插件上传同一条路）：
   * 直接写 dataURL 会让 base64 落进画布数据，云端保存时原样上云。
   * 未注入时返回 undefined —— 调用方放弃这次截图，而不是退回 base64。
   */
  persistImage?(blob: Blob, name?: string): Promise<{ resourceId: string; url: string } | undefined>
  /**
   * 把一段视频字节存进宿主资源库，返回持久引用 + 当前可用地址
   * （云端是同源 URL、本地是资源库重建的地址）。上传的节点字段写这条地址，不写临时 objectURL。
   * 未注入 / 存取失败 → undefined（调用方回落 objectURL 兜底）。
   */
  persistVideo?(blob: Blob, name?: string): Promise<{ resourceId: string; url: string } | undefined>
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

/**
 * 只要"按名字取服务"这一件事的宿主形状（内核 Context 与渲染上下文都满足）。
 *
 * 保留内核那套"服务名 → 类型"重载：内置服务名（doc/nodeLayout/settings…）按名推导，
 * 插件自有窄端口仍可显式泛型。这样这个结构端口不至于把类型信息拍平成 unknown。
 */
export interface ServiceGetter {
  get<K extends keyof Services>(name: K): Services[K]
  get<T = unknown>(name: string): T
  tryGet<K extends keyof Services>(name: K): Services[K] | undefined
  tryGet<T = unknown>(name: string): T | undefined
}

/** 截图产出的新节点相对视频节点的偏移（摆在右侧同一水平线上） */
export const FRAME_NODE_GAP = 40
/** 视频节点宽度拿不到时的默认值（决定截图节点摆多远） */
const DEFAULT_NODE_WIDTH = 480

/** 裁剪出的新节点与原视频右边缘的间隔（与图片节点同一条规矩：留 100px，别贴太近） */
export const CROP_NODE_GAP = 100

/** 裁剪节点名的前缀（扫描与生成都用它） */
export const CROP_LABEL_PREFIX = '裁剪'

/**
 * 下一个可用的裁剪节点名：扫描现有 video 节点里「裁剪 N」的 N，取最大值 + 1。
 *
 * 为什么不存计数器：计数器要么污染节点 data、要么只在内存里（撤销/刷新后与画布对不上）。
 * 扫描是幂等的：撤销几次、删掉中间哪个，算出来的名字都不会与画布上已有的撞车。
 */
export function nextVideoCropLabel(nodes: Array<{ type: string; data?: Record<string, unknown> }>): string {
  let max = 0
  const re = new RegExp('^' + CROP_LABEL_PREFIX + '\\s*(\\d+)$')
  const used = new Set<string>()
  for (const n of nodes) {
    if (n.type !== 'video') continue
    const label = n.data?.label
    if (typeof label !== 'string') continue
    used.add(label.trim())
    const m = re.exec(label.trim())
    if (!m) continue
    const num = Number.parseInt(m[1], 10)
    if (!Number.isNaN(num) && num > max) max = num
  }
  if (used.has(CROP_LABEL_PREFIX)) {
    const n = max + 1 === 1 ? 2 : max + 1
    return CROP_LABEL_PREFIX + ' ' + String(n)
  }
  return max === 0 ? CROP_LABEL_PREFIX : CROP_LABEL_PREFIX + ' ' + String(max + 1)
}

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
  /**
   * 读/写统一走 doc 门面（设计文档 §4.1）。5c 起 nodeStore/graph 两个老名已下线，
   * doc 是唯一来源；缺 doc（纯逻辑测试未注入图服务）则安全降级（读 undefined、写 no-op）。
   */
  type VideoDocPort = {
    getNode(id: string): NodeLike | undefined
    getNodes(): NodeLike[]
    types: ReadonlyMap<string, unknown>
    updateNode(id: string, patch: { data: Record<string, unknown>; size?: { w: number; h: number } }): void
    transaction<T>(
      reason: string,
      fn: (tx: {
        createNode(t: string, p: { x: number; y: number }, d?: Record<string, unknown>): string
        connectEdge(input: { source: string; target: string; sourceHandle?: string; targetHandle?: string }): { edgeId: string; status: string }
      }) => T,
    ): T
  }
  /** doc 门面（5c 起数据唯一来源）；缺 doc 则安全降级（读 undefined、写 no-op） */
  const doc = (): VideoDocPort | undefined => svc.get<VideoDocPort | undefined>('doc')
  const layout = () => svc.tryGet('nodeLayout')

  /** 媒体能力（宿主注册在 capability 场里；这里按服务名尝试，未落地时为 undefined） */
  const media = () =>
    svc.tryGet<{
      addNode?(
        kind: string,
        id: string,
        position: { x: number; y: number },
        opts?: { nodeType?: string; meta?: Record<string, unknown> },
      ): string | undefined
    }>('media')

  /** 图片节点服务（插件身份入口；未装图片插件时为 undefined） */
  const imageService = () =>
    svc.tryGet<{
      addImageNodeFromResource?(
        position: { x: number; y: number },
        resourceId: string,
        meta?: { name?: string; width?: number; height?: number },
      ): string
    }>('image')

  /**
   * 媒体字节 → 资源库：put 拿持久引用、resolve 换当前可用地址
   * （云端是同源 URL `/api/canvases/<画布id>/resources/<哈希>`、本地是资源库重建的地址）。
   * 没有资源库 / 存取失败 → undefined —— 调用方各自兜底（上传回落 objectURL、截图放弃）。
   */
  const persist = async (
    blob: Blob,
    kind: string,
    name?: string,
  ): Promise<{ resourceId: string; url: string } | undefined> => {
    const store = svc.tryGet<{
      put(b: Blob, o?: { kind?: string; name?: string }): Promise<string>
      resolve(ref: string): Promise<string | undefined>
    }>('resources')
    if (!store) return undefined
    try {
      const resourceId = await store.put(blob, { kind, ...(name ? { name } : {}) })
      const url = await store.resolve(resourceId)
      return url ? { resourceId, url } : undefined
    } catch {
      return undefined
    }
  }

  return {
    read: (nodeId) => doc()?.getNode(nodeId)?.data,
    // size 与 data 在**同一次** updateNode 里提交：内核按 patch 记一条历史 → 一次撤销退干净
  write: (nodeId, data, size, unset) =>
    doc()?.updateNode(
      nodeId,
      size !== undefined
        ? { data, size: { w: size.w, h: size.h }, ...(unset ? { dataUnset: unset } : {}) }
        : { data, ...(unset ? { dataUnset: unset } : {}) },
    ),
    // 上限解析只有一份实现（videoFit.readVideoFitLimits）：不在这里再抄一遍"读配置 + 回落"的兜底
    fitLimits: () => readVideoFitLimits(svc),
    hasType: (type) => (doc() ? doc()!.types.has(type) : true),
    nodePosition: (nodeId) => doc()?.getNode(nodeId)?.position ?? null,
    listNodes: () => (doc()?.getNodes() ?? []).map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: (n.data ?? {}) as Record<string, unknown>,
      ...(n.size ? { size: { w: n.size.w, h: n.size.h } } : {}),
    })),
    // 建节点 + 连边一个事务：用户按一次撤销把"新节点 + 那条线"一起退掉
    createNodeWithEdge: (type, position, data, target, edgeDirection = 'newToTarget') => {
      const g = doc()
      if (!g) return null
      try {
        return g.transaction('video-crop-node', (tx) => {
          const created = tx.createNode(type, position, data)
          tx.connectEdge(
            edgeDirection === 'targetToNew'
              ? { source: target, target: created, sourceHandle: 'source', targetHandle: 'target' }
              : { source: created, target, sourceHandle: 'source', targetHandle: 'target' },
          )
          return created
        })
      } catch {
        return null
      }
    },
    nodeWidth: (nodeId) => {
      const rect = layout()?.getNodeRect(nodeId)
      if (rect && rect.w > 0) return rect.w
      const node = doc()?.getNode(nodeId)
      const w = Number(node?.data?.cardWidth) || node?.size?.w || 0
      return w > 0 ? w : null
    },
    createNode: (type, position, data) => {
      const g = doc()
      if (!g) return null
      try {
        return g.transaction('video-create-node', (tx) => tx.createNode(type, position, data))
      } catch {
        return null
      }
    },
    // 截图产出图片节点：只交“位置 + 资源引用 + 原始元数据”，字段由图片类型自己写。
    // 两条入口都试过才判失败 —— 这样删掉图片插件时截图会明确返回 null，而不是留下孤儿节点。
    addImageNodeFromResource: (position, resourceId, meta) => {
      const capability = media()
      if (typeof capability?.addNode === 'function') {
        try {
          const id = capability.addNode('image', resourceId, position, { nodeType: 'image', meta })
          if (id) return id
        } catch {
          // 能力不可用时继续尝试服务入口
        }
      }
      const service = imageService()
      if (typeof service?.addImageNodeFromResource !== 'function') return null
      try {
        const id = service.addImageNodeFromResource(position, resourceId, meta)
        return id || null
      } catch {
        return null
      }
    },
    // 上传视频的字节存进资源库：节点写 resolve 出来的地址（不写临时 objectURL）
    persistVideo: (blob, name) => persist(blob, 'video', name),
    // 截图产出的图片字节存进资源库（与图片插件上传同一条路；不退回 base64）
    persistImage: (blob, name) => persist(blob, 'image', name),
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
 * 节点标题右侧那一格显示什么（`1280×720`；尺寸拿不到 → 空串，标题那一格就不渲染）。
 *
 * 复用 displaySizeOf 的"裁过就按裁框"口径：标题上写的就是用户此刻看到的画面尺寸，
 * 与内容区右上角那个角标同源 —— 同一件事只有一份算法。
 *
 * 这是节点类型声明 `titleExtra` 时用的纯函数：**读 data 现算，不写回 data**。
 */
export function videoTitleExtra(data: Record<string, unknown> | undefined): string {
  const { width, height } = displaySizeOf(data)
  return width > 0 && height > 0 ? `${width}×${height}` : ''
}

/**
 * 换视频后的统一写回：data + 卡片尺寸**一次写完**。
 *
 * 尺寸算不出（元数据没读出来/非法）时只写 data 并**清掉旧尺寸** —— 不能留着上一段视频的
 * 卡片尺寸（那会让新视频被硬塞进旧比例里）。
 */
function writeVideoData(ctx: VideoOpsContext, nodeId: string, data: Record<string, unknown>, unset?: string[]): void {
  const sizes = videoCardSizePatch(data.videoWidth, data.videoHeight, ctx.fitLimits?.())
  if (!sizes) {
    ctx.write(nodeId, data, undefined, unset)
    return
  }
  // 只写正式尺寸 size；卡片镜像由 nodeStore 自动补齐
  ctx.write(nodeId, data, sizes.size, unset)
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
    ...(extra ?? {}),
  }
  if (metaIn?.name) patch.videoName = metaIn.name
  if (typeof metaIn?.size === 'number') patch.videoSize = metaIn.size
  if (meta) {
    patch.videoWidth = meta.width
    patch.videoHeight = meta.height
    patch.videoDuration = meta.duration
  }
  // 全新的画面：裁剪框与剪辑范围都属于上一段视频，一并清掉（dataUnset 才真的删得掉键）
  writeVideoData(ctx, nodeId, { ...(ctx.read(nodeId) ?? {}), ...patch }, ['cropRect', 'clipStart', 'clipEnd'])
  return true
}

/**
 * 上传视频文件：字节先进资源库（put → resolve 拿当前可用地址）→ 载入。
 *
 * 为什么视频不像图片那样转 dataURL：几十兆的视频转 base64 会膨胀约三分之一，
 * 写进 localStorage 直接撑爆配额、刷新反而丢数据。
 *
 * 节点里写的是**资源库解析出来的地址**（云端是同源 URL / 本地是资源库地址）：
 * `URL.createObjectURL(file)` 的 `blob:` 只在当前页面有效 —— 存到服务器后别的标签页取不到、
 * 刷新后失效、云端生成任务时服务器也拿不到。objectURL 只在**没有资源库 / 解析失败**时
 * 兜底（极简宿主）—— 那种情况下节点数据本来就只在本次会话有效，写它不会更糟。
 *
 * 资源登记**先做、且不单独写库**：resourceId 随本次载入一起提交，
 * 于是"换视频"对用户始终是**一次撤销**就退回原样（分两次写会让撤销只退半步）。
 *
 * @param file 不给（命令触发）时开系统选视频框；用户取消 → false
 */
export async function uploadVideo(
  ctx: VideoOpsContext,
  nodeId: string,
  file: Blob | undefined,
  transform: VideoTransform = defaultTransform,
): Promise<boolean> {
  if (!ctx.read(nodeId)) return false
  const picked = file ?? (await transform.pickFile())
  if (!picked) return false
  const name = (picked as File).name
  // 字节先进资源库、拿回可用地址（createVideoOps.persistVideo 装配）；拿不到才回落 objectURL
  const persisted = await ctx.persistVideo?.(picked, typeof name === 'string' && name ? name : undefined)
  const url = persisted?.url || transform.objectUrl(picked)
  if (!url) return false
  return loadVideo(
    ctx,
    nodeId,
    url,
    {
      ...(typeof name === 'string' && name ? { name } : {}),
      ...(typeof (picked as File).size === 'number' ? { size: (picked as File).size } : {}),
    },
    persisted ? { resourceId: persisted.resourceId } : undefined,
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
    ctx.write(nodeId, next, sizes.size)
    return true
  }
  ctx.write(nodeId, next)
  return true
}

/**
 * 真裁剪的结果（后台 ffmpeg 已把新文件写进画布资源）。
 * 与 cropVideo 的区别：这不是"记一个框靠 CSS 取景"，而是**换掉节点指向的视频文件**。
 */
export interface RealCropResult {
  /** 新视频的同源地址（写进 videoUrl） */
  url: string
  /** 新视频的持久引用（可写进 resourceId；没有就保留旧引用） */
  resourceId?: string
  /** 裁后画面尺寸（视频像素） */
  width: number
  height: number
}

/**
 * 把后台真裁剪的产物装进一个**新建的下游节点**，并从原视频连一条线过去。
 *
 * 用户口径 2026-10-30：裁剪要出新节点 + 连线，与图片节点的裁剪一致。
 * 原地换地址会让底栏按 URL 缓存的缩略图继续显示旧画面（槽位文件名不变，缓存键也不变），
 * 而且用户丢掉了一次对比"裁前 / 裁后"的机会。原节点保持不动。
 *
 * 为什么清 cropRect：新节点装的本来就是裁好的文件，再叠取景映射会二次放大。
 * @returns 新节点 id；建失败 / 没有图服务 → null
 */
export function createRealCropNode(ctx: VideoOpsContext, nodeId: string, result: RealCropResult): string | null {
  if (!ctx.read(nodeId)) return null
  if (!(result.width > 0) || !(result.height > 0) || !result.url) return null
  if (!ctx.createNodeWithEdge) return null
  const source = ctx.listNodes?.()?.find((n) => n.id === nodeId)
  const sourceWidth = source?.size?.w ?? (source?.data?.cardWidth as number | undefined) ?? DEFAULT_NODE_WIDTH
  const sizes = videoCardSizePatch(result.width, result.height, ctx.fitLimits?.())
  const position = {
    x: (source?.position.x ?? 0) + sourceWidth + FRAME_NODE_GAP,
    y: source?.position.y ?? 0,
  }
  const label = nextVideoCropLabel((ctx.listNodes?.() ?? []).map((n) => ({ type: n.type, data: n.data })))
  const data: Record<string, unknown> = {
    label,
    videoUrl: result.url,
    videoName: label,
    videoWidth: result.width,
    videoHeight: result.height,
    ...(result.resourceId ? { resourceId: result.resourceId } : {}),
    ...(sizes ? { cardWidth: sizes.size.w, cardHeight: sizes.size.h } : {}),
  }
  // 原视频是上游、裁出来的是下游（用户拖线方向：从原节点拉到新节点）
  return ctx.createNodeWithEdge('video', position, data, nodeId, 'targetToNew')
 }

/**
 * 恢复整幅画面：清掉裁剪框，卡片尺寸回到原始视频比例。
 * 与 cropVideo 是逆操作 —— 裁剪既然是取景式的，就该随时能退回去。
 */
export function resetCrop(ctx: VideoOpsContext, nodeId: string): boolean {
  const current = ctx.read(nodeId)
  if (!current) return false
  const next: Record<string, unknown> = { ...current }
  // cropRect 必须走 dataUnset：浅合并删不掉键（内核 data patch 的合并语义）
  return writeWithSize(ctx, nodeId, next, Number(current.videoWidth), Number(current.videoHeight), ['cropRect'])
}

/** 写 data 并同时把卡片调成给定画面尺寸的比例（拿不到尺寸就只写 data） */
function writeWithSize(
  ctx: VideoOpsContext,
  nodeId: string,
  data: Record<string, unknown>,
  width: unknown,
  height: unknown,
  unset?: string[],
): boolean {
  const sizes = videoCardSizePatch(width, height, ctx.fitLimits?.())
  if (!sizes) {
    ctx.write(nodeId, data, undefined, unset)
    return true
  }
  ctx.write(
    nodeId,
    data,
    sizes.size,
    unset,
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
  ctx.write(nodeId, { ...current }, undefined, ['clipStart', 'clipEnd'])
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
  if (!data.videoUrl) return null
  // 截图产出的是 image 节点：必须由图片插件自己建（它才知道自己的字段）。
  // 图片插件没装 → 明确失败，绝不替它写 data（那会变成孤儿类型 / 无人认领的字段）。
  if (!ctx.addImageNodeFromResource) return null
  // 二次保险：服务在、类型却没注册（热卸中间态）也不建 —— 建出来没人渲染。
  if (ctx.hasType && !ctx.hasType('image')) return null
  const frame = await transform.captureFrame(data.videoUrl, at, data.cropRect ?? null)
  if (!frame) return null

  // 截图是**新的一张图**：字节存进资源库（本地进库 / 云端进文件夹），节点里只留引用。
  // 不能直接写 frame.dataUrl —— 那是 base64，会原样落进画布数据并上云。
  if (!ctx.persistImage) return null
  let persisted: { resourceId: string; url: string } | undefined
  try {
    // dataURL → Blob（fetch 支持 data: 地址；不必自己解析 base64）
    const blob = await (await fetch(frame.dataUrl)).blob()
    persisted = await ctx.persistImage(blob, frameFileName(data.videoName, at))
  } catch {
    return null
  }
  if (!persisted) return null

  const source = ctx.nodePosition?.(nodeId) ?? { x: 0, y: 0 }
  const width = ctx.nodeWidth?.(nodeId) ?? DEFAULT_NODE_WIDTH
  const position = { x: source.x + width + FRAME_NODE_GAP, y: source.y }
  // 持久引用交给图片类型；显示地址不交给它（节点数据只存 resourceId）。
  return ctx.addImageNodeFromResource(position, persisted.resourceId, {
    name: frameFileName(data.videoName, at),
    width: frame.width,
    height: frame.height,
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
