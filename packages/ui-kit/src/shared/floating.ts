import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { UiKitPlacement } from './types'

export type FloatingAnchor =
  | 'top-start' | 'top' | 'top-end'
  | 'right-start' | 'right' | 'right-end'
  | 'bottom-start' | 'bottom' | 'bottom-end'
  | 'left-start' | 'left' | 'left-end'

export interface FloatingOptions {
  placement?: UiKitPlacement | FloatingAnchor
  offset?: number
  padding?: number
  matchWidth?: boolean
  maxWidth?: string
  minWidth?: string
  maxHeight?: string
}

export interface FloatingPosition {
  left: number
  top: number
  width?: number
  maxWidth?: number
  minWidth?: number
  maxHeight?: number
  placement: FloatingAnchor
}

const DEFAULT_POSITION: FloatingPosition = { left: 0, top: 0, placement: 'bottom-start' }

function numeric(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim())
  return match ? Number(match[1]) : undefined
}

function sideOf(placement: FloatingAnchor): 'top' | 'bottom' | 'left' | 'right' {
  return placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right'
}

function alignOf(placement: FloatingAnchor): 'start' | 'center' | 'end' {
  const part = placement.split('-')[1]
  return part === 'start' || part === 'end' ? part : 'center'
}

function opposite(side: 'top' | 'bottom' | 'left' | 'right'): 'top' | 'bottom' | 'left' | 'right' {
  return side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left'
}

function withSide(
  side: 'top' | 'bottom' | 'left' | 'right',
  align: 'start' | 'center' | 'end',
): FloatingAnchor {
  return (align === 'center' ? side : `${side}-${align}`) as Exclude<UiKitPlacement, 'auto'>
}

/**
 * 固定定位浮层：自动翻转、夹在视口内、可跟触发器同宽。
 *
 * 打开期间用 rAF 重算位置，因此触发器被拖拽 / 页面滚动 / 容器缩放时不会掉队。
 */
export function useFloating(
  trigger: Ref<HTMLElement | null>,
  panel: Ref<HTMLElement | null>,
  active: Ref<boolean>,
  options: Ref<FloatingOptions>,
  /** 坐标锚点：非空时面板贴到这个视口坐标，忽略 trigger。 */
  point?: Ref<{ x: number; y: number } | null>,
) {
  const position = ref<FloatingPosition>({ ...DEFAULT_POSITION })
  const positioned = ref(false)
  let frame = 0

  function update(): void {
    const panelEl = panel.value
    if (!panelEl) return
    let rect: DOMRect | null = null
    if (point?.value) {
      rect = { left: point.value.x, top: point.value.y, right: point.value.x, bottom: point.value.y, width: 0, height: 0, x: point.value.x, y: point.value.y, toJSON: () => ({}) }
    } else {
      const triggerEl = trigger.value
      rect = triggerEl ? triggerEl.getBoundingClientRect() : null
    }
    if (!rect) return
    const padding = options.value.padding ?? 8
    const offset = options.value.offset ?? 6
    const vw = window.innerWidth
    const vh = window.innerHeight
    const panelWidth = panelEl.offsetWidth || 240
    const panelHeight = panelEl.offsetHeight || 120
    const requested = options.value.placement ?? 'bottom-start'
    const wanted: FloatingAnchor = requested === 'auto' ? 'bottom-start' : requested
    let side = sideOf(wanted)
    const align = alignOf(wanted)
    const space = {
      bottom: vh - rect.bottom - offset - padding,
      top: rect.top - offset - padding,
      right: vw - rect.right - offset - padding,
      left: rect.left - offset - padding,
    }
    const need = side === 'top' || side === 'bottom' ? panelHeight : panelWidth
    if (space[side] < need && space[opposite(side)] > space[side]) side = opposite(side)

    let left = rect.left
    let top = rect.top
    if (side === 'bottom') top = rect.bottom + offset
    if (side === 'top') top = rect.top - panelHeight - offset
    if (side === 'right') left = rect.right + offset
    if (side === 'left') left = rect.left - panelWidth - offset

    if (side === 'bottom' || side === 'top') {
      if (align === 'center') left = rect.left + rect.width / 2 - panelWidth / 2
      if (align === 'end') left = rect.right - panelWidth
    } else {
      if (align === 'center') top = rect.top + rect.height / 2 - panelHeight / 2
      if (align === 'end') top = rect.bottom - panelHeight
    }

    left = Math.min(Math.max(left, padding), Math.max(padding, vw - panelWidth - padding))
    top = Math.min(Math.max(top, padding), Math.max(padding, vh - panelHeight - padding))

    const maxHeight = Math.max(
      120,
      Math.min(numeric(options.value.maxHeight) ?? vh - padding * 2, vh - padding * 2),
    )
    position.value = {
      left: Math.round(left),
      top: Math.round(top),
      width: options.value.matchWidth ? Math.round(rect.width) : undefined,
      maxWidth: numeric(options.value.maxWidth),
      minWidth: numeric(options.value.minWidth),
      maxHeight,
      placement: withSide(side, align),
    }
    positioned.value = true
  }

  function loop(): void {
    update()
    if (active.value) frame = requestAnimationFrame(loop)
  }

  function start(): void {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(loop)
  }

  function stop(): void {
    cancelAnimationFrame(frame)
    frame = 0
  }

  watch(active, (open) => {
    if (open) {
      positioned.value = false
      start()
    } else {
      stop()
      positioned.value = false
    }
  }, { immediate: true })

  onBeforeUnmount(stop)

  return { position, positioned, update, start, stop }
}
