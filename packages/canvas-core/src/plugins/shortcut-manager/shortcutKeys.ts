/**
 * 把快捷键字符串拆成片段数组。
 *
 * 示例：
 *   splitShortcutKeys('ctrl+shift+z')  // ['ctrl', 'shift', 'z']
 *   splitShortcutKeys('Delete')        // ['Delete']
 *   splitShortcutKeys('  ctrl + a ')   // ['ctrl', 'a']
 *
 * 拆分规则：以 `+` 分割并去除空白，空段自动丢弃。
 */
export function splitShortcutKeys(keys: string): string[] {
  if (!keys) return []
  return keys
    .split('+')
    .map(p => p.trim())
    .filter(Boolean)
}

/**
 * 把键位字符串规范化为小写规范形式（用于 remap 录入前）。
 * 这里仅做展示层归一：去空白 + 转小写。
 */
export function normalizeKeysForDisplay(keys: string): string {
  return splitShortcutKeys(keys).join('+')
}
