/**
 * plugin-node-video —— video 节点插件（照 plugin-node-image 的写法：对象插件 + Service 子类上架服务）。
 *
 * 对照 v1 packages/canvas-core/src/nodes/Video/（VideoNode.vue + VideoNodePlugin.ts + videoNodeUtils.ts）：
 * - 播放 UI 自己画（不用原生 controls），进度/时间/截图/下载/全屏都在节点上；
 * - 裁剪与剪辑优先**真换文件**：后台 ffmpeg 插件（server/plugin-video-crop.js）重新编码，
 *   产物装进新建的下游节点 + 连线，原节点不动；后台不可用才回落元数据式（记框 / 记区间）；
 * - 截图产出一个新的 image 节点（"从视频里取一张图继续用"）；
 * - 取帧、尺寸适配、范围收敛等纯逻辑全部抽成可单测的函数（videoCrop / videoClip / videoFit / videoNodeData）。
 *
 * 与 v1 的架构差异（v2 分层，别按老写法抄）：
 * - v1 靠 data._overlay._cropMode 记"正在裁剪"（要宿主手动 strip 才不落盘）；v2 用**会话态**
 *   （videoSession），刷新后不会复活、也不占撤销栈；
 * - v1 的命令直接改 VueFlow 节点（vf.updateNode）；v2 一律走内核 graph 唯一写入口（自动进历史 + 落盘）；
 * - v1 的"裁剪/剪辑确认后新建节点"在 v2 恢复为**新建下游节点 + 连线**（用户口径 2026-10-30）：
 *   原视频留着做对比；原地换地址还会让底栏按 URL 缓存的缩略图停在旧画面。
 *
 * 依赖方向：只依赖内核(canvas-base/canvas-data) + 渲染层(canvas-render) + 默认皮的通用按钮，
 * 不反向依赖宿主/其它节点插件。
 */
