import { computed, ref, watch, type Ref } from 'vue'
import {
  isConnectionSource,
  type AimedTarget,
  type CanvasRenderContext,
} from '@plume-canvas/canvas-render'
import type { useNodeCapability } from '../../../composables/useNodeCapability'
import type MovingHandle from '../MovingHandle.vue'

export interface NodeConnectionFeedbackInput {
  ctx: CanvasRenderContext['ctx']
  id: string
  type: string
  selected: () => boolean | undefined
  connectionState: CanvasRenderContext['connectionState']
  interaction: CanvasRenderContext['interaction']
  flow: CanvasRenderContext['flow']
  cap: ReturnType<typeof useNodeCapability>
  cardWidth: Ref<number>
  cardHeight: Ref<number>
  lowDetail: Ref<boolean>
  isHandTool: Ref<boolean>
  isMultiSelected: Ref<boolean>
}

/**
 * 连接反馈：3D 倾斜、aimedTarget 上报、端口显隐/禁用、物理 hover 状态。
 *
 * 保持原样：isHovered 只由卡片根 enter/leave 写，portHovered 只由 MovingHandle @hover 写，
 * shouldShowHandles 不读 isBusyDragging，拖线源判定统一走 isConnectionSource。
 */
export function useNodeConnectionFeedback(input: NodeConnectionFeedbackInput) {
  const CONNECT_FEEDBACK = {
    rotateX: 18,
    rotateY: 18,
    perspective: 800,
    scale: 1.018,
  }

  const isHovered = ref(false)
  const portHovered = ref(false)
  const aimPortSide = ref<null | 'input' | 'output'>(null)
  const aimBody = ref(false)

  const isConnecting = computed(() => input.connectionState.isConnecting.value)
  const activeConnection = computed(() => input.connectionState.activeConnection.value)
  const isCurrentConnectingNode = computed(
    () => isConnecting.value && isConnectionSource(activeConnection.value, input.id),
  )
  const suppressHandles = computed(() => input.connectionState.suppressHandles.value)
  const connectionHover = computed(() => {
    const h = input.connectionState.hoverNode.value
    return h && h.nodeId === input.id ? h : null
  })
  const isConnectionValidTarget = computed(
    () => connectionHover.value?.status === 'valid',
  )
  const isConnectionInvalidTarget = computed(
    () => connectionHover.value?.status === 'invalid',
  )
  const isWillEvictTarget = computed(() => connectionHover.value?.willEvict === true)

  let tipOwner = false
  watch(
    () =>
      [
        isConnectionInvalidTarget.value,
        isWillEvictTarget.value,
        connectionHover.value?.reason,
      ] as const,
    ([invalid, evict, reason]) => {
      const canvas = input.ctx.tryGet<{
        notify(m: string, o?: object): unknown
      }>('canvas')
      if (!canvas) return
      if (invalid) {
        tipOwner = true
        canvas.notify(reason || '无法连接', {
          source: `node:${input.id}`,
          followPointer: true,
          durationMs: 0,
        })
      } else if (evict) {
        tipOwner = true
        canvas.notify('将替换已有连接', {
          source: `node:${input.id}`,
          followPointer: true,
          durationMs: 0,
        })
      } else if (tipOwner) {
        tipOwner = false
        canvas.notify('', { source: `node:${input.id}` })
      }
    },
    { immediate: true },
  )

  const showConnectFeedback = computed(
    () =>
      isConnecting.value &&
      !isCurrentConnectingNode.value &&
      !isConnectionInvalidTarget.value &&
      !input.lowDetail.value &&
      isConnectionValidTarget.value,
  )

  const targetHandleRef = ref<InstanceType<typeof MovingHandle> | null>(null)
  const sourceHandleRef = ref<InstanceType<typeof MovingHandle> | null>(null)

  function onInputSnapEnter(): void {
    aimPortSide.value = 'input'
  }
  function onOutputSnapEnter(): void {
    aimPortSide.value = 'output'
  }
  function onSnapLeave(): void {
    aimPortSide.value = null
  }

  const snapZonesActive = computed(
    () => isConnecting.value && !isCurrentConnectingNode.value && !input.lowDetail.value,
  )

  function onPortHover(value: boolean): void {
    portHovered.value = value
  }

  /** 命中吸附带时用真实渲染高度 cardHeight 算端口锚点 flow 坐标 */
  function snapAnchorFor(side: 'input' | 'output'): { x: number; y: number } | undefined {
    const pos = input.flow.getNodeRenderPosition(input.id)
    if (!pos) return undefined
    const y = pos.y + input.cardHeight.value / 2
    const x = side === 'input' ? pos.x : pos.x + input.cardWidth.value
    return { x, y }
  }

  watch(
    [aimPortSide, aimBody, isConnecting, isCurrentConnectingNode],
    () => {
      const aimed = input.connectionState.aimedTarget.value
      if (!isConnecting.value || isCurrentConnectingNode.value) {
        if (aimed?.nodeId === input.id) input.connectionState.aimedTarget.value = null
        return
      }
      let next: AimedTarget | null = null
      const connectable = input.cap.hasTarget.value || input.cap.hasSource.value
      if (aimPortSide.value && connectable) {
        next = {
          nodeId: input.id,
          side: aimPortSide.value,
          anchor: snapAnchorFor(aimPortSide.value),
        }
      } else if (aimBody.value && connectable) {
        next = { nodeId: input.id, side: 'body' }
      }
      if (next) {
        input.connectionState.aimedTarget.value = next
      } else if (aimed?.nodeId === input.id) {
        input.connectionState.aimedTarget.value = null
      }
    },
    { immediate: true },
  )

  const handleBlocked = computed(
    () =>
      input.isHandTool.value ||
      input.lowDetail.value ||
      suppressHandles.value ||
      isCurrentConnectingNode.value ||
      input.interaction.isNodeDragging.value ||
      input.isMultiSelected.value,
  )
  const shouldShowHandles = computed(
    () =>
      !handleBlocked.value &&
      (isHovered.value || portHovered.value || input.selected()),
  )

  const dragSameTypeBlocked = computed(
    () => isConnecting.value && !isCurrentConnectingNode.value,
  )
  const blockedTargetPort = computed(
    () =>
      dragSameTypeBlocked.value &&
      activeConnection.value?.sourceHandle === 'target',
  )
  const blockedSourcePort = computed(
    () =>
      dragSameTypeBlocked.value &&
      activeConnection.value?.sourceHandle === 'source',
  )

  function onCardMouseEnter(): void {
    isHovered.value = true
    aimBody.value = true
  }
  function onCardMouseLeave(): void {
    isHovered.value = false
    aimBody.value = false
    targetHandleRef.value?.handleCardLeave(true)
    sourceHandleRef.value?.handleCardLeave(true)
  }

  /** 物理鼠标在卡内 0~1（3D 倾斜 fallback 输入） */
  const mousePosition = ref({ x: 0.5, y: 0.5 })
  function updateCardMousePosition(event: MouseEvent) {
    if (!showConnectFeedback.value) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    mousePosition.value = {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  const feedbackMousePosition = computed(() => {
    const h = connectionHover.value
    if (h?.status === 'valid') {
      const pos = input.flow.getNodeRenderPosition(input.id)
      if (pos && input.cardWidth.value > 0) {
        return {
          x: clamp((h.flowPosition.x - pos.x) / input.cardWidth.value, 0, 1),
          y: clamp((h.flowPosition.y - pos.y) / input.cardHeight.value, 0, 1),
        }
      }
    }
    return mousePosition.value
  })

  const cardTransform = computed(() => {
    if (isConnectionInvalidTarget.value) return ''
    if (!showConnectFeedback.value) return ''
    const p = feedbackMousePosition.value
    const rotateX = (p.y - 0.5) * CONNECT_FEEDBACK.rotateX
    const rotateY = (p.x - 0.5) * -CONNECT_FEEDBACK.rotateY
    return `perspective(${CONNECT_FEEDBACK.perspective}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px) scale(${CONNECT_FEEDBACK.scale})`
  })

  const invalidTooltipStyle = computed(() => {
    const h = connectionHover.value
    const pos = input.flow.getNodeRenderPosition(input.id)
    if (h?.status === 'invalid' && pos && input.cardWidth.value > 0) {
      const x = clamp((h.flowPosition.x - pos.x) / input.cardWidth.value, 0.06, 0.94)
      const y = clamp((h.flowPosition.y - pos.y) / input.cardHeight.value, 0.08, 0.92)
      return { left: `${x * 100}%`, top: `${y * 100}%` }
    }
    return { left: '8%', top: '50%' }
  })

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  return {
    isHovered,
    portHovered,
    isConnecting,
    activeConnection,
    isCurrentConnectingNode,
    suppressHandles,
    connectionHover,
    isConnectionValidTarget,
    isConnectionInvalidTarget,
    isWillEvictTarget,
    showConnectFeedback,
    targetHandleRef,
    sourceHandleRef,
    snapZonesActive,
    onInputSnapEnter,
    onOutputSnapEnter,
    onSnapLeave,
    onPortHover,
    onCardMouseEnter,
    onCardMouseLeave,
    updateCardMousePosition,
    cardTransform,
    invalidTooltipStyle,
    handleBlocked,
    shouldShowHandles,
    blockedTargetPort,
    blockedSourcePort,
  }
}
