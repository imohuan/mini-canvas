/**
 * 滚动层查找工具（全仓只在这里认滚动容器的选择器）。
 *
 * 生成历史 / 资产列表需要拿真实的滚动元素做触底加载与位置恢复
 * （IntersectionObserver 的 root、scrollTop 读写）。集中一处，
 * 以后换滚动容器写法只改这里。
 */

/**
 * 滚动层选择器。
 *
 * 用户口径（2026-11-04）：滚动容器统一用组件库的 ScrollArea（内部 viewport 才是
 * 真正滚动的那层），原生溢出的 div 也继续兼容。
 */
export const SCROLL_VIEWPORT_SELECTOR =
  '.ui-scroll, [data-ui-scroll], [data-slot="scroll-area-viewport"]'

/**
 * 从某个后代元素往上找真实滚动层。
 *
 * 落到组件库 ScrollArea 上时，它内部 viewport 才是滚动的那层（根节点只是定位容器），
 * 所以再往下取一次 viewport；拿不到就退回根节点。
 */
export function scrollViewportOf(start: Element | null | undefined): HTMLElement | null {
  if (!start || typeof start.closest !== 'function') return null
  const nearest = start.closest(SCROLL_VIEWPORT_SELECTOR) as HTMLElement | null
  if (nearest) return nearest
  const area = start.closest('[data-slot="scroll-area"]') as HTMLElement | null
  if (!area) return null
  return area.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? area
}

