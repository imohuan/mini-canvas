import type { MenuPosition } from "../types";

export function initialMenuPosition(coords: { left: number; top: number; bottom: number; right: number }): MenuPosition {
  // 智能定位逻辑：**先用写死的宽高给出初值**，真实翻转由 MentionMenu 测完自己尺寸后
  // 通过 anchorTop/anchorBottom 再修正（见 useEditor 里的 reflowMenu）。
  // 为什么不在这一步就定死：这里拿不到菜单真实高度，估成 280 会把明明放得下的菜单顶到屏幕上方。
  const menuWidth = 200;
  const menuMaxHeight = 280;
  const gap = 8; // 离触发点的偏移量
  const minMargin = 8; // 最小边距

  let finalX = coords.left;
  let finalY = coords.bottom + gap;
  let originH = "left";
  let originV = "top";
  let side: 'top' | 'bottom' = "bottom";

  // 水平边界检测
  if (coords.left + menuWidth > window.innerWidth) {
    finalX = coords.left - menuWidth; // 靠左显示
    originH = "right";
  }

  // 垂直方向先用估算值兜底；真实尺寸出来后由 reflowMenu 修正
  if (coords.bottom + menuMaxHeight + gap > window.innerHeight) {
    finalY = Math.max(minMargin, coords.top - menuMaxHeight - gap);
    originV = "bottom";
    side = "top";
  }

  return {
    left: `${Math.max(minMargin, finalX)}px`,
    top: `${Math.max(minMargin, finalY)}px`,
    origin: `${originV} ${originH}`,
    side: side,
    anchorTop: coords.top,
    anchorBottom: coords.bottom,
  };
}

/**
 * 用菜单**真实测量**的高度重新决定上下翻转与位置（修实测 bug：估算 280 会把菜单顶到屏幕上方）。
 * 由 MentionMenu 在 nextTick 里量完自己的 rect 后调用。
 */
export function measuredMenuPosition(pos: MenuPosition, rect: { width: number; height: number }): MenuPosition | null {
  if (pos.anchorTop === undefined || pos.anchorBottom === undefined) return null;
  const gap = 8;
  const minMargin = 8;
  const anchorTop = pos.anchorTop;
  const anchorBottom = pos.anchorBottom;
  const innerW = window.innerWidth;
  const innerH = window.innerHeight;

  // 水平：默认贴光标左侧（showMenu 已算好）；右边放不下就往左挪，且保证不出左边框
  let left = Number.parseFloat(pos.left) || 0;
  if (left + rect.width > innerW - minMargin) {
    left = Math.max(minMargin, innerW - rect.width - minMargin);
  }

  // 垂直：下方放得下就往下弹；放不下且上方更宽裕才往上弹（两者都不够时选空间大的一侧）
  const spaceBelow = innerH - anchorBottom - gap - minMargin;
  const spaceAbove = anchorTop - gap - minMargin;
  const fitsBelow = rect.height <= spaceBelow;
  const fitsAbove = rect.height <= spaceAbove;
  const placeBelow = fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove);
  const top = placeBelow ? anchorBottom + gap : Math.max(minMargin, anchorTop - rect.height - gap);

  return {
    ...pos,
    left: `${left}px`,
    top: `${top}px`,
    origin: `${placeBelow ? 'top' : 'bottom'} left`,
    side: placeBelow ? 'bottom' : 'top',
  };
}

