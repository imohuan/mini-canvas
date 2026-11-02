import { computed, nextTick, ref, watch } from 'vue'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { UpstreamMaterial } from '../panelSource'
import { nodeIdOfChip } from '../refSlots'
import { nodeMediaOf } from '../refSlotDrag'
import { peekVideoThumb, ensureVideoThumb } from '../videoThumbCache'
import { buildTagMenuGroups, buildTagMenuSections, type TagMenuEntry, type TagMenuKind } from '../tagMenu'
import { fitPreviewBox, HOVER_PREVIEW_MAX_SIDE } from '../previewBoxSize'

interface TagMenuDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  shownMaterials: { value: UpstreamMaterial[] }
  videoThumbTick: { value: number }
  videoThumbOf(url: string | undefined): string | undefined
  videoProvider: () => ((url: string) => Promise<string | null>) | undefined
  replaceChipWith(newNodeId: string, chip: ResourceItem, name: string): Promise<void>
  getAnchorEl(): HTMLElement | null
  focusSearch(): void
  invalidateChips(): void
}

/** 标签菜单：全画布节点数据、菜单分组、锚点与条目 hover 预览。 */
export function useBottomBarTagMenu(deps: TagMenuDeps) {
  const tagMenuOpen = ref(false)
  const tagMenuQuery = ref('')
  const tagMenuChip = ref<ResourceItem | null>(null)
  const tagMenuAnchorShift = ref({ x: 0, y: 0 })
  const tagMenuAnchorHeight = ref(1)
  const tagMenuPreviewEntry = ref<TagMenuEntry | null>(null)
  const tagMenuPreviewVisible = ref(false)
  const tagMenuPreviewBox = ref<{ width: number; height: number }>({ width: HOVER_PREVIEW_MAX_SIDE, height: HOVER_PREVIEW_MAX_SIDE })
  const tagMenuPreviewPos = ref({ left: 0, top: 0, above: false })
  const tagMenuPreviewTimer = ref<ReturnType<typeof setTimeout> | null>(null)
  const tagMenuPreviewBoxEl = ref<HTMLElement | null>(null)

  function hoverTagMenuRow(entry: TagMenuEntry, rowEl: HTMLElement): void {
    if (tagMenuPreviewTimer.value) { clearTimeout(tagMenuPreviewTimer.value); tagMenuPreviewTimer.value = null }
    tagMenuPreviewEntry.value = entry
    tagMenuPreviewBox.value = { width: HOVER_PREVIEW_MAX_SIDE, height: HOVER_PREVIEW_MAX_SIDE }
    tagMenuPreviewVisible.value = false
    tagMenuPreviewTimer.value = setTimeout(() => {
      tagMenuPreviewTimer.value = null
      if (tagMenuPreviewEntry.value?.id !== entry.id) return
      if (entry.kind === 'video') {
        const probe = document.createElement('video')
        probe.preload = 'metadata'
        probe.muted = true
        probe.onloadedmetadata = () => {
          if (tagMenuPreviewEntry.value?.id !== entry.id) return
          tagMenuPreviewBox.value = fitPreviewBox(probe.videoWidth, probe.videoHeight)
          placeTagMenuPreviewByEntry(entry)
          tagMenuPreviewVisible.value = true
        }
        probe.onerror = () => {
          if (tagMenuPreviewEntry.value?.id !== entry.id) return
          placeTagMenuPreviewByEntry(entry)
          tagMenuPreviewVisible.value = true
        }
        probe.src = entry.url ?? ''
        return
      }
      const img = new Image()
      img.onload = () => {
        if (tagMenuPreviewEntry.value?.id !== entry.id) return
        tagMenuPreviewBox.value = fitPreviewBox(img.naturalWidth, img.naturalHeight)
        placeTagMenuPreviewByEntry(entry)
        tagMenuPreviewVisible.value = true
      }
      img.src = entry.url ?? ''
    }, 120)
  }

  function placeTagMenuPreviewByEntry(entry: TagMenuEntry): void {
    const row =
      (document.querySelector('.nb-tagmenu-row[data-entry-id="' + CSS.escape(entry.id) + '"]') as HTMLElement | null)
      ?? (document.querySelector('.nb-tagmenu-row:hover') as HTMLElement | null)
    if (row) placeTagMenuPreview(row.getBoundingClientRect())
    else console.warn('[bottom-bar] 行 hover 预览：找不到行 DOM（entry=' + entry.id + '）')
  }
  function leaveTagMenuRow(): void {
    if (tagMenuPreviewTimer.value) { clearTimeout(tagMenuPreviewTimer.value); tagMenuPreviewTimer.value = null }
    tagMenuPreviewEntry.value = null
    tagMenuPreviewVisible.value = false
  }
  function placeTagMenuPreview(rowRect: DOMRect): void {
    const w = tagMenuPreviewBox.value.width
    const gap = 8
    const rightSpace = window.innerWidth - rowRect.right
    const useLeft = rightSpace < w + gap + 8
    const left = useLeft ? rowRect.left - w - gap : rowRect.right + gap
    const maxTop = window.innerHeight - tagMenuPreviewBox.value.height - 8
    const top = Math.round(Math.min(Math.max(8, rowRect.top), Math.max(8, maxTop)))
    tagMenuPreviewPos.value = { left: Math.round(left), top, above: !useLeft }
  }
  const tagMenuRootStyle = computed<Record<string, string>>(() => ({
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: '1px',
    height: tagMenuAnchorHeight.value + 'px',
    transform: 'translate(' + tagMenuAnchorShift.value.x + 'px, ' + tagMenuAnchorShift.value.y + 'px)',
    pointerEvents: 'none',
  }))

  const tagMenuEntries = computed<TagMenuEntry[]>(() => {
    const doc = deps.ctx.tryGet<{
      getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }>
    }>('doc')
    if (!doc || typeof doc.getNodes !== 'function') return []
    const linked = new Map(deps.shownMaterials.value.map((m) => [m.id, m]))
    const out: TagMenuEntry[] = []
    for (const n of doc.getNodes()) {
      if (n.id === deps.props.id) continue
      const media = nodeMediaOf(n) ?? typeOnlyMediaOf(n)
      if (!media) continue
      out.push({
        id: n.id,
        name: media.name || n.id,
        kind: media.mediaType,
        ...(media.url ? { url: media.url } : {}),
        referenced: linked.has(n.id),
      })
    }
    return out
  })

  function typeOnlyMediaOf(
    node: { type?: string; data?: Record<string, unknown> },
  ): { mediaType: 'image' | 'video' | 'audio' | 'text'; url: string; name: string } | null {
    const type = node.type
    if (type !== 'image' && type !== 'video' && type !== 'audio' && type !== 'text') return null
    const label = typeof node.data?.label === 'string' ? node.data.label.trim() : ''
    const fallback = type === 'image' ? '图片' : type === 'video' ? '视频' : type === 'audio' ? '音频' : '文本'
    return { mediaType: type, url: '', name: label || fallback }
  }

  const tagMenuGroups = computed(() => buildTagMenuGroups(tagMenuEntries.value, tagMenuQuery.value))
  const tagMenuFlat = computed(() => tagMenuQuery.value.trim().length > 0)
  const tagMenuSections = computed(() => buildTagMenuSections(tagMenuEntries.value, tagMenuQuery.value))
  const tagMenuActiveKind = ref<TagMenuKind | null>(null)
  watch(tagMenuSections, (s) => {
    if (!s.kinds.some((k) => k.kind === tagMenuActiveKind.value)) {
      tagMenuActiveKind.value = s.kinds[0]?.kind ?? null
    }
  }, { immediate: true })
  const tagMenuActiveItems = computed<TagMenuEntry[]>(() => {
    const kinds = tagMenuSections.value.kinds
    return kinds.find((k) => k.kind === tagMenuActiveKind.value)?.items ?? kinds[0]?.items ?? []
  })
  const tagMenuFlatItems = computed(() => tagMenuGroups.value.flatMap((g) => g.items))
  function tagMenuThumbOf(e: { kind: string; url?: string }): string {
    void deps.videoThumbTick.value
    if (!e.url) return ''
    if (e.kind === 'video') return deps.videoThumbOf(e.url) ?? ''
    if (e.kind === 'audio' || e.kind === 'text') return ''
    return e.url
  }

  function openTagMenu(
    item: ResourceItem,
    anchor: { left: number; top: number; right: number; bottom: number },
  ): void {
    if (tagMenuOpen.value && tagMenuChip.value?.id === item.id) {
      closeTagMenu()
      return
    }
    tagMenuChip.value = item
    tagMenuQuery.value = ''
    tagMenuActiveKind.value = null
    tagMenuOpen.value = false
    tagMenuAnchorShift.value = { x: 0, y: 0 }
    tagMenuAnchorHeight.value = Math.max(1, Math.round(anchor.bottom - anchor.top))
    void (async () => {
      const capture = deps.videoProvider()
      if (!capture) return
      const doc = deps.ctx.tryGet<{ getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }> }>('doc')
      if (!doc || typeof doc.getNodes !== 'function') return
      let touched = false
      for (const n of doc.getNodes()) {
        const media = nodeMediaOf(n) ?? typeOnlyMediaOf(n)
        if (!media || media.mediaType !== 'video' || !media.url) continue
        if (peekVideoThumb(media.url)) continue
        const thumb = await ensureVideoThumb(media.url, capture)
        if (thumb) touched = true
      }
      if (touched) deps.videoThumbTick.value += 1
    })()
    void nextTick().then(() => {
      const el = deps.getAnchorEl()
      if (el) {
        const r = el.getBoundingClientRect()
        tagMenuAnchorShift.value = {
          x: Math.round(anchor.left - r.left),
          y: Math.round(anchor.top - r.top),
        }
      }
      return nextTick()
    }).then(() => {
      tagMenuOpen.value = true
      void nextTick().then(() => deps.focusSearch())
    })
  }

  function closeTagMenu(): void {
    tagMenuOpen.value = false
    tagMenuChip.value = null
    tagMenuQuery.value = ''
  }

  async function pickTagMenuNode(entry: TagMenuEntry): Promise<void> {
    const chip = tagMenuChip.value
    if (!chip) return
    const oldNodeId = nodeIdOfChip(chip.id)
    if (oldNodeId === entry.id) {
      closeTagMenu()
      return
    }
    await deps.replaceChipWith(entry.id, chip, entry.name)
    closeTagMenu()
  }

  function invalidateChips(): void {
    tagMenuOpen.value = false
    tagMenuChip.value = null
    tagMenuQuery.value = ''
  }

  return {
    tagMenuOpen,
    tagMenuQuery,
    tagMenuChip,
    tagMenuAnchorShift,
    tagMenuAnchorHeight,
    tagMenuPreviewEntry,
    tagMenuPreviewVisible,
    tagMenuPreviewBox,
    tagMenuPreviewPos,
    tagMenuPreviewTimer,
    tagMenuPreviewBoxEl,
    hoverTagMenuRow,
    leaveTagMenuRow,
    tagMenuRootStyle,
    tagMenuEntries,
    tagMenuGroups,
    tagMenuFlat,
    tagMenuSections,
    tagMenuActiveKind,
    tagMenuActiveItems,
    tagMenuFlatItems,
    tagMenuThumbOf,
    openTagMenu,
    closeTagMenu,
    pickTagMenuNode,
    invalidateChips,
  }
}