import {
  Service, type Context, type ConfigSchema, type PluginModule, bindTypeDefaultSize,
  DEFAULT_VIDEO_CARD_LIMITS, VIDEO_CARD_LIMIT_KEYS, isMediaCardLimitKey,
} from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import { videoThumbTierFields, videoThumbTierKeys } from './videoThumbTier'
import { videoTitleExtra, videoAspectRatio } from './videoOps'
import { followedVideoCardSizePatch, readVideoFitLimits } from './videoFit'
import { MIN_CLIP_DURATION } from './videoClip'
import VideoContent from './VideoContent.vue'
import VideoPreview from './VideoPreview.vue'
import VideoFullscreenOverlay from './VideoFullscreenOverlay.vue'
import VideoTopToolbar from './VideoTopToolbar.vue'
import VideoClipPanel from './VideoClipPanel.vue'
import VideoFrameOverlay from './VideoFrameOverlay.vue'
import { publishToolActions } from '@mini-canvas/plugin-bottom-bar'
import { beginOverlay, endOverlay, isClipPending, onOverlayModeChange, setClipPending, setCropPending } from './videoSession'
import { clearClipPrefs } from './videoClipStore'
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
import { cropNodeWithBackend } from './videoCropFlow'
import { clipNodeWithBackend } from './videoClipFlow'
import { videoToAudio } from './videoAudioFlow'
import { MEDIA_CREATOR_FIELD, type MediaKindCreator } from '@mini-canvas/canvas-render'
import { captureVideoThumb } from './videoThumbService'

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
  /**
   * 取一张「有意义的」视频缩略图（宽度上限、跳过纯色片头）。
   *
   * 用户口径 2026-10-28：底栏参考卡/标签要显示视频的小缩略图，但视频是流媒体，
   * 直接当 img src 用显示不出来。这里由视频插件自己解码取帧，外部只需拿 dataURL。
   * 第三轮口径：一张图管全部用途 —— 宽度上限 1080、保持原比例，卡片缩小显示、hover 放大显示。
   *
   * @param maxWidth 宽度上限（缺省 1080）；原视频更窄就按原宽
   * @returns dataURL；取不到（跨域/解码失败/无视频）返回 null
   */
  captureThumb(videoUrl: string, maxWidth?: number): Promise<string | null>
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

  /** 按持久引用建视频节点：节点里只有 resourceId（播放地址由内容组件 resolve） */
  addVideoNodeFromResource(position: { x: number; y: number }, resourceId: string): string {
    return this.doc().transaction('add-video-node', (tx) =>
      tx.createNode(VIDEO_NODE_TYPE, position, resourceId ? { resourceId } : {}),
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

  /** 取视频缩略图（宽度上限 1080、跳过纯色片头）—— 供底栏参考卡/标签/hover 使用 */
  async captureThumb(videoUrl: string, maxWidth?: number): Promise<string | null> {
    return captureVideoThumb(videoUrl, maxWidth ? { maxWidth } : {})
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
  // 与图片节点同一套「最短边 / 最长边」；不再保留两套宽/高上限。
  [VIDEO_CARD_LIMIT_KEYS.minShortSide]: {
    type: 'number', default: DEFAULT_VIDEO_CARD_LIMITS.minShortSide, min: 40, max: 2000, step: 10,
    label: '最短边最小', group: '布局/视频节点尺寸',
    description: '视频节点卡片最短的一条边至少这么长（px）。小视频会等比放大，细长视频按这条算。',
  },
  [VIDEO_CARD_LIMIT_KEYS.maxLongSide]: {
    type: 'number', default: DEFAULT_VIDEO_CARD_LIMITS.maxLongSide, min: 120, max: 4000, step: 10,
    label: '最长边最大', group: '布局/视频节点尺寸',
    description: '视频节点卡片最长的一条边最多这么长（px）。特别细长的视频会超过它，以最短边为准。',
  },
  videoMinClipDuration: {
    type: 'number', default: 1, min: 0.1, max: 10, step: 0.1,
    label: '剪辑最短时长', group: '节点/视频剪辑',
    description: '拖动剪辑端点时至少要保留的秒数。设得太小会因为一帧的误差而几乎剪掉整段。',
  },
  videoClipSnapStep: {
    type: 'number', default: 0.1, min: 0.01, max: 10, step: 0.01,
    label: '吸附间隔', group: '节点/视频剪辑',
    description: '剪辑胶片条上磁吸的对齐间隔（秒）。磁吸只在拖拽接近对齐点时生效，平时跟手。',
  },
  videoClipSnapRadius: {
    type: 'number', default: 0.12, min: 0.01, max: 5, step: 0.01,
    label: '吸附范围', group: '节点/视频剪辑',
    description: '距离对齐点多近才吸上去（秒）。不能超过吸附间隔的一半，超出会被自动收回。',
  },
  videoClipLoop: {
    type: 'boolean', default: false,
    label: '区间循环', group: '节点/视频剪辑',
    description: '剪辑确认后只在保留区间内循环播放（预览新剪辑效果用）。',
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
 * 连接约束：输入口收文本、音频、图片、视频（生成时的参考素材），输出口产 video。
 * 不声明 capacity = 不限条数（视频节点可以接多个上游素材）。
 * 卡片边框：保留外壳默认的 1px 边框（2026-10-12 与图片节点同一条口径）——
 * 空视频 + 白底画面与画布背景糊在一起时，边框是唯一能看出节点边界的东西。
 */
export function apply(ctx: Context) {
  // 上控制栏注册进 nodeToolbar 的「默认模式」（用户口径 2026-10-29 重构）：
  // 与裁剪/扩展等模式共用同一条解析链路，节点类型不再声明 out:top 段。
  // 不 import 主题/底栏插件 —— 跨插件只认服务名。
  const registerToolbar = (): boolean => {
    const svc = ctx.tryGet<{
      registerMode?(mode: unknown): void
    } | undefined>('nodeToolbar')
    if (!svc?.registerMode) return false
    svc.registerMode({
      id: 'default',
      types: ['video'],
      title: '视频默认状态栏',
      topBar: VideoTopToolbar,
      order: 100,
    })
    // 用户口径 2026-10-29：裁剪会话接管顶栏（确认/取消/比例都在顶栏），底栏整格不显示
    // （bottomBar: null）—— 与图片节点的 image/crop 同一条写法（文档案例 9 的方式 C）。
    svc.registerMode({ id: 'video/crop', types: ['video'], title: '裁剪视频画面', bottomBar: null })
    // 剪辑会话接管底栏：底栏整格换成 VideoClipPanel（胶片条）；顶栏沿用默认模式（'default'），
    // 选中/关闭按钮还在 —— 用户不再需要"先去底栏下拉里找剪辑"。
    svc.registerMode({
      id: 'video/clip',
      types: ['video'],
      title: '剪辑视频时长',
      topBar: 'default',
      bottomBar: VideoClipPanel,
      order: 100,
    })
    return true
  }
  if (!registerToolbar()) {
    const off = ctx.on('ctx:plugin-installed', () => {
      if (registerToolbar()) off.dispose()
    })
  }

  // 1.5 裁剪会话 ↔ 状态栏模式自动同步（与图片插件的 onEditModeChange 同一条写法）：
  //     进裁剪 → nodeToolbar 切到 video/crop 模式（底栏消失、顶栏保持）；确认/取消 → 退出模式。
  //     监听放在这里而不是 videoSession 内部：那份是纯状态，只负责「记着自己正在编辑」。
  const offOverlayMode = onOverlayModeChange((nodeId, mode) => {
    const svc = ctx.tryGet<{
      enter?(nodeId: string, modeId: string): void
      exit?(nodeId: string): void
    } | undefined>('nodeToolbar')
    if (!svc) return
    if (mode === 'crop') svc.enter?.(nodeId, 'video/crop')
    else if (mode === 'clip') svc.enter?.(nodeId, 'video/clip')
    else svc.exit?.(nodeId)
  })
  ctx.effect(() => () => offOverlayMode())

  const service = new VideoService(ctx)

  // 媒体创建器：别的插件要“放一段视频”时经 media 能力路由到这里，
  // 由视频插件自己写标准字段（resourceId），调用方不需要知道 video 服务。
  ctx.registryOf<MediaKindCreator>(MEDIA_CREATOR_FIELD).add(
    'video',
    {
      addNode: (request) =>
        service.addVideoNodeFromResource(request.position, request.resourceId),
      applyToNode: (request) => {
        const doc = ctx.get('doc')
        const node = doc.getNode(request.nodeId)
        if (!node || node.type !== 'video') return false
        doc.updateNode(request.nodeId, { data: { resourceId: request.resourceId } })
        return true
      },
    },
    { id: 'node-video' },
  )

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
    // 剪辑不再注册成底栏「动作」：它现在是 video/clip 模式，底栏整格换成胶片条。
    // 从前注册成动作时，面板动作会被写进 data.barValues，退出剪辑后底栏按"上次的动作"
    // 又把它选回来 → 立刻重新进入剪辑，用户永远退不出去（实测会形成循环）。
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
    // 数据契约：对外产出一段视频；节点数据只保存持久资源引用 resourceId。
    produces: { video: { kind: 'video', refField: 'resourceId' } },
    icon: NODE_ICON,
    // 标题右侧显示画面分辨率（1280×720；裁过就是裁框尺寸）——派生值按 data 现算，不写进 data。
    titleExtra: videoTitleExtra,
    // 等比例拖拽用画面/裁框比例（videoOps.videoAspectRatio）；拿不到时壳退回卡片比例。
    resizeRatio: videoAspectRatio,
    // 尺寸与 v1 NODE_SIZES.video 同：一点元数据都读不到时的兜底
    size: { w: 480, h: 320 },
    inputs: [{ port: 'target', acceptsTypes: ['text', 'audio', 'image', 'video'] }],
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

  // 最短边 / 最长边一改，画布上**已有**的视频节点也按新规则重算（用户要的实时效果）。
  // 视频节点没有拖拽 resize，卡片尺寸一直由画面比例决定，所以这里可以安全地整体重算。
  // 优先走 updateNodeRuntime：落盘但不占撤销栈 —— 改设置不该让用户按 Ctrl+Z 撤销。
  const settingsForFit = ctx.tryGet<{
    onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
  }>('settings')
  const offVideoFit = settingsForFit?.onChange((key) => {
    if (!isMediaCardLimitKey(key, VIDEO_CARD_LIMIT_KEYS)) return
    const doc = ctx.tryGet<{
      getNodes(): Array<{ id: string; type: string; data?: Record<string, unknown> }>
      updateNodeRuntime?(id: string, patch: { size: { w: number; h: number } }): void
      updateNode?(id: string, patch: { size: { w: number; h: number } }): void
    }>('doc')
    if (!doc) return
    const limits = readVideoFitLimits(ctx)
    for (const node of doc.getNodes()) {
      if (node.type !== VIDEO_NODE_TYPE) continue
      const patch = followedVideoCardSizePatch(node.data, limits)
      if (!patch) continue
      if (doc.updateNodeRuntime) doc.updateNodeRuntime(node.id, { size: patch.size })
      else doc.updateNode?.(node.id, { size: patch.size })
    }
  })
  if (offVideoFit) ctx.effect(() => () => offVideoFit.dispose())

  // —— 命令：界面按钮与命令走**同一批实现**（cropVideo / clipVideo / captureFrameNode …）——
  //   按钮是"组件自己调实现"，命令是"外部（快捷键/右键菜单/MCP）按 id 调"，两条路不各写一遍。
  //   payload 约定：{ nodeId: string }；上传额外给 file（不给则开系统选文件框）；
  //   裁剪确认额外给 rect（视频像素矩形）。
  const ops = createVideoOps(ctx)

  ctx.commands.register({
    id: 'video:upload',
    title: '上传视频',
    run: async (_c, payload) => {
      const { nodeId, file } = (payload ?? {}) as { nodeId?: string; file?: Blob }
      if (!nodeId) return false
      return uploadVideo(ops, nodeId, file)
    },
  })

  ctx.commands.register({
    id: 'video:crop',
    title: '裁剪视频画面',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      beginOverlay(nodeId, 'crop')
      return true
    },
  })
  ctx.commands.register({
    id: 'video:crop-confirm',
    title: '确认裁剪',
    run: async (_c, payload) => {
      const { nodeId, rect } = (payload ?? {}) as { nodeId?: string; rect?: Rect }
      if (!nodeId || !rect) return false
      // 真裁剪优先：后台 ffmpeg 把画面按框重新编码成新文件，节点指向新文件。
      // 后台不可用（没装插件 / 外链源 / 转码失败）→ 回落取景式，行为与从前一致。
      // 转码期间置「处理中」：顶栏按钮禁用，防止连点重复提交同名槽位。
      setCropPending(nodeId, true)
      beginOverlay(nodeId, 'crop')
      let real: boolean | null = null
      try {
        real = await cropNodeWithBackend(ctx, ops, nodeId, rect)
      } finally {
        setCropPending(nodeId, false)
      }
      // 无论成败都退出覆盖层：失败时留在裁剪态会让用户以为"点了没反应"
      endOverlay(nodeId)
      if (real !== null) return real
      return cropVideo(ops, nodeId, rect)
    },
  })
  ctx.commands.register({
    id: 'video:crop-cancel',
    title: '取消裁剪',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      endOverlay(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'video:reset-crop',
    title: '恢复整幅画面',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return resetCrop(ops, nodeId)
    },
  })
  ctx.commands.register({
    id: 'video:clip',
    title: '剪辑视频',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      beginOverlay(nodeId, 'clip')
      return true
    },
  })
  ctx.commands.register({
    id: 'video:clip-confirm',
    title: '确认剪辑',
    run: async (_c, payload) => {
      const { nodeId, start, end } = (payload ?? {}) as { nodeId?: string; start?: number; end?: number }
      if (!nodeId || typeof start !== 'number' || typeof end !== 'number') return false
      // 真剪辑优先：后台 ffmpeg 把这一段重新编码成新文件，再建下游节点 + 连线。
      // 后台不可用（没装插件 / 外链源 / 转码失败）→ 回落元数据式，行为与从前一致。
      setClipPending(nodeId, true)
      let real: boolean | null = null
      try {
        real = await clipNodeWithBackend(ctx, ops, nodeId, start, end)
      } finally {
        setClipPending(nodeId, false)
      }
      endOverlay(nodeId)
      if (real !== null) return real
      return clipVideo(ops, nodeId, start, end, MIN_CLIP_DURATION)
    },
  })
  ctx.commands.register({
    id: 'video:clip-cancel',
    title: '取消剪辑',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      endOverlay(nodeId)
      return true
    },
  })
  ctx.commands.register({
    id: 'video:reset-clip',
    title: '恢复整段时长',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return resetClip(ops, nodeId)
    },
  })
  ctx.commands.register({
    id: 'video:capture-frame',
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
    id: 'video:download',
    title: '下载视频',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return downloadVideoNode(ops, nodeId)
    },
  })
  ctx.commands.register({
    id: 'video:to-audio',
    title: '视频转音频',
    run: async (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      // 真转：后台 ffmpeg 抽音轨成 mp3，新建一个音频节点 + 连线（与裁剪/剪辑同一条顺序）
      return (await videoToAudio(ctx, nodeId)) === true
    },
  })
}

/** 兼容旧装配的 PluginModule 出口（name='video' 供 HMR reload） */
export const nodeVideoPlugin: PluginModule = { name, inject, Config, apply }
