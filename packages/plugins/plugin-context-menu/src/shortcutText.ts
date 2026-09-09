/**
 * shortcutText —— 命令 keys（机器串）→ 右键菜单右侧的可读快捷键文本（纯逻辑，可单测）。
 *
 * v2 命令 keys 用跨平台修饰键 'mod'（win/linux=ctrl、mac=⌘），显示时不能原样输出；
 * 本函数把组合串拆段、逐段译成可读键帽名再拼回（'mod+shift+z' → 'Ctrl+Shift+Z'）。
 * 多条 keys（如 ['Delete','Backspace']）用 ' / ' 连接。
 */

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
}

function capLabel(part: string): string {
  switch (part.toLowerCase()) {
    case 'mod':
    case 'cmd':
      return isMacPlatform() ? '⌘' : 'Ctrl'
    case 'ctrl':
    case 'control':
      return 'Ctrl'
    case 'meta':
      return isMacPlatform() ? '⌘' : 'Win'
    case 'shift':
      return 'Shift'
    case 'alt':
    case 'option':
      return isMacPlatform() ? '⌥' : 'Alt'
    case 'enter':
      return 'Enter'
    case 'escape':
    case 'esc':
      return 'Esc'
    case 'space':
      return 'Space'
    case 'backspace':
      return '⌫'
    case 'delete':
      return 'Del'
    case 'tab':
      return 'Tab'
    case 'arrowup':
      return '↑'
    case 'arrowdown':
      return '↓'
    case 'arrowleft':
      return '←'
    case 'arrowright':
      return '→'
    default:
      if (part.length === 1) return part.toUpperCase()
      return part.charAt(0).toUpperCase() + part.slice(1)
  }
}

/** keys 数组 → 可读文本（多键用 ' / ' 分隔） */
export function shortcutText(keys: string[] | undefined): string {
  if (!keys || keys.length === 0) return ''
  return keys
    .map((combo) =>
      combo
        .split('+')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => capLabel(p))
        .join('+'),
    )
    .join(' / ')
}

/** 把单条组合串拆成已翻译键帽数组（'mod+shift+z' → ['Ctrl'|'⌘','Shift','Z']） */
export function comboChips(combo: string): string[] {
  return combo
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => capLabel(p))
}

/** keys 数组 → 键帽组列表（每条组合一组；供菜单/面板渲染 kbd 键帽） */
export function splitComboChips(
  keys: string[] | undefined,
): Array<{ combo: string[] }> {
  if (!keys || keys.length === 0) return []
  return keys.map((combo) => ({ combo: comboChips(combo) }))
}
