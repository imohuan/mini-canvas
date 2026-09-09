/**
 * keyLabels —— 键帽显示名翻译（纯逻辑、零 Vue/DOM，可单测）。
 *
 * v2 命令 keys 是跨平台写法：修饰键用 'mod'（宿主 keyComboMatches 里 = ctrl 或 meta 任一，
 * 按平台分发）。帮助面板/重映射面板展示时不能把 'mod' 原样打出，须译成当前平台可读键帽：
 *   win/linux → Ctrl；macOS → ⌘。
 * 其余修饰键（ctrl/alt/shift/meta/cmd）与功能键（方向/删除/回车…）一并翻译成键帽惯用名。
 */

/** 当前是否 macOS（⌘/⌥ 显示用；无 navigator 环境（SSR/测试）回落非 mac） */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '')
}

/** 单段键名 → 键帽显示名 */
export function keyCapLabel(part: string): string {
  const p = part.toLowerCase()
  switch (p) {
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
    case 'plus':
      return '+'
    case 'minus':
      return '-'
    case 'equal':
      return '='
    case 'pageup':
      return 'PgUp'
    case 'pagedown':
      return 'PgDn'
    case 'home':
      return 'Home'
    case 'end':
      return 'End'
    case 'capslock':
      return 'Caps'
    default:
      // 单字符字母 → 大写（z → Z）；其它原样首字母大写（如 '/', 'F1' → 原样）
      if (part.length === 1) return part.toUpperCase()
      return part.charAt(0).toUpperCase() + part.slice(1)
  }
}

/** 完整组合串 → 键帽片段数组（'mod+shift+z' → ['Ctrl'|'⌘','Shift','Z']） */
export function keyPartsToLabels(keys: string): string[] {
  if (!keys) return []
  return keys
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => keyCapLabel(p))
}

/** 把 v2 命令的跨平台修饰键 'mod' 归一成当前平台的保留键写法（win→ctrl / mac→meta），小写去空格 */
export function normalizeKeyForPlatform(keys: string): string {
  const mod = isMacPlatform() ? 'meta' : 'ctrl'
  return keys
    .toLowerCase()
    .replace(/\bmod\b/g, mod)
    .replace(/\s+/g, '')
}
