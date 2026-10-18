/**
 * nodeAudioPlugin —— audio 节点插件（照 plugin-node-video / plugin-node-image 的写法：
 * 对象插件 + Service 子类上架服务 + ctx.nodes.register 一次注册数据与 UI）。
 *
 * 为什么从 plugin-web2api-tools 里搬出来：那是「接 web2api 平台能力」的插件，音频节点是**画布
 * 上的一种节点类型**，两者生命周期与归属都不同 —— 一个音频节点应该能在没装 web2api 的宿主里
 * 存在（上传本地音频、听一段生成的语音）。搬出来后 web2api 只留「生成动作 + 结果写入器」。
 *
 * 分层（为什么这么切）：
 * - waveform.ts      纯数据：采样 → 定长峰值数组 → 百分比（可单测）；
 * - audioPlayback.ts 纯逻辑：进度/时间/指针换算（可单测）；
 * - audioTransform.ts 浏览器端口：解码音频 / 选文件 / 下载（唯一碰 Web Audio 与 DOM 的地方）；
 * - audioOps.ts     载入一条路：解码一次 → 波形与时长一起写回（界面按钮与命令共用同一实现）；
 * - 本文件           接线：注册节点类型 + 服务 + 命令（唯一碰 ctx 的地方）；
 * - AudioContent.vue 内容段：装配 AudioWavePlayer（波形/播放），管节点特有（设置/元数据/刷新）；
 * - AudioTopToolbar.vue 上控制栏（out:top）：上传入口。与图片/视频节点同一条规矩 ——
 *   卡片里只显示素材与空态，**放素材的按钮固定在上控制栏**（用户口径 2026-10-14）。
 *
 * 依赖方向：只依赖 canvas-base / canvas-data / canvas-render / kernel。
 * 不 import plugin-theme-default（设计系统按钮走 ui 目录按名取，见 T08 守卫）。
 */
import { Service, type Context, type ConfigSchema, type PluginModule, bindTypeDefaultSize } from '@mini-canvas/canvas-base'
import type { DocService } from '@mini-canvas/canvas-data'
import AudioPreview from './AudioPreview.vue'
import AudioContent from './AudioContent.vue'
import AudioTopToolbar from './AudioTopToolbar.vue'
import { createAudioOps, downloadAudioNode, reanalyzeAudio, uploadAudio } from './audioOps'
import { MEDIA_CREATOR_FIELD, type MediaKindCreator } from '@mini-canvas/canvas-render'

/** 节点类型名：web2api 的动作（types: ['audio']）与写入器（kind: 'audio'）都按它对齐 */
export const AUDIO_NODE_TYPE = 'audio'

/**
 * 音频节点服务（其它插件/宿主经 ctx.get('audio') 用）。
 * 只给"建节点"这一个入口 —— 载入音频/写波形与时长都走 `doc.updateNode`，不必再包一层。
 */
export interface AudioNodeService {
  /** 放一个音频节点；audioUrl 可给初始音频（URL / dataURL / objectURL），不给则显示占位 */
  addAudioNode(position: { x: number; y: number }, audioUrl?: string): string
  /** 放一个由持久资源引用承载的音频节点（只写 resourceId，不写播放地址） */
  addAudioNodeFromResource(position: { x: number; y: number }, resourceId: string): string
}

/** 类型增强缝（cordis 声明合并）：宿主/作者 ctx.audio 直访时类型为本服务 */
declare module '@mini-canvas/canvas-data' {
  interface Context {
    audio: AudioNodeService
  }
}

/** audio 服务：构造即上架 'audio'，方法经 this.ctx.get 惰性取现时服务（不缓存） */
export class AudioService extends Service implements AudioNodeService {
  constructor(ctx: Context) {
    super(ctx, 'audio')
  }

  addAudioNode(position: { x: number; y: number }, audioUrl = ''): string {
    const doc = this.ctx.get<DocService>('doc')
    return doc.transaction('add-audio-node', (tx) =>
      tx.createNode(AUDIO_NODE_TYPE, position, audioUrl ? { audioUrl } : {}),
    )
  }

  /** 按持久引用建音频节点：节点里只有 resourceId（播放地址由内容组件 resolve） */
  addAudioNodeFromResource(position: { x: number; y: number }, resourceId: string): string {
    const doc = this.ctx.get<DocService>('doc')
    return doc.transaction('add-audio-node', (tx) =>
      tx.createNode(AUDIO_NODE_TYPE, position, resourceId ? { resourceId } : {}),
    )
  }
}

export const name = 'audio'
export const inject = ['doc'] as string[]

/** 节点类型图标（标题左侧与右键"新建节点"共用；opaque SVG 句柄，与其它节点类型同写法） */
const AUDIO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4"/><path d="M7 6v12"/><path d="M11 3v18"/><path d="M15 7v10"/><path d="M19 10v4"/></svg>'

/**
 * 本插件可配置项（cordis P4：模块级 Config）。
 *
 * 键名一律带本包前缀 audio…：内核 settings 是**全局同一张表、先声明者独占**，
 * 叫 maxBuckets 这种通用名会和其他插件抢同一个键（撞名会被静默跳过）。
 * 分组沿用项目既有一级分类（布局 / 常规 / 节点 / 边），不新立无主分类。
 */
