/**
 * composerKeys —— 输入框那套按键口径（纯逻辑，零 Vue / 零 DOM，可单测）。
 *
 * 为什么要单独一层：这是条**改过**的用户口径 —— 原来是「Enter 直接发送」，
 * 2026-10-11 改成「**Ctrl / Cmd + Enter 才提交**」，单独 Enter 留给换行。
 * 判定必须同时照顾三件事，写在组件里就变成一眼看不全的 if 串：
 *   ① 跨平台：macOS 用 Cmd（metaKey），其它用 Ctrl；
 *   ② 输入法：中文打字时按回车是在**选词**，不能当成提交；
 *   ③ 不给别的键误伤：只有 Enter 家族参与判定。
 */

/** 判定只需要这几个字段 —— 不写 KeyboardEvent 全量，测试里造一个对象就能跑 */
export interface ComposerKeyInfo {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  /** 输入法合成中（KeyboardEvent.isComposing；合成期间的回车只是选词） */
  isComposing?: boolean
}

/**
 * 这次按键算不算「提交」？
 *
 * 口径（用户 2026-10-11）：「我希望改成按 Ctrl+回车进行提交，Ctrl+回车才触发它的这个提交功能」。
 * 所以规则很窄：**Enter 家族 + 按住 Ctrl 或 Cmd**，且不在输入法合成中。
 * Shift 是 Ctrl+Enter 之外的旁枝（Shift+Ctrl+Enter 也算提交，用户按下去的意思就是提交），
 * 但单独的 Shift+Enter 不算 —— 那是软换行。
 */
export function isSubmitShortcut(e: ComposerKeyInfo): boolean {
  if (e.key !== 'Enter') return false
  if (e.isComposing) return false
  return !!(e.ctrlKey || e.metaKey)
}
