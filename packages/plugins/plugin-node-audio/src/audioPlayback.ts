/**
 * audioPlayback —— 播放进度与指针位置之间的换算（零 DOM、零 Vue、Node 可单测）。
 *
 * 波形当进度条用，这条换算路径上有两类容易写错的地方，抽成纯函数钉住：
 * 一是时长未知/为 0/NaN 时的收敛（不能除出 NaN 塞进 CSS）；
 * 二是指针位置 → 比例的夹取（拖到卡片外也要收敛成 0 或 1）。
 */

/** 收进 0..1；非有限数给 0（NaN 进 CSS 宽度会让整条波形消失） */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 已播比例（0..1）。时长未知/非法 → 0（宁可显示"从头开始"，也不显示 NaN） */
export function progressRatio(current: number, duration: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(duration) || duration <= 0) return 0
  return clamp01(current / duration)
}

/** 比例 → 目标播放时间（秒）。progressRatio 的逆运算，结果夹在 0..duration 内 */
export function seekTime(ratio: number, duration: number): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(duration) || duration <= 0) return 0
  return clamp01(ratio) * duration
}

/**
 * 指针横坐标 → 已播比例。
 *
 * 传 `getBoundingClientRect()` 的 left/width 而不是元素本身：这样本函数不碰 DOM，
 * 单测直接喂数字（也顺手避开了"元素被缩放时 rect 才是真的"这个画布上的坑）。
 */
export function ratioFromPointer(clientX: number, left: number, width: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return 0
  return clamp01((clientX - left) / width)
}

/** 两位补零 */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * 秒 → `m:ss`（超过一小时给 `h:mm:ss`）；非法/负数给 `0:00`。
 *
 * 用 floor 而不是 round：播放中读到的 9.9 秒显示 0:09 比 0:10 更符合直觉
 * （时间轴还没走完那一位）。
 */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
