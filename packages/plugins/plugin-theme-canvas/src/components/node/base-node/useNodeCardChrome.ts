import { computed, type Ref } from 'vue'
import { resolveCardFrame } from '../cardFrame'
import type { useNodeCapability } from '../../../composables/useNodeCapability'

export interface NodeCardChromeInput {
  cap: ReturnType<typeof useNodeCapability>
  type: string
  selected: () => boolean | undefined
  data: () => Record<string, unknown> | undefined
  zoom: Ref<number>
  titleMinZoom: Ref<number>
  titleOffset: Ref<number>
  titleScale: Ref<number>
  lowDetail: Ref<boolean>
  titleVisible: Ref<boolean>
  hideTitleOnMulti: Ref<boolean>
  cardWidth: Ref<number>
  cardHeight: Ref<number>
  cardTransform: Ref<string>
}

/** 卡片外观、标题位置与浮层/工具栏的可见性门。 */
export function useNodeCardChrome(input: NodeCardChromeInput) {
  const cap = input.cap
  const titleIcon = cap.icon

  const nodeLabel = computed(() => {
    const label = input.data()?.label as string | undefined
    return label || cap.label.value || input.type || '节点'
  })

  const titleExtraText = computed(() => {
    const src = cap.titleExtra.value
    if (!src) return ''
    if (typeof src === 'string') return src
    try {
      return src((input.data() ?? {}) as Record<string, unknown>) ?? ''
    } catch {
      return ''
    }
  })
  const titleExtraSlotComp = computed(() => cap.titleExtraSlot?.value)

  const titleCanvasWidth = computed(
    () => input.cardWidth.value * Math.max(input.zoom.value, input.titleMinZoom.value),
  )
  const cardBorderComp = computed(() =>
    cap.frameless.value ? 0 : Math.max(1 / input.zoom.value, 1),
  )
  const titlePositionStyle = computed(() => ({
    transform: `scale(${input.titleScale.value})`,
    transformOrigin: 'left bottom',
    left: `${-cardBorderComp.value}px`,
    bottom: `calc(100% + ${input.titleOffset.value * input.titleScale.value + cardBorderComp.value}px)`,
    width: `${titleCanvasWidth.value}px`,
  }))

  const showSelectionOutline = computed(
    () => Boolean(input.selected() && !input.data()?._overlay),
  )
  const cardFrame = computed(() =>
    resolveCardFrame({
      zoom: input.zoom.value,
      frameless: cap.frameless.value,
      transparent: cap.transparent.value,
      selected: showSelectionOutline.value,
    }),
  )
  const cardInlineStyle = computed<Record<string, string>>(() => ({
    width: `${input.cardWidth.value}px`,
    height: `${input.cardHeight.value}px`,
    transform: input.cardTransform.value,
    borderWidth: cardFrame.value.borderWidth,
    borderRadius: cardFrame.value.borderRadius,
    '--card-outline-width': cardFrame.value.outlineWidth,
    '--card-surface': cardFrame.value.surface,
    '--card-shadow': cardFrame.value.shadow,
    '--card-content-surface': cardFrame.value.contentSurface,
  }))

  const showTitle = computed(
    () =>
      input.titleVisible.value &&
      !input.lowDetail.value &&
      !input.hideTitleOnMulti.value,
  )

  return {
    cap,
    titleIcon,
    nodeLabel,
    titleExtraText,
    titleExtraSlotComp,
    titlePositionStyle,
    showSelectionOutline,
    cardInlineStyle,
    showTitle,
  }
}
