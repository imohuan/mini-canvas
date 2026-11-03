import { watch, type Ref } from 'vue'
import {
  beginNodeResize,
  endNodeResize,
  type CanvasRenderContext,
} from '@mini-canvas/canvas-render'
import { useNodeCardSize as useNodeCardSizeBase } from '../../../composables/useNodeCardSize'

export interface NodeCardSizeInput {
  id: string
  type: string
  data: () => Record<string, unknown>
  writeback: ((id: string, patch: Record<string, unknown>) => void) | undefined
  flow: CanvasRenderContext['flow']
  interaction: CanvasRenderContext['interaction']
  zoom: Ref<number>
}

/** 卡片尺寸 + resize 会话接线（抓点偏移、共享活动位、缩放补算）。 */
export function useNodeCardSize(input: NodeCardSizeInput) {
  function resizeGrabOffset(
    e: PointerEvent,
  ): { x: number; y: number } | undefined {
    const cardEl = (e.currentTarget as HTMLElement | null)?.closest(
      '.v2-card',
    ) as HTMLElement | null
    if (!cardEl || typeof cardEl.getBoundingClientRect !== 'function') return undefined
    const r = cardEl.getBoundingClientRect()
    return { x: r.right - e.clientX, y: r.bottom - e.clientY }
  }

  const card = useNodeCardSizeBase({
    nodeId: input.id,
    data: input.data,
    type: input.type,
    writeback: input.writeback,
    toFlow: (x, y) => input.flow.screenToFlow(x, y),
    grabOffset: resizeGrabOffset,
    onVisualSize: (w, h) => input.flow.updateNodeVisualSize(input.id, w, h),
    onResizeStart: () => beginNodeResize(input.interaction, input.id),
    onResizeEnd: () => endNodeResize(input.interaction, input.id),
  })

  const cardWidth = card.cardWidth
  const cardHeight = card.cardHeight
  const cardResizable = card.resizable
  const cardIsResizing = card.isResizing

  watch(input.zoom, () => {
    if (cardIsResizing.value) card.refreshSize()
  })

  return {
    card,
    cardWidth,
    cardHeight,
    cardResizable,
    cardIsResizing,
  }
}
