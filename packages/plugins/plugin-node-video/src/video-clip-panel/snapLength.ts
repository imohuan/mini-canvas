export interface SnapLengthOptions {
  snap: boolean
  snapStep: number
  effectiveRadius: number
}

/**
 * 磁性吸附：把时长圆到最近的间隔倍数；范围(radius)始终 ≤ 间隔/2，只起「跟手缓冲」作用，
 * 这里按 demo 的实际行为实现（圆整值与原值差超过范围 = 还没进吸附带 = 返回原值）。
 */
export function snapLength(length: number, options: SnapLengthOptions): number {
  if (!options.snap || options.snapStep <= 0) return length
  const snapped = Math.round(length / options.snapStep) * options.snapStep
  return Math.abs(snapped - length) <= options.effectiveRadius ? snapped : length
}
