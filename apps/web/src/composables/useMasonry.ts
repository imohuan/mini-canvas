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
  remove?(elements: HTMLElement[]): void
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
  /** 摘掉元素并让布局立刻收缩（不能只调 layout：Masonry 仍按旧项记账） */
  remove: (elements: HTMLElement[]) => void
  layout: () => void
  setColumnWidth: (columnWidth: number | string) => void
  /** 还没有实例时把"想做的重排"记下来，实例就绪后补一次 */
  layoutWhenReady: () => void
  destroy: () => void
}

/** 创建 Masonry 瀑布流管理器 */
export function useMasonry(): UseMasonryReturn {
  const instance = ref<MasonryRuntime | null>(null)
  /**
   * 实例还没建好时收到的"稍后重排"请求。
   *
   * 根因（用户口径 2026-10-28：打开两次后瀑布流所有卡挤在同一格，拖缩放滑杆才恢复）：
   * 图片/视频打不开会被摘掉一张卡，代码随即 `layout()`；但 Masonry 构造是 **异步** 的
   * （masonry-layout / imagesloaded 都是动态 import），这一刻 instance 还是 null，
   * `?.layout()` 空调用 —— 被删的格子空着不收缩，后面的卡全叠在原位。
   * 记一个标记，等 init 完成立刻补一次重排。
   */
  let layoutPending = false
  /** init 令牌：重新打开面板时旧 init 的 await 才回来，不能覆盖新实例 */
  let initToken = 0

  async function init(target: string | HTMLElement, options: MasonryOptions = {}): Promise<void> {
    const container = typeof target === 'string' ? (document.querySelector(target) as HTMLElement | null) : target
    if (!container) {
      console.warn("[useMasonry] 容器未找到: " + String(target))
      return
    }

    const token = ++initToken
    const [Masonry, imagesLoaded] = await Promise.all([loadMasonryCtor(), loadImagesLoaded()])
    // 等待模块加载期间又被 init/destroy 过一次（快速开关面板）：这次已经过期，别覆盖新实例
    if (token !== initToken) return
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
    if (layoutPending) {
      layoutPending = false
      msnry.layout()
    }

    // 图片加载完成后触发重排，用 rAF 确保 DOM 布局完成
    imagesLoaded(container, () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          instance.value?.layout()
        })
      })
    })
  }

  /** 从布局里移除元素（历史卡加载失败被摘掉时用） */
  function remove(elements: HTMLElement[]): void {
    if (elements.length === 0) return
    const msnry = instance.value
    if (!msnry) {
      // 实例没就绪：元素已经从 DOM 摘掉，等 init 补一次 layout 即可
      layoutPending = true
      return
    }
    if (typeof msnry.remove === "function") msnry.remove(elements)
    else msnry.layout()
  }

  /** 实例没就绪也接受重排请求（init 完成后立即补一次） */
  function layoutWhenReady(): void {
    if (instance.value) instance.value.layout()
    else layoutPending = true
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
    // 作废在途 init：它回来时不能再把实例挂上（重开面板会拿到旧容器的实例）
    initToken++
    if (instance.value) {
      instance.value.destroy()
      instance.value = null
    }
  }

  return { instance, init, append, prepend, remove, layout, layoutWhenReady, setColumnWidth, destroy }
}
