import { markRaw } from 'vue'
import type { Node } from '@vue-flow/core'
import { ImageNode } from './index'
import ImageUploadButton from './ImageUploadButton.vue'
import ImageBottomToolbar from './ImageBottomToolbar.vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'

// ---- SVG icons ----
const cropSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`
const filterSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke-linecap="round"/></svg>`
const rotateSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`
const downloadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
const confirmSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
const cancelSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
// 扩展图标（向外箭头）
const expandSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
// 上传/生成箭头（底部工具栏用）
const uploadArrowSvg = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`
// 菜单图标（CanvasMenu 使用）— 无 class，由 CSS 控制 16x16
const menuIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>`
// 标题图标（BaseNode title 使用）— 由外层 span 控制尺寸
const titleIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>`

// ---- helpers ----
const MAX_PREVIEW_WIDTH = 420
const MAX_PREVIEW_HEIGHT = 300

function fitCardSize(width: number, height: number) {
  const ratio = Math.min(MAX_PREVIEW_WIDTH / width, MAX_PREVIEW_HEIGHT / height, 1)
  return { cardWidth: Math.max(120, Math.round(width * ratio)), cardHeight: Math.max(80, Math.round(height * ratio)) }
}

function readImageDims(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url) }
    image.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
    image.src = url
  })
}

// ---- command implementations ----

async function handleImageUpload(ctx: CommandContext, args?: unknown) {
  const file = (args as { file?: File })?.file
  if (!file) return

  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const imageUrl = URL.createObjectURL(file)
  const dims = await readImageDims(file)
  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  const nextSize = dims ? fitCardSize(dims.width, dims.height) : null

  // 持久化
  const assetManager = runtime.getPluginAPI?.('storage')?.assets
  let assetId: string | undefined
  if (assetManager) {
    try { assetId = await assetManager.saveAsset(file, file.name, file.type) }
    catch (err) { ctx.logger.error('保存图片资产失败:', err) }
  }

  vf.updateNode(nodeId, {
    data: {
      ...(node?.data ?? {}),
      assetId, imageUrl,
      imageName: file.name, imageType: file.type,
      imageWidth: dims?.width, imageHeight: dims?.height,
      cardWidth: nextSize?.cardWidth ?? node?.data?.cardWidth,
      cardHeight: nextSize?.cardHeight ?? node?.data?.cardHeight,
    },
  })
}

function handleImageCrop(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node?.data?.imageUrl || !node.data.imageWidth || !node.data.imageHeight) return

  // 设置 overlay 统一管理裁剪状态
  vf.updateNode(nodeId, {
    data: {
      ...(node.data),
      _overlay: {
        _cropMode: true,
        _toolbarGroup: 'crop',
        _cropRect: { x: 0, y: 0, width: node.data.imageWidth, height: node.data.imageHeight },
      },
    },
  })
  vf.fitView({ nodes: [nodeId], padding: 0.15, maxZoom: 4, duration: 250 })
}

