/**
 * handleFollow —— 浮动端口圆球"跟随鼠标"的几何与动画步进（纯函数，便于单测）。
 *
 * 与 MovingHandle.vue 的分工：组件负责读鼠标事件、换算本地坐标、驱动 rAF；
 * 这里只算"球该去哪（target）"和"这一帧走到哪（step）"，不碰 DOM。
 *
 * 坐标系约定（anchor-local）：以端口锚点（卡边中点）为原点，
 *   out —— 朝节点外侧的距离，永远取正；
 *   y   —— 垂直偏移，向下为正。
 * 组件按端口方向（source/target）把 out 映射成 ±x。
 */

/** 球要去的终点：从锚点指向鼠标的射线上，比鼠标再远 gap；总距离封顶 maxOut */
export function followTarget(
  mouse: { out: number; y: number },
  gap: number,
  maxOut: number,
): { out: number; y: number } {
  const dist = Math.hypot(mouse.out, mouse.y)
  // 鼠标正好压在锚点上时 atan2 无意义，给一个极小正数保持"朝外"的稳定方向
  const angle = Math.atan2(mouse.y, mouse.out || 0.0001)
  const followDist = Math.min(Math.max(dist + gap, 0), Math.max(maxOut, 0))
  return { out: Math.cos(angle) * followDist, y: Math.sin(angle) * followDist }
}

/**
 * 一帧的插值步进：从 cur 朝 target 靠近 ease 比例。
 * 鼠标一直动 → 球一直追不完 → 视觉上就是"带滞回的跟随"，而不是瞬移。
 */
export function stepFollow(
  cur: { out: number; y: number },
  target: { out: number; y: number },
  ease: number,
): { out: number; y: number } {
  return {
    out: cur.out + (target.out - cur.out) * ease,
    y: cur.y + (target.y - cur.y) * ease,
  }
}

/** 是否还需要继续追（未到位则再排一帧，避免空转 rAF） */
export function needsMoreFrames(
  cur: { out: number; y: number },
  target: { out: number; y: number },
  epsilon = 0.25,
): boolean {
  return Math.abs(target.out - cur.out) > epsilon || Math.abs(target.y - cur.y) > epsilon
}
