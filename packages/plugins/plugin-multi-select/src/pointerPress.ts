/**
 * pointerPress —— 全局"指针是否按下"共享状态（模块级，跨组件实例共享）。
 *
 * 为什么必须是**模块级**而不是组件内的 ref（用户连续多轮反馈的 bug 根因）：
 * 多选框组件在拖拽过程中可能重挂载（slot 重渲染 / nodeEpoch 变化等），
 * 组件内的 ref 会随新实例重置为 false —— 用户明明还按着鼠标，批量端口却重新冒出来。
 * 模块级状态 + 一次性绑定的监听不受重挂载影响；同时给 <body> 打一个类名，
 * 让 CSS 也能在"JS 状态万一没跟上"时兜住（双保险）。
 */
import { ref } from 'vue'

/** 当前是否有指针按下 */
export const pointerDown = ref(false)

/** body 上的类名（CSS 兜底用，不依赖 Vue 响应式） */
export const POINTER_DOWN_CLASS = 'mc-pointer-down'

let bound = false

/**
 * 绑定全局按下/抬起监听。幂等：多次调用只绑一次（多实例/重挂载安全）。
 *
 * 注意：**不监听 pointercancel** —— 真实拖拽（节点拖动/原生图片拖拽）中浏览器会发它，
 * 若在此清掉按下态，端口会在用户仍按着的时候重新出现（实测复现：按下 → 端口 0；
 * 发 pointercancel → 端口又变 2）。
 * 例外：按在**多选框自己的批量端口**上（准备拖线）不置位 —— 那一按就是要用它。
 */
export function bindPointerPressWatchers(): void {
  if (bound || typeof document === 'undefined') return
  bound = true
  document.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (t && typeof t.closest === 'function' && t.closest('.selection-frame-batch-slot')) return
      pointerDown.value = true
      document.body?.classList?.add(POINTER_DOWN_CLASS)
    },
    true,
  )
  document.addEventListener(
    'pointerup',
    () => {
      pointerDown.value = false
      document.body?.classList?.remove(POINTER_DOWN_CLASS)
    },
    true,
  )
}