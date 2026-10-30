/**
 * plugin-file-drop —— 文件拖入 & 粘贴插件（v2 复刻老版 canvas-core/src/plugins/file-drop）。
 *
 * 数据流（v2 铁律：只经内核服务读写，不碰 VueFlow/宿主内部；建节点原子进 history 一次撤销）：
 * - 拖文件到画布 / 粘贴图片、视频或文本 → 读 File → **媒体先落资源库、节点写解析出来的地址**
 *   （见 addFiles 的说明）、文本读成 data.text → 在 drop/粘贴位置建对应节点。
 *
 * 边界：
 * - 建 image / video / text 三类节点；未知文件归 unsupported（忽略 + console.warn）。
 * - 媒体字节经宿主 resources 落库（本地 IndexedDB / 云端画布文件夹），节点里写的是
 *   **持久可取的地址**（云端同源 URL / 本地资源库地址）—— 不是 objectURL。
 *   objectURL 只在**没有资源库服务**的极简宿主里兜底（那种环境下节点数据本就只在本次会话有效）。
 * - 建节点前检测 nodeStore.types 是否注册了对应类型（node-image / node-video / node-text 装配才有）；
 *   缺类型则该文件类别跳过（console.warn）——插件可与节点插件独立装配，不硬耦合（masterplan 铁律 8）。
 *
 * 事件挂载：window 级 dragover/drop 监听，ctx.effect 绑定 → 随插件 scope 自动回收；
 * 浏览器环境守卫(typeof window !== 'undefined')，node 测试/装配安全跳过。
 * 坐标：drop/paste 的 clientX/Y 经 ctx.get('viewport').screenToFlow 转 flow 坐标作节点 position
 * （对齐老版"放到鼠标处"）；无 viewport 服务/无鼠标锚点退级联默认。
 * 粘贴：不再自绑 window paste（宿主 keydown 对 mod+v preventDefault 会掐掉原生 paste）。
 * 改为向宿主统一仲裁场 registryOf('clipboard/paste') 注册处理器，按 order 抢这次粘贴
 * （媒体 20 > 纯文本 30；若剪贴板带"来自画布"标记则让位给 clipboard 插件）。
 */
import {
  Service, type Context, type PluginModule,
  DEFAULT_IMAGE_CARD_LIMITS, DEFAULT_VIDEO_CARD_LIMITS,
  IMAGE_CARD_LIMIT_KEYS, VIDEO_CARD_LIMIT_KEYS, readMediaCardLimits,
} from '@mini-canvas/canvas-base'
import type { DocService, SelectionService, ResourceService } from '@mini-canvas/canvas-data'
import {
  CLIPBOARD_PASTE_KIND,
  CLIPBOARD_PASTE_KEY,
  hasCanvasClipboardMarker,
  type ClipboardPasteHandler,
  type ClipboardPastePayload,
} from '@mini-canvas/canvas-data'
import {
  classifyFile,
  clampText,
  spreadPositions,
  buildImagePayload,
  buildVideoPayload,
  buildAudioPayload,
  buildTextPayload,
  buildPastedTextPayload,
  MAX_TEXT_LENGTH,
  type FileKind,
  type ImageDims,
  type NodePayload,
} from './fileDropEngine'

/** 插件可配置项（老版 FileDropOptions 对应子集） */
export interface FileDropOptions extends Record<string, unknown> {
  /** 是否启用拖放文件到画布（缺省 true） */
  enableDragDrop?: boolean
  /** 是否启用粘贴图片/文本到画布（缺省 true） */
  enablePaste?: boolean
}

/** file-drop 对外服务形状（其它插件/UI 程序化触发拖入/粘贴；形状与老版行为对齐） */
export interface FileDropService {
  /** 处理一批拖入/粘贴的 File（图片/视频/文本），在 flow 坐标处建节点；返回实际创建数。 */
  addFiles(files: File[], atFlow: { x: number; y: number } | null): Promise<number>
  /** 粘贴纯文本 → 文本节点（客户端直接给字符串的入口） */
  addPastedText(text: string, atFlow: { x: number; y: number } | null): string | null
  /** 判断文件是否可处理（image/video/text，且对应节点类型已注册） */
  canHandle(file: { name: string; type: string }): boolean
}

declare module '@mini-canvas/canvas-data' {
  interface Context {
    fileDrop: FileDropService
  }
}

