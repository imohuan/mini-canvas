/**
 * videoCrop —— 视频裁剪的取景映射（纯函数，零 DOM / 零 Vue，node 可单测）。
 *
 * 框本身的几何（拖拽、夹边界、最小边、坐标系换算）已收进渲染层的通用件
 * @mini-canvas/canvas-render 的 crop/mediaFit —— 图片与视频共用同一份实现，
 * 这里只留**视频特有**的那一件事：把裁剪框翻译成 CSS，让画面按框取景。
 *
 * 为什么视频裁剪是取景式的（不重新编码）：转码要么引入 wasm/ffmpeg 依赖，
 * 要么用 MediaRecorder 实时重录（要播完整段、时长与体积都不可控）——
 * 两条路都超出「节点显示与整理」的范围。于是裁剪只记框，显示时用 CSS 放大偏移，
 * 好处是随时可以恢复整幅画面、不产生第二份文件。
 *
 * framingStyle 与通用件的 framedMediaStyle 是同一套算法（放大到「原宽÷框宽」倍、
 * 往左上推「框起点÷框宽」倍），这里重新导出成视频语汇，让节点侧读起来是「取景」而不是「位图裁剪」。
 */
import { framedMediaStyle } from '@mini-canvas/canvas-render'
import type { Rect } from '@mini-canvas/canvas-render'

/** 是否是一个可用的裁剪框（委托通用件的脏数据守卫） */
export { isUsableRect as isCroppedRect } from '@mini-canvas/canvas-render'
export type { Rect } from '@mini-canvas/canvas-render'

/**
 * 裁剪后的画面在卡片内该多大、偏移多少（CSS 百分比）。
 * @returns 空对象 = 整幅画面（没裁过 / 框非法），调用方据此不施加任何放大与偏移
 */
export function framingStyle(
  rect: Rect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): Record<string, string> {
  return framedMediaStyle(rect, sourceWidth, sourceHeight)
}
