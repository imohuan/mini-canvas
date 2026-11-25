/** 悬浮卡片定位（纯函数，可单测） */

export interface ToolCardAnchor {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface ToolCardPositionInput {
  anchor: ToolCardAnchor
  /**
   * 绝对不能盖住的区域（MCP 下拉菜单本身）。
   *
   * 下拉里的工具行在菜单内部：卡片必须落在菜单**外面**。左右都放不下时
   * 就改到菜单上方或下方，绝不夹回菜单上面。
   */
  avoid?: { left: number; top: number; right: number; bottom: number }
  card: { width: number; height: number }
  viewport: { width: number; height: number }
  /** 希望出现在触发元素的哪一侧 */
  side: 'top' | 'left'
  gap?: number
  margin?: number
}

export interface ToolCardPosition {
  left: number
  top: number
  maxHeight: number
  side: 'top' | 'bottom' | 'left' | 'right'
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/**
 * 算卡片的 fixed 坐标，并处理三件必须做的事：
 *   ① 空间不够就翻到另一侧（下拉在屏幕右侧时不能继续往右长）；
 *   ② 水平 / 垂直都夹在视口内（窗口很窄时也不能露出屏幕）；
 *   ③ 卡片太高时给 maxHeight，让内容内部滚动，而不是顶出屏幕。
 */
export function computeToolCardPosition(input: ToolCardPositionInput): ToolCardPosition {
  const gap = input.gap ?? 10
  const margin = input.margin ?? 12
  const vw = input.viewport.width
  const vh = input.viewport.height
  const maxHeight = Math.max(120, vh - margin * 2)
  const width = Math.min(input.card.width, vw - margin * 2)
  const height = Math.min(input.card.height, maxHeight)

  if (input.side === 'left') {
    const box = input.avoid ?? input.anchor
    const roomLeft = box.left - margin - gap
    const roomRight = vw - margin - gap - box.right
    const fitsLeft = width <= roomLeft
    const fitsRight = width <= roomRight
    if (fitsLeft || fitsRight) {
      const useLeft = fitsLeft && (!fitsRight || roomLeft >= roomRight)
      return {
        left: useLeft ? box.left - gap - width : box.right + gap,
        top: clamp(input.anchor.top, margin, Math.max(margin, vh - margin - height)),
        maxHeight,
        side: useLeft ? 'left' : 'right',
      }
    }
    /**
     * 左右都不够宽：改到菜单上方 / 下方，水平居中于菜单。
     * 这里仍然不与菜单竖直区间重叠。
     */
    const spaceAbove = box.top - margin - gap
    const spaceBelow = vh - margin - gap - box.bottom
    const useBelow = height > spaceAbove && spaceBelow > spaceAbove
    const limit = Math.max(120, useBelow ? spaceBelow : spaceAbove)
    return {
      left: clamp(box.left + (box.right - box.left) / 2 - width / 2, margin, Math.max(margin, vw - margin - width)),
      top: useBelow ? box.bottom + gap : Math.max(margin, box.top - gap - height),
      maxHeight: Math.min(maxHeight, limit),
      side: useBelow ? 'bottom' : 'top',
    }
  }

  const spaceAbove = input.anchor.top - margin
  const spaceBelow = vh - input.anchor.bottom - margin
  const useBottom = height + gap > spaceAbove && spaceBelow > spaceAbove
  const top = useBottom ? input.anchor.bottom + gap : input.anchor.top - gap - height
  return {
    left: clamp(input.anchor.left + input.anchor.width / 2 - width / 2, margin, vw - margin - width),
    top: clamp(top, margin, vh - margin - height),
    maxHeight,
    side: useBottom ? 'bottom' : 'top',
  }
}
