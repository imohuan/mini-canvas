import { markRaw } from 'vue'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'
import { TextNode } from './index'

const boldSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg>`
const fontSizeSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`
const colorSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 2a10 10 0 010 20"/></svg>`
const alignSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/></svg>`
const copySvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`
const deleteSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`

// stub 命令实现 — 后续可接入富文本编辑
function noopCmd(ctx: CommandContext) { ctx.logger.debug('text command stub:', ctx.node?.id) }

export const TextNodePlugin: CanvasPlugin = {
  name: 'node:text',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'text', node: markRaw(TextNode), label: '文本',
      defaultSize: { cardWidth: 300, cardHeight: 200 },
      menuItem: { label: '文本', description: '创建文本节点', icon: 'text' },
      canReceiveInput: false, resizable: true,
    })

    context.commands.register({ id: 'text.bold', source: 'node:text', run: noopCmd })
    context.commands.register({ id: 'text.fontsize', source: 'node:text', run: noopCmd })
    context.commands.register({ id: 'text.color', source: 'node:text', run: noopCmd })
    context.commands.register({ id: 'text.align', source: 'node:text', run: noopCmd })
    context.commands.register({ id: 'text.copy', source: 'node:text', run: noopCmd })
    context.commands.register({ id: 'text.delete', source: 'node:text', run: noopCmd })

    context.toolbars.register('node:text', { id: 'text.bold', source: 'node:text', commandId: 'text.bold', position: 'top', title: '加粗', icon: boldSvg, nodeTypes: ['text'], order: 10 })
    context.toolbars.register('node:text', { id: 'text.fontsize', source: 'node:text', commandId: 'text.fontsize', position: 'top', title: '字号', icon: fontSizeSvg, nodeTypes: ['text'], order: 20 })
    context.toolbars.register('node:text', { id: 'text.color', source: 'node:text', commandId: 'text.color', position: 'top', title: '颜色', icon: colorSvg, nodeTypes: ['text'], order: 30 })
    context.toolbars.register('node:text', { id: 'text.align', source: 'node:text', commandId: 'text.align', position: 'top', title: '对齐', icon: alignSvg, nodeTypes: ['text'], order: 40 })
    context.toolbars.register('node:text', { id: 'text.copy', source: 'node:text', commandId: 'text.copy', position: 'bottom', title: '复制', icon: copySvg, nodeTypes: ['text'], order: 10 })
    context.toolbars.register('node:text', { id: 'text.delete', source: 'node:text', commandId: 'text.delete', position: 'bottom', title: '删除', icon: deleteSvg, nodeTypes: ['text'], order: 20 })

    return {
      uninstall() {
        context.canvasNodes.unregister('text')
        context.toolbars.unregisterSource('node:text')
        context.commands.unregisterSource('node:text')
      },
    }
  },
}