/**
 * videoClipKeys —— 剪辑条的键盘交互（纯函数，Node 可单测）。
 *
 * 复刻 demo 的快捷键语义（见截图右侧配置面板）：方向键动选区、Shift 按住 = 精确
 * 微调（0.1s 档）、I/O 设出入点、空格播放/暂停、Esc 退出、Enter 确认。
 * 判定拆成纯函数：组件里只做「把事件交给它 → 拿到该做什么」。
 */

/** 一次键位判定的输入（组件把 KeyboardEvent 的字段原样传进来，便于单测） */
export interface ClipKeyInput {
  key: string
  shift: boolean
  ctrl: boolean
  meta: boolean
}

/** 判定结果：kind 是「要做的动作」，seconds 是方向键的微调量（非方向键为 0） */
export type ClipKeyAction =
  | { kind: 'none' }
  | { kind: 'nudge-edge'; edge: 'start' | 'end'; seconds: number }
  | { kind: 'move'; seconds: number }
  | { kind: 'set-in' }
  | { kind: 'set-out' }
  | { kind: 'toggle-play' }
  | { kind: 'exit' }
  | { kind: 'confirm' }

/** 方向键普通步长（秒）：与 demo 的 0.25s 一致；Shift 按住 = 精确模式 0.1s */
const NUDGE_STEP = 0.25
const NUDGE_STEP_FINE = 0.1
/** Ctrl/Meta 按住 = 快速调整 1s（对应配置面板的「快速调整 Ctrl+↑/↓」） */
const NUDGE_STEP_FAST = 1

/** 输入框聚焦时按键不进剪辑条（否则打字会拖动选区） */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** 键盘事件 → 动作。不认识的键返回 none（组件直接忽略） */
export function clipKeyAction(input: ClipKeyInput): ClipKeyAction {
  const step = input.shift ? NUDGE_STEP_FINE : input.ctrl || input.meta ? NUDGE_STEP_FAST : NUDGE_STEP
  switch (input.key) {
    case 'ArrowLeft':
      return { kind: 'move', seconds: -step }
    case 'ArrowRight':
      return { kind: 'move', seconds: step }
    case 'ArrowUp':
      return { kind: 'nudge-edge', edge: 'start', seconds: -step }
    case 'ArrowDown':
      return { kind: 'nudge-edge', edge: 'end', seconds: step }
    case 'i':
    case 'I':
      return { kind: 'set-in' }
    case 'o':
    case 'O':
      return { kind: 'set-out' }
    case ' ':
      return { kind: 'toggle-play' }
    case 'Escape':
      return { kind: 'exit' }
    case 'Enter':
      return { kind: 'confirm' }
    default:
      return { kind: 'none' }
  }
}
