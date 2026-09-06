/**
 * useNodeCardSize —— 卡片固定尺寸 + 右下角拖拽 resize（移植自 v1 Decoration/BaseNode 的内置 resize 逻辑）。
 *
 * v2 卡片从"内容自适应"改为"固定可改尺寸框"。尺寸来源：node.data.cardWidth/cardHeight（与 v1 同名，便于存量迁移）
 * ?? nodeStore.types.defaultSize。resize 拖拽用 pointer capture，屏幕 delta ÷ zoom 还原成画布/内容坐标，
 * 结束经 nodeWrite 写回 node.data（触发 nodeStore 订阅 → 渲染态自动刷新，无需手动 updateNode/map）。
 *
 * 用法（BaseNode）：
 *   const card = useNodeCardSize({ id, data, type, writeback: nodeWrite, zoom })
 *   :style="{ width: card.cardWidth+'px', height: card.cardHeight+'px', ... }"
 *   <div class="resize-handle" @pointerdown=... @pointermove=... @pointerup=... />
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useNodeCapability } from './useNodeCapability'

export interface NodeCardSizeOptions {
  nodeId: string
  /** 节点 data（reactive） */
  data: Record<string, unknown>
  type: string
  /** 尺寸写回（CanvasHost nodeWrite → nodeStore + 落盘） */
  writeback?: (id: string, patch: Record<string, unknown>) => void
  /** 当前画布缩放（resize 屏幕 delta ÷ zoom 换算） */
  zoom: () => number
}

export const CARD_MIN_WIDTH = 120
export const CARD_MIN_HEIGHT = 80

export function useNodeCardSize(opts: NodeCardSizeOptions) {
  const capability = useNodeCapability(opts.type)
  // 初值：data 显式尺寸 ?? 类型 defaultSize
  const cardWidth = ref<number>(
    (opts.data.cardWidth as number) || capability.defaultSize.value.w,
  )
  const cardHeight = ref<number>(
    (opts.data.cardHeight as number) || capability.defaultSize.value.h,
  )

  // 外部(data.cardWidth/Height)改动同步进来；拖拽期间不覆盖本地拖拽值
  const isResizing = ref(false)
  watch(
    () => opts.data?.cardWidth as number | undefined,
    (w) => {
      if (w !== undefined && !isResizing.value) cardWidth.value = w
    },
  )
  watch(
    () => opts.data?.cardHeight as number | undefined,
    (h) => {
      if (h !== undefined && !isResizing.value) cardHeight.value = h
    },
  )

  // resizable 只在 data.resizable === true 时显示拖柄
  const resizable = computed(() => opts.data?.resizable === true)

  // —— resize 拖拽状态机 ——
  interface ResizeState {
    startScreenX: number
    startScreenY: number
    startWidth: number
    startHeight: number
  }
  const resizeState = ref<ResizeState | null>(null)

  function onResizePointerDown(e: PointerEvent) {
    if (!resizable.value) return
    e.preventDefault()
    e.stopPropagation()
    isResizing.value = true
    resizeState.value = {
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startWidth: cardWidth.value,
      startHeight: cardHeight.value,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onResizePointerMove(e: PointerEvent) {
    if (!isResizing.value || !resizeState.value) return
    const ds = resizeState.value
    const z = opts.zoom() || 1
    const dx = (e.clientX - ds.startScreenX) / z
    const dy = (e.clientY - ds.startScreenY) / z
    cardWidth.value = Math.max(CARD_MIN_WIDTH, ds.startWidth + dx)
    cardHeight.value = Math.max(CARD_MIN_HEIGHT, ds.startHeight + dy)
  }

  function onResizePointerUp(e: PointerEvent) {
    if (!isResizing.value || !resizeState.value) return
    isResizing.value = false
    resizeState.value = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    // 写回 node.data（触发 nodeStore 订阅自动刷新渲染态）
    if (opts.writeback) {
      opts.writeback(opts.nodeId, { cardWidth: cardWidth.value, cardHeight: cardHeight.value })
    }
  }

  onBeforeUnmount(() => {
    isResizing.value = false
    resizeState.value = null
  })

  return {
    cardWidth,
    cardHeight,
    resizable,
    isResizing,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
  }
}
