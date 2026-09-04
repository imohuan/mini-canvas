# 快捷键录制 Alt 组合录不到的根因与修复

## 结论

原 `RemapPanel.vue` 录制组合键时，靠"收集独立修饰键的 keydown 事件"来判断按住哪些修饰键：

```ts
// 旧逻辑
if (MODIFIER_KEYS.has(keyName)) { heldModifiers.add(keyName); ... return }
...
captureCandidate(formatShortcut(keyName, heldModifiers))
```

**这是错误的假设。** 真实浏览器（用 CDP 真实输入复现）在按下组合键 `Alt+A` 时：

```
keydown key='A' altKey=true   ← 只有这一个 keydown！
keyup   key='A'
keyup   key='Alt'
```

- 组合键下**不派发独立的 `Alt` keydown**，Alt 只是作为 `A` 事件上的 `altKey=true` 标志。
- 于是 `heldModifiers` 永远没有 `Alt`，录制输出变成单键 `a`（Alt 丢了）。

## 修复

录制捕获普通键时，改用事件的修饰键**标志位**组装，而不是 keydown 收集：

```ts
function formatShortcutFromEvent(e: KeyboardEvent, key: string): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  if (e.metaKey) parts.push('meta')
  parts.push(key.toLowerCase())
  return parts.join('+')
}
```

浏览器验证：
- `Alt+A` → `alt+a` ✓
- `Control+Shift+S` → `ctrl+shift+s` ✓

纯修饰键收尾（长按兜底 + keyup）保留，仅在有独立修饰键 keydown 派发的环境中生效。
