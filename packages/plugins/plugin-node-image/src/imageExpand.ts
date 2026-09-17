/**
 * imageExpand —— 图片扩展（Outpaint）的**纯几何与位图算法**（无 Vue，canvas 部分可注入以便单测）。
 *
 * 语义（对齐 v1 ImageExpander + handleImageExpandConfirm）：
 * 扩展框是**包住原图**的，框比原图大的部分就是新增的画布。确认时把原图按框内的偏移画到
 * 一块更大的透明画布上 —— 扩出来的区域是透明的，等着交给生成模型去填内容（这正是 outpaint 的输入）。
 *
 * 框的拖拽/夹边界在通用件（@mini-canvas/canvas-render 的 crop/mediaFit，expand 模式）里，
 * 这里只负责「把框变成一张新位图」这一步纯计算 —— 它同时被命令与组件调用。
 */
import { toPixelRect, type Rect } from '@mini-canvas/canvas-render'

/**
 * 由原图 + 扩展框算出新图该多大、原图该画在哪儿（**不碰 canvas**，可直接断言）。
 *
 * 关键换算：data 里记的 imageWidth/Height 是"显示尺寸"，真实位图可能更大（用户上传的原图），
 * 所以先用 scale 把框换算到真实像素，再决定画布尺寸与原图偏移。
 *
 * @param rect        扩展框（显示尺寸坐标系；x/y 可为负 = 往左/上扩）
 * @param imageWidth  原图显示宽（data.imageWidth）
 * @param imageHeight 原图显示高（data.imageHeight）
 * @param bitmapWidth 真实位图宽（实测）
 * @param bitmapHeight真实位图高（实测）
 * @returns 目标画布尺寸与原图左上角在该画布上的位置；参数非法返回 null（调用方放弃，不猜）
 */
export function computeExpandLayout(
  rect: Rect,
  imageWidth: number,
  imageHeight: number,
  bitmapWidth: number,
  bitmapHeight: number,
): { canvasWidth: number; canvasHeight: number; offsetX: number; offsetY: number } | null {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(bitmapWidth > 0) || !(bitmapHeight > 0)) return null
  // 先在**原始**矩形上判合法性，再取整：toPixelRect 会把宽高抬到至少 1px
  // （那是给 canvas 用的保护），先取整的话一个 0×0 的框会变成 1×1 的"合法"框，
  // 于是产出一张 1×1 的图 —— 用户拿到一张比原图还小的图，还以为扩展成功了。
  if (!(rect.width > 0) || !(rect.height > 0)) return null
  const pixels = toPixelRect(rect)
  const scaleX = bitmapWidth / imageWidth
  const scaleY = bitmapHeight / imageHeight
  return {
    canvasWidth: pixels.width,
    canvasHeight: pixels.height,
    // 原图在框里的位置：框左上角为原点。框往左上扩时 x/y 为负 → 原图向右下偏移。
    // 加 0 是为了消掉 -0（负零）：它等于 0 但会让"无偏移"在断言/日志里长得像负数。
    offsetX: -Math.round(pixels.x * scaleX) + 0,
    offsetY: -Math.round(pixels.y * scaleY) + 0,
  }
}

/** 浏览器位图端口（单测注入假实现；真实实现走 canvas） */
export interface ExpandBitmapIO {
  /** 把 url 解成可绘制位图 + 真实像素尺寸 */
  load(url: string): Promise<{ source: CanvasImageSource; width: number; height: number } | null>
  /** 建一块透明画布并把原图画进去 → 返回 PNG dataURL */
  paint(bounds: { width: number; height: number }, draw: (c2d: CanvasRenderingContext2D, source: CanvasImageSource) => void, source: CanvasImageSource): string | null
  /** 释放位图（ImageBitmap 需显式 close） */
  release(source: CanvasImageSource): void
}

/**
 * 执行一次扩展：读原图 → 画到更大的透明画布 → 产出新的 dataURL。
 *
 * 为什么产出 dataURL 而不是 objectURL：与图片上传同一取舍 —— dataURL 写进节点 data 后
 * 能直接落盘、刷新照常显示（objectURL 出文档即失效）。
 *
 * @returns 新图的 dataURL 与像素尺寸；任一步失败返回 null（调用方保留原图，不写半成品）
 */
export async function expandImage(
  url: string,
  rect: Rect,
  imageWidth: number,
  imageHeight: number,
  io: ExpandBitmapIO,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!url) return null
  const loaded = await io.load(url)
  if (!loaded) return null
  try {
    const layout = computeExpandLayout(rect, imageWidth, imageHeight, loaded.width, loaded.height)
    if (!layout) return null
    const dataUrl = io.paint(
      { width: layout.canvasWidth, height: layout.canvasHeight },
      (c2d, source) => {
        c2d.drawImage(source, layout.offsetX, layout.offsetY)
      },
      loaded.source,
    )
    if (!dataUrl) return null
    return { dataUrl, width: layout.canvasWidth, height: layout.canvasHeight }
  } finally {
    io.release(loaded.source)
  }
}

/**
 * 扩展结果是否"真的比原图大"（一处都没有扩出去 → 这次操作没有意义，不该落库）。
 * 用户点了确认却什么也没变，宁可不动也不要写一条空的历史。
 */
export function isExpandEffective(rect: Rect, imageWidth: number, imageHeight: number): boolean {
  return rect.x < 0 || rect.y < 0 || rect.width > imageWidth + 0.5 || rect.height > imageHeight + 0.5
}
