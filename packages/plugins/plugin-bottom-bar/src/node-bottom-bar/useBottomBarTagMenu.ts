import { computed, nextTick, ref, watch } from 'vue'
import type { ResourceItem } from '@plume-canvas/editor'
import { setChipEditing } from '@plume-canvas/editor'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import type { UpstreamMaterial } from '../panelSource'
import { nodeIdOfChip } from '../refSlots'
import { nodeMediaOf } from '../refSlotDrag'
import { peekVideoThumb, ensureVideoThumb } from '../videoThumbCache'
import { buildTagMenuGroups, buildTagMenuSections, type TagMenuEntry, type TagMenuKind } from '../tagMenu'
import { fitPreviewBox, HOVER_PREVIEW_MAX_SIDE } from '../previewBoxSize'
import { placeMenuRowPreview } from '../hoverPreviewPlacement'

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
  /**
   * 菜单开/关时通知编辑器「这颗标签别弹 hover 预览」（用户 2026-11-25）。
   *
   * 不传 chipId = 解除。缺省实现是空函数：单测里没有真实编辑器也能跑。
   */
  suppressEditorPreview?(chipId?: string): void
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
  /**
   * 节点 id → 资源服务解析出的可显示地址。
   *
   * 为什么要有（用户 2026-11-25 截图 3）：新图片/视频节点只存 `resourceId`，
   * data 里没有 url。菜单直接读 `nodeMediaOf` 就拿到空地址 ——
   * 行首缩略图退回默认图标、hover 也弹不出预览。这里按 id 现取一次地址补齐。
   */
  const resolvedResourceUrls = ref<Record<string, string>>({})

  /**
   * 菜单开着 = 这颗标签进入编辑态（用户 2026-11-06）：左侧固定显示铅笔，
   * 不再露出缩略图。
   *
   * 记 id 而不是关闭时再读 tagMenuChip：点外 / Esc / 选中时 chip 可能已经先被清空，
   * 那时还得把旧的那颗恢复成缩略图。
   */
  let editingChipId = ''
  watch(tagMenuOpen, (open) => {
    if (editingChipId) setChipEditing(editingChipId, open)
    /**
     * 关闭时**统一解除**预览压制（用户 2026-11-25）。
     *
     * 为什么不能只在 closeTagMenu 里解除：菜单是受控的 Dropdown，Esc / 点外 / 选中
     * 都会直接把 open 置 false（走 @update:open），不经过我们的函数。
     * 只在那里解除的话，按一次 Esc 就会把这颗标签的 hover 预览永久禁掉 ——
     * 现场表现是「菜单关了，可是再怎么 hover 都不弹预览了」。
     */
    if (!open) {
      editingChipId = ''
      deps.suppressEditorPreview?.()
    }
  })

  /**
   * 菜单关掉时把「正在编辑」的标签恢复成缩略图（用户 2026-11-06）。
   *
   * 为什么不能只靠 watch(tagMenuOpen)：菜单是点外/Esc 关的，而 Esc 在搜索框里
   * 会被原生输入框先吃掉；这时外层 open 变了、chip 也清了，标签却还挂着铅笔。
   * 统一在这里兜一次，任何关闭路径都能恢复。
   */
  function restoreEditingChip(): void {
    if (!editingChipId) return
    setChipEditing(editingChipId, false)
    editingChipId = ''
  }

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
    /**
     * 预览摆在行的**上方**（放不下才翻到下方），与卡片 hover 预览同一套规则。
     *
     * 用户 2026-11-25 截图 2：菜单开着时预览跑出屏幕。旧实现把预览放在行的左右两侧、
     * 只夹了纵向 —— 菜单贴着视口左/右边缘时，横向坐标直接变成负数或超出屏宽。
     * 现在统一走 placeHoverPreview：水平居中于该行、左右夹进视口，纵向优先上方。
     */
    tagMenuPreviewPos.value = placeMenuRowPreview(
      { left: rowRect.left, right: rowRect.right, top: rowRect.top, bottom: rowRect.bottom, width: rowRect.width },
      { width: window.innerWidth, height: window.innerHeight },
      tagMenuPreviewBox.value,
    )
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

  /** 画布节点的 resourceId（只为需要现取地址的媒体节点） */
  function resourceRefOf(node: { type?: string; data?: Record<string, unknown> }): string {
    const id = node.data?.resourceId
    return typeof id === 'string' && id.trim() ? id.trim() : ''
  }

  const tagMenuEntries = computed<TagMenuEntry[]>(() => {
    const doc = deps.ctx.tryGet<{
      getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }>
    }>('doc')
    if (!doc || typeof doc.getNodes !== 'function') return []
    const linked = new Map(deps.shownMaterials.value.map((m) => [m.id, m]))
    const out: TagMenuEntry[] = []
    for (const n of doc.getNodes()) {
      if (n.id === deps.props.id) continue
      const media0 = nodeMediaOf(n) ?? typeOnlyMediaOf(n)
      if (!media0) continue
      const media =
        media0.url || media0.mediaType === 'text'
          ? media0
          : { ...media0, url: resolvedResourceUrls.value[n.id] ?? '' }
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

  /**
   * 补齐「只有 resourceId」的节点地址（用户 2026-11-25 截图 3 的根因）。
   *
   * 菜单行首的缩略图与 hover 预览都只认 `entry.url`。新节点不再写 `imageUrl`，
   * 只保留 `resourceId`，于是菜单里永远是空地址 —— 缩略图退化成默认图标、
   * hover 预览也因为没有图可画而不弹。这里在菜单打开时按 id 现取一次，
   * 结果按节点 id 缓存（同一个资源不会反复请求）。
   */
  let resolving = false
  async function resolveTagMenuResourceUrls(): Promise<void> {
    if (resolving) return
    const doc = deps.ctx.tryGet<{
      getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }>
    }>('doc')
    const service = deps.ctx.tryGet<{ resolve(ref: string): Promise<string | undefined> }>('resources')
    if (!doc || typeof doc.getNodes !== 'function' || !service?.resolve) return
    const todo: Array<{ id: string; ref: string }> = []
    for (const n of doc.getNodes()) {
      if (n.id === deps.props.id) continue
      const media = nodeMediaOf(n)
      // 有地址的（旧存档 / 外部链接）不用取；文本没有可显示的像素
      if (!media || media.url || media.mediaType === 'text') continue
      const ref = resourceRefOf(n)
      if (!ref || resolvedResourceUrls.value[n.id]) continue
      todo.push({ id: n.id, ref })
    }
    if (todo.length === 0) return
    resolving = true
    try {
      const pairs = await Promise.all(
        todo.map(async ({ id, ref }) => {
          try {
            return [id, (await service.resolve(ref)) ?? ''] as const
          } catch {
            return [id, ''] as const
          }
        }),
      )
      const next = { ...resolvedResourceUrls.value }
      let changed = false
      for (const [id, url] of pairs) {
        if (!url || next[id] === url) continue
        next[id] = url
        changed = true
      }
      if (changed) resolvedResourceUrls.value = next
    } finally {
      resolving = false
    }
  }

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
    // 菜单马上要盖在标签旁边：立刻收掉这颗标签的 hover 预览，并禁止它再弹
    deps.suppressEditorPreview?.(String(item.id ?? ''))
    tagMenuQuery.value = ''
    tagMenuActiveKind.value = null
    tagMenuOpen.value = false
    tagMenuAnchorShift.value = { x: 0, y: 0 }
    tagMenuAnchorHeight.value = Math.max(1, Math.round(anchor.bottom - anchor.top))
    // 只有 resourceId 的节点：先把可显示地址取回来（缩略图与 hover 预览都靠它）
    void resolveTagMenuResourceUrls()
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
      editingChipId = String(item.id ?? '')
      tagMenuOpen.value = true
      setChipEditing(editingChipId, true)
      void nextTick().then(() => deps.focusSearch())
    })
  }

  function closeTagMenu(): void {
    tagMenuOpen.value = false
    // 解除「不要弹预览」：菜单关了，鼠标还停着的话就恢复原本的 hover 行为
    deps.suppressEditorPreview?.()
    restoreEditingChip()
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
    deps.suppressEditorPreview?.()
    restoreEditingChip()
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
    /** 菜单打开时补资源地址的异步入口（导出给单测与诊断用） */
    resolveTagMenuResourceUrls,
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
    restoreEditingChip,
  }
}
