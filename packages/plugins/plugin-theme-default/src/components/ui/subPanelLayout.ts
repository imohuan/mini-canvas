/**
 * 二级浮层的视口收纳计算（纯函数，方便单测）。
 *
 * 打开时就能算完：不必等挂载、也不依赖内容测量。
 * - 下方空间够：贴着触发项，最大高度就是剩余空间；
 * - 下方空间不够：整体上移，至少留出 minHeight，内容再长就在面板内滚动。
 */
export interface SubPanelBox {
  top: number
  maxHeight: number
}

export function fitSubPanel(
  anchorTop: number,
  viewportHeight: number,
  minHeight = 320,
  margin = 8,
): SubPanelBox {
  const room = Math.max(0, viewportHeight - margin * 2)
  const minBox = Math.min(Math.max(0, minHeight), room)
  const below = Math.max(0, viewportHeight - margin - anchorTop)
  const top = minBox > 0 && below >= minBox
    ? Math.max(margin, anchorTop)
    : Math.max(margin, viewportHeight - margin - minBox)
  return { top, maxHeight: Math.max(0, viewportHeight - margin - top) }
}
