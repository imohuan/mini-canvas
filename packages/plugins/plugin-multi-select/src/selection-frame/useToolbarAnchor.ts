import { computed, onBeforeUnmount, ref } from 'vue'
import {
  createCapabilityCache,
  capabilityField,
  resolveNodeSlotStyle,
  useToolbarOffsets,
} from '@mini-canvas/canvas-render'
import { selectionRegionEntries } from '../selectionRegion'
import type { SelectionFrameGeometry } from '../multiSelectEngine'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'

/** 读取选择框的上/下控制栏条目与定位。 */
export function useToolbarAnchor(input: {
  ctx: CanvasRenderContext['ctx']
  viewport: CanvasRenderContext['flow']['viewport']
  flow: CanvasRenderContext['flow']
  frame: { value: SelectionFrameGeometry | null }
}) {
  const { ctx, viewport, flow, frame } = input
  const regionField = (() => {
    try {
      return ctx.registryOf<unknown>('selection/region')
    } catch {
      return undefined
    }
  })()
  const regionTick = ref(0)
  const rawRegionField = regionField as { subscribe(cb?: () => void): { dispose(): void } } | undefined
  const regionOff = rawRegionField?.subscribe(() => void (regionTick.value += 1))
  onBeforeUnmount(() => regionOff?.dispose())
  const regionEntriesOf = (region: string) =>
    (void regionTick.value, selectionRegionEntries(regionField as never, region))
  const topRegions = computed(() => regionEntriesOf('out:top'))
  const bottomRegions = computed(() => regionEntriesOf('out:bottom'))

  const selectionCapabilityCache = createCapabilityCache(
    capabilityField(ctx),
    {
      ctx: ctx as never,
      id: '',
      type: '',
      data: computed(() => ({})) as never,
      selected: computed(() => true) as never,
      solo: computed(() => false) as never,
      zoom: computed(() => viewport.value.zoom) as never,
      update: () => {},
    },
    ctx.isDev === true,
  )
  onBeforeUnmount(() => selectionCapabilityCache.dispose())

  const toolbarOffsets = useToolbarOffsets()
  const topRegionsStyle = computed(() =>
    resolveNodeSlotStyle({ side: 'top', offset: toolbarOffsets.value.top, zoom: viewport.value.zoom || 1 }),
  )
  const bottomRegionsStyle = computed(() =>
    resolveNodeSlotStyle({ side: 'bottom', offset: toolbarOffsets.value.bottom, zoom: viewport.value.zoom || 1 }),
  )

  const SCREEN_EDGE_MARGIN = 162
  const toolbarClampShift = computed(() => {
    const g = frame.value
    if (!g) return null
    const paneRect = flow.paneRect.value
    if (!flow.flowToScreen || !paneRect) return null
    const vpLeft = paneRect.left
    const vpTop = paneRect.top
    const vpRight = paneRect.right
    const vpBottom = paneRect.bottom
    const shift = (anchor: { x: number; y: number }, _side: 'top' | 'bottom') => {
      const sp = flow.flowToScreen(anchor.x, anchor.y)
      const clampedX = Math.min(Math.max(sp.x, vpLeft + SCREEN_EDGE_MARGIN), vpRight - SCREEN_EDGE_MARGIN)
      const clampedY = Math.min(Math.max(sp.y, vpTop + SCREEN_EDGE_MARGIN), vpBottom - SCREEN_EDGE_MARGIN)
      const dx = clampedX - sp.x
      const dy = clampedY - sp.y
      const zoom = viewport.value.zoom || 1
      return { dx: dx / zoom, dy: dy / zoom }
    }
    const top = shift({ x: g.outer.x + g.outer.w / 2, y: g.outer.y }, 'top')
    const bottom = shift({ x: g.outer.x + g.outer.w / 2, y: g.outer.y + g.outer.h }, 'bottom')
    return { top, bottom }
  })
  const topClampStyle = computed(() => {
    const s = toolbarClampShift.value
    if (!s || (Math.abs(s.top.dx) < 0.5 && Math.abs(s.top.dy) < 0.5)) return {}
    return { translate: `${s.top.dx}px ${s.top.dy}px` }
  })
  const bottomClampStyle = computed(() => {
    const s = toolbarClampShift.value
    if (!s || (Math.abs(s.bottom.dx) < 0.5 && Math.abs(s.bottom.dy) < 0.5)) return {}
    return { translate: `${s.bottom.dx}px ${s.bottom.dy}px` }
  })
  const toolbarAnchorStyle = computed(() => {
    const g = frame.value
    if (!g) return null
    return {
      left: `${g.outer.x}px`,
      top: `${g.outer.y}px`,
      width: `${g.outer.w}px`,
      height: `${g.outer.h}px`,
    }
  })

  return {
    get topRegions() { return topRegions.value },
    get bottomRegions() { return bottomRegions.value },
    selectionCapabilityCache,
    get topRegionsStyle() { return topRegionsStyle.value },
    get bottomRegionsStyle() { return bottomRegionsStyle.value },
    get topClampStyle() { return topClampStyle.value },
    get bottomClampStyle() { return bottomClampStyle.value },
    get toolbarAnchorStyle() { return toolbarAnchorStyle.value },
  }
}
