import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { ResourceItem } from 'prosemirror-editor-bundle'
import type { CanvasRenderContext } from '@mini-canvas/canvas-render'
import type { ViewContract } from '@mini-canvas/canvas-base'
import { nextRefOrder, placeChipAt, previewListFor, type MaterialCard, type UpstreamMaterial } from '../panelSource'
import { openPreview } from '../mediaPreview'
import { peekVideoThumb } from '../videoThumbCache'
import {
  mergeRefTiles,
  nextChipOrder,
  nameFromFileName,
  targetOfTile,
  uniqueNodeName,
  uploadToRefSlot,
  formatVideoDuration,
  videoOverLimit,
  type RefTarget,
  type RefTile,
  type TileCardLike,
} from '../refTiles'
import {
  refChipsFromDoc,
  refNodeChipId,
  refNameChipId,
  REF_SLOT_META,
  judgeSlotDrop,
  dropVerdictMessage,
  nodeIdOfChip,
  type RefSlotKind,
} from '../refSlots'
import type { BottomBarEditorHandle } from './types'

interface CardDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  renderEdges: CanvasRenderContext['renderEdges']
  refOrder: ComputedRef<string[]>
  shownMaterials: ComputedRef<UpstreamMaterial[]>
  cards: ComputedRef<MaterialCard[]>
  cardImageOf(tile: { url?: string; kind?: string | null }): string
  videoThumbOf(url: string | undefined): string | undefined
  ensureFullVideoThumb(url: string): Promise<string | undefined>
  videoThumbTick: Ref<number>
  editorComponentRef: Ref<BottomBarEditorHandle | null>
  prompt: Ref<string>
  promptDoc: Ref<unknown>
  persistValues: () => void
  onPromptText: (v: string) => void
  onOpenTagMenu(item: ResourceItem, anchor: { left: number; top: number; right: number; bottom: number }): void
  replaceChipWith(newNodeId: string, chip: ResourceItem, name: string): Promise<void>
}

