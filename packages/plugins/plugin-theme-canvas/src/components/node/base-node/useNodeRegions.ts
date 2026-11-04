import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import {
  createCapabilityCache,
  createCapabilityNodeContext,
  capabilityField,
} from '@mini-canvas/canvas-render'
import { nodeRegionStackEntries } from '@mini-canvas/canvas-data'
import type { NodeWrite } from '@mini-canvas/canvas-render'

export interface NodeRegionsInput {
  ctx: CanvasRenderContext['ctx']
  registry: CanvasRenderContext['registry']
  id: string
  type: string
  data: () => Record<string, unknown> | undefined
  isSelected: Ref<boolean>
  isSoloSelected: Ref<boolean>
  zoom: Ref<number>
  nodeWrite: NodeWrite | undefined
}

/**
 * 十个区域的路由，以及每节点一份的能力实例缓存。
 *
 * 区域场是非响应式的普通对象，仍由 regionOff 订阅 bump regionTick；
 * 缓存仍建在节点这一层，卸载时统一 dispose。
 */
export function useNodeRegions(input: NodeRegionsInput) {
  const regionField = (() => {
    try {
      return input.ctx?.registryOf?.('node/region')
    } catch {
      return undefined
    }
  })()
  const regionTick = ref(0)
  const regionOff = regionField?.subscribe(() => void (regionTick.value += 1))
  onBeforeUnmount(() => regionOff?.dispose())

  const regionEntries = (region: string) =>
    (void regionTick.value,
    nodeRegionStackEntries(input.registry, regionField as never, input.type, region))

  const contentStack = computed(() => regionEntries('in'))
  const titleStack = computed(() => regionEntries('title'))
  const customTitle = computed(() => titleStack.value[0]?.component)
  const customTitleEntry = computed(() =>
    customTitle.value ? titleStack.value[0] : undefined,
  )
  const topSlots = computed(() => regionEntries('out:top'))
  const bottomSlots = computed(() => regionEntries('out:bottom'))
  const overlaySlots = computed(() => regionEntries('over:inset'))
  const leftRegions = computed(() => regionEntries('out:left'))
  const rightRegions = computed(() => regionEntries('out:right'))
  const onTopRegions = computed(() => regionEntries('on:top'))
  const onBottomRegions = computed(() => regionEntries('on:bottom'))
  const outsetRegions = computed(() => regionEntries('over:outset'))
  const editable = computed(() => Boolean(input.nodeWrite))

  const nodeDataRef = computed(() => (input.data() ?? {}) as Record<string, unknown>)
  const capabilityNode = createCapabilityNodeContext({
    ctx: input.ctx,
    id: input.id,
    type: input.type,
    data: nodeDataRef,
    selected: input.isSelected,
    solo: input.isSoloSelected,
    zoom: input.zoom,
    update: (patch) => input.nodeWrite?.(input.id, patch),
  })
  const capabilityIsDev = input.ctx?.isDev === true
  const capabilityCache = createCapabilityCache(
    capabilityField(input.ctx),
    capabilityNode,
    capabilityIsDev,
  )
  onBeforeUnmount(() => capabilityCache.dispose())

  return {
    contentStack,
    titleStack,
    customTitle,
    customTitleEntry,
    topSlots,
    bottomSlots,
    overlaySlots,
    leftRegions,
    rightRegions,
    onTopRegions,
    onBottomRegions,
    outsetRegions,
    editable,
    capabilityCache,
    capabilityIsDev,
  }
}