async function handleImageCropConfirm(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node?.data) return

  const sourceData = node.data
  const { imageUrl, imageWidth, imageHeight } = sourceData
  if (!imageUrl || !imageWidth || !imageHeight) return

  const cropRect = sourceData._overlay?._cropRect as { x: number; y: number; width: number; height: number } | undefined
  if (!cropRect || cropRect.width <= 0 || cropRect.height <= 0) return

  // 1. 退出裁剪模式
  const cleanedData = { ...sourceData }
  delete cleanedData._overlay
  vf.updateNode(nodeId, { data: cleanedData })

  // 2. Canvas 裁剪图片
  // drawImage(HTMLImageElement) 对这种格式图片完全无效（浏览器 canvas bug），
  // 改用 fetch + createImageBitmap 两步解码
  ctx.logger.debug('[Crop] imageUrl 前80字符:', typeof imageUrl === 'string' ? (imageUrl as string).slice(0, 80) : typeof imageUrl)
  ctx.logger.debug('[Crop] cropRect raw:', JSON.stringify(cropRect))
  ctx.logger.debug('[Crop] 源 data 尺寸:', imageWidth, 'x', imageHeight)

  // Step A: fetch 原始数据
  const response = await fetch(imageUrl)
  ctx.logger.debug('[Crop] fetch → status:', response.status, 'ok:', response.ok, 'type:', response.type)
  if (!response.ok) { ctx.logger.error('fetch 失败:', response.status); return }
  const rawBlob = await response.blob()
  ctx.logger.debug('[Crop] rawBlob → size:', rawBlob.size, 'type:', rawBlob.type)

  // Step B: 创建完整 bitmap，获取实际图片尺寸
  const fullBitmap = await createImageBitmap(rawBlob)
  ctx.logger.debug('[Crop] fullBitmap →', fullBitmap.width, 'x', fullBitmap.height)

  // Step C: 用实际尺寸计算裁剪坐标
  const scaleX = imageWidth > 0 ? fullBitmap.width / imageWidth : 1
  const scaleY = imageHeight > 0 ? fullBitmap.height / imageHeight : 1
  const sx = Math.round(cropRect.x * scaleX)
  const sy = Math.round(cropRect.y * scaleY)
  const sw = Math.round(cropRect.width * scaleX)
  const sh = Math.round(cropRect.height * scaleY)
  ctx.logger.debug('[Crop] scale:', scaleX, scaleY, '→ crop coords:', sx, sy, sw, sh)

  // Step D: 裁剪 bitmap
  const cropBitmap = await createImageBitmap(fullBitmap, sx, sy, sw, sh)
  fullBitmap.close()
  ctx.logger.debug('[Crop] cropBitmap →', cropBitmap.width, 'x', cropBitmap.height)

  // Step E: 画到 canvas
  const canvas = document.createElement('canvas')
  canvas.width = cropBitmap.width
  canvas.height = cropBitmap.height
  const c2d = canvas.getContext('2d')!
  c2d.drawImage(cropBitmap, 0, 0)
  cropBitmap.close()

  const testPixel = c2d.getImageData(
    Math.min(1, canvas.width - 1),
    Math.min(1, canvas.height - 1),
    1, 1,
  )
  const hasContent = testPixel.data.some((v, i) => i < 3 && v > 0)
  ctx.logger.debug('[Crop] canvas:', canvas.width, 'x', canvas.height, 'testPixel:', testPixel.data, 'hasContent:', hasContent)

  if (!hasContent) {
    ctx.logger.warn('裁剪画布无内容 — 全部 0')
    return
  }

  // 生成裁剪结果 URL：优先使用 Blob URL（与 FileDropPlugin 一致）
  let croppedUrl: string
  let blob: Blob | null = null
  const blobby = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  blob = blobby
  croppedUrl = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png')

  // 3. 持久化
  let assetId: string | undefined
  const assetManager = runtime.getPluginAPI?.('storage')?.assets
  if (assetManager && blob) {
    const name = `${(sourceData.imageName as string) || 'cropped'}_crop.png`
    try { assetId = await assetManager.saveAsset(new File([blob], name, { type: 'image/png' }), name, 'image/png') }
    catch (err) { ctx.logger.error('保存裁剪图片资产失败:', err) }
  }

  // 4. 计算卡片尺寸（基于裁剪后的真实像素尺寸 sw/sh）
  const ratio = Math.min(MAX_PREVIEW_WIDTH / sw, MAX_PREVIEW_HEIGHT / sh, 1)
  const cardWidth = Math.max(80, Math.round(sw * ratio))
  const cardHeight = Math.max(60, Math.round(sh * ratio))

  // 5. 在源节点右侧添加新图片节点
  const newNodeId = `image-${Date.now()}`
  vf.addNodes([{
    id: newNodeId,
    type: 'custom',
    position: {
      x: node.position.x + (sourceData.cardWidth ?? cardWidth) + 40,
      y: node.position.y,
    },
    data: {
      label: `${(sourceData.imageName as string) || 'image'}_crop`,
      nodeType: 'image',
      assetId,
      imageUrl: croppedUrl,
      imageName: `${(sourceData.imageName as string) || 'image'}_crop`,
      imageType: 'image/png',
      imageWidth: sw,
      imageHeight: sh,
      cardWidth,
      cardHeight,
    },
    sourcePosition: 'right' as any,
    targetPosition: 'left' as any,
  }])
}

