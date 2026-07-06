import { markRaw } from 'vue'
import type { Node } from '@vue-flow/core'
import { VideoNode } from './index'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'
import { makeVideoResultNode } from './videoNodeUtils'

const clipSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16"/><path d="M4 17h16"/><path d="M8 4v16"/><path d="M16 4v16"/></svg>`
const cropSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2v14a2 2 0 002 2h14"/><path d="M2 6h14a2 2 0 012 2v14"/></svg>`
const downloadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
const fullscreenSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
const cameraSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`
const confirmSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
const cancelSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`

const menuIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="12" height="14" rx="2"/><path d="M16 9l5-3v12l-5-3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const titleIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`

type RectLike = { x: number; y: number; width: number; height: number }

function getRuntime(ctx: CommandContext) {
  return ctx.runtime as any
}
function getVueFlow(ctx: CommandContext) {
  return getRuntime(ctx)?.vueFlowInstance
}
function getNode(ctx: CommandContext): Node | null {
  const nodeId = ctx.node?.id
  if (!nodeId) return null
  const vf = getVueFlow(ctx)
  if (!vf) return (ctx.node as Node) || null
  return (vf.getNodes.value as Node[]).find((n) => n.id === nodeId) || null
}
function updateNodeData(ctx: CommandContext, data: Record<string, unknown>) {
  const vf = getVueFlow(ctx)
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return
  vf.updateNode(nodeId, { data })
}
function cleanOverlay(ctx: CommandContext) {
  const node = getNode(ctx)
  if (!node) return null
  const data = { ...(node.data as any) }
  delete data._overlay
  updateNodeData(ctx, data)
  return { ...node, data } as Node
}

function handleVideoCrop(ctx: CommandContext) {
  const node = getNode(ctx)
  const vf = getVueFlow(ctx)
  if (!node || !vf || !(node.data as any)?.videoUrl) return
  const w = Number((node.data as any).videoWidth) || 640
  const h = Number((node.data as any).videoHeight) || 360
  updateNodeData(ctx, {
    ...(node.data as any),
    _overlay: {
      _cropMode: true,
      _toolbarGroup: 'crop',
      _cropRect: { x: 0, y: 0, width: w, height: h },
    },
  })
  vf.fitView({ nodes: [node.id], padding: 0.15, maxZoom: 4, duration: 250 })
}

function handleVideoCropConfirm(ctx: CommandContext) {
  const vf = getVueFlow(ctx)
  const node = getNode(ctx)
  if (!vf || !node) return
  const rect = (node.data as any)?._overlay?._cropRect as RectLike | undefined
  if (!rect || rect.width <= 0 || rect.height <= 0) return
  const cleanNode = cleanOverlay(ctx) || node
  vf.addNodes([makeVideoResultNode(cleanNode, { suffix: '_crop', cropRect: rect })])
}

function handleVideoCropCancel(ctx: CommandContext) {
  cleanOverlay(ctx)
}

function handleVideoClip(ctx: CommandContext) {
  const node = getNode(ctx)
  const vf = getVueFlow(ctx)
  if (!node || !vf || !(node.data as any)?.videoUrl) return
  const duration = Number((node.data as any).videoDuration) || 0.1
  updateNodeData(ctx, {
    ...(node.data as any),
    _overlay: {
      _clipMode: true,
      _toolbarGroup: 'clip',
      _clipRange: {
        start: Number((node.data as any).clipStart) || 0,
        end: Number((node.data as any).clipEnd) || duration,
      },
    },
  })
}

function handleVideoClipConfirm(ctx: CommandContext) {
  const vf = getVueFlow(ctx)
  const node = getNode(ctx)
  if (!vf || !node) return
  const range = (node.data as any)?._overlay?._clipRange as { start: number; end: number } | undefined
  if (!range) return
  const cleanNode = cleanOverlay(ctx) || node
  vf.addNodes([makeVideoResultNode(cleanNode, { suffix: '_clip', clipStart: range.start, clipEnd: range.end })])
}

function handleVideoClipCancel(ctx: CommandContext) {
  cleanOverlay(ctx)
}

function handleVideoFullscreen(ctx: CommandContext) {
  const nodeId = ctx.node?.id
  if (!nodeId) return
  window.dispatchEvent(new CustomEvent('video:fullscreen', { detail: { nodeId } }))
}

function handleVideoCaptureFrame(ctx: CommandContext) {
  const nodeId = ctx.node?.id
  if (!nodeId) return
  window.dispatchEvent(new CustomEvent('video:capture-frame', { detail: { nodeId } }))
}

function handleVideoDownload(ctx: CommandContext) {
  const node = ctx.node
  const url = (node?.data as any)?.videoUrl as string | undefined
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = ((node?.data as any)?.videoName as string) || 'video.mp4'
  a.click()
}

