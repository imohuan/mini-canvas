/**
 * 子菜单与父菜单的**可见边缘**间距。
 *
 * 为什么不能只写 `sideOffset: 8`：
 * reka 的偏移是从**触发行的边框**量起的，而触发行缩在父面板的内边距里（p-1.5 = 6px）。
 * 于是「配置 8」实际得到 `8 - 6 = 2px` 的可视缝隙；再算上父面板自身的外框，
 * 2026-11-03 在画布下拉里实测是 **-8px（子菜单压在父菜单上）**。
 *
 * 做法：等子菜单挂载后，读它父面板与触发行的真实矩形，把「父面板可见边缘到触发行」的
 * 内缩量补进 sideOffset，让最终可见间距等于配置值（默认 8px）。
 * 翻转（side=left）时用镜像公式，方向变了也不会错位。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { componentConfig } from '../../componentConfig'

/** 从组件 ref / DOM 元素里取出真实的浮层根节点 */
function nodeOf(value: unknown): HTMLElement | null {
  if (!value) return null
  if (value instanceof HTMLElement) return value
  const el = (value as { $el?: unknown }).$el
  return el instanceof HTMLElement ? el : null
}

/**
 * 把子菜单的 sideOffset 校正到「可见边缘相距 subGap」。
 *
 * @param rootRef 子菜单内容的组件 ref（透传到底层 DOM）
 * @param slot    子菜单的 data-slot（dropdown-menu-sub-content / context-menu-sub-content）
 */
export function useSubMenuGap(rootRef: Ref<unknown>, slot: string): {
  offset: Ref<number | null>
  remeasure: () => void
} {
  const offset = ref<number | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let observer: ResizeObserver | null = null

  /** 找到子菜单内容层的真实 DOM（根节点可能是内层滚动 div，也可能是内容元素本身） */
  function contentElement(): HTMLElement | null {
    const root = nodeOf(rootRef.value)
    if (!root) return null
    if (root.matches(`[data-slot="${slot}"]`)) return root
    return root.closest<HTMLElement>(`[data-slot="${slot}"]`) ?? null
  }

  function measure(): void {
    const content = contentElement()
    if (!content) return

    const triggerId = content.getAttribute('aria-labelledby')
    const trigger = triggerId ? document.getElementById(triggerId) : null
    if (!trigger) return

    // 父面板：一级菜单或上一层子菜单（teleport 出去后仍能从触发行往上找到）
    const parent = trigger.closest<HTMLElement>(
      '[data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"], [data-slot="context-menu-content"], [data-slot="context-menu-sub-content"]',
    )
    if (!parent) return

    const side = content.getAttribute('data-side') ?? 'right'
    const panel = parent.getBoundingClientRect()
    const row = trigger.getBoundingClientRect()
    // 触发行比父面板可见边缘缩进多少（含面板内边距）
    const inset = side === 'left' ? row.left - panel.left : panel.right - row.right
    // 目标：可见边缘相距 subGap
    offset.value = Math.round(inset + componentConfig.subGap)
  }

  /**
   * 子菜单的内容是 reka 用 Presence 延迟渲染的：组件早已挂载，但关闭时 DOM 里只有注释节点。
   * 所以不能只量一次，要重试到真正渲染出元素为止（最多约 0.5 秒，避免无限循环）。
   *
   * **不用 requestAnimationFrame**：浏览器会暂停后台标签页的 rAF，那样窗口在后台时
   * 间距就永远量不出来（2026-11-03 实测：调试标签页不可见时 data-sub-gap 一直是空的）。
   * nextTick 在挂载后的同一帧、浏览器绘制前执行，量出来的值第一帧就是对的，不会看到跳动。
   */
  function schedule(attempt = 0): void {
    if (timer !== null) clearTimeout(timer)
    void nextTick(() => {
      if (!contentElement()) {
        if (attempt < 40) timer = setTimeout(() => schedule(attempt + 1), 25)
        return
      }
      measure()
    })
  }

  /** 存一份固定引用，卸载时才能真正摘掉（每次传新箭头函数是摘不掉的） */
  const onWindowResize = (): void => schedule()

  onMounted(() => {
    // 内层 div 在关闭时整个不渲染（reka 的 Presence），
    // 所以每次子菜单打开都要重新挂观察者 —— 见下面 watch。
    window.addEventListener('resize', onWindowResize)
    schedule()
  })

  // 每次重新渲染出一个内容层，就量一次并把观察者挂到新元素上
  watch(
    () => nodeOf(rootRef.value),
    (el) => {
      observer?.disconnect()
      if (el && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => schedule())
        observer.observe(el)
      }
      schedule()
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
    observer?.disconnect()
    window.removeEventListener('resize', onWindowResize)
  })

  return { offset, remeasure: schedule }
}
