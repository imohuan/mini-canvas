import { nextTick, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'

/**
 * 快捷键面板的定位与关闭逻辑。
 *
 * 从 ModalsArea.vue 原样搬出：只负责箭头对准 dock 的「快捷键」按钮，
 * 以及点面板外面关闭（触发器自身不算外面）。
 */
export function useShortcutPanel(isOpen: () => boolean, close: () => void) {
  const shortcutPanelRef = ref<HTMLElement | null>(null)
  const arrowShift = ref(0)

  watch(
    isOpen,
    async (open) => {
      if (!open) {
        arrowShift.value = 0
        return
      }
      await nextTick()
      const btn = document.querySelector('[aria-label="快捷键"]')
      if (!btn) return
      arrowShift.value =
        btn.getBoundingClientRect().left +
        btn.getBoundingClientRect().width / 2 -
        window.innerWidth / 2
    },
    { immediate: true },
  )

  onClickOutside(
    shortcutPanelRef,
    (e) => {
      if (!isOpen()) return
      const target = e.target
      if (target instanceof Element && target.closest('[aria-label="快捷键"]')) return
      close()
    },
    { ignore: ['[aria-label="快捷键"]'] },
  )

  return { shortcutPanelRef, arrowShift }
}