export const VideoNodePlugin: CanvasPlugin = {
  name: 'node:video',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'video', node: markRaw(VideoNode), label: '视频',
      defaultSize: { cardWidth: 480, cardHeight: 320 },
      menuItem: { label: '视频', description: '创建视频节点', icon: menuIconSvg },
      canReceiveInput: true,
      canProduceOutput: true,
      resizable: false,
      acceptsInputs: ['image', 'text', 'video'],
      titleIcon: titleIconSvg,
      selfRender: true,
    })

    context.commands.register({ id: 'video.crop', source: 'node:video', title: '裁剪', run: handleVideoCrop })
    context.commands.register({ id: 'video.cropConfirm', source: 'node:video', title: '确认裁剪', run: handleVideoCropConfirm })
    context.commands.register({ id: 'video.cropCancel', source: 'node:video', title: '取消裁剪', run: handleVideoCropCancel })
    context.commands.register({ id: 'video.clip', source: 'node:video', title: '剪辑', run: handleVideoClip })
    context.commands.register({ id: 'video.clipConfirm', source: 'node:video', title: '确认剪辑', run: handleVideoClipConfirm })
    context.commands.register({ id: 'video.clipCancel', source: 'node:video', title: '取消剪辑', run: handleVideoClipCancel })
    context.commands.register({ id: 'video.fullscreen', source: 'node:video', title: '全屏', run: handleVideoFullscreen })
    context.commands.register({ id: 'video.export-frame', source: 'node:video', title: '截图', run: handleVideoCaptureFrame })
    context.commands.register({ id: 'video.download', source: 'node:video', title: '下载', run: handleVideoDownload })

    context.menus.register('node:video', { id: 'video:download', source: 'node:video', commandId: 'video.download', title: '下载', icon: downloadSvg, areas: ['node'], nodeTypes: ['video'], order: 40 })

    context.toolbars.register('node:video', { id: 'video.clip', source: 'node:video', commandId: 'video.clip', position: 'top', title: '剪辑', icon: clipSvg, tooltip: '剪辑视频', nodeTypes: ['video'], group: 'default', order: 10, visible: (ctx) => !ctx.node?.data?._overlay })
    context.toolbars.register('node:video', { id: 'video.crop', source: 'node:video', commandId: 'video.crop', position: 'top', title: '裁剪', icon: cropSvg, tooltip: '裁剪画面', nodeTypes: ['video'], group: 'default', order: 20, visible: (ctx) => !ctx.node?.data?._overlay })
    context.toolbars.register('node:video', { id: 'video.export-frame', source: 'node:video', commandId: 'video.export-frame', position: 'top', title: '截图', icon: cameraSvg, tooltip: '截图当前帧', nodeTypes: ['video'], group: 'default', order: 30, visible: (ctx) => !ctx.node?.data?._overlay })
    context.toolbars.register('node:video', { id: 'video.download', source: 'node:video', commandId: 'video.download', position: 'top', title: '下载', icon: downloadSvg, tooltip: '下载视频', nodeTypes: ['video'], group: 'default', order: 40, visible: (ctx) => !ctx.node?.data?._overlay })
    context.toolbars.register('node:video', { id: 'video.fullscreen', source: 'node:video', commandId: 'video.fullscreen', position: 'top', title: '全屏', icon: fullscreenSvg, tooltip: '全屏预览', nodeTypes: ['video'], group: 'default', order: 50, visible: (ctx) => !ctx.node?.data?._overlay })

    context.toolbars.register('node:video', { id: 'video.cropConfirm', source: 'node:video', commandId: 'video.cropConfirm', position: 'top', title: '确认', icon: confirmSvg, tooltip: '确认裁剪', nodeTypes: ['video'], group: 'crop', order: 10, visible: (ctx) => ctx.node?.data?._overlay?._cropMode === true })
    context.toolbars.register('node:video', { id: 'video.cropCancel', source: 'node:video', commandId: 'video.cropCancel', position: 'top', title: '取消', icon: cancelSvg, tooltip: '取消裁剪', nodeTypes: ['video'], group: 'crop', order: 20, visible: (ctx) => ctx.node?.data?._overlay?._cropMode === true, danger: true })
    context.toolbars.register('node:video', { id: 'video.clipConfirm', source: 'node:video', commandId: 'video.clipConfirm', position: 'top', title: '确认', icon: confirmSvg, tooltip: '确认剪辑', nodeTypes: ['video'], group: 'clip', order: 10, visible: (ctx) => ctx.node?.data?._overlay?._clipMode === true })
    context.toolbars.register('node:video', { id: 'video.clipCancel', source: 'node:video', commandId: 'video.clipCancel', position: 'top', title: '取消', icon: cancelSvg, tooltip: '取消剪辑', nodeTypes: ['video'], group: 'clip', order: 20, visible: (ctx) => ctx.node?.data?._overlay?._clipMode === true, danger: true })

    return {
      uninstall() {
        context.canvasNodes.unregister('video')
        context.toolbars.unregisterSource('node:video')
        context.commands.unregisterSource('node:video')
      },
    }
  },
}