function handleImageCropCancel(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node) return

  const data = { ...(node.data) }
  delete data._overlay
  vf.updateNode(nodeId, { data })
}

// ==================== 图片扩展（Outpaint）====================

function handleImageExpand(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node?.data?.imageUrl || !node.data.imageWidth || !node.data.imageHeight) return

  // 设置 overlay 统一管理扩展状态
  vf.updateNode(nodeId, {
    data: {
      ...(node.data),
      _overlay: {
        _expandMode: true,
        _toolbarGroup: 'expand',
        _expandRect: { x: 0, y: 0, width: node.data.imageWidth, height: node.data.imageHeight },
      },
    },
  })
}

async function handleImageExpandConfirm(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node?.data) return

  const sourceData = node.data
  const { imageUrl, imageWidth, imageHeight } = sourceData
  if (!imageUrl || !imageWidth || !imageHeight) return

  const expandRect = sourceData._overlay?._expandRect as { x: number; y: number; width: number; height: number } | undefined
  if (!expandRect || expandRect.width <= 0 || expandRect.height <= 0) return

  // TODO: 实现扩展生成逻辑（Canvas 拼接 + AI 填充）
  ctx.logger.debug('[Expand] expandRect:', JSON.stringify(expandRect))

  // 退出扩展模式
  const cleanedData = { ...sourceData }
  delete cleanedData._overlay
  vf.updateNode(nodeId, { data: cleanedData })
}

function handleImageExpandCancel(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node) return

  const data = { ...(node.data) }
  delete data._overlay
  vf.updateNode(nodeId, { data })
}

function handleImageFilter(ctx: CommandContext, args?: unknown) {
  const filterType = (args as { filter?: string })?.filter || 'none'
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  const img = node?.data?.imageElement as HTMLImageElement | undefined
  if (!img) { ctx.logger.warn('滤镜需要已加载的图片元素'); return }

  if (filterType === 'none') img.style.filter = 'none'
  else if (filterType === 'grayscale') img.style.filter = 'grayscale(100%)'
  else if (filterType === 'sepia') img.style.filter = 'sepia(100%)'
}

function handleImageRotate(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  const currentRotation = (node?.data?._rotation as number) || 0
  const nextRotation = (currentRotation + 90) % 360
  vf.updateNode(nodeId, { data: { ...(node?.data as any), _rotation: nextRotation } })
}

function handleImageDownload(ctx: CommandContext) {
  const node = ctx.node
  if (!node) return
  const imageUrl = (node.data as any)?.imageUrl as string | undefined
  if (!imageUrl) return
  const a = document.createElement('a')
  a.href = imageUrl
  a.download = (node.data as any)?.imageName || 'image.png'
  a.click()
}

