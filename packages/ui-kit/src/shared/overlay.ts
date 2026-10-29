import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { focusableIn, focusFirst } from './dom'

let lockCount = 0
let previousOverflow = ''

function lockBody(): void {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
}

function unlockBody(): void {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) document.body.style.overflow = previousOverflow
}

/** 点击浮层/触发器以外的区域时关闭。用捕获阶段，嵌套浮层不会互相吞事件。 */
export function useOutsideClick(
  active: Ref<boolean>,
  containers: Array<Ref<HTMLElement | null>>,
  handler: () => void,
): void {
  function onPointerDown(event: PointerEvent): void {
    if (!active.value) return
    const target = event.target as Node | null
    if (!target) return
    const inside = containers.some((ref) => ref.value?.contains(target))
    if (!inside) handler()
  }
  onMounted(() => document.addEventListener('pointerdown', onPointerDown, true))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
}

export function useEscape(active: Ref<boolean>, handler: (event: KeyboardEvent) => void): void {
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && active.value) handler(event)
  }
  onMounted(() => document.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
}

export interface FocusTrapOptions {
  onEscape?: () => void
  lockScroll?: boolean
  restoreFocus?: boolean
  initialFocus?: 'first' | 'panel' | 'none'
}

/**
 * 模态焦点管理：打开时把焦点送进面板，Tab 在面板内循环，关闭后还给原来的元素。
 * 同时可选锁定 body 滚动，处理连续弹窗的计数。
 */
export function useFocusTrap(
  active: Ref<boolean>,
  panel: Ref<HTMLElement | null>,
  options: FocusTrapOptions = {},
): void {
  let previous: HTMLElement | null = null
  let locked = false

  function onKeydown(event: KeyboardEvent): void {
    if (!active.value) return
    if (event.key === 'Escape') {
      options.onEscape?.()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusableIn(panel.value)
    if (items.length === 0) {
      event.preventDefault()
      panel.value?.focus()
      return
    }
    const current = document.activeElement as HTMLElement | null
    const index = current ? items.indexOf(current) : -1
    event.preventDefault()
    const next = event.shiftKey
      ? items[index <= 0 ? items.length - 1 : index - 1]
      : items[index < 0 || index === items.length - 1 ? 0 : index + 1]
    next?.focus()
  }

  watch(active, (open) => {
    if (open) {
      previous = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      if (options.lockScroll) {
        lockBody()
        locked = true
      }
      requestAnimationFrame(() => {
        if (options.initialFocus === 'none') return
        if (options.initialFocus === 'panel') panel.value?.focus()
        else focusFirst(panel.value)
      })
    } else {
      document.removeEventListener('keydown', onKeydown)
      if (locked) {
        unlockBody()
        locked = false
      }
      if (options.restoreFocus !== false) previous?.focus?.()
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
    if (locked) unlockBody()
  })
}

/** 浮层内用方向键移动焦点；返回是否消费了按键。 */
export function moveFocus(
  panel: HTMLElement | null,
  selector: string,
  direction: 1 | -1,
  current?: HTMLElement | null,
): boolean {
  if (!panel) return false
  const items = Array.from(panel.querySelectorAll<HTMLElement>(selector))
    .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true')
  if (items.length === 0) return false
  const active = current ?? (document.activeElement as HTMLElement | null)
  const index = active ? items.indexOf(active) : -1
  const next = direction > 0
    ? items[index < 0 || index === items.length - 1 ? 0 : index + 1]
    : items[index <= 0 ? items.length - 1 : index - 1]
  next?.focus()
  return true
}
