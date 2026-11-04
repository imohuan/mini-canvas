/** 预览页的演示数据（菜单命令）。 */

export interface PreviewCommand {
  value: string
  label: string
  group: string
  shortcut: string
}

export const COMMANDS: PreviewCommand[] = [
  { value: 'new-canvas', label: '新建画布', group: '画布', shortcut: '⌘ N' },
  { value: 'new-image', label: '新建图片节点', group: '节点', shortcut: '⌘ ⇧ I' },
  { value: 'export', label: '导出画布', group: '画布', shortcut: '⌘ E' },
  { value: 'settings', label: '打开设置', group: '系统', shortcut: '⌘ ,' },
]
