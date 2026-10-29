import { computed, onBeforeUnmount, nextTick, ref, watch, type Ref } from 'vue'
import { useFloating } from '../../shared/floating'
import { useEscape, useOutsideClick } from '../../shared/overlay'
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
  closeFromSlot: () => void
}

/** 下拉浮层的开关、定位和互斥逻辑；模板只负责画。 */
export function useDropdown(props: DropdownProps, emit: (value: boolean) => void): DropdownApi {
  const id = Symbol('dropdown')
  const open = ref(props.modelValue ?? false)
  const triggerRef = ref<HTMLElement | null>(null)
  const panelRef = ref<HTMLElement | null>(null)
  let hideTimer = 0

  const options = computed(() => ({
    placement: props.placement ?? 'bottom-start',
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
    if (props.menuMinWidth) style.minWidth = props.menuMinWidth
    if (props.menuMaxWidth) style.maxWidth = props.menuMaxWidth
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


  return { open, triggerRef, panelRef, position, positioned, show, hide, toggle, scheduleHide, cancelHide, panelStyle, closeFromSlot }
}
