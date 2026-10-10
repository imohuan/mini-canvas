/**
 * selectionScroll —— 「打开下拉时，把当前选中项滚进可视区」的**纯计算**（零 DOM、零 Vue，可单测）。
 *
 * 为什么单独抽出来：这是本功能里唯一"有口径"的部分（已经看得见就不动、从上面被裁就对齐上缘、
 * 从下面被裁就对齐下缘、最后夹在可滚范围里），值得被测试钉住；其余（量 DOM、写 scrollTop）
 * 都是机械动作，写在组件里就行 —— 与 stickToBottomCore.ts 同一套做法。
 *
 * 用户口径（2026-10-10）：模型下拉可能有几十条（一台自建网关几十上百个模型 ID），
 * 列表限高只露几行；选中项多半在可视区外，点开根本看不到"我现在用的是哪个"，得手动往下翻。
 */
import type { ScrollMetrics } from './stickToBottomCore.js'

/** 一个列表项在**滚动内容坐标系**里的位置（top = 项上缘距内容顶，height = 项高） */
export interface ItemMetrics {
  top: number
  height: number
}

/**
 * 算出「让这一项出现在可视区里」该用的 scrollTop。
 *
 * 三条规则（与浏览器 scrollIntoView({ block: 'nearest' }) 同一套直觉，但**只**动这一个容器，
 * 不会顺带把外层的滚动容器一起拽走）：
 *   · 项被裁在可视区**上方** → 把它上缘对齐到容器上缘；
 *   · 项被裁在可视区**下方** → 把它下缘对齐到容器下缘；
 *   · 项**已经完整可见** → 原样返回当前 scrollTop（不动它，别无谓跳一下）。
 *
 * 项比可视区还高（怎么摆都露不全）时对齐上缘 —— 露开头比露结尾有用。
 *
 * pad：与容器上下边的留白（默认 0），免得项贴着边。负值按 0 处理。
 * 返回值一定夹在 [0, scrollHeight - clientHeight]（内容不够滚时恒为 0）。
 */
export function scrollTopForVisibleItem(box: ScrollMetrics, item: ItemMetrics, pad = 0): number {
  const max = Math.max(0, box.scrollHeight - box.clientHeight)
  const gap = Math.max(0, pad)
  const visibleTop = box.scrollTop
  const visibleBottom = box.scrollTop + box.clientHeight
  let next = box.scrollTop
  if (item.height >= box.clientHeight) {
    // 露不全：对齐上缘
    next = item.top - gap
  } else if (item.top - gap < visibleTop) {
    next = item.top - gap
  } else if (item.top + item.height + gap > visibleBottom) {
    next = item.top + item.height + gap - box.clientHeight
  }
  return Math.min(max, Math.max(0, next))
}
