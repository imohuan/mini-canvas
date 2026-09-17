/**
 * plugin-node-video —— video 节点插件（照 plugin-node-image 的写法：对象插件 + Service 子类上架服务）。
 *
 * 对照 v1 packages/canvas-core/src/nodes/Video/（VideoNode.vue + VideoNodePlugin.ts + videoNodeUtils.ts）：
 * - 播放 UI 自己画（不用原生 controls），进度/时间/截图/下载/全屏都在节点上；
 * - 裁剪与剪辑是**元数据式**的：只记裁剪框与保留区间，不重新编码视频（v1 也是这个取舍）；
 * - 截图产出一个新的 image 节点（"从视频里取一张图继续用"）；
 * - 取帧、尺寸适配、范围收敛等纯逻辑全部抽成可单测的函数（videoCrop / videoClip / videoFit / videoNodeData）。
 *
 * 与 v1 的架构差异（v2 分层，别按老写法抄）：
 * - v1 靠 data._overlay._cropMode 记"正在裁剪"（要宿主手动 strip 才不落盘）；v2 用**会话态**
 *   （videoSession），刷新后不会复活、也不占撤销栈；
 * - v1 的命令直接改 VueFlow 节点（vf.updateNode）；v2 一律走内核 graph 唯一写入口（自动进历史 + 落盘）；
 * - v1 的"裁剪/剪辑确认后新建节点"在 v2 改成**原地写回**：用户直觉是"把这个节点裁好"，
 *   而不是"多出一个节点"；要取出结果用截图（那才是真的新素材）。
 *
 * 依赖方向：只依赖内核(canvas-base/canvas-data) + 渲染层(canvas-render) + 默认皮的通用按钮，
 * 不反向依赖宿主/其它节点插件。
 */
import { Service, type Context, type ConfigSchema, type PluginModule } from '@mini-canvas/canvas-base'
import type { GraphDocumentService } from '@mini-canvas/canvas-data'
import { DEFAULT_VIDEO_FIT_LIMITS } from './videoFit'
import { MIN_CLIP_DURATION } from './videoClip'
import VideoContent from './VideoContent.vue'
import VideoTopToolbar from './VideoTopToolbar.vue'
import VideoClipPanel from './VideoClipPanel.vue'
import VideoFrameOverlay from './VideoFrameOverlay.vue'
import { beginOverlay, endOverlay } from './videoSession'
import {
  captureFrameNode,
  clipVideo,
  createVideoOps,
  cropVideo,
  downloadVideoNode,
  resetClip,
  resetCrop,
} from './videoOps'
import type { Rect } from './videoCrop'

/** 本插件注册的节点类型名 */
export const VIDEO_NODE_TYPE = 'video'

/** video 插件暴露给外部的服务形状（其它插件/宿主经 ctx.get('video') 使用） */
export interface VideoNodeService {
  /** 放一个视频节点；videoUrl 可给初始视频（URL / dataURL / objectURL），不给则显示占位 */
  addVideoNode(position: { x: number; y: number }, videoUrl?: string): string
  /** 换掉某节点的视频；空串 = 清空回到占位态 */
  setVideoUrl(id: string, videoUrl: string): void
  /** 删除节点（走图唯一写入口，连带清边、可撤销、自动落盘） */
  removeNode(id: string): void
}

/** 类型增强缝（cordis 声明合并）：宿主/作者 ctx.video 直访时类型为本服务 */
declare module '@mini-canvas/canvas-data' {
  interface Context {
    video: VideoNodeService
  }
}

/** video 服务：构造即上架 'video'，方法经 this.ctx.get 惰性取现时服务（不缓存） */
export class VideoService extends Service implements VideoNodeService {
  constructor(ctx: Context) {
    super(ctx, 'video')
  }

  private graph(): GraphDocumentService {
    return this.ctx.get<GraphDocumentService>('graph')
  }

  addVideoNode(position: { x: number; y: number }, videoUrl = ''): string {
    return this.graph().transaction('add-video-node', (tx) =>
      tx.createNode(VIDEO_NODE_TYPE, position, videoUrl ? { videoUrl } : {}),
    )
  }

  /** 换视频：清掉旧尺寸（新视频元数据还没量，留着旧尺寸会让卡片比例对不上） */
  setVideoUrl(id: string, videoUrl: string): void {
    this.graph().updateNode(id, { data: { videoUrl, cardWidth: undefined, cardHeight: undefined } })
  }

  removeNode(id: string): void {
    this.graph().removeNodes([id])
  }
}

export const name = 'video'
export const inject = ['graph'] as string[]

/** 节点类型图标（标题左侧与右键"新建节点"共用；单一来源 = 本类型注册时声明） */
const NODE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5l5 2.5-5 2.5z"/></svg>'

/**
 * 本插件可配置项 schema（cordis P4：模块级 Config）。
 *
 * 键名一律带本包前缀 video…：内核 settings 是**全局同一张表、先声明者独占**，
 * 叫 maxWidth / minClipDuration 这种通用名会和其他插件抢同一个键（撞名会被静默跳过）。
 * 分组沿用项目既有一级分类（布局 / 常规 / 节点 / 边），不新立无主分类。
 */