export const ImageNodePlugin: CanvasPlugin = {
  name: 'node:image',
  version: '1.0.0',

  install(context: PluginContext) {
    // 注册节点类型
    context.canvasNodes.register({
      type: 'image', node: markRaw(ImageNode), label: '图片',
      defaultSize: { cardWidth: 360, cardHeight: 270 },
      menuItem: { label: '图片', description: '创建图片节点', icon: menuIconSvg },
      canReceiveInput: true, resizable: false,
      titleIcon: titleIconSvg,
      topToolbar: undefined,
      bottomToolbar: markRaw(ImageBottomToolbar),
    })

    // 注册命令
    context.commands.register({ id: 'image.upload', source: 'node:image', title: '上传图片', run: handleImageUpload })
    context.commands.register({ id: 'image.crop', source: 'node:image', title: '裁剪', run: handleImageCrop })
    context.commands.register({ id: 'image.cropConfirm', source: 'node:image', title: '确认裁剪', run: handleImageCropConfirm })
    context.commands.register({ id: 'image.cropCancel', source: 'node:image', title: '取消裁剪', run: handleImageCropCancel })
    context.commands.register({ id: 'image.expand', source: 'node:image', title: '扩展', run: handleImageExpand })
    context.commands.register({ id: 'image.expandConfirm', source: 'node:image', title: '确认扩展', run: handleImageExpandConfirm })
    context.commands.register({ id: 'image.expandCancel', source: 'node:image', title: '取消扩展', run: handleImageExpandCancel })
    context.commands.register({ id: 'image.filter', source: 'node:image', title: '滤镜', run: handleImageFilter })
    context.commands.register({ id: 'image.rotate', source: 'node:image', title: '旋转', run: handleImageRotate })
    context.commands.register({ id: 'image.download', source: 'node:image', title: '下载', run: handleImageDownload })

    // 注册 toolbar 按钮
    // top: default 组（正常状态下显示，裁剪时 overlay._toolbarGroup='crop' 自动隐藏）
    context.toolbars.register('node:image', { id: 'image.upload', source: 'node:image', commandId: 'image.upload', position: 'top', title: '上传图片', tooltip: '点击上传本地图片', nodeTypes: ['image'], group: 'default', order: 10, customRender: markRaw(ImageUploadButton) })
    context.toolbars.register('node:image', { id: 'image.crop', source: 'node:image', commandId: 'image.crop', position: 'top', title: '裁剪', icon: cropSvg, tooltip: '裁剪图片', nodeTypes: ['image'], group: 'default', order: 20 })
    context.toolbars.register('node:image', { id: 'image.filter', source: 'node:image', commandId: 'image.filter', position: 'top', title: '滤镜', icon: filterSvg, nodeTypes: ['image'], group: 'default', order: 30, dropdown: [{ id: 'none', title: '无滤镜' }, { id: 'grayscale', title: '黑白' }, { id: 'sepia', title: '复古' }] })
    // top: crop 组（仅裁剪模式 overlay._toolbarGroup='crop' 时显示）
    context.toolbars.register('node:image', { id: 'image.cropConfirm', source: 'node:image', commandId: 'image.cropConfirm', position: 'top', title: '确认', icon: confirmSvg, tooltip: '确认裁剪', nodeTypes: ['image'], group: 'crop', order: 10, visible: (ctx) => ctx.node?.data?._overlay?._cropMode === true })
    context.toolbars.register('node:image', { id: 'image.cropCancel', source: 'node:image', commandId: 'image.cropCancel', position: 'top', title: '取消', icon: cancelSvg, tooltip: '取消裁剪', nodeTypes: ['image'], group: 'crop', order: 20, visible: (ctx) => ctx.node?.data?._overlay?._cropMode === true })

    // top: 扩展按钮（default 组，正常状态显示）
    context.toolbars.register('node:image', { id: 'image.expand', source: 'node:image', commandId: 'image.expand', position: 'top', title: '扩展', icon: expandSvg, tooltip: '扩展图片', nodeTypes: ['image'], group: 'default', order: 25 })
    // top: expand 组（仅扩展模式 overlay._toolbarGroup='expand' 时显示）
    context.toolbars.register('node:image', { id: 'image.expandConfirm', source: 'node:image', commandId: 'image.expandConfirm', position: 'top', title: '确认扩展', icon: confirmSvg, tooltip: '确认扩展', nodeTypes: ['image'], group: 'expand', order: 10, visible: (ctx) => ctx.node?.data?._overlay?._expandMode === true })
    context.toolbars.register('node:image', { id: 'image.expandCancel', source: 'node:image', commandId: 'image.expandCancel', position: 'top', title: '取消', icon: cancelSvg, tooltip: '取消扩展', nodeTypes: ['image'], group: 'expand', order: 0, visible: (ctx) => ctx.node?.data?._overlay?._expandMode === true })
    // bottom: 不标 group，始终显示
    context.toolbars.register('node:image', { id: 'image.rotate', source: 'node:image', commandId: 'image.rotate', position: 'bottom', title: '旋转', icon: rotateSvg, nodeTypes: ['image'], order: 10 })
    context.toolbars.register('node:image', { id: 'image.download', source: 'node:image', commandId: 'image.download', position: 'bottom', title: '下载', icon: downloadSvg, nodeTypes: ['image'], order: 20 })

    return {
      uninstall() {
        context.canvasNodes.unregister('image')
        context.toolbars.unregisterSource('node:image')
        context.commands.unregisterSource('node:image')
      },
    }
  },
}