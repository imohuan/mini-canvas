import { markRaw } from 'vue'
import type { Node } from '@vue-flow/core'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'
import { StageNode } from './index'

const castSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`
const configSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.77 3.77z"/></svg>`
const exportSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
const copySvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`
const deleteSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`
// advanced 组图标
const layoutSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`
const themeSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 000 20z" fill="currentColor"/></svg>`
// 切换器图标
const switchAdvSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`
const switchBaseSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`

// 菜单图标（CanvasMenu 使用）
const menuIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 5-9 5-9-5 9-5Z" stroke-linejoin="round"/><path d="M3 12l9 5 9-5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 16l9 5 9-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
// 标题图标（BaseNode title 使用）
const titleIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 5-9 5-9-5 9-5Z" stroke-linejoin="round"/><path d="M3 12l9 5 9-5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 16l9 5 9-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

function noopCmd(ctx: CommandContext) { ctx.logger.debug('stage command stub:', ctx.node?.id) }

/** 切换节点工具组：写入 _overlay._toolbarGroup，BaseToolbar 自动响应重渲染 */
function switchToolbarGroup(ctx: CommandContext, group: string | undefined) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return
  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  vf.updateNode(nodeId, { data: { ...(node?.data ?? {}), _overlay: { _toolbarGroup: group } } })
}

export const StageNodePlugin: CanvasPlugin = {
  name: 'node:stage',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'stage', node: markRaw(StageNode), label: '导演台',
      defaultSize: { cardWidth: 320, cardHeight: 320 },
      menuItem: { label: '导演台', description: '创建编排节点', icon: menuIconSvg, badge: 'NEW' },
      canReceiveInput: true, resizable: false,
      titleIcon: titleIconSvg,
    })

    // —— 命令 ——
    // basic 组命令
    context.commands.register({ id: 'stage.cast', source: 'node:stage', run: noopCmd })
    context.commands.register({ id: 'stage.config', source: 'node:stage', run: noopCmd })
    // advanced 组命令
    context.commands.register({ id: 'stage.layout', source: 'node:stage', run: noopCmd })
    context.commands.register({ id: 'stage.theme', source: 'node:stage', run: noopCmd })
    // 切换器命令
    context.commands.register({ id: 'stage.toAdvanced', source: 'node:stage', run: (ctx) => switchToolbarGroup(ctx, 'advanced') })
    context.commands.register({ id: 'stage.toBasic', source: 'node:stage', run: (ctx) => switchToolbarGroup(ctx, 'basic') })
    // bottom 命令（不参与组切换）
    context.commands.register({ id: 'stage.export', source: 'node:stage', run: noopCmd })
    context.commands.register({ id: 'stage.copy', source: 'node:stage', run: noopCmd })
    context.commands.register({ id: 'stage.delete', source: 'node:stage', run: noopCmd })

    // —— top toolbar ——
    // basic 组：角色、配置
    context.toolbars.register('node:stage', { id: 'stage.cast', source: 'node:stage', commandId: 'stage.cast', position: 'top', title: '角色', icon: castSvg, nodeTypes: ['stage'], group: 'basic', order: 10 })
    context.toolbars.register('node:stage', { id: 'stage.config', source: 'node:stage', commandId: 'stage.config', position: 'top', title: '配置', icon: configSvg, nodeTypes: ['stage'], group: 'basic', order: 20 })
    // advanced 组：布局、主题
    context.toolbars.register('node:stage', { id: 'stage.layout', source: 'node:stage', commandId: 'stage.layout', position: 'top', title: '布局', icon: layoutSvg, nodeTypes: ['stage'], group: 'advanced', order: 10 })
    context.toolbars.register('node:stage', { id: 'stage.theme', source: 'node:stage', commandId: 'stage.theme', position: 'top', title: '主题', icon: themeSvg, nodeTypes: ['stage'], group: 'advanced', order: 20 })
    // 切换器（不标 group → 永远显示，用 visible 互斥省空间）
    context.toolbars.register('node:stage', { id: 'stage.toAdvanced', source: 'node:stage', commandId: 'stage.toAdvanced', position: 'top', title: '高级', icon: switchAdvSvg, tooltip: '切换到高级工具组', nodeTypes: ['stage'], order: 0, visible: (ctx) => (ctx.node?.data as any)?._overlay?._toolbarGroup !== 'advanced' })
    context.toolbars.register('node:stage', { id: 'stage.toBasic', source: 'node:stage', commandId: 'stage.toBasic', position: 'top', title: '基础', icon: switchBaseSvg, tooltip: '切回基础工具组', nodeTypes: ['stage'], order: 0, visible: (ctx) => (ctx.node?.data as any)?._overlay?._toolbarGroup === 'advanced' })

    // —— bottom toolbar（不标 group，始终显示，作对比）——
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