export const name = 'file-drop'
export const inject = ['doc', 'selection'] as string[]

/** 可编辑输入框内不响应粘贴/拖放（对齐宿主 CanvasHost 与 clipboard 同规则） */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return Boolean(t.closest('input, textarea, select, [contenteditable="true"]'))
}

/**
 * 读 File 为文本。
 *
 * 优先用 `Blob.text()`（现代浏览器都有，node 也有）而不是老版的 FileReader：
 * 这条路径没有回调、异常直接冒泡，也不必依赖浏览器专有构造函数 ——
 * 于是"读文本"这件纯数据的事在无头环境里也能真跑一遍（装配测试因此能覆盖它）。
 * 老环境缺 .text() 时回落 FileReader，行为对用户完全一致。
 */
function readAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取失败: ${file.name}`))
    reader.readAsText(file)
  })
}

/** 浏览器环境：读图片真实宽高（老版 getImageDims 同款；失败返回 null → 默认卡片尺寸） */
function readImageDims(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

/**
 * 浏览器环境：读视频元数据（宽/高/时长）。
 *
 * 为什么不复用图片那套 `new Image()`：视频没有 naturalWidth，必须用 `<video>` 元素并等
 * loadedmetadata —— 只有那个事件保证 videoWidth / videoHeight / duration 可用。
 * 读不到（格式不被支持 / 解码失败）返回 null，调用方退回默认卡片尺寸，绝不猜一个数字。
 */
function readVideoMeta(blob: Blob): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const finish = (value: VideoMeta | null): void => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null)
        return
      }
      finish({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
      })
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}

/** 浏览器专属 IO 的依赖注入点：生产用真实实现；node 单测注入假实现（不触碰 DOM/FileReader/Image） */
export interface FileDropReaders {
  /** 读 File 文本内容 */
  readText(file: File): Promise<string>
  /** 读图片真实宽高；失败返回 null → 默认卡片尺寸 */
  readImageDims(blob: Blob): Promise<ImageDims | null>
  /** 读视频元数据（宽/高/时长）；失败返回 null → 默认卡片尺寸 */
  readVideoMeta(blob: Blob): Promise<VideoMeta | null>
  /** 生成图片 objectURL（node 无此 API，测试注入 mock） */
  createObjectURL(blob: Blob): string
}

/** 视频元数据（宽高 + 时长秒） */
export interface VideoMeta {
  width: number
  height: number
  duration: number
}

/** 默认浏览器实现（生产）；File 来自 FileReader / Image / URL.createObjectURL */
const defaultReaders: FileDropReaders = {
  readText: (f) => readAsText(f),
  readImageDims: (b) => readImageDims(b),
  readVideoMeta: (b) => readVideoMeta(b),
  createObjectURL: (b) => URL.createObjectURL(b),
}

export class FileDropServiceImpl extends Service implements FileDropService {
  /** 最近一次画布内鼠标位置（屏幕坐标；供粘贴锚点） */
  private lastClient: { x: number; y: number } | null = null
  /** 浏览器 IO（可注入：node 测试用假实现） */
  private readers: FileDropReaders

  constructor(ctx: Context, readers: FileDropReaders = defaultReaders) {
    super(ctx, 'file-drop')
    this.readers = readers
  }

 private get selection(): SelectionService {
   return this.ctx.get('selection')
 }
  private get doc(): DocService {
    return this.ctx.get('doc')
}
  private get viewport() {
    return this.ctx.tryGet('viewport') ?? undefined
  }

  /** 类型是否已注册（node-image / node-video / node-text 插件装配才 true；缺则跳过该类文件） */
  private typeRegistered(type: 'image' | 'video' | 'audio' | 'text'): boolean {
    return this.doc.types.has(type)
  }

  canHandle(file: { name: string; type: string }): boolean {
    const kind = classifyFile(file)
    if (kind === 'unsupported') return false
    return this.typeRegistered(kind)
  }

  /** 记录最近鼠标（供粘贴锚点；由 apply 里 window pointermove 喂入） */
  trackClientPoint(x: number, y: number): void {
    this.lastClient = { x, y }
  }

  /** client 屏幕坐标 → flow 坐标；无 viewport 服务/无坐标返回 null（调用方退级联默认） */
  toFlow(client: { x: number; y: number } | null): { x: number; y: number } | null {
    if (!client) return null
    const vp = this.viewport
    if (!vp) return null
    return vp.screenToFlow(client.x, client.y)
  }

  /** 最近鼠标锚点；无则 null（addFiles 无锚点时用中心默认 200,200） */
  flowAnchor(): { x: number; y: number } | null {
    return this.toFlow(this.lastClient)
  }

  /**
   * 把字节存进宿主资源库，并拿回「当前可用的显示地址」。
   *
   * 两步缺一不可（用户 2026-10-13 报的 bug 就出在只做了前一步）：
   *   ① `put`    → 持久引用（写节点的 `resourceId`；本地是 `res-<n>`、云端就是那个 URL）；
   *   ② `resolve` → **显示地址**（写节点的 `imageUrl`/`videoUrl`/`audioUrl`）。
   * 只写 objectURL 的话，那个地址只在当前页面有效（刷新 / 换标签页 / 服务器都取不到）。
   *
   * @returns 拿得到地址 → `{ ref, url }`；没有资源库服务或解析不出 → `undefined`（调用方退 objectURL）
   */
  private async storeAndResolve(
    file: File,
    kind: 'image' | 'video' | 'audio',
  ): Promise<{ ref: string; url: string } | undefined> {
    const resources = this.ctx.tryGet<{
      put(b: Blob, o?: { kind?: string; name?: string }): Promise<string>
      resolve(ref: string): Promise<string | undefined>
    }>('resources')
    if (!resources) return undefined
    // 防御：宿主给的服务形状可能不全（老宿主 / 测试替身只有 put）——
    // 缺 resolve 时**退 objectURL**，而不是让整个文件处理抛错失败（用户文件不该因为
    // 服务端能力不全就被丢掉）。
    if (typeof resources.resolve !== 'function') return undefined
    const ref = await resources.put(file, { kind, name: file.name })
    const url = await resources.resolve(ref)
    // 解析不出地址（资源后端异常）→ 当没存过：调用方退 objectURL，至少本次会话能看
    return url ? { ref, url } : undefined
  }

  /** 建节点载荷批量写入（history 一次；选中新节点便于立刻拖动/删除） */
  private commitPayloads(payloads: NodePayload[], description: string): string[] {
   if (payloads.length === 0) return []
    // id 统一向内核要（自增数字）：插件不再自造 `fd-时间戳-序号` 这种形态。
    // 先拿号再写入 —— 拿号才能连边 / 选中，这也是必须暴露 nextNodeId 的原因。
    const ids = payloads.map(() => this.doc.nextNodeId())
    this.doc.transaction('file-drop-add', (tx) => {
      tx.addNodes(
        payloads.map((p, i) => ({
          id: ids[i],
          type: p.type,
          position: p.position,
          data: p.data,
          ...(p.size !== undefined ? { size: p.size } : {}),
        })),
      )
    })
   this.selection.set(ids)
    this.selection.clearEdges()
    return ids
  }

  /**
   * 处理一批文件（drop 或粘贴图片 File）。返回实际创建节点数。
   * 图片：读真实尺寸 → 建 image（带适配尺寸）；
   * 视频：读元数据（宽高时长）→ 建 video（带适配尺寸）；
   * 文本：读内容截断 → 建 text。
   * 未知/未注册类型：跳过并 console.warn（不崩、不半建）。
   *
   * ## 节点里写什么地址（用户 2026-10-13 报的 bug）
   *
   * **写资源库解析出来的地址，不写 objectURL**。
   *
   * 早先这里写的是 `URL.createObjectURL(file)` 的 `blob:` 地址 —— 它只在**当前这个浏览器页面**
   * 里有效：存到服务器后别的标签页/别人打不开、刷新后失效、云端生成任务时服务器也拿不到。
   * 用户的症状就是"拖/粘进来的图，刷新或换地方就没了"。
   *
   * 现在：`resources.put(file)` 把字节存进资源库（本地 IndexedDB / 云端画布文件夹）→
   * `resources.resolve(ref)` 拿回**当前可用地址**（云端是同源 URL、本地是资源库地址）→ 写进节点。
   * objectURL 只在**没有资源库服务**时兜底（极简宿主 / 单测）—— 那种情况下节点数据本来就只在
   * 本次会话有意义，写 objectURL 是唯一选择，不会更糟。
   */
  async addFiles(files: File[], atFlow: { x: number; y: number } | null): Promise<number> {
    const list = files.filter((f) => this.canHandle(f))
    if (list.length === 0) return 0
    const anchor = atFlow ?? this.flowAnchor() ?? { x: 200, y: 200 }
    const positions = spreadPositions(anchor, list.length)
    const payloads: NodePayload[] = []
    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      const kind = classifyFile(file)
      try {
        if (kind === 'image' && this.typeRegistered('image')) {
          const dims = await this.readers.readImageDims(file)
          // 先落字节、再拿地址（见方法头的说明）；拿不到就退 objectURL（无资源库的极简环境）
          const stored = await this.storeAndResolve(file, 'image')
          const url = stored?.url ?? this.readers.createObjectURL(file)
          const payload = buildImagePayload(
            file, url, positions[i], dims,
            readMediaCardLimits(this.ctx, IMAGE_CARD_LIMIT_KEYS, DEFAULT_IMAGE_CARD_LIMITS),
          )
          if (stored) payload.data.resourceId = stored.ref
          payloads.push(payload)
        } else if (kind === 'video' && this.typeRegistered('video')) {
          const meta = await this.readers.readVideoMeta(file)
          const stored = await this.storeAndResolve(file, 'video')
          const url = stored?.url ?? this.readers.createObjectURL(file)
          const payload = buildVideoPayload(
            file, url, positions[i], meta,
            readMediaCardLimits(this.ctx, VIDEO_CARD_LIMIT_KEYS, DEFAULT_VIDEO_CARD_LIMITS),
          )
          if (stored) payload.data.resourceId = stored.ref
          payloads.push(payload)
        } else if (kind === 'audio' && this.typeRegistered('audio')) {
          const stored = await this.storeAndResolve(file, 'audio')
          const url = stored?.url ?? this.readers.createObjectURL(file)
          const payload = buildAudioPayload(file, url, positions[i])
          if (stored) payload.data.resourceId = stored.ref
          // 音频波形/时长由节点内容组件按 audioUrl 自己分析，这里不需要额外元数据。
          payloads.push(payload)
        } else if (kind === 'text' && this.typeRegistered('text')) {
          const content = await this.readers.readText(file)
          payloads.push(buildTextPayload(file, clampText(content), positions[i]))
        }
      } catch (err) {
        console.warn(`[file-drop] 处理文件失败: ${file.name}`, err)
      }
    }
    if (payloads.length === 0) return 0
    this.commitPayloads(payloads, `拖入 ${payloads.length} 个文件`)
    return payloads.length
  }

  /** 粘贴纯文本 → 文本节点（返回节点 id 或 null） */
  addPastedText(text: string, atFlow: { x: number; y: number } | null): string | null {
    const trimmed = text.trim()
    if (!trimmed || !this.typeRegistered('text')) return null
    const anchor = atFlow ?? this.flowAnchor() ?? { x: 200, y: 200 }
    const payload = buildPastedTextPayload(clampText(trimmed), anchor)
    const ids = this.commitPayloads([payload], '粘贴文本')
    return ids[0] ?? null
  }

  // ===== 粘贴仲裁用的同步判定 / 异步落地（见 canvas-data/canvas/clipboardActions）=====

  /**
   * 剪贴板里有没有"能建节点"的图片/视频文件（同步判定，供粘贴仲裁当场认领）。
   *
   * 判据用**每个文件自己的 MIME/名字**，不是 clipboardData.types —— 真机实测：
   * 粘贴一张图片时 types 往往只有 ['Files']（不是 'image/png'），真实类型在 files 上。
   */
  claimsMediaPaste(files: readonly { name: string; type: string }[]): boolean {
    return files.some((f) => {
      const kind = classifyFile(f)
      return (kind === 'image' || kind === 'video') && this.typeRegistered(kind)
    })
  }

  /** 剪贴板里有没有可建文本节点的纯文本（同步判定） */
  claimsTextPaste(stringTypes: readonly string[]): boolean {
    if (!this.typeRegistered('text')) return false
    return stringTypes.some((t) => t === 'text/plain' || t === 'text/markdown' || t === 'text/x-markdown')
  }

  /** 从粘贴载荷里的图片/视频建立节点（异步；返回创建数量） */
  async pasteMedia(files: File[], atFlow: { x: number; y: number } | null): Promise<number> {
    const media = files.filter((f) => {
      const kind = classifyFile(f)
      return (kind === 'image' || kind === 'video') && this.typeRegistered(kind)
    })
    if (media.length === 0) return 0
    return this.addFiles(media, atFlow)
  }

  /** 从粘贴载荷里的纯文本建立文本节点（异步；返回是否创建） */
  async pasteTextAsync(
    payload: { readText(mime: string): Promise<string>; stringTypes: readonly string[] },
    atFlow: { x: number; y: number } | null,
  ): Promise<boolean> {
    const mime = payload.stringTypes.find((t) => t === 'text/plain')
      ?? payload.stringTypes.find((t) => t === 'text/markdown' || t === 'text/x-markdown')
    if (!mime) return false
    const text = await payload.readText(mime)
    return this.addPastedText(text, atFlow) !== null
  }
}

/**
 * 造 file-drop 的两条粘贴处理器（媒体 20 / 文本 30），供装配与测试共用一个事实源。
 *
 * 判据要点（真机实测）：
 * - 图片粘贴时 clipboardData.types 常只有 ['Files']，真实类型在 files 上 —— 故媒体判定看 files；
 * - 两条都**先看画布剪贴板标记**：若这次粘贴是"刚在画布上复制的节点"，让位给 clipboard 插件（order 10）。
 */
export function createFileDropPasteHandlers(
  svc: FileDropServiceImpl,
  pluginName = name,
): Array<{ key: string; handler: ClipboardPasteHandler; id: string; order: number }> {
  const mediaHandler: ClipboardPasteHandler = (payload: ClipboardPastePayload): boolean => {
    if (hasCanvasClipboardMarker(payload)) return false // 画布节点复制 → 让位
    if (!svc.claimsMediaPaste(payload.files)) return false
    void svc.pasteMedia(payload.files, svc.flowAnchor())
    return true
  }
  const textHandler: ClipboardPasteHandler = (payload: ClipboardPastePayload): boolean => {
    if (hasCanvasClipboardMarker(payload)) return false
    if (!svc.claimsTextPaste(payload.stringTypes)) return false
    void svc.pasteTextAsync(payload, svc.flowAnchor())
    return true
  }
  return [
    { key: CLIPBOARD_PASTE_KEY, handler: mediaHandler, id: pluginName + ':media', order: 20 },
    { key: CLIPBOARD_PASTE_KEY, handler: textHandler, id: pluginName + ':text', order: 30 },
  ]
}

/** 装配入口（cordis 形态） */
export function apply(ctx: Context, options: FileDropOptions = {}): void {
  const opts = { enableDragDrop: true, enablePaste: true, ...options }
  const svc = new FileDropServiceImpl(ctx)

  // 追踪画布鼠标位置（粘贴锚点）：只在浏览器环境绑 window pointermove；ctx.effect 自动回收。
  ctx.effect(() => {
    if (typeof window === 'undefined') return
    function onPointerMove(e: PointerEvent): void {
      if (isEditableTarget(e.target)) return
      const el = e.target as HTMLElement | null
      if (!el || !el.closest('.vue-flow')) return
      svc.trackClientPoint(e.clientX, e.clientY)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  })

  if (opts.enableDragDrop) {
    ctx.effect(() => {
      if (typeof window === 'undefined') return
      function onDragOver(e: DragEvent): void {
        if (isEditableTarget(e.target)) return
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      }
      async function onDrop(e: DragEvent): Promise<void> {
        if (isEditableTarget(e.target)) return
        const files = e.dataTransfer?.files
        if (!files || files.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        const flow = svc.toFlow({ x: e.clientX, y: e.clientY }) ?? { x: e.clientX, y: e.clientY }
        await svc.addFiles(Array.from(files), flow)
      }
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('drop', onDrop)
      return () => {
        window.removeEventListener('dragover', onDragOver)
        window.removeEventListener('drop', onDrop)
      }
    })
  }

  if (opts.enablePaste) {
    // 粘贴走宿主统一仲裁（不再自绑 window paste —— 铁律 7；且宿主 keydown 现放行原生 paste）。
    // 处理器由工厂给出（媒体 20 / 文本 30），测试直接复用同一份逻辑。
    for (const h of createFileDropPasteHandlers(svc)) {
      ctx.registryOf<ClipboardPasteHandler>(CLIPBOARD_PASTE_KIND).add(h.key, h.handler, { id: h.id, order: h.order })
    }
  }
}

/** 兼容旧装配的 PluginModule 出口 */
export const fileDropPlugin: PluginModule = { name, inject, apply }
