import { computed } from 'vue'
import type { Ref } from 'vue'
import { frameStrokeCss, type MultiSelectFrameConfig } from '../multiSelectConfig'
import type { SelectionFrameGeometry } from '../multiSelectEngine'

/** 两框的内联样式与显隐。 */
export function useSelectionStyles(input: {
  frame: Ref<SelectionFrameGeometry | null>
  frameConfig: Ref<MultiSelectFrameConfig>
}) {
  const outerStyle = computed(() => {
    const g = input.frame.value
    if (!g) return null
    const stroke = frameStrokeCss(input.frameConfig.value.outer, 1, 'var(--ui-select-outer, var(--ui-accent, #0891b2))')
    return {
      left: `${g.outer.x}px`,
      top: `${g.outer.y}px`,
      width: `${g.outer.w}px`,
      height: `${g.outer.h}px`,
      ...stroke,
    }
  })
  const innerStyle = computed(() => {
    const g = input.frame.value
    if (!g) return null
    return {
      left: `${g.inner.x}px`,
      top: `${g.inner.y}px`,
      width: `${g.inner.w}px`,
      height: `${g.inner.h}px`,
      ...frameStrokeCss(input.frameConfig.value.inner, 1, 'var(--ui-select-inner, var(--ui-accent, #0891b2))'),
    }
  })
  const showInner = computed(() => {
    const g = input.frame.value
    if (!g) return false
    return input.frameConfig.value.inner.lineWidth > 0 && g.inner.w > 0 && g.inner.h > 0
  })
  return { outerStyle, innerStyle, showInner }
}
