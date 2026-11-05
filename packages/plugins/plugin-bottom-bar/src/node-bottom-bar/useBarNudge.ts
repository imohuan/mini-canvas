/**
 * useBarNudge —— 底栏贴边收拢（不越出视口）。
 *
 * 为什么需要：底栏在下插槽里水平居中（`left:50%` + `translateX(-50%)`），
 * 宽度是固定的 660px 左右。节点靠近视口左右边缘时，整块会有一半被裁掉 ——
 * 用户实测 2026-11-05 的截图就是左边一段被切掉，输入框起点都看不见。
 *
 * 做法：只量底栏自己的屏幕矩形，把超出去的那部分补回来（平移），
 * 不改宽度、不改缩放，也不碰插槽的定位规则 —— 插槽仍然负责"贴在卡片下面"。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** 离视口边缘至少留这么多，避免贴着窗口边框 */
const EDGE = 8

export interface BarNudgeInput {
  /** 底栏根元素 */
  el: Ref<HTMLElement | null>
  /** 底栏此刻是否渲染 */
  shown: Ref<boolean>
  /** 展开成大窗口时不参与（那时是全屏 dialog，有自己的定位） */
  paused?: Ref<boolean>
}

/** 单测/SSR 里没有 rAF：有就用（逐帧跟随拖动），没有就只在 shown 翻转时量一次 */
const hasRaf = typeof requestAnimationFrame === 'function'

export function useBarNudge(input: BarNudgeInput) {
  const shift = ref(0)
  let raf = 0

  function measure(): void {
    const el = input.el.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    // 当前矩形已经含上一次的平移，先还原成"未平移"的位置再算。
    const baseLeft = rect.left - shift.value
    const baseRight = rect.right - shift.value
    const viewport = window.innerWidth
    let next = 0
    if (rect.width > viewport - EDGE * 2) next = EDGE - baseLeft
    else if (baseLeft < EDGE) next = EDGE - baseLeft
    else if (baseRight > viewport - EDGE) next = viewport - EDGE - baseRight
    const rounded = Math.round(next)
    if (rounded !== shift.value) shift.value = rounded
  }

  function loop(): void {
    raf = 0
    measure()
    if (hasRaf && input.shown.value && !input.paused?.value) raf = requestAnimationFrame(loop)
  }

  function stop(): void {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    // 收起时清掉平移，下次显示从原位置重新量，避免残留偏移。
    if (shift.value !== 0) shift.value = 0
  }

  watch(
    [input.shown, input.paused ?? ref(false)],
    ([shown, paused]) => {
      if (shown && !paused) {
        if (!raf) {
          if (hasRaf) raf = requestAnimationFrame(loop)
          else measure()
        }
      } else {
        stop()
      }
    },
    { immediate: true },
  )
  onBeforeUnmount(stop)

  return { shift, measure }
}
