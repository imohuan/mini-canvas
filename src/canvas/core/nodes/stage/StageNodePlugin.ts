import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'
import { StageNode } from './index'

const castSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`
const configSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.77 3.77z"/></svg>`
const exportSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
const copySvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`
const deleteSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`

function noopCmd(ctx: CommandContext) { ctx.logger.debug('stage command stub:', ctx.node?.id) }

export const StageNodePlugin: CanvasPlugin = {
  name: 'node:stage',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'stage', node: markRaw(StageNode), label: '导演台',
      defaultSize: { cardWidth: 320, cardHeight: 320 },
      menuItem: { label: '导演台', description: '创建编排节点', icon: 'layers', badge: 'NEW' },
      canReceiveInput: true, resizable: false,
    })

    context.commands.register({ id: 'stage.cast', source: 'node:stage', run: noopCmd })
    context.commands.register({ id: 'stage.config', source: 'node:stage', run: noopCmd })
    context.commands.register({ id: 'stage.export', source: 'node:stage', run: noopCmd })
    context.commands.register({ id: 'stage.copy', source: 'node:stage', run: noopCmd })
    context.commands.register({ id: 'stage.delete', source: 'node:stage', run: noopCmd })

    context.toolbars.register('node:stage', { id: 'stage.cast', source: 'node:stage', commandId: 'stage.cast', position: 'top', title: '角色', icon: castSvg, nodeTypes: ['stage'], order: 10 })
    context.toolbars.register('node:stage', { id: 'stage.config', source: 'node:stage', commandId: 'stage.config', position: 'top', title: '配置', icon: configSvg, nodeTypes: ['stage'], order: 20 })
    context.toolbars.register('node:stage', { id: 'stage.export', source: 'node:stage', commandId: 'stage.export', position: 'bottom', title: '导出', icon: exportSvg, nodeTypes: ['stage'], order: 10 })
    context.toolbars.register('node:stage', { id: 'stage.copy', source: 'node:stage', commandId: 'stage.copy', position: 'bottom', title: '复制', icon: copySvg, nodeTypes: ['stage'], order: 20 })
    context.toolbars.register('node:stage', { id: 'stage.delete', source: 'node:stage', commandId: 'stage.delete', position: 'bottom', title: '删除', icon: deleteSvg, nodeTypes: ['stage'], order: 30 })

    return {
      uninstall() {
        context.canvasNodes.unregister('stage')
        context.toolbars.unregisterSource('node:stage')
        context.commands.unregisterSource('node:stage')
      },
    }
  },
}