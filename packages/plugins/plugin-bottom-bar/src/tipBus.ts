/**
 * tipBus —— **通用鼠标跟随提示**（hover 那种胶囊）。
 *
 * 用户口径（2026-10-26）：覆盖层底部那行文字不要；提示改成跟随鼠标的通用能力，
 * 任何地方都能主动调用（类似 hover 效果），不止选择态用。
 *
 * 用法：
 *   showTip('已连接 · 不可重复拖拽')      // 显示并跟随鼠标
 *   moveTip(clientX, clientY)              // 鼠标移动时（TipLayer 自己监听也可）
 *   hideTip()                              // 隐藏
 *
 * 跨模块实例：状态同时写 globalThis 并广播事件（热重载 UMD 拷贝 vs bundle 拷贝不共享模块 ref）。
 */
import { ref } from 'vue'

const text = ref('')
const visible = ref(false)

export const TIP_EVENT = 'mini-canvas:tip'

function broadcast(): void {
  ;(globalThis as { __miniCanvasTip?: { text: string; visible: boolean } }).__miniCanvasTip = {
    text: text.value,
    visible: visible.value,
  }
  globalThis.dispatchEvent?.(new CustomEvent(TIP_EVENT))
}

/** 显示提示（跟随鼠标；由 TipLayer 负责定位） */
export function showTip(message: string): void {
  if (!message) return hideTip()
  text.value = message
  visible.value = true
  broadcast()
}

/** 隐藏提示（幂等） */
export function hideTip(): void {
  if (!visible.value && !text.value) return
  visible.value = false
  text.value = ''
  broadcast()
}

/** 当前提示内容（空串 = 不显示） */
export function currentTip(): string {
  return visible.value ? text.value : ''
}

/** 读 globalThis 版本（TipLayer 用：跨模块实例可见） */
export function readTipFromGlobal(): string {
  const s = (globalThis as { __miniCanvasTip?: { text: string; visible: boolean } }).__miniCanvasTip
  return s?.visible ? s.text : ''
}
