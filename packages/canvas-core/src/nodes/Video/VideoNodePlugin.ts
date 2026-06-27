import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'
import { VideoNode } from './index'

const playSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg>`
const cropSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/><polyline points="16 3 21 3 21 8"/><line x1="21" y1="3" x2="11" y2="13"/></svg>`
const exportFrameSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`
const replaceSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`

// 菜单图标（CanvasMenu 使用）
const menuIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="12" height="14" rx="2"/><path d="M16 9l5-3v12l-5-3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
// 标题图标（BaseNode title 使用）
const titleIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`

function noopCmd(ctx: CommandContext) { ctx.logger.debug('video command stub:', ctx.node?.id) }

export const VideoNodePlugin: CanvasPlugin = {
  name: 'node:video',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'video', node: markRaw(VideoNode), label: '视频',
      defaultSize: { cardWidth: 480, cardHeight: 320 },
      menuItem: { label: '视频', description: '创建视频节点', icon: menuIconSvg },
      canReceiveInput: true, resizable: false,
      titleIcon: titleIconSvg,
    })

    context.commands.register({ id: 'video.play', source: 'node:video', run: noopCmd })
    context.commands.register({ id: 'video.crop', source: 'node:video', run: noopCmd })
    context.commands.register({ id: 'video.export-frame', source: 'node:video', run: noopCmd })
    context.commands.register({ id: 'video.replace', source: 'node:video', run: noopCmd })

    context.toolbars.register('node:video', { id: 'video.play', source: 'node:video', commandId: 'video.play', position: 'top', title: '播放', icon: playSvg, nodeTypes: ['video'], order: 10 })
    context.toolbars.register('node:video', { id: 'video.crop', source: 'node:video', commandId: 'video.crop', position: 'top', title: '裁剪', icon: cropSvg, nodeTypes: ['video'], order: 20 })
    context.toolbars.register('node:video', { id: 'video.export-frame', source: 'node:video', commandId: 'video.export-frame', position: 'bottom', title: '导出帧', icon: exportFrameSvg, nodeTypes: ['video'], order: 10 })
    context.toolbars.register('node:video', { id: 'video.replace', source: 'node:video', commandId: 'video.replace', position: 'bottom', title: '替换', icon: replaceSvg, nodeTypes: ['video'], order: 20 })

    return {
      uninstall() {
        context.canvasNodes.unregister('video')
        context.toolbars.unregisterSource('node:video')
        context.commands.unregisterSource('node:video')
      },
    }
  },
}