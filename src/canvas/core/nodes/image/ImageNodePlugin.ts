import { markRaw } from 'vue'
import type { Node } from '@vue-flow/core'
import { ImageNode } from './index'
import ImageUploadButton from './ImageUploadButton.vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'

// ---- SVG icons ----
const cropSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`
const filterSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke-linecap="round"/></svg>`
const rotateSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>`
const downloadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

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
      resizable: true,
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

  // 进入裁剪模式
  vf.updateNode(nodeId, { data: { ...(node.data as any), _cropMode: true } })
  vf.fitView({ nodes: [nodeId], padding: 0.15, maxZoom: 4, duration: 250 })
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
      menuItem: { label: '图片', description: '创建图片节点', icon: 'image' },
      canReceiveInput: true, resizable: false,
    })

    // 注册命令
    context.commands.register({ id: 'image.upload', source: 'node:image', title: '上传图片', run: handleImageUpload })
    context.commands.register({ id: 'image.crop', source: 'node:image', title: '裁剪', run: handleImageCrop })
    context.commands.register({ id: 'image.filter', source: 'node:image', title: '滤镜', run: handleImageFilter })
    context.commands.register({ id: 'image.rotate', source: 'node:image', title: '旋转', run: handleImageRotate })
    context.commands.register({ id: 'image.download', source: 'node:image', title: '下载', run: handleImageDownload })

    // 注册 toolbar 按钮
    context.toolbars.register('node:image', { id: 'image.upload', source: 'node:image', commandId: 'image.upload', position: 'top', title: '上传图片', tooltip: '点击上传本地图片', nodeTypes: ['image'], order: 10, customRender: markRaw(ImageUploadButton) })
    context.toolbars.register('node:image', { id: 'image.crop', source: 'node:image', commandId: 'image.crop', position: 'top', title: '裁剪', icon: cropSvg, tooltip: '裁剪图片', nodeTypes: ['image'], order: 20 })
    context.toolbars.register('node:image', { id: 'image.filter', source: 'node:image', commandId: 'image.filter', position: 'top', title: '滤镜', icon: filterSvg, nodeTypes: ['image'], order: 30, dropdown: [{ id: 'none', title: '无滤镜' }, { id: 'grayscale', title: '黑白' }, { id: 'sepia', title: '复古' }] })
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