/**
 * 预览取景 —— 纯函数，可在 Node 里用数学验证。
 *
 * 为什么单独抽出来：之前取景依赖"在浏览器里量 DOM"，量到的是半个内容
 * （卡片外溢出的标题、端口、标签量不到），于是缩放与居中都不准，
 * 表现就是内容偏左上、右下空一大片。改成纯计算后，居中这一步可以被测试钉死。
 */
export interface FrameRect {
  x: number
  y: number
  w: number
  h: number
}

export interface FrameResult {
  /** 缩放比 */
  scale: number
  /** 舞台左上角相对视野的位移（px，屏幕坐标） */
  x: number
  y: number
}

/**
 * 让一块内容在视野里居中，并留出等宽边距。
 *
 * 保证：内容四边到视野边缘的距离相等（受 MAX_FIT_SCALE 限制时也一样）。
 */
export function fitRectInView(
  content: FrameRect,
  view: { w: number; h: number },
  pad: number,
  maxScale = 1,
): FrameResult {
  const safeW = Math.max(1, content.w)
  const safeH = Math.max(1, content.h)
  const viewW = Math.max(1, view.w)
  const viewH = Math.max(1, view.h)
  const padSize = Math.max(0, pad)

  // 缩放只需保证"内容 + 留白"装得下；位移直接按内容本身居中，
  // 不能再额外减一次留白，否则留白被算两遍、左右边距不等。
  const scale = Math.min(viewW / (safeW + padSize * 2), viewH / (safeH + padSize * 2), maxScale)
  const x = (viewW - safeW * scale) / 2 - content.x * scale
  const y = (viewH - safeH * scale) / 2 - content.y * scale
  return { scale, x, y }
}

/** 内容四边到视野边缘的实际边距（测试与调试用）。 */
export function frameMargins(content: FrameRect, view: { w: number; h: number }, result: FrameResult) {
  const left = content.x * result.scale + result.x
  const top = content.y * result.scale + result.y
  return {
    left,
    top,
    right: view.w - ((content.x + content.w) * result.scale + result.x),
    bottom: view.h - ((content.y + content.h) * result.scale + result.y),
  }
}
