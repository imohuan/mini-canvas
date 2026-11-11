import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import type { MultiRadioConfig } from '@plume-canvas/theme-contract'
import { multiRadioStyle } from '@plume-canvas/theme-contract'

export interface NodeMultiSelectStateInput {
  ctx: CanvasRenderContext['ctx']
  id: string
  selected: () => boolean | undefined
  zoom: Ref<number>
  titleMinZoom: Ref<number>
  lowDetail: Ref<boolean>
  multiRadio: Readonly<{ value: MultiRadioConfig }>
  hideTitlesOnMulti: Readonly<{ value: boolean }>
}

/** 选中态：内核 selection 是单源，VueFlow 的 selected 只作只读宿主的兜底。 */
export function useNodeMultiSelectState(input: NodeMultiSelectStateInput) {
  const selTick = ref(0)
  const selectionPeek = input.ctx?.tryGet('selection')
  const selOff = selectionPeek?.onChange(() => void (selTick.value += 1))
  onBeforeUnmount(() => selOff?.())

  const isSelected = computed(() => {
    void selTick.value
    return selectionPeek ? selectionPeek.ids.has(input.id) : Boolean(input.selected())
  })
  const selectedCount = computed(() => {
    void selTick.value
    return selectionPeek ? selectionPeek.ids.size : (input.selected() ? 1 : 0)
  })

  const isSoloSelected = computed(() => isSelected.value && selectedCount.value === 1)
  const isMultiSelected = computed(() => isSelected.value && selectedCount.value > 1)
  const hideTitleOnMulti = computed(
    () => input.hideTitlesOnMulti.value && isSelected.value && selectedCount.value > 1,
  )
  const showMultiRadio = computed(
    () =>
      isSelected.value &&
      selectedCount.value > 1 &&
      (!input.lowDetail.value || input.multiRadio.value.showInLowDetail),
  )
  const radioStyle = computed(() =>
    multiRadioStyle({
      size: input.multiRadio.value.size,
      zoom: input.zoom.value,
      minZoom: input.titleMinZoom.value,
    }),
  )

  return {
    isSelected,
    selectedCount,
    isSoloSelected,
    isMultiSelected,
    hideTitleOnMulti,
    showMultiRadio,
    radioStyle,
  }
}
