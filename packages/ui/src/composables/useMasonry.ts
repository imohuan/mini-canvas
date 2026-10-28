/**
 * useMasonry — Masonry 瀑布流布局 composable
 *
 * 封装 masonry-layout + imagesloaded，支持动态增删项、手动触发布局重算和销毁清理。
 * 照 web2api 的 TaskResultGalleryView 同款实现搬入（生成历史瀑布流复用）。
 */

import { ref, type Ref } from "vue"

/**
 * masonry-layout / imagesloaded 在模块顶层就访问 window —— SSR（vitest node 环境）
 * 直接 import 会炸。这里改成**惰性动态 import**：只在真正 init/append（浏览器里）时加载。
 */
type MasonryCtor = new (el: HTMLElement, opts: Record<string, unknown>) => MasonryRuntime
type ImagesLoadedFn = (targets: unknown, fn: () => void) => unknown
let MasonryCtorPromise: Promise<MasonryCtor> | null = null
let imagesLoadedFnPromise: Promise<ImagesLoadedFn> | null = null

async function loadMasonryCtor(): Promise<MasonryCtor> {
  MasonryCtorPromise ??= import("masonry-layout").then((m) => (m.default ?? m) as unknown as MasonryCtor)
  return MasonryCtorPromise
}
async function loadImagesLoaded(): Promise<ImagesLoadedFn> {
  imagesLoadedFnPromise ??= import("imagesloaded").then((m) => (m.default ?? m) as unknown as ImagesLoadedFn)
  return imagesLoadedFnPromise
}

/** masonry-layout 官方 @types 把大部分成员标记为可选且缺少 element/options 等运行时属性。
 * 这里定义一个运行时真实存在的子集，供内部和外部调用。 */
export interface MasonryRuntime {
  element: HTMLElement
  options: { columnWidth?: number | string; gutter?: number; [key: string]: unknown }
  appended(elements: HTMLElement[]): void
  prepended(elements: HTMLElement[]): void
  layout(): void
  option(options: Partial<MasonryRuntime["options"]>): void
  destroy(): void
}

/** Masonry 初始化选项（排除 container/元素相关，由 composable 托管） */
export interface MasonryOptions {
  columnWidth?: number | string
  gutter?: number
  itemSelector?: string
  percentPosition?: boolean
  transitionDuration?: string
  fitWidth?: boolean
  horizontalOrder?: boolean
}

/** useMasonry 返回值 */
export interface UseMasonryReturn {
  instance: Ref<MasonryRuntime | null>
  init: (target: string | HTMLElement, options?: MasonryOptions) => Promise<void>
  append: (elements: HTMLElement[]) => Promise<void>
  prepend: (elements: HTMLElement[]) => Promise<void>
  layout: () => void
  setColumnWidth: (columnWidth: number | string) => void
  destroy: () => void
}

/** 创建 Masonry 瀑布流管理器 */
export function useMasonry(): UseMasonryReturn {
  const instance = ref<MasonryRuntime | null>(null)

  async function init(target: string | HTMLElement, options: MasonryOptions = {}): Promise<void> {
    const container = typeof target === 'string' ? (document.querySelector(target) as HTMLElement | null) : target
    if (!container) {
      console.warn("[useMasonry] 容器未找到: " + String(target))
      return
    }

    const [Masonry, imagesLoaded] = await Promise.all([loadMasonryCtor(), loadImagesLoaded()])
    const msnry = new Masonry(container, {
      itemSelector: options.itemSelector ?? ".masonry-item",
      columnWidth: options.columnWidth ?? 280,
      gutter: options.gutter ?? 12,
      percentPosition: options.percentPosition ?? true,
      transitionDuration: options.transitionDuration ?? "0.3s",
      fitWidth: options.fitWidth ?? false,
      horizontalOrder: options.horizontalOrder ?? true,
    })

    instance.value = msnry as unknown as MasonryRuntime

    // 图片加载完成后触发重排，用 rAF 确保 DOM 布局完成
    imagesLoaded(container, () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          instance.value?.layout()
        })
      })
    })
  }

  /** 追加元素到布局 */
  async function append(elements: HTMLElement[]): Promise<void> {
    const msnry = instance.value
    if (!msnry || elements.length === 0) return

    // 先插入 DOM
    for (const el of elements) {
      msnry.element?.appendChild(el)
    }

    // 注册新元素
    msnry.appended(elements)

    // 等待图片加载后重排
    const imagesLoaded = await loadImagesLoaded()
    imagesLoaded(elements, () => {
      requestAnimationFrame(() => {
        instance.value?.layout()
      })
    })
  }

  /** 在列表**最前面**插入元素（新任务到达时只补新卡，不重画已有卡片） */
  async function prepend(elements: HTMLElement[]): Promise<void> {
    const msnry = instance.value
    if (!msnry || elements.length === 0) return
    const first = msnry.element?.firstChild ?? null
    for (const el of elements) msnry.element?.insertBefore(el, first)
    msnry.prepended(elements)
    const imagesLoaded = await loadImagesLoaded()
    imagesLoaded(elements, () => {
      requestAnimationFrame(() => {
        instance.value?.layout()
      })
    })
  }

  /** 手动触发完整布局重算 */
  function layout(): void {
    instance.value?.layout()
  }

  /** 更新列宽并重排（slider / resize 等场景） */
  function setColumnWidth(columnWidth: number | string): void {
    const msnry = instance.value
    if (!msnry) return
    msnry.options.columnWidth = columnWidth
    msnry.layout()
  }

  /** 销毁实例 */
  function destroy(): void {
    if (instance.value) {
      instance.value.destroy()
      instance.value = null
    }
  }

  return { instance, init, append, prepend, layout, setColumnWidth, destroy }
}
