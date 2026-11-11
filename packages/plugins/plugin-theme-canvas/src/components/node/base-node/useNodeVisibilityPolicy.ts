import { computed, type Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'

export interface NodeVisibilityPolicyInput {
  id: string
  interaction: CanvasRenderContext['interaction']
  isSelected: Ref<boolean>
  selectedCount: Ref<number>
  isHandTool: Ref<boolean>
}

/** 上/下插槽与编辑浮层的压制条件（两套开关，不合并）。 */
export function useNodeVisibilityPolicy(input: NodeVisibilityPolicyInput) {
  const hideToolbars = computed(
    () =>
      input.interaction?.isSelecting?.value === true ||
      (input.isSelected.value && input.selectedCount.value > 1) ||
      input.interaction?.nodeResizeId?.value === input.id,
  )
  const hideOverlays = computed(
    () => input.interaction?.nodeResizeId?.value === input.id,
  )
  const hideSlotBars = computed(
    () =>
      hideToolbars.value ||
      input.interaction?.isNodeDragging?.value === true ||
      input.isHandTool.value,
  )
  return {
    hideToolbars,
    hideOverlays,
    hideSlotBars,
  }
}
