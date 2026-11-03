import type { Ref } from 'vue'
import { clampClipEnd, moveClipRange } from '../videoClip'
import { clipKeyAction, isTypingTarget } from '../videoClipKeys'

export interface ClipKeyboardOptions {
  visible: Readonly<Ref<boolean>>
  configOpen: Ref<boolean>
  range: Ref<{ start: number; end: number }>
  duration: Ref<number>
  minClip: Ref<number>
  commit: (next: { start: number; end: number }) => void
  setInPoint: () => void
  setOutPoint: () => void
  togglePlay: () => void
  onCancel: () => void
  onConfirm: () => void
}

/**
 * 剪辑会话的键盘处理（监听由入口按原顺序挂到 window 捕获阶段）。
 */
export function useClipKeyboard(options: ClipKeyboardOptions) {
  const {
    visible,
    configOpen,
    range,
    duration,
    minClip,
    commit,
    setInPoint,
    setOutPoint,
    togglePlay,
    onCancel,
    onConfirm,
  } = options

  /**
   * 剪辑会话的键盘处理。
   *
   * ★ 必须挂在 window 上（用户实测 2026-10-31 报「除了方向键其它都没反应」）：
   * 从前写在 .vclip-dock 的 @keydown 上，只有焦点正好落在这一条的某个子元素里才收得到。
   * 剪辑时用户大多点过视频画面（焦点在 video / 画布 / body），于是 I/O/Space/Esc/Enter
   * 全都收不到 —— 方向键"能用"只是因为点过手柄、焦点刚好留在手柄里。
   * demo 也是直接 window.addEventListener('keydown')，这里对齐同一做法。
   */
  function onKeyDown(ev: KeyboardEvent): void {
    if (!visible.value || isTypingTarget(ev.target)) return
    /**
     * 快捷键面板开着时，Esc 先关面板，再按一次才退出剪辑。
     *
     * 这里必须自己 stopPropagation：只 return 让下拉件去关，事件还会继续走到画布，
     * 画布的 Esc 会取消选中 —— 剪辑条随选中消失，看起来就是「按 Esc 直接退出了」。
     */
    if (configOpen.value && ev.key === 'Escape') {
      configOpen.value = false
      ev.preventDefault()
      ev.stopPropagation()
      return
    }
    // 下拉面板 / 菜单打开时把键盘让给它（否则 Esc 会退出剪辑、Enter 会确认）
    if (ev.target instanceof Element && ev.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
    const action = clipKeyAction({ key: ev.key, code: ev.code, shift: ev.shiftKey, ctrl: ev.ctrlKey, meta: ev.metaKey })
    if (action.kind === 'none') return
    const step = 'seconds' in action ? action.seconds : 0
    const opts = { duration: duration.value, minDuration: minClip.value }
    switch (action.kind) {
      case 'move':
        commit(moveClipRange({ ...range.value, nextStart: range.value.start + step, ...opts }))
        break
      /**
       * ↑ / ↓ = 扩展 / 收缩选区（demo 语义：起点不动，只动终点）。
       *
       * 从前实现成"动起点"（↑ 收缩起点、↓ 扩终点），按键表和实际效果对不上 ——
       * 用户看到的是「扩展/收缩选区」，按下去选区却在平移。这里按长度改终点。
       */
      case 'resize': {
        const current = range.value.end - range.value.start
        const len = Math.max(minClip.value, current + step)
        commit(clampClipEnd({ start: range.value.start, end: range.value.start + len, ...opts }))
        break
      }
      case 'set-in': setInPoint(); break
      case 'set-out': setOutPoint(); break
      case 'toggle-play': togglePlay(); break
      case 'exit': onCancel(); break
      case 'confirm': onConfirm(); break
    }
    /**
     * 拦在捕获阶段并停止继续传播（用户实测 2026-10-31）：
     * 画布节点自己监听方向键（↑ 会「Moved selected node up」），事件在冒泡到 window 之前
     * 就被它处理掉了 —— 剪辑条收不到，看起来就是「方向键在动节点，不在动选区」。
     * 捕获阶段先拿键 + stopPropagation，画布就不会再动节点。
     */
    ev.preventDefault()
    ev.stopPropagation()
  }

  return onKeyDown
}
