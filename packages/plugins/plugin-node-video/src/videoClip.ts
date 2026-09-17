/**
 * videoClip —— 剪辑范围的约束规则（纯函数，零 DOM / 零 Vue，node 可单测）。
 *
 * 照 v1 的 videoNodeUtils（clampClipRange / clampClipStart / clampClipEnd）：用户拖端点或挪整段时，
 * 结果必须先被"收进合法范围"再落库 —— 起点不能早于 0、终点不能晚于时长、两端之间必须留够最短时长。
 * 这些判断放在纯函数里，才能在 node 里把边界情况一次说清，不必起浏览器拖进度条。
 */
import { finiteOr } from './videoNodeData'

/** 一次范围约束的输入 */
export interface ClipRangeInput {
  start: number
  end: number
  duration: number
  minDuration?: number
}

/**
 * 拖动整段时的输入：新的起点（长度保持不变，两端一起被推）。
 * 长度固定由 start/end 的差值决定，故可直接传一个范围对象再加 nextStart ——
 * `moveClipRange({ ...range, nextStart })` 是主要用法，别把 nextStart 设成必填以外的形状。
 */
export interface MoveClipRangeInput extends ClipRangeInput {
  nextStart: number
}

/** 最短剪辑时长下限（秒）：比这更短的范围没有意义，也给不出可拖的把手 */
export const MIN_CLIP_DURATION = 0.1

/** 收敛出可用的时长与最短长度（时长非法 → 0.1；最短长度被限制在 [0.1, 时长] 内） */
function bounds(duration: unknown, minDuration: unknown): { dur: number; min: number } {
  const dur = Math.max(MIN_CLIP_DURATION, finiteOr(duration, MIN_CLIP_DURATION))
  const min = Math.min(Math.max(MIN_CLIP_DURATION, finiteOr(minDuration, MIN_CLIP_DURATION)), dur)
  return { dur, min }
}

/** 秒值收敛到 3 位小数（避免浮点拖拽留下 3.0000000000000004 这类脏值落盘） */
function round3(v: number): number {
  return Number(v.toFixed(3))
}

/**
 * 把 [start, end] 收进 [0, duration] 且保证长度不小于 minDuration。
 * 两端颠倒时自动交换；长度不足时优先把终点往后推，推不动（贴住尾部）再把起点往前挪。
 */
export function clampClipRange({ start, end, duration, minDuration }: ClipRangeInput): { start: number; end: number } {
  const { dur, min } = bounds(duration, minDuration)
  let s = Math.min(Math.max(0, finiteOr(start, 0)), dur)
  let e = Math.min(Math.max(0, finiteOr(end, dur)), dur)
  if (s > e) [s, e] = [e, s]
  if (e - s < min) {
    if (s + min <= dur) e = s + min
    else s = Math.max(0, e - min)
  }
  return { start: round3(s), end: round3(e) }
}

/** 只动起点：终点钉住，起点被收进 [0, end - min] */
export function clampClipStart({ start, end, duration, minDuration }: ClipRangeInput): { start: number; end: number } {
  const { dur, min } = bounds(duration, minDuration)
  const e = Math.min(Math.max(min, finiteOr(end, dur)), dur)
  const s = Math.min(Math.max(0, finiteOr(start, 0)), Math.max(0, e - min))
  return { start: round3(s), end: round3(e) }
}

/** 只动终点：起点钉住，终点被收进 [start + min, duration] */
export function clampClipEnd({ start, end, duration, minDuration }: ClipRangeInput): { start: number; end: number } {
  const { dur, min } = bounds(duration, minDuration)
  const s = Math.min(Math.max(0, finiteOr(start, 0)), Math.max(0, dur - min))
  const e = Math.min(Math.max(s + min, finiteOr(end, dur)), dur)
  return { start: round3(s), end: round3(e) }
}

/**
 * 整段平移：长度保持不变，起点挪到 nextStart（抵住任一端即停）。
 * 用户拖动中间那块时用它 —— 只改位置、不改长度。
 */
export function moveClipRange({
  start,
  end,
  nextStart,
  duration,
  minDuration,
}: MoveClipRangeInput): { start: number; end: number } {
  const { dur, min } = bounds(duration, minDuration)
  const current = clampClipRange({ start, end, duration: dur })
  const length = Math.max(min, Math.min(dur, current.end - current.start))
  const s = Math.min(Math.max(0, finiteOr(nextStart, 0)), Math.max(0, dur - length))
  return { start: round3(s), end: round3(s + length) }
}

/**
 * 读节点里已保存的剪辑范围；缺省 = 整段（[0, duration]）。
 * 脏数据（起止颠倒 / 越界 / 非数）经 clampClipRange 收敛，绝不把非法值交给播放器。
 */
export function readClipRange(
  data: Record<string, unknown> | undefined,
  minDuration?: number,
): { start: number; end: number } {
  const duration = finiteOr(data?.videoDuration, 0)
  if (duration <= 0) return { start: 0, end: 0 }
  return clampClipRange({
    start: finiteOr(data?.clipStart, 0),
    end: finiteOr(data?.clipEnd, duration),
    duration,
    minDuration,
  })
}
