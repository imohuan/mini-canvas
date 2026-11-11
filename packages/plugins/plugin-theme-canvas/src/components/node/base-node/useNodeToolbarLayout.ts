import { computed, inject, type Ref } from 'vue'
import {
  NODE_TOOLBAR_HOST_KEY,
  resolveNodeSlotStyle,
  useToolbarOffsets,
} from '@plume-canvas/canvas-render'

export interface NodeToolbarLayoutInput {
  zoom: Ref<number>
  cardWidth: Ref<number>
  cardHeight: Ref<number>
  position: () => { x: number; y: number } | undefined
}

/** 上/下控制栏的定位、传送宿主与编辑浮层的同尺寸层。 */
export function useNodeToolbarLayout(input: NodeToolbarLayoutInput) {
  const slotOffsets = useToolbarOffsets()
  const topSlotsStyle = computed(() =>
    resolveNodeSlotStyle({
      side: 'top',
      offset: slotOffsets.value.top,
      zoom: input.zoom.value,
    }),
  )
  const bottomSlotsStyle = computed(() =>
    resolveNodeSlotStyle({
      side: 'bottom',
      offset: slotOffsets.value.bottom,
      zoom: input.zoom.value,
    }),
  )

  const toolbarHostEl = inject(NODE_TOOLBAR_HOST_KEY, undefined)
  const toolbarHost = computed<HTMLElement | null>(() => toolbarHostEl?.value ?? null)
  const toolbarAnchorStyle = computed<Record<string, string>>(() => ({
    left: `${input.position()?.x ?? 0}px`,
    top: `${input.position()?.y ?? 0}px`,
    width: `${input.cardWidth.value}px`,
    height: `${input.cardHeight.value}px`,
  }))
  const overlayLayerStyle = computed<Record<string, string>>(() => ({
    width: `${input.cardWidth.value}px`,
    height: `${input.cardHeight.value}px`,
  }))

  return {
    topSlotsStyle,
    bottomSlotsStyle,
    toolbarHost,
    toolbarAnchorStyle,
    overlayLayerStyle,
  }
}