/** 参考卡行、上传/换绑、排序、卡片点击与标签刷新。 */
export function useBottomBarCards(deps: CardDeps) {
  const { ctx, props } = deps
  const promptChips = computed(() => refChipsFromDoc(deps.promptDoc.value))
  const refTiles = computed(() =>
    mergeRefTiles(
      promptChips.value,
      deps.shownMaterials.value.map((m) => ({
        id: m.id,
        name: m.name,
        kind: m.kind === 'image' || m.kind === 'video' || m.kind === 'audio' || m.kind === 'text' ? m.kind : 'image',
        url: m.url,
        value: m.value,
        ...(m.duration ? { duration: m.duration } : {}),
      })),
      deps.refOrder.value,
    ),
  )

  const loadingTiles = ref<Record<string, boolean>>({})
  const brokenTiles = ref<Record<string, boolean>>({})
  const imageReady = ref<Record<string, boolean>>({})

  function clearBrokenTile(key: string): void {
    if (loadingTiles.value[key]) {
      const next = { ...loadingTiles.value }
      delete next[key]
      loadingTiles.value = next
    }
    if (brokenTiles.value[key]) {
      const next = { ...brokenTiles.value }
      delete next[key]
      brokenTiles.value = next
    }
    imageReady.value = { ...imageReady.value, [key]: true }
  }

  function markBrokenTile(key: string): void {
    if (!loadingTiles.value[key]) return
    brokenTiles.value = { ...brokenTiles.value, [key]: true }
  }

  watch(
    () => refTiles.value.map((t) => [t.key, deps.cardImageOf(t)].join('|')).join(','),
    () => {
      const next: Record<string, boolean> = {}
      for (const t of refTiles.value) {
        if (t.kind !== 'video') continue
        if (!deps.cardImageOf(t)) continue
        if (brokenTiles.value[t.key]) continue
        if (t.url && deps.videoThumbOf(t.url)) continue
        next[t.key] = true
      }
      loadingTiles.value = next
      for (const key of Object.keys(next)) {
        setTimeout(() => {
          if (loadingTiles.value[key]) {
            brokenTiles.value = { ...brokenTiles.value, [key]: true }
          }
        }, 13000)
      }
    },
    { immediate: true },
  )

  watch(
    deps.shownMaterials,
    () => {
      for (const t of refTiles.value) {
        if (t.kind !== 'video' || !t.url) continue
        if (loadingTiles.value[t.key] && !peekVideoThumb(t.url)) {
          brokenTiles.value = { ...brokenTiles.value, [t.key]: true }
        }
      }
    },
    { immediate: true },
  )

  const slotErrors = ref<Record<string, string>>({})
  function slotErrorOf(tile: { key: string }): string {
    return slotErrors.value[tile.key] ?? ''
  }

  function cardTooltip(tile: RefTile): string {
    if (tile.invalid) return '「' + tile.label + '」引用已失效'
    if (tile.pending) return '「' + tile.label + '」待添加：拖节点或点它上传'
    const kindLabel =
      tile.kind === 'video' ? '视频'
      : tile.kind === 'audio' ? '音频'
      : tile.kind === 'text' ? '文本'
      : tile.kind === 'image' ? '图片' : '素材'
    const duration = tile.kind === 'video' ? formatVideoDuration(tile.duration) : ''
    return '「' + tile.label + '」' + kindLabel + (duration ? ' · ' + duration : '') + '（可拖动调整顺序）'
  }

  function onReorder(next?: MaterialCard[]): void {
    const ids = nextRefOrder(deps.refOrder.value, deps.cards.value, next)
    if (!ids) return
    try {
      ctx.get('doc').updateNode(props.id, { data: { refOrder: ids } })
    } catch {
      /* 节点已不在等情况：忽略 */
    }
  }

  function openCard(card: TileCardLike): void {
    const full = deps.cards.value.find((c) => c.id === card.id)
    const multi = previewListFor(deps.cards.value, full ?? (card as MaterialCard))
    const kind = full?.isText ? 'text' : ((full?.kind ?? 'image') as 'image' | 'video' | 'audio')
    const url = full?.url ?? card.url
    openPreview({
      name: full?.name ?? card.name,
      nodeId: card.id,
      kind,
      url,
      text: full?.value,
      ...(multi ?? {}),
    }, props.id)
  }

  function removeCard(nodeId: string): void {
    if (!nodeId) return
    const doc = ctx.tryGet<{
      removeEdges(ids: string[]): number
      getEdges?(): Array<{ id: string; source: string; target: string }>
    }>('doc')
    if (!doc) return
    const ids = new Set<string>()
    for (const e of deps.renderEdges.value) if (e.source === nodeId && e.target === props.id) ids.add(e.id)
    if (ids.size === 0) {
      for (const e of doc.getEdges?.() ?? []) if (e.source === nodeId && e.target === props.id) ids.add(e.id)
    }
    if (ids.size > 0) doc.removeEdges([...ids])
  }

  const dragging = ref(false)
  let lastDragEndAt = 0
  let lastDragEndX = -1
  let lastDragEndY = -1
  function onDragEndMark(payload: Event): void {
    lastDragEndAt = Date.now()
    dragging.value = false
    const oe = (payload as { originalEvent?: MouseEvent | TouchEvent } | undefined)?.originalEvent
    const point = oe && 'clientX' in oe ? oe : (oe as TouchEvent | undefined)?.changedTouches?.[0]
    lastDragEndX = point?.clientX ?? -1
    lastDragEndY = point?.clientY ?? -1
  }
  function markDragEnd(x: number, y: number): void {
    lastDragEndAt = Date.now()
    lastDragEndX = x
    lastDragEndY = y
  }
  function clickAfterDrag(ev: MouseEvent): boolean {
    if (Date.now() - lastDragEndAt > 350) return false
    const dx = Math.abs(ev.clientX - lastDragEndX)
    const dy = Math.abs(ev.clientY - lastDragEndY)
    return dx < 6 && dy < 6
  }

  let removeViaPointerAt = 0
  function onRemovePointerDown(tile: RefTile): void {
    if (!tile.nodeId) return
    removeViaPointerAt = Date.now()
    removeCard(tile.nodeId)
  }
  function onCardsClickCapture(ev: MouseEvent): void {
    ;(window as any).__capDbg = { target: (ev.target as HTMLElement)?.className?.toString().slice(0, 40), t: Date.now() }
    if (Date.now() - removeViaPointerAt < 600) {
      ev.stopPropagation()
      ev.preventDefault()
      return
    }
    if (clickAfterDrag(ev)) {
      ev.stopPropagation()
      ev.preventDefault()
      return
    }
    const target = ev.target as HTMLElement | null
    if (!target) return
    const card = target.closest<HTMLElement>('.nb-card')
    if (!card) return
    const key = card.getAttribute('data-tile-key') ?? ''
    const tile = refTiles.value.find((t) => t.key === key)
    if (target.closest('.nb-card-act')) return
    if (target.closest('.nb-remove')) {
      ev.stopPropagation()
      if (tile?.nodeId && Date.now() - removeViaPointerAt > 600) removeCard(tile.nodeId)
      return
    }
    if (tile?.pending) {
      ev.stopPropagation()
      pickSlotFile(tile)
      return
    }
    if (tile && !tile.invalid) ev.stopPropagation()
  }

  function onCardDblClick(tile: RefTile): void {
    const nodeId = tile.nodeId ?? (tile.key.startsWith('ref-node:') ? tile.key.slice('ref-node:'.length) : '')
    if (!nodeId) return
    const commands = ctx.tryGet<{ runCommand(id: string, ...payload: unknown[]): unknown }>('canvas')
    try {
      if (commands?.runCommand('auto-layout:focus-node', nodeId) === true) return
    } catch { /* 命令异常：回落到下面的通用实现 */ }
    const view = ctx.tryGet<ViewContract>('view')
    if (!view) return
    const settings = ctx.tryGet<{ get(key: string): unknown }>('settings')
    const readNum = (key: string, fallback: number): number => {
      const v = settings?.get(key)
      return typeof v === 'number' && Number.isFinite(v) ? v : fallback
    }
    view.fitTo([nodeId], {
      heightRatio: readNum('focusHeightRatio', 0.5),
      minZoom: readNum('autoLayoutMinZoom', 0.1),
      maxZoom: readNum('autoLayoutMaxZoom', 4),
      durationMs: 200,
    })
  }

  function onCardsKeydown(ev: KeyboardEvent): void {
    if (!(ev.ctrlKey || ev.metaKey)) return
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
    const card = (ev.target as HTMLElement).closest('.nb-card') as HTMLElement | null
    if (!card) return
    const key = card.getAttribute('data-tile-key') ?? ''
    const cur = refTiles.value.findIndex((t) => t.key === key)
    if (cur < 0) return
    const to = ev.key === 'ArrowLeft' ? cur - 1 : cur + 1
    if (to < 0 || to >= refTiles.value.length) return
    const next = [...refTiles.value]
    const [moved] = next.splice(cur, 1)
    next.splice(to, 0, moved)
    ev.preventDefault()
    ev.stopPropagation()
    onReorderTiles(next.map((t) => ({ key: t.key })))
  }

  function onReorderTiles(next?: Array<{ key?: string }>): void {
    const ids = nextChipOrder(deps.refOrder.value, refTiles.value, next)
    if (!ids) return
    try {
      ctx.get('doc').updateNode(props.id, { data: { refOrder: ids } })
    } catch {
      /* 节点已不在等情况：忽略 */
    }
  }

  function insertTileChip(tile: RefTile): void {
    const item: ResourceItem = {
      id: tile.key,
      name: tile.label,
      category: '素材',
      ...(tile.kind ? { chipKind: tile.kind } : {}),
      ...(tile.url ? { url: tile.url } : {}),
      ...(tile.value ? { value: tile.value } : {}),
    }
    if (!deps.editorComponentRef.value?.insertResource) {
      ctx.tryGet<{ notify(m: string, opts?: { source?: string; followPointer?: boolean; durationMs?: number }): unknown }>('canvas')
        ?.notify('当前动作没有输入框，先选一个生成类动作再 @', { source: 'bottom-bar', followPointer: true, durationMs: 0 })
      return
    }
    deps.editorComponentRef.value.insertResource(item)
  }

  let atPointerAt = 0
  function onAtPointerDown(tile: RefTile): void {
    atPointerAt = Date.now()
    insertTileChip(tile)
  }
  function onAtClick(tile: RefTile): void {
    if (Date.now() - atPointerAt < 600) return
    insertTileChip(tile)
  }

  function pickSlotFile(tile: RefTile): void {
    const target = targetOfTile(tile)
    const kind: RefSlotKind = tile.kind ?? 'any'
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = REF_SLOT_META[kind].accept
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file) void fillSlotFromFile(kind, file, target)
      input.remove()
    })
    input.addEventListener('cancel', () => input.remove())
    input.click()
  }

  async function fillSlotFromFile(kind: RefSlotKind, file: File, target?: RefTarget): Promise<void> {
    const errKey = target?.previousChipId ?? ''
    const verdict = judgeSlotDrop(kind, { file })
    if (!verdict.ok) {
      setSlotError(errKey, dropVerdictMessage(kind, verdict))
      return
    }
    const fileDrop = ctx.tryGet<{
      addFiles(files: File[], atFlow: { x: number; y: number } | null): Promise<number>
    }>('file-drop')
    if (!fileDrop) {
      setSlotError(errKey, '当前宿主没有文件落库能力，无法建参考节点')
      return
    }
    const doc = ctx.tryGet<{
      getNode(id: string): { type?: string; data?: Record<string, unknown>; position?: { x: number; y: number }; width?: number } | undefined
      getNodes(): Array<{ id: string; type?: string; data?: Record<string, unknown> }>
      addEdge(input: { source: string; target: string }): string
      updateNode(id: string, patch: { data: Record<string, unknown> }): void
    }>('doc')
    if (!doc) { setSlotError(errKey, '当前宿主没有连线能力'); return }
    const me = doc.getNode(props.id)
    const base = me?.position ?? { x: 0, y: 0 }
    const w = Number(me?.width) || 320
    try {
      const idsBeforeUpload = new Set(doc.getNodes().map((n) => n.id))
      const result = await uploadToRefSlot(
        { file, targetId: props.id },
        {
          addFiles: (files, at) => fileDrop.addFiles(files, at),
          waitTick: () => nextTick(),
          afterCreate: () => {
            try { ctx.tryGet<{ set(ids: string[]): void }>('selection')?.set([props.id]) } catch { /* 忽略 */ }
          },
          addEdge: (source, target) => {
            try { return doc.addEdge({ source, target }) } catch { return null }
          },
          pickCreated: () => {
            const freshNode = doc.getNodes().find((n) => !idsBeforeUpload.has(n.id) && n.id !== props.id)
            if (!freshNode) return null
            const d = freshNode.data ?? {}
            const s = (v: unknown) => (typeof v === 'string' && v ? v : '')
            const url = s(d.imageUrl) || s(d.videoUrl) || s(d.audioUrl)
            const taken = doc.getNodes()
              .filter((n) => n.id !== freshNode.id)
              .map((n) => (typeof n.data?.label === 'string' ? n.data.label : ''))
            const name = uniqueNodeName(nameFromFileName(file.name), taken)
            try { doc.updateNode(freshNode.id, { data: { label: name } }) } catch { /* 忽略 */ }
            return { id: freshNode.id, name, url }
          },
          positionFor: () => ({ x: base.x - w - 24, y: base.y }),
        },
      )
      if (!result.ok) { setSlotError(errKey, result.error ?? '上传失败'); return }
      if (result.created) bindChipToNode(target, result.created.id, result.created.name)
      refreshSlotChips()
    } catch (err) {
      console.warn('[bottom-bar] 上传参考失败', err)
      setSlotError(errKey, '上传失败，请重试')
    }
  }

  function bindChipToNode(target: RefTarget | undefined, nodeId: string, name: string): void {
    const material = deps.shownMaterials.value.find((m) => m.id === nodeId)
    const item: ResourceItem = {
      id: refNodeChipId(nodeId),
      name,
      category: '素材',
      ...(material ? { chipKind: material.kind as 'image' | 'video' | 'audio' | 'text' } : {}),
      ...(material?.url ? { url: material.url } : {}),
      ...(material?.value ? { value: material.value } : {}),
      ...(target?.previousChipId ? { previousId: target.previousChipId } : {}),
    }
    const replaced = target?.previousChipId
      ? deps.editorComponentRef.value?.replaceResource?.(item) === true
      : false
    if (!replaced) deps.editorComponentRef.value?.insertResource?.(item)
    const order = placeChipAt(deps.refOrder.value, target?.previousChipId, nodeId)
    try {
      ctx.get('doc').updateNode(props.id, { data: { refOrder: order } })
    } catch { /* 节点已不在等情况：忽略 */ }
  }

  function setSlotError(key: string, message: string): void {
    if (!key) return
    slotErrors.value = { ...slotErrors.value, [key]: message }
    setTimeout(() => {
      const next = { ...slotErrors.value }
      delete next[key]
      slotErrors.value = next
    }, 2600)
  }

  function markRefSlotsInPrompt(): void {
    const ed = deps.editorComponentRef.value
    if (!ed?.markRefSlots) return
    const count = ed.markRefSlots()
    if (count <= 0) return
    void nextTick().then(() => {
      const nextText = ed.exportText?.()
      if (typeof nextText === 'string' && nextText !== deps.prompt.value) deps.onPromptText(nextText)
      deps.persistValues()
      refreshSlotChips()
    })
  }

  async function onPasteFiles(
    files: File[],
    editorCtx: { insert(item: ResourceItem): void },
  ): Promise<boolean> {
    const image = files.find((f) => f.type.startsWith('image/'))
    if (!image) return false
    const pendingName = image.name || '粘贴的图片'
    const pendingId = refNameChipId(pendingName)
    editorCtx.insert({ id: pendingId, name: pendingName, category: '素材' })
    void fillSlotFromFile('image', image, { previousChipId: pendingId, pendingName })
      .then(() => refreshSlotChips())
      .catch(() => { /* 上传失败不回滚标签（用户可手动删）；错误已在 slotErrors 提示 */ })
    return true
  }

  async function bindTileToNode(tile: RefTile, nodeId: string, name: string): Promise<void> {
    const target = targetOfTile(tile)
    const doc = ctx.tryGet<{
      getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined
      addEdge(input: { source: string; target: string }): string
      removeEdges(ids: string[]): number
      getEdges?(): Array<{ id: string; source: string; target: string }>
      updateNode(id: string, patch: { data: Record<string, unknown> }): void
    }>('doc')
    if (!doc) return
    try {
      const stale: string[] = []
      for (const e of deps.renderEdges.value) {
        if (e.target !== props.id) continue
        if (e.source === nodeId) stale.push(e.id)
        else if (target.oldNodeId && e.source === target.oldNodeId) stale.push(e.id)
      }
      if (stale.length) doc.removeEdges([...new Set(stale)])
      if (target.oldNodeId !== nodeId) {
        try { doc.addEdge({ source: nodeId, target: props.id }) } catch { /* 已存在等：忽略 */ }
      }
      bindChipToNode(target, nodeId, name)
      slotErrors.value = {}
      await nextTick()
      await new Promise((r) => setTimeout(r, 300))
      refreshSlotChips()
    } catch (err) {
      console.warn('[bottom-bar] 绑定参考失败', err)
    }
  }

  /** 某个节点在本节点正文里被引用了几次（决定换绑是「断旧线」还是「再加一条」） */
  function refCountOf(nodeId: string): number {
    return promptChips.value.filter((c) => c.nodeId === nodeId).length
  }

  async function replaceChipWith(newNodeId: string, chip: ResourceItem, name: string): Promise<void> {
    const doc = ctx.tryGet<{
      addEdge(input: { source: string; target: string }): string
      removeEdges(ids: string[]): number
      getEdges?(): Array<{ id: string; source: string; target: string }>
    }>('doc')
    if (!doc) return
    const oldNodeId = nodeIdOfChip(chip.id)
    const unique = oldNodeId ? refCountOf(oldNodeId) <= 1 : false
    if (unique && oldNodeId && oldNodeId !== newNodeId) {
      const stale = deps.renderEdges.value.filter((e) => e.source === oldNodeId && e.target === props.id).map((e) => e.id)
      if (stale.length) doc.removeEdges(stale)
    }
    try { doc.addEdge({ source: newNodeId, target: props.id }) } catch { /* 已存在等：忽略 */ }
    await nextTick()
    await nextTick()
    bindChipToNode(
      { previousChipId: chip.id, oldNodeId: oldNodeId ?? undefined },
      newNodeId,
      name,
    )
    refreshSlotChips()
  }

  function refreshSlotChips(): void {
    try {
      if (typeof window === 'undefined') return
      ;(window as any).__chipRuns = ((window as any).__chipRuns || 0) + 1
      if (typeof document === 'undefined') return
      if (!deps.editorComponentRef.value) return
      for (const tile of refTiles.value) {
        try {
          if (tile.invalid) {
            registerItem({
              id: tile.key,
              name: tile.label,
              category: '素材',
              invalid: true,
              chipKind: undefined,
              url: '',
            })
            deps.editorComponentRef.value?.replaceResource?.({
              id: tile.key,
              name: tile.label,
              category: '素材',
              invalid: true,
              chipKind: undefined,
              url: '',
            })
            continue
          }
          if (tile.pending || !tile.nodeId) {
            registerItem({
              id: tile.key,
              name: tile.label,
              category: '素材',
              onIconClick: deps.onOpenTagMenu,
            })
            continue
          }
          const kind = tile.kind ?? undefined
          const url = kind === 'video' ? (deps.videoThumbOf(tile.url) ?? '') : (tile.url ?? '')
          const item: ResourceItem = {
            id: refNodeChipId(tile.nodeId),
            name: tile.label,
            category: '素材',
            ...(kind ? { chipKind: kind } : {}),
            ...(url ? { url } : {}),
            ...(tile.value ? { value: tile.value } : {}),
            onIconClick: deps.onOpenTagMenu,
            ...(kind === 'video' && tile.url
              ? { hoverPreview: () => deps.ensureFullVideoThumb(tile.url as string) }
              : {}),
          }
          registerItem(item)
          deps.editorComponentRef.value?.replaceResource?.({
            ...item,
            name: tile.label,
          })
        } catch (err) {
          ;(window as any).__chipErr = { tile: tile.key, msg: String(err), stack: (err as Error)?.stack?.slice(0, 500) }
        }
      }
      deps.editorComponentRef.value?.refreshChips?.()
    } catch (err) {
      ;(window as any).__chipErr = { tile: '(outer)', msg: String(err), stack: (err as Error)?.stack?.slice(0, 500) }
    }
  }

  watch([deps.shownMaterials, deps.refOrder], () => {
    void nextTick()
      .then(() => typeof requestAnimationFrame === 'function'
        ? new Promise<void>((r) => requestAnimationFrame(() => r()))
        : undefined)
      .then(() => refreshSlotChips())
  }, { immediate: true })

  const slotsDropHot = ref(false)
  function onSlotDragOver(_ev: DragEvent): void {
    slotsDropHot.value = true
  }
  function onSlotDragLeave(_ev: DragEvent): void {
    setTimeout(() => { slotsDropHot.value = false }, 60)
  }
  function onSlotDrop(ev: DragEvent): void {
    slotsDropHot.value = false
    const file = ev.dataTransfer?.files?.[0]
    if (!file) return
    const host = (ev.currentTarget as HTMLElement | null)?.closest('.nb-card') as HTMLElement | null
    const tile = refTiles.value.find((t) => t.key === (host?.dataset.tileKey || ''))
    if (!tile) return
    void fillSlotFromFile(tile.kind ?? 'any', file, targetOfTile(tile))
  }

  return {
    promptChips,
    refTiles,
    loadingTiles,
    brokenTiles,
    imageReady,
    clearBrokenTile,
    markBrokenTile,
    slotErrors,
    slotErrorOf,
    cardTooltip,
    onReorder,
    openCard,
    removeCard,
    dragging,
    onDragEndMark,
    markDragEnd,
    onRemovePointerDown,
    onCardsClickCapture,
    onCardDblClick,
    onCardsKeydown,
    onReorderTiles,
    insertTileChip,
    onAtPointerDown,
    onAtClick,
    pickSlotFile,
    fillSlotFromFile,
    bindChipToNode,
    setSlotError,
    markRefSlotsInPrompt,
    onPasteFiles,
    bindTileToNode,
    replaceChipWith,
    refreshSlotChips,
    formatVideoDuration,
    videoOverLimit,
    slotsDropHot,
    onSlotDragOver,
    onSlotDragLeave,
    onSlotDrop,
  }
}

import { registerItem } from 'prosemirror-editor-bundle'
