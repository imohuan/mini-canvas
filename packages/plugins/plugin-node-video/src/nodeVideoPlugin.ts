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
import { Service, type Context, type ConfigSchema, type PluginModule, bindTypeDefaultSize } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import { videoThumbTierFields, videoThumbTierKeys } from './videoThumbTier'
import { DEFAULT_VIDEO_FIT_LIMITS } from './videoFit'
import { videoTitleExtra } from './videoOps'
import { MIN_CLIP_DURATION } from './videoClip'
import VideoContent from './VideoContent.vue'
import VideoPreview from './VideoPreview.vue'
import VideoFullscreenOverlay from './VideoFullscreenOverlay.vue'
import VideoTopToolbar from './VideoTopToolbar.vue'
import VideoClipPanel from './VideoClipPanel.vue'
import VideoFrameOverlay from './VideoFrameOverlay.vue'
import { registerBarAction, publishToolActions } from '@mini-canvas/plugin-bottom-bar'
import { beginOverlay, endOverlay } from './videoSession'
import {
  captureFrameNode,
  clipVideo,
  createVideoOps,
  cropVideo,
  downloadVideoNode,
  resetClip,
  resetCrop,
  uploadVideo,
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

  private doc(): DocService {
    return this.ctx.get('doc')
  }

  addVideoNode(position: { x: number; y: number }, videoUrl = ''): string {
    return this.doc().transaction('add-video-node', (tx) =>
      tx.createNode(VIDEO_NODE_TYPE, position, videoUrl ? { videoUrl } : {}),
    )
  }

  /** 换视频：清掉旧尺寸（新视频元数据还没量，留着旧尺寸会让卡片比例对不上） */
  setVideoUrl(id: string, videoUrl: string): void {
    // size: undefined 清正式尺寸（镜像由 nodeStore 一并清掉），新视频元数据读出来再按比例写回
    this.doc().updateNode(id, { data: { videoUrl }, size: undefined })
  }

  removeNode(id: string): void {
    this.doc().removeNodes([id])
  }
}

export const name = 'video'
export const inject = ['doc'] as string[]

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
  // —— 「布局 / 视频节点尺寸」：新节点默认尺寸（改完实时生效，未 resize 过的节点跟着变）——
  videoDefaultWidth: {
    type: 'number', default: 480, min: 80, max: 2000, step: 10,
    label: '默认宽', group: '布局/视频节点尺寸',
    description: '视频节点没有自己的尺寸时用的宽度（px）。改完立即生效：没被手动拖过尺寸的视频节点会立刻跟着变。',
  },
  videoDefaultHeight: {
    type: 'number', default: 320, min: 80, max: 2000, step: 10,
    label: '默认高', group: '布局/视频节点尺寸',
    description: '视频节点没有自己的尺寸时用的高度（px）。改完立即生效（同上）。',
  },
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
  // —— 「节点/缩略图」：视频帧图的三档（用户口径：视频这套**独立**配，与图片分开）——
  //
  // 视频的三档**全是帧图**（第 1 档 = 原生尺寸那一帧）：因为"不播放时不加载视频"，
  // 第 1 档也必须是一张图 —— 这是与图片节点最大的差别（图片第 1 档是原图本身）。
  //
  // 帧图由**本插件自己用 canvas 抓帧**（见 videoThumbCanvas.ts）：起一个临时 video 解码、
  // seek 到某一刻、按档位缩放画进画布 —— 不依赖后台、不动基础包，且三档**真的不同尺寸**
  // （从前那条截帧路径建的是原像素画布，配置的尺寸对它毫无作用，用户实测报过）。
  ...videoThumbTierFields('video', '节点/缩略图', '视频'),
}

/** 本插件声明的帧图设置键（内容组件按它过滤 settings 变更） */
export const VIDEO_THUMB_KEYS = videoThumbTierKeys('video')

/**
 * 插件主体：上架 'video' 服务 + 注册 'video' 节点类型（数据/尺寸/连接约束 + content + 上下操作栏 + create）。
 *
 * 连接约束：输入口收 image（封面/首帧参考）与 video、输出口产 video ——
 * 对齐 v1 VideoNodePlugin 的 acceptsInputs: ['image', 'text', 'video']。
 * 不声明 capacity = 不限条数（视频节点可以接多个上游素材）。
 * 卡片边框：保留外壳默认的 1px 边框（2026-10-12 与图片节点同一条口径）——
 * 空视频 + 白底画面与画布背景糊在一起时，边框是唯一能看出节点边界的东西。
 */
