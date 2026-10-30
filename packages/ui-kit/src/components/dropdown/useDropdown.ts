import { computed, onBeforeUnmount, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useFloating } from '../../shared/floating'
import { useEscape, useOutsideClick } from '../../shared/overlay'
import type { UiKitPlacement } from '../../shared/types'
import type { DropdownProps } from './types'

let openInstance: symbol | null = null

export interface DropdownApi {
  open: Ref<boolean>
  triggerRef: Ref<HTMLElement | null>
  panelRef: Ref<HTMLElement | null>
  position: ReturnType<typeof useFloating>['position']
  positioned: ReturnType<typeof useFloating>['positioned']
  show: () => void
  hide: () => void
  toggle: () => void
  scheduleHide: () => void
  cancelHide: () => void
  panelStyle: Ref<Record<string, string>>
  arrowStyle: ComputedRef<Record<string, string>>
  closeFromSlot: () => void
}

/** 下拉浮层的开关、定位和互斥逻辑；模板只负责画。 */
export function useDropdown(props: DropdownProps, emit: (value: boolean) => void): DropdownApi {
  const id = Symbol('dropdown')
  const open = ref(props.modelValue ?? false)
  const triggerRef = ref<HTMLElement | null>(null)
  const panelRef = ref<HTMLElement | null>(null)
  let hideTimer = 0

  /** placement 的后缀与 align 都能决定横向对齐；align 显式值优先。 */
  const resolvedPlacement = computed<UiKitPlacement>(() => {
    const base = props.placement ?? 'bottom-start'
    if (base === 'auto') return 'bottom-start'
    const align = props.align ?? 'auto'
    if (align === 'auto') return base
    const side = base.split('-')[0] as 'top' | 'bottom' | 'left' | 'right'
    return (align === 'center' ? side : side + '-' + align) as UiKitPlacement
  })

  const options = computed(() => ({
    placement: resolvedPlacement.value,
    offset: props.offset ?? 6,
    matchWidth: props.matchWidth ?? false,
    maxWidth: props.menuMaxWidth,
    minWidth: props.menuMinWidth,
    maxHeight: props.menuMaxHeight,
  }))
  const { position, positioned, update } = useFloating(triggerRef, panelRef, open, options)

  function setOpen(value: boolean): void {
    if (open.value === value) return
    if (value && !props.disabled) {
      if (openInstance && openInstance !== id) closeInstance?.()
      openInstance = id
    }
    open.value = value
    emit(value)
    if (value) nextTick(update)
  }

  let closeInstance: (() => void) | undefined
  closeInstance = () => setOpen(false)

  function show(): void {
    if (props.disabled) return
    cancelHide()
    setOpen(true)
  }

  function hide(): void {
    cancelHide()
    if (openInstance === id) openInstance = null
    open.value = false
    emit(false)
  }

  function toggle(): void {
    // 悬停模式由鼠标进出负责关闭；点击只负责打开。
    // 否则鼠标明明还停在触发器上，点一下反而把刚悬停打开的菜单关掉。
    if ((props.trigger ?? 'click') === 'hover') {
      show()
      return
    }
    if (open.value) hide()
    else show()
  }

  function scheduleHide(): void {
    if ((props.trigger ?? 'click') !== 'hover') return
    cancelHide()
    hideTimer = window.setTimeout(hide, Math.max(0, props.hoverCloseDelay ?? 150))
  }

  function cancelHide(): void {
    window.clearTimeout(hideTimer)
    hideTimer = 0
  }

  watch(() => props.modelValue, (value) => {
    if (typeof value === 'boolean' && value !== open.value) {
      open.value = value
      if (!value && openInstance === id) openInstance = null
      if (value) nextTick(update)
    }
  })

  useOutsideClick(open, [triggerRef, panelRef], hide)
  useEscape(open, hide)
  onBeforeUnmount(cancelHide)

  const panelStyle = computed<Record<string, string>>(() => {
    const style: Record<string, string> = {
      left: position.value.left + 'px',
      top: position.value.top + 'px',
      maxHeight: position.value.maxHeight ? position.value.maxHeight + 'px' : '',
    }
    if (props.menuWidth) style.width = props.menuWidth
    else if (props.matchWidth && position.value.width) style.width = position.value.width + 'px'
    if (props.menuHeight) style.height = props.menuHeight
    if (props.menuMinWidth) style.minWidth = props.menuMinWidth
    if (props.menuMaxWidth) style.maxWidth = props.menuMaxWidth
    return style
  })

  /**
   * 箭头是独立 fixed 元素：面板自己 overflow 滚动，画在面板内部会被裁掉。
   * 只露出朝触发器那一半，内侧一半由面板盖住，看起来像从面板边缘长出来。
   */
  const ARROW_SIZE = 10
  const ARROW_PAD = 12
  const arrowStyle = computed<Record<string, string>>(() => {
    const hidden: Record<string, string> = { display: 'none' }
    if (!props.arrow || !positioned.value) return hidden
    const panel = panelRef.value
    const trigger = triggerRef.value
    if (!panel || !trigger) return hidden
    const pos = position.value
    const side = pos.placement.split('-')[0] as 'top' | 'bottom' | 'left' | 'right'
    const tr = trigger.getBoundingClientRect()
    const half = ARROW_SIZE / 2
    const style: Record<string, string> = {
      position: 'fixed',
      width: ARROW_SIZE + 'px',
      height: ARROW_SIZE + 'px',
      background: 'var(--mck-panel, #fff)',
      border: '0 solid var(--mck-line, #e2e5ea)',
      transform: 'rotate(45deg)',
      pointerEvents: 'none',
    }
    const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))
    if (side === 'top' || side === 'bottom') {
      const center = tr.left + tr.width / 2
      style.left = clamp(center - half, pos.left + ARROW_PAD, pos.left + panel.offsetWidth - ARROW_PAD) + 'px'
      style.top = (side === 'bottom' ? pos.top : pos.top + panel.offsetHeight) - half + 'px'
      const edges = side === 'bottom' ? ['Top', 'Left'] : ['Bottom', 'Right']
      for (const edge of edges) style['border' + edge + 'Width'] = '1px'
    } else {
      const center = tr.top + tr.height / 2
      style.top = clamp(center - half, pos.top + ARROW_PAD, pos.top + panel.offsetHeight - ARROW_PAD) + 'px'
      style.left = (side === 'right' ? pos.left : pos.left + panel.offsetWidth) - half + 'px'
      const edges = side === 'right' ? ['Bottom', 'Left'] : ['Top', 'Right']
      for (const edge of edges) style['border' + edge + 'Width'] = '1px'
    }
    return style
  })

  /**
   * slot 里的 close 必须真的关掉浮层并通知父组件；
   * hide 与外点/ESC 共用，但父级 modelValue 还没同步时也要兜底置 false。
   */
  function closeFromSlot(): void {
    open.value = false
    if (openInstance === id) openInstance = null
    emit(false)
  }


  return { open, triggerRef, panelRef, position, positioned, show, hide, toggle, scheduleHide, cancelHide, panelStyle, arrowStyle, closeFromSlot }
}
