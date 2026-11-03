import { ref, watch } from 'vue'

/** 把框上的滚轮转发给 VueFlow 的 viewport 元素。 */
export function useWheelPassthrough(pane: { value: HTMLElement | null }) {
  function forwardWheel(e: WheelEvent): void {
    const target = viewportEl.value
    if (!target) return
    e.preventDefault()
    target.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  const viewportEl = ref<HTMLElement | null>(null)
  function resolveViewportEl(): void {
    const paneEl = pane?.value
    const root = paneEl?.closest('.vue-flow')
    viewportEl.value = root ? root.querySelector('.vue-flow__viewport') : null
  }
  watch(pane, () => resolveViewportEl())
  resolveViewportEl()

  const wrapperRef = ref<HTMLElement | null>(null)
  watch(wrapperRef, (el, _old, onCleanup) => {
    if (!el) return
    el.addEventListener('wheel', forwardWheel, { passive: false })
    onCleanup(() => el.removeEventListener('wheel', forwardWheel))
  })

  return { wrapperRef, viewportEl }
}
