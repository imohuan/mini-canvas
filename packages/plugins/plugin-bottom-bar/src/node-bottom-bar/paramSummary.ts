/**
 * 参数下拉触发器上那行摘要怎么拼（纯函数，可单测）。
 *
 * 用户口径（2026-11-16）：
 * 「你的第二个下拉菜单你这里没有必要显示每一个选项的值」——
 * 底栏那格只有 ~150px，把每个参数的当前值都铺上去（MP3 · 24 kHz · 0 · 0 · 0）
 * 会把模型名挤成省略号，也读不出重点。
 *
 * 现在只显示**改了默认值的那些**：
 * - 全部是默认值 → 只显示参数数量（「参数 5」），一眼知道点开有东西可调，但不占位置；
 * - 改了一两个 → 只显示改动值（「WAV · 语速 20」），与默认不同的才值得看；
 * - 最多 2 个，多了用「+N」收尾。
 */

export interface SummaryField {
  key: string
  label?: string
  description?: string
  type?: string
  default?: unknown
  options?: Array<{ label: string; value: string | number | boolean }>
}

export interface SummaryInput {
  fields: ReadonlyArray<SummaryField>
  values: Record<string, unknown>
  /** 没改动时用的占位文案（默认「参数」） */
  placeholder?: string
}

/** 每项当前值的显示文案（优先用选项的 label） */
function valueLabel(field: SummaryField, value: unknown): string {
  const opt = field.options?.find((o) => String(o.value) === String(value))
  return opt ? opt.label : String(value)
}

/** 这一项是不是还等于它的默认值 */
function isDefault(field: SummaryField, value: unknown): boolean {
  if (field.default === undefined) return false
  return String(field.default) === String(value)
}

/** 摘要里最多显示几个值；超出用 +N 收尾 */
const MAX_PARTS = 2

export function paramSummary(input: SummaryInput): string {
  const placeholder = input.placeholder ?? '参数'
  const fields = input.fields ?? []
  if (fields.length === 0) return ''

  const changed: string[] = []
  for (const f of fields) {
    const v = input.values?.[f.key]
    if (v === undefined || v === null || v === '') continue
    if (isDefault(f, v)) continue
    const label = valueLabel(f, v)
    // 有选项的值（WAV / 48 kHz）自带含义，直接用 label；
    // 滑块这类裸数字（0 / 20）看不出是什么参数，才补上名字（「语速 20」）。
    const hasOptions = (f.options?.length ?? 0) > 0
    const name = (f.label ?? '').trim()
    changed.push(!hasOptions && name ? name + ' ' + label : label)
  }

  // 全默认时只说「参数」：后面挂个数字容易被读成参数值（用户 2026-11-16 截图里
  // 「参数 5」看着像第 5 个参数，其实只是「有 5 项可调」）。
  if (changed.length === 0) return placeholder
  if (changed.length <= MAX_PARTS) return changed.join(' · ')
  return changed.slice(0, MAX_PARTS).join(' · ') + ' +' + (changed.length - MAX_PARTS)
}
