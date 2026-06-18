import type { CanvasPlugin, PluginContext, Point } from '../types'
import type { Node } from '@vue-flow/core'
import { Position } from '@vue-flow/core'
import { getAssetManager } from '../../hooks/useStorage'

// ============================================================================
// Types
// ============================================================================

export interface FileDropOptions extends Record<string, unknown> {
  /** 是否启用拖放文件到画布 */
  enableDragDrop?: boolean
  /** 是否启用粘贴图片/视频/文本 */
  enablePaste?: boolean
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<FileDropOptions> = {
  enableDragDrop: true,
  enablePaste: true,
}

const IMAGE_MIME = /^image\//
const VIDEO_MIME = /^video\//
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i
const VIDEO_EXT = /\.(mp4|webm|ogg|mov|avi|mkv|wmv)$/i
const TEXT_EXT = /\.(txt|md|markdown)$/i
const TEXT_MIME = /^text\/(plain|markdown|x-markdown)$/

const NODE_SIZES: Record<string, { cardWidth: number; cardHeight: number }> = {
  text: { cardWidth: 360, cardHeight: 300 },
  image: { cardWidth: 420, cardHeight: 300 },
  video: { cardWidth: 480, cardHeight: 340 },
}

const MAX_TEXT_LENGTH = 50000

// ============================================================================
// Utilities
// ============================================================================

let nodeCounter = 0

function nextId(): string {
  return `fd-${Date.now()}-${nodeCounter++}`
}

function isImageFile(file: File): boolean {
  return IMAGE_MIME.test(file.type) || IMAGE_EXT.test(file.name)
}

function isVideoFile(file: File): boolean {
  return VIDEO_MIME.test(file.type) || VIDEO_EXT.test(file.name)
}

function isTextFile(file: File): boolean {
  return TEXT_MIME.test(file.type) || TEXT_EXT.test(file.name)
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取失败: ${file.name}`))
    reader.readAsText(file)
  })
}

function readClipboardString(item: DataTransferItem): Promise<string> {
  return new Promise((resolve) => item.getAsString(resolve))
}

function getImageDims(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
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

function getVideoDims(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight })
      URL.revokeObjectURL(url)
    }
    video.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    video.src = url
  })
}

// ============================================================================
// Plugin
// ============================================================================

/**
 * FileDropPlugin — 文件拖入 & 粘贴插件
 *
 * 功能：
 * 1. 拖拽图片/视频/TXT/MD 文件到画布 → 自动创建对应节点
 * 2. Ctrl+V 或右键粘贴图片/视频 → 创建对应节点
 * 3. Ctrl+V 粘贴文本内容 → 创建文本节点
 */
export const FileDropPlugin: CanvasPlugin<FileDropOptions> = {
  name: 'file-drop',
  version: '0.1.0',

  install(context: PluginContext, options: FileDropOptions) {
    const logger = context.logger
    const opts = { ...DEFAULT_OPTIONS, ...options }

    /** 最后已知的鼠标在画布上的位置（屏幕坐标） */
    let lastMousePos: Point | null = null
    /** DOM 监听器清理函数集合 */
    const cleanups: (() => void)[] = []

    // ---- 追踪鼠标位置 ----
    const offPaneMouseMove = context.on('paneMouseMove', (event: MouseEvent) => {
      lastMousePos = { x: event.clientX, y: event.clientY }
    })

    // ---- 坐标转换 ----
    function toFlowPos(clientX: number, clientY: number): Point {
      return context.viewport.screenToFlowCoordinate({ x: clientX, y: clientY })
    }

    // ---- 创建节点 ----
    function buildNode(nodeType: 'text' | 'image' | 'video', extra: Record<string, unknown>, pos: Point): Node {
      const nodeId = nextId()
      const size = NODE_SIZES[nodeType]
      const label = (extra.label as string) || nodeType

      return {
        id: nodeId,
        type: 'custom',
        position: {
          x: pos.x - size.cardWidth / 2,
          y: pos.y - size.cardHeight / 2,
        },
        data: {
          label,
          nodeType,
          cardWidth: size.cardWidth,
          cardHeight: size.cardHeight,
          resizable: nodeType === 'text',
          ...extra,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }
    }

    // ---- 添加到画布（含历史记录） ----
    function addNodes(nodes: Node[], description: string) {
      const ids = nodes.map((n) => n.id)
      context.emit('history:record', {
        type: 'addNodes',
        description,
        undo: () => context.actions.removeNodes(ids),
        redo: () => context.actions.addNodes(nodes),
      })
      context.actions.addNodes(nodes)
    }

    // ---- 处理拖入文件 ----
    async function handleDrop(e: DragEvent) {
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      e.preventDefault()
      e.stopPropagation()

      const center = toFlowPos(e.clientX, e.clientY)
      const nodes: Node[] = []
      const baseX = center.x - (files.length * 10)
      const baseY = center.y - (files.length * 10)

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const pos: Point = { x: baseX + i * 40, y: baseY + i * 40 }

        if (isImageFile(file)) {
          const url = URL.createObjectURL(file)
          const dims = await getImageDims(file)
          const size = dims
            ? (() => {
                const ratio = Math.min(NODE_SIZES.image.cardWidth / dims.width, NODE_SIZES.image.cardHeight / dims.height, 1)
                return {
                  cardWidth: Math.max(120, Math.round(dims.width * ratio)),
                  cardHeight: Math.max(80, Math.round(dims.height * ratio)),
                }
              })()
            : NODE_SIZES.image

          // 通过 AssetManager 持久化
          const am = getAssetManager()
          let assetId: string | undefined
          if (am) {
            try {
              assetId = await am.saveAsset(file, file.name, file.type)
            } catch (err) {
              logger.warn(`保存图片资产失败: ${file.name}`, err)
            }
          }

          const extra: Record<string, unknown> = {
            label: file.name,
            assetId,
            imageUrl: url,
            imageName: file.name,
            imageType: file.type,
            imageWidth: dims?.width,
            imageHeight: dims?.height,
            cardWidth: size.cardWidth,
            cardHeight: size.cardHeight,
            resizable: true,
          }
          nodes.push(buildNode('image', extra, pos))
          logger.info(`拖入图片: ${file.name}${dims ? ` (${dims.width}×${dims.height})` : ''}`)
        } else if (isVideoFile(file)) {
          const url = URL.createObjectURL(file)
          const dims = await getVideoDims(file)

          // 通过 AssetManager 持久化
          const am = getAssetManager()
          let assetId: string | undefined
          if (am) {
            try {
              assetId = await am.saveAsset(file, file.name, file.type)
            } catch (err) {
              logger.warn(`保存视频资产失败: ${file.name}`, err)
            }
          }

          const extra: Record<string, unknown> = {
            label: file.name,
            assetId,
            videoUrl: url,
            videoName: file.name,
            videoType: file.type,
          }
          if (dims) {
            extra.videoWidth = dims.width
            extra.videoHeight = dims.height
          }
          nodes.push(buildNode('video', extra, pos))
          logger.info(`拖入视频: ${file.name}${dims ? ` (${dims.width}×${dims.height})` : ''}`)
        } else if (isTextFile(file)) {
          try {
            const content = await readAsText(file)
            const text = content.length > MAX_TEXT_LENGTH
              ? content.slice(0, MAX_TEXT_LENGTH) + `\n\n...（内容过长，已截断，共 ${content.length} 字符）`
              : content
            nodes.push(buildNode('text', { label: file.name, text }, pos))
            logger.info(`拖入文本: ${file.name} (${content.length} 字符)`)
          } catch (err) {
            logger.error(`读取文件失败: ${file.name}`, err)
          }
        } else {
          logger.warn(`不支持的文件: ${file.name} (${file.type || '未知类型'})`)
        }
      }

      if (nodes.length > 0) {
        addNodes(nodes, `拖入 ${nodes.length} 个文件`)
        logger.info(`文件拖入完成: ${nodes.length} 个节点`)
      }
    }

    function handleDragOver(e: DragEvent) {
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy'
      }
    }

    // ---- 处理粘贴 ----
    async function handlePaste(e: ClipboardEvent) {
      try {
      // 排除输入框中的粘贴
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      const items = e.clipboardData?.items
      if (!items || items.length === 0) {
        logger.debug('[Paste] 剪贴板无内容')
        return
      }

      // 先提取数据再 preventDefault —— preventDefault 后浏览器可能清空 clipboardData
      type PasteItem = { kind: 'image' | 'video'; blob: File } | { kind: 'text'; text: string }
      const pasteItems: PasteItem[] = []
      const itemTypes: string[] = []

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        itemTypes.push(item.type)
        if (IMAGE_MIME.test(item.type)) {
          const blob = item.getAsFile()
          if (blob) pasteItems.push({ kind: 'image', blob })
        } else if (VIDEO_MIME.test(item.type)) {
          const blob = item.getAsFile()
          if (blob) pasteItems.push({ kind: 'video', blob })
        } else if (item.kind === 'string') {
          pasteItems.push({ kind: 'text', text: await readClipboardString(item) })
        }
      }

      if (pasteItems.length === 0) {
        logger.debug(`[Paste] 无可处理内容, types: ${itemTypes.join(', ')}`)
        return
      }

      e.preventDefault()
      logger.info(`[Paste] 检测到可处理内容, types: ${itemTypes.join(', ')}, 提取 ${pasteItems.length} 项`)

      const center = lastMousePos ? toFlowPos(lastMousePos.x, lastMousePos.y) : { x: 200, y: 200 }
      const nodes: Node[] = []

      for (let i = 0; i < pasteItems.length; i++) {
        const pi = pasteItems[i]
        const pos: Point = { x: center.x + i * 40, y: center.y + i * 40 }

        if (pi.kind === 'image') {
          const blob = pi.blob
          const url = URL.createObjectURL(blob)
          const dims = await getImageDims(blob)
          const size = dims
            ? (() => {
                const ratio = Math.min(NODE_SIZES.image.cardWidth / dims.width, NODE_SIZES.image.cardHeight / dims.height, 1)
                return {
                  cardWidth: Math.max(120, Math.round(dims.width * ratio)),
                  cardHeight: Math.max(80, Math.round(dims.height * ratio)),
                }
              })()
            : NODE_SIZES.image

          const am = getAssetManager()
          let assetId: string | undefined
          if (am) {
            try {
              assetId = await am.saveAsset(blob, 'pasted-image.png', blob.type)
            } catch (err) {
              logger.warn('保存粘贴图片资产失败', err)
            }
          }

          const extra: Record<string, unknown> = {
            label: '粘贴的图片',
            assetId,
            imageUrl: url,
            imageName: 'pasted-image',
            imageType: blob.type,
            cardWidth: size.cardWidth,
            cardHeight: size.cardHeight,
            resizable: true,
          }
          if (dims) {
            extra.imageWidth = dims.width
            extra.imageHeight = dims.height
          }
          nodes.push(buildNode('image', extra, pos))
          logger.info(`粘贴图片到画布${dims ? ` (${dims.width}×${dims.height})` : ''}`)
        } else if (pi.kind === 'video') {
          const blob = pi.blob
          const url = URL.createObjectURL(blob)
          const dims = await getVideoDims(blob)

          const am = getAssetManager()
          let assetId: string | undefined
          if (am) {
            try {
              assetId = await am.saveAsset(blob, 'pasted-video.mp4', blob.type)
            } catch (err) {
              logger.warn('保存粘贴视频资产失败', err)
            }
          }

          const extra: Record<string, unknown> = {
            label: '粘贴的视频',
            assetId,
            videoUrl: url,
            videoName: 'pasted-video',
            videoType: blob.type,
          }
          if (dims) {
            extra.videoWidth = dims.width
            extra.videoHeight = dims.height
          }
          nodes.push(buildNode('video', extra, pos))
          logger.info(`粘贴视频到画布${dims ? ` (${dims.width}×${dims.height})` : ''}`)
        } else if (pi.kind === 'text') {
          const text = pi.text
          if (!text.trim()) continue

          const displayText = text.length > MAX_TEXT_LENGTH
            ? text.slice(0, MAX_TEXT_LENGTH) + `\n\n...（内容过长，已截断，共 ${text.length} 字符）`
            : text

          nodes.push(buildNode('text', { label: '粘贴的文本', text: displayText }, pos))
          logger.info(`粘贴文本到画布 (${text.length} 字符)`)
        }
      }

      if (nodes.length > 0) {
        addNodes(nodes, '粘贴内容')
        logger.info(`[Paste] 添加了 ${nodes.length} 个节点`)
      } else {
        logger.warn(`[Paste] 未创建任何节点 (pasteItems: ${pasteItems.length})`)
      }
      } catch (err) {
        logger.error('[Paste] 处理失败:', err)
        console.error('[FileDropPlugin] paste error:', err)
      }
    }

    // ---- 注册 DOM 事件 ----
    function bindPane() {
      const pane = document.querySelector('.vue-flow') as HTMLElement | null
      if (!pane) {
        logger.warn('未找到 .vue-flow 容器，1s 后重试')
        const retry = setTimeout(bindPane, 1000)
        cleanups.push(() => clearTimeout(retry))
        return
      }

      if (opts.enableDragDrop) {
        pane.addEventListener('dragover', handleDragOver)
        pane.addEventListener('drop', handleDrop)
        cleanups.push(() => {
          pane.removeEventListener('dragover', handleDragOver)
          pane.removeEventListener('drop', handleDrop)
        })
        logger.info('文件拖放监听已就绪')
      }
    }

    if (opts.enablePaste) {
      document.addEventListener('paste', handlePaste)
      cleanups.push(() => document.removeEventListener('paste', handlePaste))
      logger.info('粘贴监听已就绪')
    }

    bindPane()

    logger.info('FileDropPlugin 安装完成')

    return {
      uninstall() {
        offPaneMouseMove()
        for (const fn of cleanups) fn()
        cleanups.length = 0
      },
    }
  },
}

export default FileDropPlugin
