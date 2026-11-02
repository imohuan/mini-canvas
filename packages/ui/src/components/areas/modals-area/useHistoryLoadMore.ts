import { computed, nextTick, onMounted, type Ref } from 'vue'
import { scrollViewportOf } from '../../scrollPane'
import type { HistoryPreviewItem } from './useHistoryPreview'

interface HistoryState {
  historyOpen: boolean
  histHasMore: boolean
  histLoadingMore: boolean
  histType: string
}

interface HistoryUi {
  state: HistoryState
  histVisible: Ref<HistoryPreviewItem[]>
  histErrorCount: Ref<number>
  loadMoreHistory: () => void
}

/**
 * 生成历史的“下一批卡片”和“下一页数据”加载。
 *
 * 从 HistoryModal.vue 原样搬出：保留哨兵观察、1 秒节流、漏画对账和 800ms 自愈巡检。
 * 只通过参数拿状态，卡片 DOM 的建造仍留在 HistoryModal。
 */
export function useHistoryLoadMore(opts: {
  s: HistoryState
  ui: HistoryUi
  masonryEl: Ref<HTMLElement | null>
  loadSentinelEl: Ref<HTMLElement | null>
  renderedCount: Ref<number>
  droppedHistoryIds: Set<string>
  lastColumnWidth: () => number
  appendMasonryItems: (from: number, to: number) => void
}) {
  const {
    s,
    ui,
    masonryEl,
    loadSentinelEl,
    renderedCount,
    droppedHistoryIds,
    lastColumnWidth,
    appendMasonryItems,
  } = opts

  const BATCH_SIZE = 24
  const LOAD_MORE_INTERVAL_MS = 1000
  let loadMoreObserver: IntersectionObserver | null = null
  let lastLoadMoreAt = 0
  let loadMoreRetryTimer: ReturnType<typeof setTimeout> | null = null
  /** 已经挂上观察器的哨兵元素（同一个元素不重复 setup，元素换了才重挂） */
  let observedSentinel: HTMLElement | null = null
  let lastBatchTime = 0
  let lastItemVisible = false
  let sentinelObserver: IntersectionObserver | null = null
  let sentinelWatchdog: ReturnType<typeof setInterval> | null = null

  /** 最后一张卡可见 → 追加下一批已拉到的数据（节流交给 maybeLoadMoreBatch） */
  function loadMoreBatch(): void {
    const items = ui.histVisible.value
    if (renderedCount.value >= items.length) { lastItemVisible = false; return }
    const elapsed = Date.now() - lastBatchTime
    if (elapsed < 1000) {
      if (lastItemVisible) setTimeout(() => { if (lastItemVisible) loadMoreBatch() }, 1000 - elapsed)
      return
    }
    lastBatchTime = Date.now()
    const previousCount = renderedCount.value
    renderedCount.value = Math.min(renderedCount.value + BATCH_SIZE, items.length)
    nextTick(() => appendMasonryItems(previousCount, renderedCount.value))
  }

  /**
   * 与下一页哨兵同款的可视监听节流（用户口径 2026-10-27：不要滚动事件）。
   * 旧实现用「Date.now() - lastBatchTime」判可见性：卡片挂上观察器那一刻若仍在
   * 1 秒节流窗口里，loadMoreBatch 只排了个 setTimeout，而这个 timer 又依赖
   * lastItemVisible（进可视区才为 true）—— 两把节流锁互相踩，最后一张卡明明
   * 在屏上也不会追加（用户实测：滚到底也没加载更多）。
   */
  function maybeLoadMoreBatch(): void {
    if (!s.historyOpen || renderedCount.value >= ui.histVisible.value.length) {
      lastItemVisible = false
      return
    }
    const elapsed = Date.now() - lastBatchTime
    if (elapsed < LOAD_MORE_INTERVAL_MS) {
      if (lastItemVisible) setTimeout(() => { if (lastItemVisible) loadMoreBatch() }, LOAD_MORE_INTERVAL_MS - elapsed)
      return
    }
    loadMoreBatch()
  }

  /**
   * 哨兵进了可视区：离上次拉页超过间隔才真的拉（否则定时到点补拉一次）。
   * 数据到位后由 histDataVersion 的 watch 续接瀑布流（appendMasonryItems）。
   */
  function maybeLoadMorePage(): void {
    if (!s.historyOpen || s.histLoadingMore) return
    if (!canLoadMore.value) return
    // 数据已全部拉到、只剩"没渲染的卡片"时，不需要再打接口：直接让最后一批接上瀑布流。
    if (!s.histHasMore) {
      /**
       * 漏画兜底（2026-10-30 用户实测：视频 27 条全部拉到，visible=16，墙上只有 11 张 ——
       * renderedCount=26 与 DOM 11 脱节，计数认为画完了，哨兵从此不再补画）。
       * 以**墙上实际画过的 id** 为准：数据里没画过的全部接上，计数对齐 DOM。
       */
      const drawn = new Set(
        [...(masonryEl.value?.querySelectorAll('[data-hist-id]') ?? [])].map(
          (el) => (el as HTMLElement).dataset.histId,
        ),
      )
      // 排除被有意摘掉的卡（坏资源、显示异常关着时移除）——否则补画/摘卡会互相触发成死循环
      const missing = ui.histVisible.value.filter(
        (e) => !(e.id && drawn.has(e.id)) && !(e.id && droppedHistoryIds.has(e.id)),
      )
      if (missing.length > 0) {
        const from = ui.histVisible.value.findIndex((e) => e === missing[0])
        const to = from + missing.length
        renderedCount.value = Math.max(renderedCount.value, to)
        nextTick(() => appendMasonryItems(from, to))
      }
      else {
        // 没有漏卡时把计数对齐 DOM（防止缓存墙挂回后的虚高把下一轮判断带偏）
        syncRenderedCountWithWall()
      }
      return
    }
    const elapsed = Date.now() - lastLoadMoreAt
    if (elapsed < LOAD_MORE_INTERVAL_MS) {
      if (loadMoreRetryTimer) clearTimeout(loadMoreRetryTimer)
      loadMoreRetryTimer = setTimeout(() => {
        loadMoreRetryTimer = null
        maybeLoadMorePage()
      }, LOAD_MORE_INTERVAL_MS - elapsed)
      return
    }
    lastLoadMoreAt = Date.now()
    ui.loadMoreHistory()
  }

  /**
   * 哨兵现在是否真的在滚动视口里（**不依赖 observer 的阈值回调**）。
   *
   * 为什么需要这个函数（用户报的"滚到底不加载"的根因）：
   * IntersectionObserver 只在"穿过阈值"时回调一次。首屏过滤后只剩十几张卡，
   * 列表比弹窗还短，哨兵一直完整可见 —— 加载第 2 页后哨兵仍原样可见（只是位置下移），
   * 比例一直是 1，**不会再收到任何回调**，于是第 3 页永远不拉。
   * 用户看到的就是：明明到底了、下面一片空白，却再也没有新卡片。
   *
   * 于是每次 DOM/高度变化后再主动量一次：哨兵还在视口里就继续拉，直到列表填满视口
   * 或没有下一页为止（节流仍由 maybeLoadMorePage 负责，不会连发请求）。
   */
  function isSentinelInView(): boolean {
    const sentinel = loadSentinelEl.value
    const view = scrollViewportOf(sentinel)
    if (!sentinel || !view) return false
    const rect = sentinel.getBoundingClientRect()
    const v = view.getBoundingClientRect()
    return rect.top <= v.bottom + 600 && rect.bottom >= v.top
  }

  /** 列表没填满视口时继续拉下一页（幂等 + 节流，可放心在每次布局变化后调用） */
  function fillViewportIfNeeded(): void {
    if (!s.historyOpen) return
    /**
     * 先对账再拉页（2026-10-30 实测：renderedCount=26、DOM=11，计数说"画完了"，
     * 漏掉的卡永远没人补）。以 DOM 实际画过的 id 为准：数据里没画过的先补画，
     * 计数对齐 DOM —— 之后再走正常的"拉下一页"判断。
     */
    // 注意：对账必须发生在 canLoadMore 判断之前 —— 计数虚高时 canLoadMore 恒 false，
    // 永远走不到补画分支（上一版就是被它挡住的）。
    syncRenderedCountWithWall()
    if (!canLoadMore.value) return
    if (isSentinelInView()) maybeLoadMorePage()
  }

  /** 把 renderedCount 对齐墙上实际画过的卡片数（缓存墙挂回 / 异常回落后的计数漂移） */
  function syncRenderedCountWithWall(): void {
    const container = masonryEl.value
    if (!container) return
    const drawn = container.querySelectorAll('[data-hist-id]').length
    if (drawn > 0) renderedCount.value = drawn
  }

  /**
   * 还能不能继续加载：
   *   · 后端还有下一页 → 能（哨兵负责拉数据）
   *   · 数据已全拉到、但还有卡片没渲染 → 也能（哨兵负责把剩余卡片接上瀑布流）
   *
   * 两种"能"都要保留哨兵；只有真正到底（没数据、也全渲染完）才把它从 DOM 摘掉。
   */
  const canLoadMore = computed(() => {
    /**
     * 以 DOM 实际画的数量为准（renderedCount 可能与墙脱节 —— 见 maybeLoadMorePage 兜底）：
     * 数据里还有没画过的条目就继续，别让计数说谎把哨兵摘了。
     */
    const items = ui.histVisible.value
    /**
     * 以 DOM 实际画过的 id 数为准（renderedCount 可能虚高 —— 缓存墙挂回、异常回落、
     * 去重过滤都会让计数与墙脱节）：数据里还有没画过的条目就继续。
     */
    if (masonryEl.value) {
      const drawnIds = new Set(
        [...masonryEl.value.querySelectorAll('[data-hist-id]')].map((el) => (el as HTMLElement).dataset.histId),
      )
      // 已摘掉的坏资源卡不算"还没画"（否则 watchdog 每 800ms 都会推一次重建）
      if (items.some((e) => e.id && !drawnIds.has(e.id) && !droppedHistoryIds.has(e.id))) return true
    }
    if (renderedCount.value < items.length) return true
    return s.histHasMore
  })

  /**
   * 给自动化/排障用：把"到底能不能再加载"的真实状态挂到 DOM 上。
   * 真机排查时先看这几个数，避免只凭"画面没动"猜原因。
   */
  function readLoadState(): Record<string, unknown> {
    const sentinel = loadSentinelEl.value
    const view = scrollViewportOf(sentinel)
    // ⚠️ 不要用 s 命名：s 是 ui.state（被下面的 hasMore / loading 读取）。
    // 之前这里用 const s = rect 遮蔽了它，模板渲染时直接抛
    // "Cannot read properties of undefined (reading 'histHasMore')"，整个瀑布流不渲染。
    const rect = sentinel?.getBoundingClientRect()
    const v = view?.getBoundingClientRect()
    return {
      rendered: renderedCount.value,
      visible: ui.histVisible.value.length,
      // 已摘掉的（坏资源、显示异常关着）不算漏画：补漏与 canLoadMore 都跳过它们
      dropped: droppedHistoryIds.size,
      type: s.histType,
      first: ui.histVisible.value[0]?.kind ?? null,
      hasMore: s.histHasMore,
      loading: s.histLoadingMore,
      errorCount: ui.histErrorCount.value,
      masonry: !!masonryEl.value,
      columns: lastColumnWidth(),
      sentinel: !!sentinel,
      inView: !!(rect && v && rect.top <= v.bottom + 600 && rect.bottom >= v.top),
    }
  }

  /**
   * 监听底部哨兵。真正的滚动层是 ScrollArea 内部的 viewport（根元素本身不滚），
   * root 必须指到它 —— 否则哨兵相对浏览器 viewport 永远"在视口外"（弹窗内容超出视口），一次都不会触发。
   */
  function setupLoadSentinel(): void {
    const sentinel = loadSentinelEl.value
    // 数据还没到时哨兵是 v-if=false（DOM 里没有）—— 先记下"没有"，等它出现再由
    // watch(visibles) 重新调用本函数。以前这里直接 return 且只调用一次，
    // 于是"先开面板、后到数据"时哨兵后渲染出来却永远没人观察（用户实测：滚到底不加载）。
    if (!sentinel) {
      observedSentinel = null
      return
    }
    if (sentinel === observedSentinel && loadMoreObserver) return
    teardownLoadSentinel()
    observedSentinel = sentinel
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          maybeLoadMorePage()
          // 一次回调可能既拉页又把旧数据渲染完，再补一次让最新状态接上
          nextTick(fillViewportIfNeeded)
        }
      },
      { root: scrollViewportOf(sentinel), rootMargin: '0px 0px 600px 0px' },
    )
    loadMoreObserver.observe(sentinel)
    // 首次挂上时也主动量一次：哨兵一开始就在视口里（列表不足一屏）时，
    // 浏览器可能不派发 intersecting 回调（初始状态即相交），只靠回调会永远不拉第 2 页。
    fillViewportIfNeeded()
  }

  function teardownLoadSentinel(): void {
    loadMoreObserver?.disconnect()
    loadMoreObserver = null
    observedSentinel = null
    if (loadMoreRetryTimer) {
      clearTimeout(loadMoreRetryTimer)
      loadMoreRetryTimer = null
    }
  }

  /**
   * 哨兵自愈巡检（用户口径 2026-10-28）。
   *
   * 症状：切页签后滚到底不再加载，拖一下缩放滑杆才恢复 —— 说明哨兵/观察器在切换那一拍
   * 失去了唯一的触发机会，之后再没人叫醒它。这里每 800ms 轻量检查一次（只读几何，不发请求）：
   *   · 元素还在但观察器没了 → 重挂；
   *   · 哨兵就在视口里、也确实还能加载 → 走一次 fillViewportIfNeeded（内部有 1 秒节流）。
   * 历史面板关着时直接跳过，不留后台开销。
   */
  function ensureLoadSentinelAlive(): void {
    if (!s.historyOpen) return
    const sentinel = loadSentinelEl.value
    if (!sentinel) return
    if (sentinel !== observedSentinel || !loadMoreObserver) {
      setupLoadSentinel()
      return
    }
    fillViewportIfNeeded()
  }

  onMounted(() => {
    if (sentinelWatchdog) clearInterval(sentinelWatchdog)
    sentinelWatchdog = setInterval(ensureLoadSentinelAlive, 800)
  })

  /** 监听最后一张卡：进入可视区（含下方 600px 缓冲）就追加下一批 */
  function observeLastItem(): void {
    sentinelObserver?.disconnect()
    const container = masonryEl.value
    if (!container) return
    const els = container.querySelectorAll<HTMLElement>('.hist-masonry-item')
    const last = els.length > 0 ? els[els.length - 1] : null
    if (!last) return
    sentinelObserver = new IntersectionObserver(
      (entries) => {
        lastItemVisible = entries.some((e) => e.isIntersecting)
        if (lastItemVisible) maybeLoadMoreBatch()
      },
      { root: container, rootMargin: '0px 0px 600px 0px' },
    )
    sentinelObserver.observe(last)
  }

  function dispose(): void {
    sentinelObserver?.disconnect()
    sentinelObserver = null
    teardownLoadSentinel()
    if (sentinelWatchdog) clearInterval(sentinelWatchdog)
    sentinelWatchdog = null
  }

  return {
    BATCH_SIZE,
    canLoadMore,
    loadMoreBatch,
    maybeLoadMoreBatch,
    maybeLoadMorePage,
    fillViewportIfNeeded,
    syncRenderedCountWithWall,
    readLoadState,
    setupLoadSentinel,
    teardownLoadSentinel,
    ensureLoadSentinelAlive,
    observeLastItem,
    dispose,
  }
}
