import { computed, watch, type Ref } from 'vue'
import {
  createV2Logger,
  type CanvasRenderContext,
} from '@mini-canvas/canvas-render'
import { useNodeDebugOverlay as useNodeDebugGeometry } from '../../../composables/useNodeDebugOverlay'

export interface NodeDebugOverlayInput {
  id: string
  type: string
  debug: CanvasRenderContext['debug']
  snapZone: CanvasRenderContext['snapZone']
  handleParams: CanvasRenderContext['handleParams']
  cardWidth: Ref<number>
  cardHeight: Ref<number>
  lowDetail: Ref<boolean>
  isConnecting: Ref<boolean>
  suppressHandles: Ref<boolean>
  showTargetHandle: Ref<boolean>
}

/** 调试可视化：端口调试开关 + 吸附带几何（与真实命中同源）。 */
export function useNodeDebugOverlay(input: NodeDebugOverlayInput) {
  const log = createV2Logger('base-node')
  const debugHandle = computed(() => Boolean(input.debug.handleDebug))
  const showHandleDebugOverlay = computed(
    () => debugHandle.value && !input.lowDetail.value && !input.suppressHandles.value,
  )
  const showSnapDebugOverlay = computed(
    () =>
      Boolean(input.debug.connectionSnapDebugVisible) &&
      input.showTargetHandle.value &&
      !input.lowDetail.value,
  )

  const portZoneWidth = computed(() => Number(input.handleParams.portZoneWidth) || 0)
  const portZoneHeight = computed(
    () =>
      input.cardHeight.value *
      Math.min(
        Math.max(Number(input.handleParams.portZoneHeightRatio) || 0.8, 0),
        1,
      ),
  )
  const portZoneOffset = computed(() => Number(input.handleParams.portZoneOffset) || 0)
  const portZoneShape = computed(() => input.handleParams.portZoneShape ?? 'arc')
  const portZoneArcRatio = computed(() =>
    Math.min(
      Math.max(Number(input.handleParams.portZoneArcRatio) ?? 1, 0.2),
      1,
    ),
  )
  const debugOverlay = useNodeDebugGeometry({
    cardWidth: input.cardWidth,
    cardHeight: input.cardHeight,
    handleRadius: portZoneWidth,
    snapZone: input.snapZone,
  })
  const debugViewBox = computed(
    () => `0 0 ${input.cardWidth.value} ${input.cardHeight.value}`,
  )
  const bodyRect = computed(() => ({
    x: 0,
    y: 0,
    width: input.cardWidth.value,
    height: input.cardHeight.value,
  }))
  const inputSnapStyle = computed(() => ({
    left: `${debugOverlay.leftBand.value.x}px`,
    top: `${debugOverlay.leftBand.value.y}px`,
    width: `${debugOverlay.leftBand.value.width}px`,
    height: `${debugOverlay.leftBand.value.height}px`,
  }))
  const outputSnapStyle = computed(() => ({
    left: `${debugOverlay.rightBand.value.x}px`,
    top: `${debugOverlay.rightBand.value.y}px`,
    width: `${debugOverlay.rightBand.value.width}px`,
    height: `${debugOverlay.rightBand.value.height}px`,
  }))

  watch(showSnapDebugOverlay, (on) => {
    log.log(
      `[${input.id}/${input.type}] 吸附调试叠加 ${on ? '显示' : '隐藏'} handleDebug=${debugHandle.value} isConnecting=${input.isConnecting.value}`,
    )
  })
  watch(debugHandle, (on) => {
    log.log(`[${input.id}/${input.type}] 端口调试 ${on ? '开' : '关'}`)
  })

  return {
    debugHandle,
    showHandleDebugOverlay,
    showSnapDebugOverlay,
    portZoneWidth,
    portZoneHeight,
    portZoneOffset,
    portZoneShape,
    portZoneArcRatio,
    debugOverlay,
    debugViewBox,
    bodyRect,
    inputSnapStyle,
    outputSnapStyle,
  }
}