export const Config: ConfigSchema = {
  audioDefaultWidth: {
    type: 'number', default: 320, min: 80, max: 2000, step: 10,
    label: '默认宽', group: '节点/音频节点',
    description: '音频节点没有自己的尺寸时用的宽度（px）。改完立即生效：没被手动拖过尺寸的音频节点会立刻跟着变。',
  },
  audioDefaultHeight: {
    type: 'number', default: 120, min: 60, max: 2000, step: 10,
    label: '默认高', group: '节点/音频节点',
    description: '音频节点没有自己的尺寸时用的高度（px）。改完立即生效（同上）。',
  },
  audioWaveHeight: {
    type: 'number', default: 28, min: 16, max: 120, step: 2,
    label: '波形最低高度', group: '节点/音频节点',
    description: '波形区的最低高度（px）。它默认撑满卡片剩余空间；只有卡片被压得很矮时才由这个下限兜底。',
  },
  audioBarMinWidth: {
    type: 'number', default: 2, min: 1, max: 8, step: 1,
    label: '波形竖条粗细', group: '节点/音频节点',
    description: '每根波形竖条的宽度（px）。条越细越省渲染，但太细在小尺寸卡片上会糊成一片。',
  },
}

/**
 * 插件主体：上架 'audio' 服务 + 注册 'audio' 节点类型 + 三条命令。
 *
 * 连接约束沿用 web2api 那份声明：输入口收 text（提示词/文稿）与 audio（音频）——
 * 音频节点是"生成语音"的落点，上游常是文本；也允许音频进音频（转存/接力）。
 * resizable: false（用户指定）—— 音频是"一条波形 + 一行控件"，拉大拉小都不会多出信息，
 * 反而会让波形竖条被拉伸变形、把一排按钮顶得七零八落；固定尺寸 320×120 在所有节点上一致，
 * 一屏能放下更多。要改整体大小请改这里的 size，不给用户一个按不住的手柄。
 */
export function apply(ctx: Context) {
  const service = new AudioService(ctx)
  const ops = createAudioOps(ctx)

  // 媒体创建器：别的插件要“放一段音频”时经 media 能力路由到这里，
  // 由音频插件自己写标准字段（resourceId），调用方不需要知道 audio 服务。
  ctx.registryOf<MediaKindCreator>(MEDIA_CREATOR_FIELD).add(
    'audio',
    {
      addNode: (request) =>
        service.addAudioNodeFromResource(request.position, request.resourceId),
      applyToNode: (request) => {
        const doc = ctx.get('doc')
        const node = doc.getNode(request.nodeId)
        if (!node || node.type !== 'audio') return false
        doc.updateNode(request.nodeId, { data: { resourceId: request.resourceId } })
        return true
      },
    },
    { id: 'node-audio' },
  )

  // 音频**预览**注册件：波形与进度条来自 AudioWavePlayer（与 AudioContent 共用同一套实现），
  // 这里只补预览壳（底部播放/时间/大小/文件名）。登记进 ui 目录，任何宿主按名取用。
  ctx.registryOf<unknown>('ui').add('audioPreview', AudioPreview, { id: 'node-audio' })

  ctx.nodes.register({
    type: AUDIO_NODE_TYPE,
    label: '音频',
    nameTemplate: '音频 {{ID}}',
    description: '在画布中添加一个音频节点（语音合成 / 音频生成）',
    // 数据契约：对外产出一段音频；节点数据只保存持久资源引用 resourceId。
    produces: { audio: { kind: 'audio', refField: 'resourceId' } },
    icon: AUDIO_ICON,
    size: { w: 320, h: 120 },
    inputs: [{ port: 'target', acceptsTypes: ['text', 'audio'] }],
    outputs: [{ port: 'source', contentType: 'audio' }],
    // 不支持拖拽改尺寸：波形是定长内容，拉伸只会变形（用户明确要求）
    resizable: false,
    in: AudioContent,
    segments: {
      'out:top': AudioTopToolbar,
    },
    create(position) {
      return service.addAudioNode(position)
    },
  })

  // 默认尺寸接设置面板：改完**实时**生效（没 resize 过的音频节点立刻跟着变）
  bindTypeDefaultSize(ctx, 'audio', { w: 320, h: 120 }, { widthKey: 'audioDefaultWidth', heightKey: 'audioDefaultHeight' })

  // —— 命令：界面按钮与命令走**同一批实现**（uploadAudio / downloadAudioNode / reanalyzeAudio）——
  //   按钮是"组件自己调实现"，命令是"外部（快捷键/右键菜单/MCP）按 id 调"，两条路不各写一遍。
  //   payload 约定：{ nodeId: string }（节点级操作）；上传额外给 file（不给则开系统选文件框）。
  ctx.commands.register({
    id: 'audio.upload',
    title: '上传音频',
    run: async (_c, payload) => {
      const { nodeId, file } = (payload ?? {}) as { nodeId?: string; file?: Blob }
      if (!nodeId) return false
      return uploadAudio(ops, nodeId, file)
    },
  })
  ctx.commands.register({
    id: 'audio.download',
    title: '下载音频',
    run: (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return downloadAudioNode(ops, nodeId)
    },
  })
  ctx.commands.register({
    id: 'audio.reanalyze',
    title: '刷新波形与时长',
    run: async (_c, payload) => {
      const { nodeId } = (payload ?? {}) as { nodeId?: string }
      if (!nodeId) return false
      return reanalyzeAudio(ops, nodeId)
    },
  })
}

/** 兼容装配清单的 PluginModule 出口（name='audio' 供 HMR reload） */
export const nodeAudioPlugin: PluginModule = { name, inject, Config, apply }
