import { onBeforeUnmount, ref, type Ref } from 'vue'

export interface ResizableOptions {
  /** 初始宽度 */
  initial: number
  min: number
  /** 最大宽度：数字，或返回数字的函数（想按视口比例算时用） */
  max: number | (() => number)
  /** true = 手柄在左缘（右侧面板），false = 手柄在右缘（左侧面板） */
  fromRight?: boolean
}

/**
 * 面板宽度拖拽（照 LibTV 实测：两侧面板都能拖，有上下限）。
 * 返回宽度 ref 与绑定到手柄的 pointerdown 处理器。
 */
export function useResizable(options: ResizableOptions): {
  width: Ref<number>
  startResize: (e: PointerEvent) => void
  resizing: Ref<boolean>
} {
  const width = ref(options.initial)
  const resizing = ref(false)
  let startX = 0
  let startW = 0

  const resolveMax = (): number =>
    typeof options.max === 'function' ? options.max() : options.max

  function onMove(e: PointerEvent): void {
    const delta = options.fromRight ? startX - e.clientX : e.clientX - startX
    width.value = Math.min(resolveMax(), Math.max(options.min, startW + delta))
  }
  function stop(): void {
    resizing.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    document.body.style.userSelect = ''
  }
  function startResize(e: PointerEvent): void {
    e.preventDefault()
    startX = e.clientX
    startW = width.value
    resizing.value = true
    // 拖拽期间禁掉文字选中，否则一路刷蓝
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  onBeforeUnmount(stop)
  return { width, startResize, resizing }
}
