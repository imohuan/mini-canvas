/**
 * composerKeys —— 输入框那套按键口径（纯逻辑，零 Vue / 零 DOM，可单测）。
 *
 * 为什么要单独一层：这是条**改过两次**的用户口径 —— 原来是「Enter 直接发送」，
 * 2026-10-11 改成「**Ctrl / Cmd + Enter 才提交**」；2026-10-25 起改成**可选三种**
 * （Ctrl+回车 / Shift+回车 / 回车），默认仍是 Ctrl+回车。
 * 判定必须同时照顾四件事，写在组件里就变成一眼看不全的 if 串：
 *   ① 跨平台：macOS 用 Cmd（metaKey），其它用 Ctrl；
 *   ② 输入法：中文打字时按回车是在**选词**，不能当成提交；
 *   ③ 不给别的键误伤：只有 Enter 家族参与判定。
 *   ④ 用户选的是哪一种「回车」（setting 由全局设置页写）
 */

/** 三种可选的提交键（设置页下拉的顺序就是这里） */
export type SubmitKeyMode = 'ctrl-enter' | 'shift-enter' | 'enter'

/** 下拉的显示文案 —— 与判定放在一起，设置页和测试共用同一份 */
export const SUBMIT_KEY_MODES: readonly { value: SubmitKeyMode; label: string; hint: string }[] = [
  { value: 'ctrl-enter', label: 'Ctrl + 回车', hint: '单独回车换行（默认）' },
  { value: 'shift-enter', label: 'Shift + 回车', hint: '单独回车换行' },
  { value: 'enter', label: '回车', hint: 'Shift + 回车换行' },
]

export const DEFAULT_SUBMIT_KEY_MODE: SubmitKeyMode = 'ctrl-enter'

/** 坏值 / 缺省一律回落默认（KV 里可能存着老形状或手改坏的值） */
export function normalizeSubmitKeyMode(v: unknown): SubmitKeyMode {
  return v === 'shift-enter' || v === 'enter' || v === 'ctrl-enter' ? v : DEFAULT_SUBMIT_KEY_MODE
}

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
 * 口径（用户 2026-10-25）：「希望这里可以做一个开关……可以选择 Ctrl+回车，也可以设置为
 * Shift+回车，或者直接设置为回车」。所以按用户选的那一种判定，且不在输入法合成中：
 *   · ctrl-enter  只认 Ctrl / Cmd（macOS）；
 *   · shift-enter 只认 Shift；
 *   · enter       只认**裸回车**（带 Ctrl / Shift 的不算，留给换行与其它习惯）。
 */
export function isSubmitShortcut(
  e: ComposerKeyInfo,
  mode: SubmitKeyMode = DEFAULT_SUBMIT_KEY_MODE,
): boolean {
  if (e.key !== 'Enter') return false
  if (e.isComposing) return false
  const ctrlOrCmd = !!(e.ctrlKey || e.metaKey)
  if (mode === 'ctrl-enter') return ctrlOrCmd
  if (mode === 'shift-enter') return !!e.shiftKey
  return !ctrlOrCmd && !e.shiftKey
}

/**
 * 回车要不要先让给「@ 下拉」？
 *
 * 背景（用户 2026-10-25）：「输入 @ 弹出下拉后，按回车本来是为了选菜单，结果直接发送了」。
 * 规则只有一条：**菜单开着，回车就归菜单**，与用户选的提交键无关 ——
 * 菜单里回车的语义永远是「选这一项」，不存在「同时想发送」的合理场景。
 * 输入法合成中的回车是在选词，连菜单也不该动它，所以同样放行给浏览器。
 */
export function shouldDeferEnterToMenu(
  e: ComposerKeyInfo,
  menuOpen: boolean,
  composing?: boolean,
): boolean {
  if (!menuOpen) return false
  if (e.key !== 'Enter') return false
  if (e.isComposing || composing) return false
  return true
}

/**
 * 从 config 桶里读「发送键」设置（与 packages/ui 的 agentSettings.ts 同一个键）。
 * 缺 / 坏 → 默认 Ctrl+回车；不抛（后台没起时首屏照常可用）。
 */
export const COMPOSER_PREFS_KEY = 'agentComposerPrefs'
const CONFIG_BUCKET_PATH = '/api/kv/config?values=1'

export async function loadSubmitKeyMode(opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): Promise<SubmitKeyMode> {
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  if (!f) return DEFAULT_SUBMIT_KEY_MODE
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  try {
    const res = await f(base + CONFIG_BUCKET_PATH, { headers: { accept: 'application/json' } })
    if (!res.ok) return DEFAULT_SUBMIT_KEY_MODE
    const body = (await res.json()) as { values?: Record<string, unknown> } | null
    const raw = body?.values?.[COMPOSER_PREFS_KEY]
    if (!raw || typeof raw !== 'object') return DEFAULT_SUBMIT_KEY_MODE
    return normalizeSubmitKeyMode((raw as { submitKeyMode?: unknown }).submitKeyMode)
  } catch {
    return DEFAULT_SUBMIT_KEY_MODE
  }
}
