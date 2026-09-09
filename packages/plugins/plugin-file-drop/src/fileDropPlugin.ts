/**
 * plugin-file-drop —— 文件拖入 & 粘贴插件（v2 复刻老版 canvas-core/src/plugins/file-drop）。
 *
 * 数据流（v2 铁律：只经内核服务读写，不碰 VueFlow/宿主内部；建节点原子进 history 一次撤销）：
 * - 拖文件到画布 / 粘贴图片或文本 → 读 File → 图片用 URL.createObjectURL 生成 data.imageUrl、
 *   文本读成 data.text → 在 drop/粘贴位置建 image/text 节点。
 *
 * v2 简化边界（对齐老版能做而 v2 无的类型/服务）：
 * - 只建 image/text 节点：v2 无 video 节点类型；视频/未知文件归 unsupported（忽略 + console.warn）。
 * - 不做 StoragePlugin 上传（backend-sync 不在本次复刻范围）；图片只留 objectURL 本地会话可见。
 * - 建节点前检测 nodeStore.types 是否注册了 image/text（node-image/node-text 插件装配才有）；
 *   缺类型则该文件类别跳过（console.warn）——插件可与节点插件独立装配，不硬耦合（masterplan 铁律 8）。
 *
 * 事件挂载：window 级 dragover/drop + paste 监听，ctx.effect 绑定 → 随插件 scope 自动回收；
 * 浏览器环境守卫(typeof window !== 'undefined')，node 测试/装配安全跳过。
 * 坐标：drop/paste 的 clientX/Y 经 ctx.get('viewport').screenToFlow 转 flow 坐标作节点 position
 * （对齐老版"放到鼠标处"）；无 viewport 服务/无鼠标锚点退级联默认。
 * 快捷键：不走 DOM 按键，粘贴由命令 keys(mod+v) 统一分发会与剪贴板冲突——见下方说明。
 */
import { Service, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import type { NodeStoreService, SelectionService, GraphDocumentService, ResourceService } from '@mini-canvas/canvas-core-v2'
import type { ViewportService } from '@mini-canvas/canvas-render'
import {
  classifyFile,
  clampText,
  spreadPositions,
  buildImagePayload,
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
  /** 处理一批拖入/粘贴的 File（图片/文本），在 flow 坐标处建节点；返回实际创建数。 */
  addFiles(files: File[], atFlow: { x: number; y: number } | null): Promise<number>
  /** 粘贴纯文本 → 文本节点（客户端直接给字符串的入口） */
  addPastedText(text: string, atFlow: { x: number; y: number } | null): string | null
  /** 判断文件是否可处理（image/text） */
  canHandle(file: { name: string; type: string }): boolean
}

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    fileDrop: FileDropService
  }
}

export const name = 'file-drop'
export const inject = ['nodeStore', 'selection', 'graph'] as string[]

/** 可编辑输入框内不响应粘贴/拖放（对齐宿主 CanvasHost 与 clipboard 同规则） */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return Boolean(t.closest('input, textarea, select, [contenteditable="true"]'))
}