export function apply(ctx: Context) {
  const service = new VideoService(ctx)

  // 视频节点全屏预览浮层（overlay 槽，Teleport 到 body）：双击视频节点时经 mediaPreviewBus 打开。
  // 视觉整只交给主题注册的 MediaViewer —— 与生成历史 / 底栏素材卡同一只预览组件（用户口径 2026-10-17）。
  ctx.slots.register('overlay', {
    id: 'node-video/fullscreen-preview',
    order: 43,
    component: VideoFullscreenOverlay,
    meta: { title: '视频全屏预览' },
  })

  // 视频**预览**注册件（从 VideoContent 抽出的纯展示件）：登记进 ui 目录，
  // 任何宿主按名取用 —— 换实现一起换（与 audioPreview 同一条路）。
  ctx.registryOf<unknown>('ui').add('videoPreview', VideoPreview, { id: 'node-video' })

  // 0.5 底栏动作（T9：剪辑面板搬进 plugin-bottom-bar，本包只发布动作）
  //     §0.3：nodeBar 是插件服务（不是宿主恒在服务），故不进 inject；没装 bottom-bar 的宿主照常工作。
  const registerBar = (): boolean => {
    if (!ctx.tryGet('nodeBar')) return false
    // AI 生成视频：每个 produces:'video' 的工具一条动作（输入框是临时的，发送时组装）
    publishToolActions(ctx, { types: ['video'], produces: 'video', needsPrompt: true })
    // 剪辑：选中动作 = 打开剪辑会话（面板显隐交给底栏，会话态由 onSelect/onDeselect 开合）
    registerBarAction(ctx, {
      id: 'video.clip', types: ['video'], title: '剪辑', panel: VideoClipPanel, needsPrompt: false, apply: 'self',
      description: '裁掉首尾保留一段（元数据式，不重新编码）',
      onSelect: (id) => beginOverlay(id, 'clip'),
      onDeselect: (id) => endOverlay(id),
      run: () => ({ ok: true }),   // 实际提交由面板经命令 video.clipConfirm 完成
    })
    return true
  }
  if (!registerBar()) {
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerBar()) off.dispose()
    })
  }

  ctx.nodes.register({
    type: VIDEO_NODE_TYPE,
    label: '视频',
    nameTemplate: '视频 {{ID}}',
    description: '在画布中添加一个视频节点',
    icon: NODE_ICON,
    // 标题右侧显示画面分辨率（1280×720；裁过就是裁框尺寸）——派生值按 data 现算，不写进 data。
    titleExtra: videoTitleExtra,
    // 尺寸与 v1 NODE_SIZES.video 同：一点元数据都读不到时的兜底
    size: { w: 480, h: 320 },
    inputs: [{ port: 'target', acceptsTypes: ['image', 'text', 'video'] }],
    outputs: [{ port: 'source', contentType: 'video' }],
    // 不支持拖拽改尺寸：显式声明 false（与 v1 VideoNodePlugin 的 `resizable: false` 一致）。
    // 视频卡片的尺寸由画面比例决定（进视频/裁剪/恢复都说一次改到位），
    // 留一个手动拖柄会让"卡片贴着画面"这条规矩被拖歪，而且拖过之后换视频还会被覆盖，
    // 等于给了用户一个按不住的选择。所以视频节点不提供 resize。
    resizable: false,
    // 加载态用默认尺寸（用户口径 2026-10-10）：视频一旦有内容，node.size 就按画面比例写死，
    // 重新生成时卡片仍是上一次的比例。声明本能力后：跑任务期间按设置里配的「默认宽/默认高」显示
    // （用户要的"保持横屏的视频节点默认状态"），跑完再跟随新视频比例。只改渲染、不动 node.size。
    loadingDefaultSize: true,
    in: VideoContent,
    segments: {
      'out:top': VideoTopToolbar,
      // 裁剪浮层画在**卡片外面**（over:inset 区域）：内容段住在 overflow:hidden 的裁剪层里，
      // 浮层挂那儿会被卡片边界切掉（用户实测报的「裁剪区域被节点切掉」）。
      'over:inset': VideoFrameOverlay,
    },
    create(position) {
      return service.addVideoNode(position)
    },
  })

  // 默认尺寸接设置面板：改完**实时**生效（没 resize 过的视频节点立刻跟着变）
  bindTypeDefaultSize(ctx, 'video', { w: 480, h: 320 }, { widthKey: 'videoDefaultWidth', heightKey: 'videoDefaultHeight' })

  // —— 命令：界面按钮与命令走**同一批实现**（cropVideo / clipVideo / captureFrameNode …）——
  //   按钮是"组件自己调实现"，命令是"外部（快捷键/右键菜单/MCP）按 id 调"，两条路不各写一遍。
  //   payload 约定：{ nodeId: string }；上传额外给 file（不给则开系统选文件框）；
  //   裁剪确认额外给 rect（视频像素矩形）。
  const ops = createVideoOps(ctx)

  ctx.commands.register({
    id: 'video.upload',
    title: '上传视频',
    run: async (_c, payload) => {
      const { nodeId, file } = (payload ?? {}) as { nodeId?: string; file?: Blob }
      if (!nodeId) return false
      return uploadVideo(ops, nodeId, file)
    },
  })
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