export const Config: ConfigSchema = {
  videoFitMaxWidth: {
    type: 'number', default: DEFAULT_VIDEO_FIT_LIMITS.maxWidth, min: 120, max: 2000, step: 10,
    label: '视频预览上限宽', group: '布局/视频节点尺寸',
    description: '拖入或上传视频后，视频节点卡片的最大宽度（px）。画面比这个宽就等比缩小，不会放大。',
  },
  videoFitMaxHeight: {
    type: 'number', default: DEFAULT_VIDEO_FIT_LIMITS.maxHeight, min: 120, max: 2000, step: 10,
    label: '视频预览上限高', group: '布局/视频节点尺寸',
    description: '拖入或上传视频后，视频节点卡片的最大高度（px）。画面比这个高就等比缩小，不会放大。',
  },
  videoMinClipDuration: {
    type: 'number', default: 1, min: 0.1, max: 10, step: 0.1,
    label: '剪辑最短时长', group: '节点/视频剪辑',
    description: '拖动剪辑端点时至少要保留的秒数。设得太小会因为一帧的误差而几乎剪掉整段。',
  },
}

/**
 * 插件主体：上架 'video' 服务 + 注册 'video' 节点类型（数据/尺寸/连接约束 + content + 上下操作栏 + create）。
 *
 * 连接约束：输入口收 image（封面/首帧参考）与 video、输出口产 video ——
 * 对齐 v1 VideoNodePlugin 的 acceptsInputs: ['image', 'text', 'video']。
 * 不声明 capacity = 不限条数（视频节点可以接多个上游素材）。
 * frameless：视频画面铺满整张卡，外壳那圈 1px 边框只会变成画面边缘多余的一圈缝（与图片节点同理）。
 */
export function apply(ctx: Context) {
  const service = new VideoService(ctx)

  ctx.nodes.register({
    type: VIDEO_NODE_TYPE,
    label: '视频',
    description: '在画布中添加一个视频节点',
    icon: NODE_ICON,
    // 尺寸与 v1 NODE_SIZES.video 同：一点元数据都读不到时的兜底
    size: { w: 480, h: 320 },
    inputs: [{ port: 'target', acceptsTypes: ['image', 'text', 'video'] }],
    outputs: [{ port: 'source', contentType: 'video' }],
    // 不支持拖拽改尺寸：显式声明 false（与 v1 VideoNodePlugin 的 `resizable: false` 一致）。
    // 视频卡片的尺寸由画面比例决定（进视频/裁剪/恢复都说一次改到位），
    // 留一个手动拖柄会让"卡片贴着画面"这条规矩被拖歪，而且拖过之后换视频还会被覆盖，
    // 等于给了用户一个按不住的选择。所以视频节点不提供 resize。
    resizable: false,
    frameless: true,
    content: VideoContent,
    segments: {
      'top-toolbar': VideoTopToolbar,
      'bottom-toolbar': VideoClipPanel,
      // 裁剪浮层画在**卡片外面**（overlay 段）：内容段住在 overflow:hidden 的裁剪层里，
      // 浮层挂那儿会被卡片边界切掉（用户实测报的「裁剪区域被节点切掉」）。
      overlay: VideoFrameOverlay,
    },
    create(position) {
      return service.addVideoNode(position)
    },
  })

  // —— 命令：界面按钮与命令走**同一批实现**（cropVideo / clipVideo / captureFrameNode …）——
  //   按钮是"组件自己调实现"，命令是"外部（快捷键/右键菜单/MCP）按 id 调"，两条路不各写一遍。
  //   payload 约定：{ nodeId: string }；裁剪确认额外给 rect（视频像素矩形）。
  const ops = createVideoOps(ctx)

  ctx.commands.register({
    id: 'video.crop',
    title: '裁剪视频画面',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      beginOverlay(nodeId, 'crop')
      return true
    },
  })
  ctx.commands.register({
    id: 'video.cropConfirm',
    title: '确认裁剪',
    run: (_c, payload) => {
      const { nodeId, rect } = (payload ?? {}) as { nodeId?: string; rect?: Rect }
      if (!nodeId || !rect) return false
      const ok = cropVideo(ops, nodeId, rect)
      // 无论成败都退出覆盖层：失败时留在裁剪态会让用户以为"点了没反应"
      endOverlay(nodeId)
      return ok
    },
  })
  ctx.commands.register({
    id: 'video.cropCancel',
    title: '取消裁剪',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      endOverlay(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'video.resetCrop',
    title: '恢复整幅画面',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return resetCrop(ops, nodeId)
    },
  })
  ctx.commands.register({
    id: 'video.clip',
    title: '剪辑视频',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      beginOverlay(nodeId, 'clip')
      return true
    },
  })
  ctx.commands.register({
    id: 'video.clipConfirm',
    title: '确认剪辑',
    run: (_c, payload) => {
      const { nodeId, start, end } = (payload ?? {}) as { nodeId?: string; start?: number; end?: number }
      if (!nodeId || typeof start !== 'number' || typeof end !== 'number') return false
      const ok = clipVideo(ops, nodeId, start, end, MIN_CLIP_DURATION)
      endOverlay(nodeId)
      return ok
    },
  })
  ctx.commands.register({
    id: 'video.clipCancel',
    title: '取消剪辑',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      endOverlay(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'video.resetClip',
    title: '恢复整段时长',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return resetClip(ops, nodeId)
    },
  })
  ctx.commands.register({
    id: 'video.captureFrame',
    title: '截取当前帧为图片节点',
    run: async (_c, payload) => {
      const { nodeId, at } = (payload ?? {}) as { nodeId?: string; at?: number }
      if (!nodeId) return false
      const time = typeof at === 'number' && Number.isFinite(at) ? at : 0
      const id = await captureFrameNode(ops, nodeId, time)
      return Boolean(id)
    },
  })
  ctx.commands.register({
    id: 'video.download',
    title: '下载视频',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return downloadVideoNode(ops, nodeId)
    },
  })
}

/** 兼容旧装配的 PluginModule 出口（name='video' 供 HMR reload） */
export const nodeVideoPlugin: PluginModule = { name, inject, Config, apply }
