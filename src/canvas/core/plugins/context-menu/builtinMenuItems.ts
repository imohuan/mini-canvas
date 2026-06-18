import type { MenuItemDefinition } from '../../menu/MenuRegistry'

export function createBuiltinMenuItems(): MenuItemDefinition[] {
  return [
    { id: 'node:copy', group: 'action', label: '复制', shortcut: 'Ctrl+C', icon: 'duplicate', visible: ctx => ctx.mode === 'node', priority: 30 },
    { id: 'node:duplicate', group: 'action', label: '复制一份', shortcut: 'Ctrl+D', icon: 'duplicate', visible: ctx => ctx.mode === 'node', priority: 20 },
    { id: 'node:delete', group: 'delete', label: '删除节点', shortcut: 'Del', icon: 'delete', danger: true, visible: ctx => ctx.mode === 'node', priority: 10 },
    { id: 'edge:delete', group: 'delete', label: '删除连线', shortcut: 'Del', icon: 'delete', danger: true, visible: ctx => ctx.mode === 'edge', priority: 10 },
  ]
}