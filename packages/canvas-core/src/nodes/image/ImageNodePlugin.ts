import { markRaw } from 'vue'
import type { Node } from '@vue-flow/core'
import ImageNode from './ImageNode.vue'
import ImageUploadButton from './ImageUploadButton.vue'
import MaskBrushButton from './MaskBrushButton.vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'
import type { MaskConfig } from '../../types/CanvasNodeData'

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
// 蒙版图标
const maskSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke-width="1.5" opacity="0.5"/></svg>`


// ---- helpers ----
const MAX_PREVIEW_WIDTH = 420
const MAX_PREVIEW_HEIGHT = 300

function fitCardSize(width: number, height: number) {
  const ratio = Math.min(MAX_PREVIEW_WIDTH / width, MAX_PREVIEW_HEIGHT / height, 1)
  return { cardWidth: Math.max(120, Math.round(width * ratio)), cardHeight: Math.max(80, Math.round(height * ratio)) }
}


/**
 * 将 canvas 导出为 blob 并持久化到 asset store
 */
async function saveTransformedAsset(
  canvas: HTMLCanvasElement,
  imageName: string,
  suffix: string,
  ctx: CommandContext,
): Promise<{ blob: Blob; url: string; assetId?: string } | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) {
    ctx.logger.error('[Transform] canvas.toBlob 返回 null')
    return null
  }
  const url = URL.createObjectURL(blob)

  let assetId: string | undefined
  const runtime = ctx.runtime as any
  const assetManager = runtime.getPluginAPI?.('storage')?.assets
  if (assetManager) {
    const name = `${imageName || 'image'}${suffix}.png`
    try { assetId = await assetManager.saveAsset(new File([blob], name, { type: 'image/png' }), name, 'image/png') }
    catch (err) { ctx.logger.error('保存资产失败:', err) }
  }

  return { blob, url, assetId }
}

/**
 * 在源节点右侧创建变换结果节点（通用）
 */
function createResultNode(
  vf: any,
  sourceNode: { position: { x: number; y: number }; data: Record<string, unknown> },
  result: { blob: Blob; url: string; width: number; height: number },
  suffix: string,
  assetId?: string,
): void {
  const sourceData = sourceNode.data
  const { cardWidth, cardHeight } = fitCardSize(result.width, result.height)

  const newNodeId = `image-${Date.now()}`
  vf.addNodes([{
    id: newNodeId,
    type: 'custom',
    position: {
      x: sourceNode.position.x + ((sourceData.cardWidth as number) ?? cardWidth) + 40,
      y: sourceNode.position.y,
    },
    data: {
      label: `${(sourceData.imageName as string) || 'image'}${suffix}`,
      nodeType: 'image',
      assetId,
      imageUrl: result.url,
      imageName: `${(sourceData.imageName as string) || 'image'}${suffix}`,
      imageType: 'image/png',
      imageWidth: result.width,
      imageHeight: result.height,
      cardWidth,
      cardHeight,
    },
    sourcePosition: 'right' as any,
    targetPosition: 'left' as any,
  }])
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
      imageSize: file.size,
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
  try {
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

  // 2. fetch + 完整 bitmap（算 scale）
  const response = await fetch(imageUrl as string)
  if (!response.ok) { ctx.logger.error('[Crop] fetch 失败:', response.status); return }
  const rawBlob = await response.blob()
  const fullBitmap = await createImageBitmap(rawBlob)

  const scaleX = (imageWidth as number) > 0 ? fullBitmap.width / (imageWidth as number) : 1
  const scaleY = (imageHeight as number) > 0 ? fullBitmap.height / (imageHeight as number) : 1
  const sx = Math.round(cropRect.x * scaleX)
  const sy = Math.round(cropRect.y * scaleY)
  const sw = Math.round(cropRect.width * scaleX)
  const sh = Math.round(cropRect.height * scaleY)

  // 3. 裁剪 bitmap
  const cropBitmap = await createImageBitmap(fullBitmap, sx, sy, sw, sh)
  fullBitmap.close()

  // 4. 画到 canvas
  const canvas = document.createElement('canvas')
  canvas.width = cropBitmap.width
  canvas.height = cropBitmap.height
  const c2d = canvas.getContext('2d')!
  c2d.drawImage(cropBitmap, 0, 0)
  cropBitmap.close()

  // 5. 验证有内容
  const testPixel = c2d.getImageData(Math.min(1, canvas.width - 1), Math.min(1, canvas.height - 1), 1, 1)
  if (!testPixel.data.some((v, i) => i < 3 && v > 0)) {
    ctx.logger.warn('[Crop] 裁剪画布无内容')
    return
  }

  // 6. 持久化 + 创建新节点
  const saved = await saveTransformedAsset(canvas, sourceData.imageName as string, '_crop', ctx)
  if (!saved) return
  createResultNode(vf, node, { blob: saved.blob, url: saved.url, width: sw, height: sh }, '_crop', saved.assetId)
  } catch (err) {
    ctx.logger.error('[Image] handleImageCropConfirm failed:', err)
  }
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
  // 居中显示节点，占窗口约 50%
  vf.fitView({ nodes: [nodeId], padding: 0.8, maxZoom: 4, duration: 250 })
}

async function handleImageExpandConfirm(ctx: CommandContext) {
  try {
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

  // 1. 退出扩展模式
  const cleanedData = { ...sourceData }
  delete cleanedData._overlay
  vf.updateNode(nodeId, { data: cleanedData })

  // 2. fetch + bitmap
  const response = await fetch(imageUrl as string)
  if (!response.ok) { ctx.logger.error('[Expand] fetch 原图失败:', response.status); return }
  const rawBlob = await response.blob()
  const fullBitmap = await createImageBitmap(rawBlob)

  // 3. 计算扩展坐标
  const scaleX = (imageWidth as number) > 0 ? fullBitmap.width / (imageWidth as number) : 1
  const scaleY = (imageHeight as number) > 0 ? fullBitmap.height / (imageHeight as number) : 1
  const sx = Math.round(expandRect.x * scaleX)
  const sy = Math.round(expandRect.y * scaleY)
  const sw = Math.round(expandRect.width * scaleX)
  const sh = Math.round(expandRect.height * scaleY)

  // 4. 画到 canvas
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const c2d = canvas.getContext('2d')!
  c2d.drawImage(fullBitmap, -sx, -sy)
  fullBitmap.close()

  // 5. 验证有内容
  const testPixel = c2d.getImageData(Math.min(1, canvas.width - 1), Math.min(1, canvas.height - 1), 1, 1)
  if (!testPixel.data.some((v, i) => i < 3 && v > 0)) {
    ctx.logger.warn('[Expand] 扩展画布无内容')
    return
  }

  // 6. 持久化 + 创建新节点
  const saved = await saveTransformedAsset(canvas, sourceData.imageName as string, '_expand', ctx)
  if (!saved) return
  createResultNode(vf, node, { blob: saved.blob, url: saved.url, width: sw, height: sh }, '_expand', saved.assetId)
  } catch (err) {
    ctx.logger.error('[Image] handleImageExpandConfirm failed:', err)
  }
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

// ==================== 蒙版绘制（Mask）====================

const DEFAULT_MASK_CONFIG: MaskConfig = {
  brushSize: 20,
  brushColor: '#ff0000',
  brushOpacity: 0.5,
  isErasing: false,
}

function handleImageMask(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node?.data?.imageUrl || !node.data.imageWidth || !node.data.imageHeight) return

  vf.updateNode(nodeId, {
    data: {
      ...(node.data),
      _overlay: {
        _maskMode: true,
        _toolbarGroup: 'mask',
        _maskConfig: { ...DEFAULT_MASK_CONFIG },
      },
    },
  })
  vf.fitView({ nodes: [nodeId], padding: 0.8, maxZoom: 4, duration: 250 })
}

async function handleImageMaskConfirm(ctx: CommandContext) {
  try {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node?.data) return

  const sourceData = node.data
  const { imageUrl, imageWidth, imageHeight } = sourceData
  if (!imageUrl || !imageWidth || !imageHeight) return

  const maskUrl = sourceData.maskUrl as string | undefined

  // 1. 退出蒙版模式
  const cleanedData = { ...sourceData }
  delete cleanedData._overlay
  vf.updateNode(nodeId, { data: cleanedData })

  if (!maskUrl) return

  // 2. 并行加载原图 + 蒙版
  const [imgResponse, maskResponse] = await Promise.all([
    fetch(imageUrl as string),
    fetch(maskUrl),
  ])
  if (!imgResponse.ok) { ctx.logger.error('[Mask] fetch 原图失败:', imgResponse.status); return }

  const [imgBlob, maskBlob] = await Promise.all([
    imgResponse.blob(),
    maskResponse.blob(),
  ])

  const [imgBitmap, maskBitmap] = await Promise.all([
    createImageBitmap(imgBlob),
    createImageBitmap(maskBlob),
  ])

  // 3. 合成到 canvas
  const canvas = document.createElement('canvas')
  canvas.width = imgBitmap.width
  canvas.height = imgBitmap.height
  const c2d = canvas.getContext('2d')!
  c2d.drawImage(imgBitmap, 0, 0)
  c2d.drawImage(maskBitmap, 0, 0, canvas.width, canvas.height)
  imgBitmap.close()
  maskBitmap.close()

  // 4. 验证有内容
  const testPixel = c2d.getImageData(Math.min(1, canvas.width - 1), Math.min(1, canvas.height - 1), 1, 1)
  if (!testPixel.data.some((v, i) => i < 3 && v > 0)) {
    ctx.logger.warn('[Mask] 合成画布无内容')
    return
  }

  // 5. 持久化 + 创建新节点
  const saved = await saveTransformedAsset(canvas, sourceData.imageName as string, '_masked', ctx)
  if (!saved) return
  createResultNode(vf, node, { blob: saved.blob, url: saved.url, width: imgBitmap.width, height: imgBitmap.height }, '_masked', saved.assetId)
  } catch (err) {
    ctx.logger.error('[Image] handleImageMaskConfirm failed:', err)
  }
}

function handleImageMaskCancel(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node) return

  const data = { ...(node.data) }
  delete data._overlay
  delete data.maskUrl
  vf.updateNode(nodeId, { data })
}

function handleImageMaskClear(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node) return

  vf.updateNode(nodeId, {
    data: { ...node.data, maskUrl: null },
  })
}

function handleImageMaskEraser(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return

  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  if (!node?.data?._overlay?._maskConfig) return

  const cfg = node.data._overlay._maskConfig
  vf.updateNode(nodeId, {
    data: {
      ...node.data,
      _overlay: {
        ...node.data._overlay,
        _maskConfig: { ...cfg, isErasing: !cfg.isErasing },
      },
    },
  })
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
  // imageName 可能被操作后缀污染（如 screenshot.png_expand），清洗后确保 .png 扩展名
  const rawName = (node.data as any)?.imageName || 'image'
  const cleanName = rawName.replace(/_(crop|expand|masked)$/, '').replace(/\.(png|jpe?g|gif|webp|bmp|svg)$/i, '')
  a.download = cleanName + '.png'
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
      canReceiveInput: true,
      canProduceOutput: true,
      acceptsInputs: ['image', 'text'],
      resizable: false,
      selfRender: true,
    })

    // 注册命令
    context.commands.register({ id: 'image.upload', source: 'node:image', title: '上传图片', run: handleImageUpload })
    context.commands.register({ id: 'image.crop', source: 'node:image', title: '裁剪', run: handleImageCrop })
    context.commands.register({ id: 'image.cropConfirm', source: 'node:image', title: '确认裁剪', run: handleImageCropConfirm })
    context.commands.register({ id: 'image.cropCancel', source: 'node:image', title: '取消裁剪', run: handleImageCropCancel })
    context.commands.register({ id: 'image.expand', source: 'node:image', title: '扩展', run: handleImageExpand })
    context.commands.register({ id: 'image.expandConfirm', source: 'node:image', title: '确认扩展', run: handleImageExpandConfirm })
    context.commands.register({ id: 'image.expandCancel', source: 'node:image', title: '取消扩展', run: handleImageExpandCancel })
    context.commands.register({ id: 'image.mask', source: 'node:image', title: '蒙版', run: handleImageMask })
    context.commands.register({ id: 'image.maskConfirm', source: 'node:image', title: '确认蒙版', run: handleImageMaskConfirm })
    context.commands.register({ id: 'image.maskCancel', source: 'node:image', title: '取消蒙版', run: handleImageMaskCancel })
    context.commands.register({ id: 'image.maskClear', source: 'node:image', title: '清除蒙版', run: handleImageMaskClear })
    context.commands.register({ id: 'image.maskEraser', source: 'node:image', title: '橡皮擦', run: handleImageMaskEraser })
    // no-op: MaskBrushButton customRender 自己处理交互，不通过命令
    context.commands.register({ id: 'image.maskBrushConfig', source: 'node:image', title: '画笔配置', run: () => {} })
    context.commands.register({ id: 'image.filter', source: 'node:image', title: '滤镜', run: handleImageFilter })
    context.commands.register({ id: 'image.rotate', source: 'node:image', title: '旋转', run: handleImageRotate })
    context.commands.register({ id: 'image.download', source: 'node:image', title: '下载', run: handleImageDownload })

    context.menus.register('node:image', { id: 'image:download', source: 'node:image', commandId: 'image.download', title: '下载', icon: downloadSvg, areas: ['node'], nodeTypes: ['image'], order: 40 })

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
    // top: 蒙版入口按钮（default 组）
    context.toolbars.register('node:image', { id: 'image.mask', source: 'node:image', commandId: 'image.mask', position: 'top', title: '蒙版', icon: maskSvg, tooltip: '绘制蒙版', nodeTypes: ['image'], group: 'default', order: 27 })
    // top: mask 组 — 仅蒙版模式下显示
    // MaskBrushButton 渲染 3 个按钮：菜单配置、画笔、橡皮擦
    context.toolbars.register('node:image', { id: 'image.maskBrushConfig', source: 'node:image', commandId: 'image.maskBrushConfig', position: 'top', title: '', tooltip: '画笔配置', nodeTypes: ['image'], group: 'mask', order: 5, customRender: markRaw(MaskBrushButton), visible: (ctx) => ctx.node?.data?._overlay?._maskMode === true })
    // 清除
    context.toolbars.register('node:image', { id: 'image.maskClear', source: 'node:image', commandId: 'image.maskClear', position: 'top', title: '清除', icon: cancelSvg, tooltip: '清除蒙版', nodeTypes: ['image'], group: 'mask', order: 20, visible: (ctx) => ctx.node?.data?._overlay?._maskMode === true, danger: true })
    // 确认 / 取消
    context.toolbars.register('node:image', { id: 'image.maskConfirm', source: 'node:image', commandId: 'image.maskConfirm', position: 'top', title: '完成', icon: confirmSvg, tooltip: '确认蒙版', nodeTypes: ['image'], group: 'mask', order: 30, visible: (ctx) => ctx.node?.data?._overlay?._maskMode === true })
    context.toolbars.register('node:image', { id: 'image.maskCancel', source: 'node:image', commandId: 'image.maskCancel', position: 'top', title: '取消', icon: cancelSvg, tooltip: '取消蒙版', nodeTypes: ['image'], group: 'mask', order: 35, visible: (ctx) => ctx.node?.data?._overlay?._maskMode === true, danger: true })
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