/** 浏览器环境：读 File 为文本（老版 FileReader 同款；node 测试不触碰） */
function readAsText(file: File): Promise<string> {
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

/** 浏览器专属 IO 的依赖注入点：生产用真实实现；node 单测注入假实现（不触碰 DOM/FileReader/Image） */
export interface FileDropReaders {
  /** 读 File 文本内容 */
  readText(file: File): Promise<string>
  /** 读图片真实宽高；失败返回 null → 默认卡片尺寸 */
  readImageDims(blob: Blob): Promise<ImageDims | null>
  /** 生成图片 objectURL（node 无此 API，测试注入 mock） */
  createObjectURL(blob: Blob): string
}

/** 默认浏览器实现（生产）；File 来自 FileReader / Image / URL.createObjectURL */
const defaultReaders: FileDropReaders = {
  readText: (f) => readAsText(f),
  readImageDims: (b) => readImageDims(b),
  createObjectURL: (b) => URL.createObjectURL(b),
}

/** 剪贴板 string 项读文本（老版 readClipboardString 同款） */
function readClipboardString(item: DataTransferItem): Promise<string> {
  return new Promise((resolve) => item.getAsString(resolve))
}

export class FileDropServiceImpl extends Service implements FileDropService {
  /** 节点 id 生成计数（老版 fd- 前缀 + 自增，避免与内核数字短 id 撞车） */
  private static counter = 0
  /** 最近一次画布内鼠标位置（屏幕坐标；供粘贴锚点） */
  private lastClient: { x: number; y: number } | null = null
  /** 浏览器 IO（可注入：node 测试用假实现） */
  private readers: FileDropReaders

  constructor(ctx: Context, readers: FileDropReaders = defaultReaders) {
    super(ctx, 'file-drop')
    this.readers = readers
  }

  private get nodeStore(): NodeStoreService {
    return this.ctx.get<NodeStoreService>('nodeStore')
  }
 private get selection(): SelectionService {
   return this.ctx.get<SelectionService>('selection')
 }
  private get graph(): GraphDocumentService {
    return this.ctx.get<GraphDocumentService>('graph')
 }
  private get viewport(): ViewportService | undefined {
    return this.ctx.get<ViewportService | undefined>('viewport') ?? undefined
  }

  /** 类型是否已注册（node-image/node-text 插件装配才 true；缺则跳过该类文件） */
  private typeRegistered(type: 'image' | 'text'): boolean {
    return this.nodeStore.types.has(type)
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

  private nextId(): string {
    FileDropServiceImpl.counter += 1
    return `fd-${Date.now()}-${FileDropServiceImpl.counter}`
  }

  /** 建节点载荷批量写入（history 一次；选中新节点便于立刻拖动/删除） */
  private commitPayloads(payloads: NodePayload[], description: string): string[] {
   if (payloads.length === 0) return []
   const ids = payloads.map(() => this.nextId())
    this.graph.transaction('file-drop-add', (tx) => {
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
   * 图片：读 objectURL → 读真实尺寸 → 建 image（带适配尺寸）；文本：读内容截断 → 建 text。
   * 视频/未知/未注册类型：跳过并 console.warn（不崩、不半建）。
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
          const url = this.readers.createObjectURL(file)
          const dims = await this.readers.readImageDims(file)
          const payload = buildImagePayload(file, url, positions[i], dims)
          // P1-14：把生成的 object URL 登记进宿主 resources，写 resourceId 供引用扫描回收
          // PluginScope.get 对缺失服务返回 undefined（可选探测语义）
          const resources = this.ctx.get<ResourceService | undefined>('resources')
          if (resources) {
            const resourceId = resources.register({ kind: 'image', url, resource: file })
            payload.data.resourceId = resourceId
          }
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
    ctx.effect(() => {
      if (typeof window === 'undefined') return
      async function onPaste(e: ClipboardEvent): Promise<void> {
        if (isEditableTarget(e.target)) return
        const items = e.clipboardData?.items
        if (!items || items.length === 0) return

        type PasteItem = { kind: 'image' | 'text'; blob: File } | { kind: 'text'; text: string }
        const pasteItems: PasteItem[] = []
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          const kind = classifyFile({ name: 'clipboard', type: item.type })
          if (kind === 'image') {
            const blob = item.getAsFile()
            if (blob) pasteItems.push({ kind: 'image', blob })
          } else if (item.kind === 'string') {
            pasteItems.push({ kind: 'text', text: await readClipboardString(item) })
          }
        }
        if (pasteItems.length === 0) return
        e.preventDefault()

        const anchor = svc.flowAnchor() ?? { x: 200, y: 200 }
        const images = pasteItems.filter((p): p is { kind: 'image'; blob: File } => p.kind === 'image')
        const texts = pasteItems.filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
        // 文本先建（中心），图片随后级联（避免重叠）
        let created = 0
        for (const t of texts) {
          if (svc.addPastedText(t.text, anchor)) created += 1
        }
        if (images.length > 0) {
          const offset = texts.length > 0 ? 60 : 0
          created += await svc.addFiles(
            images.map((p) => p.blob),
            { x: anchor.x + offset, y: anchor.y + offset },
          )
        }
        if (created === 0) console.warn('[file-drop] 粘贴未创建任何节点')
      }
      window.addEventListener('paste', onPaste)
      return () => window.removeEventListener('paste', onPaste)
    })
  }
}

/** 兼容旧装配的 PluginModule 出口 */
export const fileDropPlugin: PluginModule = { name, inject, apply }




