import type { PluginContext } from '../types'
import type { MenuItemDefinition } from '../../registry/types'

/**
 * 注册系统自带的右键菜单项
 *
 * 这些是画布核心功能，通过 commandId 引用命令。
 * 命令的 disabled 状态由 CommandRegistry 管理，菜单渲染时自动读取。
 */
export function registerBuiltinMenuItems(ctx: PluginContext): void {
  // ---- 核心命令 ----

  ctx.commands.register({
    id: 'core.deleteNode',
    source: 'context-menu',
    title: '删除节点',
    run(_cmdCtx) {
      const ids = [...ctx.selection.getSelectedNodeIds()]
      if (ids.length > 0) {
        ctx.actions.removeNodes(ids)
        ctx.selection.clearSelection()
      }
    },
  })

  ctx.commands.register({
    id: 'core.deleteEdge',
    source: 'context-menu',
    title: '删除连线',
    run(_cmdCtx) {
      const ids = [...ctx.selection.getSelectedEdgeIds()]
      if (ids.length > 0) {
        ctx.actions.removeEdges(ids)
        ctx.selection.clearSelection()
      }
    },
  })

  ctx.commands.register({
    id: 'clipboard.copy',
    source: 'context-menu',
    title: '复制',
    run(_cmdCtx) {
      const nodes = ctx.actions.getNodes().filter(n => ctx.selection.getSelectedNodeIds().has(n.id))
      if (nodes.length > 0) {
        ctx.emit('clipboard:copy', { nodes })
      }
    },
  })

  ctx.commands.register({
    id: 'clipboard.duplicate',
    source: 'context-menu',
    title: '复制一份',
    run(_cmdCtx) {
      const nodes = ctx.actions.getNodes().filter(n => ctx.selection.getSelectedNodeIds().has(n.id))
      if (nodes.length > 0) {
        ctx.emit('clipboard:duplicate', { nodes })
      }
    },
  })

  // ---- 节点操作 ----

  ctx.menus.register('context-menu', {
    id: 'node:copy',
    commandId: 'clipboard.copy',
    title: '复制',
    icon: 'duplicate',
    shortcut: 'Ctrl+C',
    areas: ['node'],
    order: 30,
  } as MenuItemDefinition)

  ctx.menus.register('context-menu', {
    id: 'node:duplicate',
    commandId: 'clipboard.duplicate',
    title: '复制一份',
    icon: 'duplicate',
    shortcut: 'Ctrl+D',
    areas: ['node'],
    order: 20,
  } as MenuItemDefinition)

  ctx.menus.register('context-menu', {
    id: 'node:delete',
    commandId: 'core.deleteNode',
    title: '删除节点',
    icon: 'delete',
    shortcut: 'Del',
    danger: true,
    areas: ['node'],
    order: 10,
  } as MenuItemDefinition)

  // ---- 边操作 ----

  ctx.menus.register('context-menu', {
    id: 'edge:delete',
    commandId: 'core.deleteEdge',
    title: '删除连线',
    icon: 'delete',
    shortcut: 'Del',
    danger: true,
    areas: ['edge'],
    order: 10,
  } as MenuItemDefinition)
}