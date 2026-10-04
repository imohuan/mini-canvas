import { computed, toRef, type Ref } from 'vue'
import type { Middleware, Placement } from '@floating-ui/vue'
import {
  useFloating as _useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  arrow,
} from '@floating-ui/vue'

export interface UseFloatingOptions {
  placement?: string | Ref<string>
  offset?: number | Ref<number>
  matchWidth?: boolean | Ref<boolean>
  /** 对齐触发器的哪条边：start=左缘 / center=中轴（默认）/ end=右缘 */
  align?: 'start' | 'center' | 'end' | Ref<'start' | 'center' | 'end'>
  /** 箭头元素 ref，传入后才启用 arrow middleware */
  arrowRef?: Ref<HTMLElement | null>
}

/**
 * 基于 @floating-ui/vue 的浮动定位 hook（照 AxDropdown 的用法）。
 * placement 支持字符串或 Ref<string>，可响应式切换方向。
 * 配合 v-if 使用：元素挂载时 autoUpdate 自动启动、卸载时自动清理。
 */
export function useFloating(
  referenceRef: Ref<HTMLElement | null>,
  floatingRef: Ref<HTMLElement | null>,
  options: UseFloatingOptions = {},
) {
  const { arrowRef } = options

  const matchWidthRef =
    options.matchWidth instanceof Object && 'value' in (options.matchWidth as object)
      ? (options.matchWidth as Ref<boolean>)
      : toRef(() => (options.matchWidth as boolean) ?? false)

  const placementBase =
    typeof options.placement === 'string'
      ? toRef(() => options.placement as string)
      : (options.placement ?? toRef(() => 'bottom-start'))

  // align 允许传 Ref（调用方按 placement 后缀动态判定时要跟着变）；缺失 = center
  const alignRef: Ref<'start' | 'center' | 'end'> =
    options.align && typeof options.align === 'object' && 'value' in options.align
      ? (options.align as Ref<'start' | 'center' | 'end'>)
      : toRef(() => (options.align as 'start' | 'center' | 'end' | undefined) ?? 'center')

  // 对齐模式映射：center → 纯方位（菜单中轴对触发器中轴）；start/end → 加后缀
  const placementRef = computed<Placement>(() => {
    const base = placementBase.value as string
    const side = base.split('-')[0]
    const a = alignRef.value
    return (a === 'center' ? side : `${side}-${a}`) as Placement
  })

  // 对齐模式映射：center → 纯方位（菜单中轴对触发器中轴）；start/end → 加后缀
  const effPlacement = computed<Placement>(() => {
    const base = placementRef.value as string
    const side = base.split('-')[0]
    const a = alignRef.value
    return (a === 'center' ? side : `${side}-${a}`) as Placement
  })

  const offsetRef =
    options.offset instanceof Object && 'value' in (options.offset as object)
      ? (options.offset as Ref<number>)
      : toRef(() => (options.offset as number) ?? 6)

  const middlewareRef = computed(() => {
    const arr: Middleware[] = [offset(offsetRef.value), flip(), shift({ padding: 5 })]
    if (arrowRef?.value) arr.push(arrow({ element: arrowRef }))
    return arr
  })

  const { floatingStyles, update, isPositioned, middlewareData, placement } = _useFloating(
    referenceRef,
    floatingRef,
    {
      placement: effPlacement,
      strategy: 'fixed',
      // 用 left/top 定位而非 transform:translate，避免与 Transition 的 scale 动画冲突
      transform: false,
      middleware: middlewareRef,
      whileElementsMounted: autoUpdate,
    },
  )

  const mergedStyles = computed(() => {
    const base = { ...floatingStyles.value }
    if (matchWidthRef.value && referenceRef.value) {
      ;(base as Record<string, string>).width = referenceRef.value.getBoundingClientRect().width + 'px'
    }
    return base
  })

  return {
    floatingStyles: mergedStyles,
    updatePosition: update,
    /** 位置首次计算完成后变为 true，配合 visibility 防闪现 */
    isPositioned,
    middlewareData,
    placement,
  }
}
