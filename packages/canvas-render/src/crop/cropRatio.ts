/**
 * cropRatio —— 裁剪框的比例（宽高比）策略（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 用户要求：「在中间添加一个下拉配置，可以选择当前的裁剪框的比例，设置比例之后，
 * 你的裁剪框长宽比就会进行对应变化」。所以这里把「比例」这件事单独收一层。
 *
 * 两个决定值得说明：
 *
 * 1. **"自由"必须保留**。用户可能是想随手框一块，不强加比例。默认值也是自由 ——
 *    默认锁成某个比例会让"框住这块内容"这个最朴素的动作变得别扭。
 *
 * 2. **换比例时框的"中心"不动、只改尺寸**，而不是把框挪到某个角。用户的注意力在
 *    画面中央那块内容上，锚在中心最不容易"我框的东西跑掉了"。改完再按边界收敛，
 *    保证永远不越界、也不小于最小边。
 */

/** 比例选项：value 是稳定的字符串键，ratio 是宽/高（null = 自由） */
export interface CropRatioOption {
  /** 稳定键（写进 UI 的选中值；与具体数值解耦，方便日后调整比例数值） */
  value: string
  /** 显示名 */
  label: string
  /** 宽 / 高；null = 自由（不锁比例） */
  ratio: number | null
}

/** 内置比例表（常见的构图习惯：原图、正方形、竖版、横版） */
export const CROP_RATIO_OPTIONS: CropRatioOption[] = [
  { value: 'free', label: '自由', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '2:3', label: '2:3', ratio: 2 / 3 },
]

/** 默认比例：自由（不锁） */
export const DEFAULT_CROP_RATIO_VALUE = 'free'

/** 按 value 找比例；找不到 / 非法 → null（视为自由），调用方据此不锁比例 */
export function ratioOf(value: string | undefined): number | null {
  if (!value) return null
  const opt = CROP_RATIO_OPTIONS.find((o) => o.value === value)
  if (!opt) return null
  const r = opt.ratio
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null
}

/**
 * 把框调成指定比例（**中心不动**），再收进合法范围。
 *
 * 采用「保持面积量级」的做法：先取框的短边作为基准，算出另一条边，而不是简单地把宽定死 ——
 * 否则从 16:9 切到 9:16 时宽度不变、高度暴涨，框会瞬间盖住整幅画面。
 *
 * @param rect    当前裁剪框（媒体像素）
 * @param ratio   目标宽/高；null = 自由（原样返回，不做任何改动）
 * @param fit     收敛函数（crop 用 clampCropRect、expand 用 clampExpandRect）
 * @returns 新框；ratio 为 null 或非法时返回原框
 */
export function applyRatio(
  rect: Rect,
  ratio: number | null,
  fit: (r: Rect) => Rect,
): Rect {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return rect
  if (!(rect.width > 0) || !(rect.height > 0)) return rect

  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  // 基准取短边的"半对角线"思路：先按现有框的较小边定短边，长边按比例推出。
  // 用 min 而不是 max，保证换比例后框不会比原来更"膨胀"（用户的框不会突然盖满画面）。
  const shortSide = Math.min(rect.width, rect.height)
  let width: number
  let height: number
  if (ratio >= 1) {
    // 宽 >= 高：高为短边
    height = shortSide
    width = height * ratio
  } else {
    width = shortSide
    height = width / ratio
  }
  const next: Rect = { x: cx - width / 2, y: cy - height / 2, width, height }
  return fit(next)
}

