import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import {
  collectUpstreamMaterials,
  materialCards,
  makeResourceResolver,
  resolveMaterialUrls,
  toEditorResources,
  type MaterialCard,
  type UpstreamMaterial,
} from '../panelSource'
import { peekVideoThumb, ensureVideoThumb } from '../videoThumbCache'

interface MaterialDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  renderEdges: CanvasRenderContext['renderEdges']
  renderNodes: CanvasRenderContext['renderNodes']
}

/** 上游素材解析、视频缩略图、卡片 @ 资源。 */
export function useBottomBarMaterials(deps: MaterialDeps) {
  function stringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
  }
  const refOrder = computed<string[]>(() => stringArray(deps.props.data?.refOrder))

  const materials = computed<UpstreamMaterial[]>(() =>
    collectUpstreamMaterials(
      deps.renderEdges.value,
      deps.props.id,
      (nodeId) => {
        const node = deps.renderNodes.value.find((n) => n.id === nodeId)
        return node ? { type: node.type, data: node.data } : undefined
      },
      refOrder.value,
    ),
  )

  const resolvedMaterials = ref<UpstreamMaterial[]>([])
  const materialEpoch = ref(0)
  async function refreshResolvedMaterials(): Promise<void> {
    const epoch = ++materialEpoch.value
    const next = await resolveMaterialUrls(materials.value, async (id) => {
      const resources = deps.ctx.tryGet<{ resolve(ref: string): Promise<string | undefined> }>('resources')
      return resources ? resources.resolve(id) : undefined
    })
    if (epoch === materialEpoch.value) resolvedMaterials.value = next
  }
  watch(materials, () => void refreshResolvedMaterials(), { immediate: true })

  const videoThumbTick = ref(0)
  function videoThumbOf(url: string | undefined): string | undefined {
    return peekVideoThumb(url)
  }

  function cardImageOf(tile: { url?: string; kind?: string | null }): string {
    void videoThumbTick.value
    if (!tile.url) return ''
    if (tile.kind === 'video') return videoThumbOf(tile.url) ?? ''
    if (tile.kind === 'audio') return ''
    return tile.url
  }

  function videoProvider(): ((videoUrl: string) => Promise<string | null>) | undefined {
    const svc = deps.ctx.tryGet<{ thumb?(videoUrl: string | undefined): Promise<string | null> }>('video')
    return svc?.thumb ? (url: string) => svc.thumb!(url) : undefined
  }

  const shownMaterials = computed(() =>
    resolvedMaterials.value.length === materials.value.length ? resolvedMaterials.value : materials.value,
  )

  async function ensureVideoThumbs(): Promise<void> {
    const capture = videoProvider()
    if (!capture) return
    const urls = new Set<string>()
    for (const m of shownMaterials.value) {
      if (m.kind === 'video' && m.url) urls.add(m.url)
    }
    for (const url of urls) {
      if (peekVideoThumb(url)) continue
      const thumb = await ensureVideoThumb(url, capture)
      if (thumb) videoThumbTick.value += 1
    }
  }
  watch(shownMaterials, () => void ensureVideoThumbs(), { immediate: true })

  async function ensureFullVideoThumb(url: string): Promise<string | undefined> {
    const hit = peekVideoThumb(url)
    if (hit) return hit
    const thumb = await ensureVideoThumb(url, videoProvider())
    if (thumb) videoThumbTick.value += 1
    return thumb ?? undefined
  }

  watch(videoThumbTick, () => {
    void editorResources.value
  })
  const cards = computed(() => materialCards(shownMaterials.value))
  const editorResources = computed<ResourceItem[]>(() => {
    void videoThumbTick.value
    return toEditorResources(shownMaterials.value, undefined, (url) => videoThumbOf(url))
  })
  const resolveResource = computed(() => makeResourceResolver(editorResources.value))

  return {
    refOrder,
    materials,
    resolvedMaterials,
    shownMaterials,
    videoThumbTick,
    videoProvider,
    videoThumbOf,
    cardImageOf,
    ensureFullVideoThumb,
    cards,
    editorResources,
    resolveResource,
  }
}
