/**
 * menuPlacement —— 右键菜单的视口内定位（纯逻辑，零 DOM，可单测）。
 *
 * 用户口径（2026-10-27 截图）：
 *   ① 主菜单不能和屏幕/底栏边缘贴死，要留间隔；整块必须待在可视区域内，
 *      菜单内部也要有自己的内边距（padding 属于样式，见 ContextMenu.vue）；
 *   ② 二级菜单右侧没空间时要翻转，绝不能弹出屏幕外。
 *
 * 为什么不用"按条数估算高度"：实际行高受描述、快捷键、换行影响，估出来永远偏小，
 * 菜单底部就会压到屏幕边（截图里主菜单与底栏完全重合）。这里只接受**实测尺寸**，
 * 由组件在渲染后量出来再定位。
 */

export interface Size {
  width: number
  height: number
}

export interface AnchorPoint {
  x: number
  y: number
}

export interface MenuPoint {
  left: number
  top: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** 菜单与视口边缘的最小间隔（像素） */
export const MENU_VIEWPORT_GAP = 8
/** 主菜单与二级菜单之间的横向间隔（像素） */
export const SUBMENU_OFFSET_X = 4

/** 把数值夹到 [min, max]；min > max 时（面板比视口还大）取 min，保证左上角优先可见 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * 主菜单位置：默认左上角贴鼠标点；右侧/下方放不下时向左/向上翻。
 *
 * - anchor 是鼠标点（clientX / clientY）；
 * - size 是**实测**面板尺寸；
 * - 返回左上角坐标，保证整块面板落在 [gap, 视口 - gap] 内。
 */
export function mainMenuPosition(
  anchor: AnchorPoint,
  size: Size,
  viewport: ViewportSize,
  gap = MENU_VIEWPORT_GAP,
): MenuPoint {
  const maxLeft = viewport.width - gap - size.width
  const maxTop = viewport.height - gap - size.height
  // 优先向右下展开；放不下就贴住右/下边界（仍留 gap），绝不越过边界。
  return {
    left: Math.min(Math.max(anchor.x, gap), Math.max(gap, maxLeft)),
    top: Math.min(Math.max(anchor.y, gap), Math.max(gap, maxTop)),
  }
}

/**
 * 二级菜单位置：优先放在主菜单右侧、贴着入口行；右侧放不下就翻到主菜单左侧。
 *
 * - main：主菜单左上角（已夹在视口内）；mainSize：主菜单实测尺寸；
 * - rowTop：入口行相对主菜单顶部的偏移（offsetTop）；
 * - subSize：二级菜单实测尺寸；
 * - 两侧都放不下时，选空间更大的一侧（并夹进视口），保证不出现整块跑到屏幕外。
 */
export function submenuPosition(
  main: MenuPoint,
  mainSize: Size,
  rowTop: number,
  subSize: Size,
  viewport: ViewportSize,
  gap = MENU_VIEWPORT_GAP,
): MenuPoint {
  const rightLeft = main.left + mainSize.width + SUBMENU_OFFSET_X
  const leftLeft = main.left - subSize.width - SUBMENU_OFFSET_X
  const rightFits = rightLeft + subSize.width <= viewport.width - gap
  const leftFits = leftLeft >= gap

  let left: number
  if (rightFits) left = rightLeft
  else if (leftFits) left = leftLeft
  else {
    // 两边都不够（窄屏/超宽二级菜单）：挑剩余空间更大的一侧，再夹进视口。
    const spaceRight = viewport.width - gap - rightLeft
    const spaceLeft = main.left - gap
    left = spaceRight >= spaceLeft ? rightLeft : leftLeft
  }

  return {
    left: clamp(left, gap, viewport.width - gap - subSize.width),
    top: clamp(main.top + rowTop, gap, viewport.height - gap - subSize.height),
  }
}

/**
 * 二次定位用：已知实际尺寸与视口大小，算好主/二级菜单的左上角。
 * 组件在渲染后 / ResizeObserver 回调里拿真实尺寸调它，避免按条数估算的误差。
 */
export function measureViewport(): ViewportSize {
  if (typeof window === 'undefined') return { width: 1024, height: 768 }
  return { width: window.innerWidth, height: window.innerHeight }
}
