import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import type { RefTile } from '../refTiles'
import { nodeMediaOf, judgeSlotHover } from '../refSlotDrag'
import {
  canEnterCtrlDragMode,
  ctrlBlockedByEditable,
  pointerOnBottomBarCard,
  registerStartDragHandler,
} from '../ctrlDragMode'
import {
  clearCtrlSuppression,
  ctrlSuppressed,
  enterCtrlDragMode as unifiedEnterCtrlDragMode,
  exitCtrlDragMode as unifiedExitCtrlDragMode,
} from '../selectionMode'
import type { RefSlotKind } from '../refSlots'

interface CtrlDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  renderEdges: CanvasRenderContext['renderEdges']
  refTiles: Ref<RefTile[]>
  barShown: Ref<boolean>
  /** 底栏根元素：Ctrl 门槛要读「鼠标是否停在这上面的某张卡片」 */
  barEl: Ref<HTMLElement | null>
  bindTileToNode(tile: RefTile, nodeId: string, name: string): Promise<void>
  /** 与卡片点击共用同一份「刚拖完」时间戳（拖拽余波不再触发按钮点击） */
  markDragEnd(x: number, y: number): void
  cancelPreviewTimers(): void
  stopPreviewAudio(): void
}

/** Ctrl 拖资源到参考格：会话、影子 DOM、全局事件绑定。 */
export function useCtrlResourceDrag(deps: CtrlDeps) {
  let ctrlDrag: {
    nodeId: string
    mediaType: 'image' | 'video' | 'audio' | 'text'
    url: string
    name: string
    targetTileKey?: string
    ghost?: HTMLElement
  } | null = null

  function moveGhost(x: number, y: number): void {
    const g = ctrlDrag?.ghost
    if (g) { g.style.left = x + 'px'; g.style.top = y + 'px' }
  }

  function onCtrlModeKeydown(ev: KeyboardEvent): void {
    const el = ev.target instanceof HTMLElement ? ev.target : null
    const editableTarget = ctrlBlockedByEditable({
      inEditable: !!el?.closest('input, textarea, select, [contenteditable="true"]'),
      inBottomBar: !!el?.closest('.nb-root, .nb-overlay'),
    })
    if (!canEnterCtrlDragMode({
      key: ev.key,
      repeat: ev.repeat,
      barShown: deps.barShown.value,
      editableTarget,
      hoveringCard: pointerOnBottomBarCard(deps.barEl.value),
    })) return
    if (ctrlSuppressed()) return
    clearCtrlSuppression()
    unifiedEnterCtrlDragMode(deps.props.id)
  }
  function onCtrlModeKeyup(ev: KeyboardEvent): void {
    if (ev.key !== 'Control') return
    clearCtrlSuppression()
    unifiedExitCtrlDragMode()
    if (ctrlDrag) {
      ctrlDrag.ghost?.remove()
      if (ctrlDrag.targetTileKey) {
        document.querySelector('.nb-card[data-tile-key="' + ctrlDrag.targetTileKey + '"]')?.classList.remove('is-target')
      }
      ctrlDrag = null
    }
  }

  function startCtrlDrag(nodeId: string, ev: PointerEvent): void {
    const doc = deps.ctx.tryGet<{ getNode(id: string): { type?: string; data?: Record<string, unknown> } | undefined }>('doc')
    const media = nodeMediaOf(doc?.getNode(nodeId))
    if (!media) return
    if (media.mediaType === 'text') return
    if (deps.renderEdges.value.some((e) => e.source === nodeId && e.target === deps.props.id)) return
    ev.preventDefault()
    ev.stopPropagation()
    const ghost = document.createElement('div')
    ghost.className = 'nb-drag-ghost'
    if (media.url && media.mediaType === 'image') {
      const img = document.createElement('img')
      img.src = media.url
      img.alt = ''
      ghost.appendChild(img)
    } else if (media.url && media.mediaType === 'video') {
      const video = document.createElement('video')
      video.src = media.url
      video.muted = true
      video.preload = 'metadata'
      video.className = 'nb-drag-ghost-media'
      ghost.appendChild(video)
    } else if (media.mediaType === 'audio') {
      const icon = document.createElement('div')
      icon.className = 'nb-drag-ghost-icon'
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
      ghost.appendChild(icon)
    } else if (media.url) {
      const img = document.createElement('img')
      img.src = media.url
      img.alt = ''
      ghost.appendChild(img)
    }
    document.body.appendChild(ghost)
    ctrlDrag = { nodeId, mediaType: media.mediaType, url: media.url, name: media.name, ghost }
    moveGhost(ev.clientX, ev.clientY)
  }

  function onCtrlDragPointerMove(ev: PointerEvent): void {
    if (!ctrlDrag) return
    moveGhost(ev.clientX, ev.clientY)
    const host = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.nb-card') as HTMLElement | null
    const key = host?.dataset.tileKey
    if (key && key !== ctrlDrag.targetTileKey) {
      const tile = deps.refTiles.value.find((t) => t.key === key)
      const slotKind = (tile?.kind ?? 'any') as RefSlotKind
      const verdict = judgeSlotHover({ kind: slotKind ?? 'image', media: ctrlDrag.mediaType })
      if (!verdict.ok) deps.ctx.get<{ notify(m: string, o?: object): unknown }>('canvas').notify(verdict.hint, { source: 'bottom-bar', followPointer: true, durationMs: 0, once: true })
      else deps.ctx.tryGet<{ notify(m: string, o?: object): unknown }>('canvas')?.notify('', { source: 'bottom-bar' })
    }
    if (ctrlDrag.targetTileKey && ctrlDrag.targetTileKey !== key) {
      document.querySelector('.nb-card[data-tile-key="' + ctrlDrag.targetTileKey + '"]')?.classList.remove('is-target')
      ctrlDrag.targetTileKey = undefined
    }
    if (key && key !== ctrlDrag.targetTileKey) {
      host?.classList.add('is-target')
      ctrlDrag.targetTileKey = key
    }
  }

  function onCtrlDragOver(ev: DragEvent): void {
    if (!ctrlDrag) return
    ev.preventDefault()
    moveGhost(ev.clientX, ev.clientY)
    onCtrlDragPointerMove(ev as unknown as PointerEvent)
  }

  function onCtrlDragDrop(ev: DragEvent): void {
    ;(window as any).__dropDbg = { hasSession: !!ctrlDrag, target: (ev.target as HTMLElement)?.closest?.('.nb-card')?.getAttribute('data-tile-key') ?? null }
    if (!ctrlDrag) return
    ev.preventDefault()
    onCtrlDragPointerUp(ev)
  }

  function onCtrlDragEnd(): void {
    if (!ctrlDrag) return
    onCtrlDragPointerUp(new DragEvent('pointerup'))
  }

  function onCtrlDragPointerUp(ev: PointerEvent | DragEvent): void {
    const drag = ctrlDrag
    ctrlDrag = null
    const dropGhost = () => {
      if (drag?.targetTileKey) {
        document.querySelector('.nb-card[data-tile-key="' + drag.targetTileKey + '"]')?.classList.remove('is-target')
      }
      drag?.ghost?.remove()
    }
    dropGhost()
    if (drag) deps.markDragEnd(ev.clientX, ev.clientY)
    if (!drag || !drag.targetTileKey) return
    const dropHost = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.nb-card') as HTMLElement | null
    if (dropHost?.dataset.tileKey) drag.targetTileKey = dropHost.dataset.tileKey
    const tile = deps.refTiles.value.find((t) => t.key === drag.targetTileKey)
    if (tile) {
      const slotKind = (tile.kind ?? 'any') as RefSlotKind
      const verdict = judgeSlotHover({ kind: slotKind, media: drag.mediaType })
      if (!verdict.ok) {
        deps.ctx.get<{ notify(m: string, o?: object): unknown }>('canvas').notify(verdict.hint, { source: 'bottom-bar', followPointer: true, durationMs: 0, once: true })
        return
      }
    }
    if (!tile) return
    void deps.bindTileToNode(tile, drag.nodeId, drag.name)
  }

  onMounted(() => {
    registerStartDragHandler(startCtrlDrag)
    window.addEventListener('pointermove', onCtrlDragPointerMove, true)
    window.addEventListener('pointerup', onCtrlDragPointerUp, true)
    window.addEventListener('dragover', onCtrlDragOver, true)
    window.addEventListener('drop', onCtrlDragDrop, true)
    window.addEventListener('dragend', onCtrlDragEnd, true)
    window.addEventListener('keydown', onCtrlModeKeydown, true)
    window.addEventListener('keyup', onCtrlModeKeyup, true)
  })
  onBeforeUnmount(() => {
    registerStartDragHandler(null)
    unifiedExitCtrlDragMode()
    deps.cancelPreviewTimers()
    deps.stopPreviewAudio()
    window.removeEventListener('pointermove', onCtrlDragPointerMove, true)
    window.removeEventListener('pointerup', onCtrlDragPointerUp, true)
    window.removeEventListener('dragover', onCtrlDragOver, true)
    window.removeEventListener('drop', onCtrlDragDrop, true)
    window.removeEventListener('dragend', onCtrlDragEnd, true)
    window.removeEventListener('keydown', onCtrlModeKeydown, true)
    window.removeEventListener('keyup', onCtrlModeKeyup, true)
  })

  return {
    ctrlDrag: () => ctrlDrag,
    onCtrlModeKeydown,
    onCtrlModeKeyup,
    startCtrlDrag,
    onCtrlDragPointerMove,
    onCtrlDragOver,
    onCtrlDragDrop,
    onCtrlDragEnd,
    onCtrlDragPointerUp,
  }
}
