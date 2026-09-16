/**
 * dragFollow —— 拖动过程中"框怎么跟手"的纯函数（零 Vue / 零 DOM，Node 可单测）。
 *
 * 用户报的缺陷：「拖拽的时候 选框位置错误」。
 * 现象：拖动整组节点时，节点跟手是准的，但那个选框会越跑越快 —— 实测鼠标拖 100px、
 * 框跑了 300px，且每帧增量按 1、3、6、10… 递增（三角数），框很快甩到画面外。
 *
 * 根因：mousemove 每帧都在写框的位置，而位移用的是"从按下算起的**累计**位移"。
 * 若拿**当前**框位置当基准（每帧 `当前 + 累计位移`），累计位移就被重复计入 ——
 * 第 n 帧的偏差是 n 倍位移，表现为加速甩出。
 *
 * 正确做法（本模块）：以**按下瞬间的框快照**为基准，每帧输出 `快照 + 累计位移`。
 * 这是绝对定位，与帧率、事件次数完全无关：把鼠标放在同一个位置，不管中间移动过多少次，
 * 框都停在同一处。
 *
 * 为什么单独成文件：这条几何最容易在"清理重构"时被顺手改错（本 bug 正是重构时
 * 把快照去掉导致的回归），抽出来就能直接断言"多帧累加后是否恰好等于位移"。
 */
import type { MultiSelectRect } from './multiSelectEngine'

/** 拖动中要跟随的两框（flow 绝对坐标） */
export interface FollowRects {
  outer: MultiSelectRect
  inner: MultiSelectRect
}

/** 按位移平移一个矩形（返回新对象，不改入参） */
function shiftRect(r: MultiSelectRect, dx: number, dy: number): MultiSelectRect {
  return { ...r, x: r.x + dx, y: r.y + dy }
}

/**
 * 拖动逐帧：由"按下时的快照 + 累计位移"算出两框当前应处的位置。
 *
 * @param start 按下那一刻的两框快照（**不要**传当前值，否则位移会被重复累加）
 * @param dx 从按下点到当前的累计位移（flow 坐标 = 屏幕位移 / zoom）
 * @param dy 同上，纵向
 */
export function followFrame(start: FollowRects, dx: number, dy: number): FollowRects {
  return {
    outer: shiftRect(start.outer, dx, dy),
    inner: shiftRect(start.inner, dx, dy),
  }
}

