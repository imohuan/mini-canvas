/**
 * ScrollPane 的滚动层查找工具（**全仓只在这里认 shadcn 的内部结构**）。
 *
 * 为什么单独一个模块：
 * - shadcn 的 `data-slot="scroll-area-viewport"` 是它的内部实现细节，不是我们的公开契约；
 * - 生成历史 / 资产列表需要拿这个真实的滚动元素做触底加载与位置恢复（IntersectionObserver 的 root、
 *   scrollTop 读写）。若各调用点各写一份 `closest(...)`，shadcn 一升级就要改 N 处。
 * 这里集中一处，将来结构变了只改这里。
 */

/** shadcn ScrollArea 的滚动视口选择器（内部实现，只在本文件出现） */
export const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'

/** 从某个后代元素往上找 ScrollPane 的真实滚动层；不在 ScrollPane 里则返回 null */
export function scrollViewportOf(start: Element | null | undefined): HTMLElement | null {
  if (!start || typeof start.closest !== 'function') return null
  return start.closest(SCROLL_VIEWPORT_SELECTOR) as HTMLElement | null
}

