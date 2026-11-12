import { computed, watch } from 'vue'
import { historySignatureOf, trimMapToLimit, HIST_DATA_CACHE_LIMIT } from '../historySignature'
import { queueUploads, type PendingUpload } from '../assetUploadBus'
import { readyHost } from './hostRuntime'
import type { UiState } from './createUiState'
import type { UiHostScope } from './useUiHost'
import type { CanvasListScope } from './useCanvasList'

/**
 * 生成历史：筛选、分页、缓存、加载态、批量动作。
 *
 * 筛选 watch 由入口按原 onReady 顺序调用 bindHistoryFilters()；这里只搬运原函数，
 * 不改请求序号 / epoch / 缓存的先后关系。
 */
export function createHistoryScope(state: UiState, host: UiHostScope, canvasList: CanvasListScope) {
  const { showToast } = host
  const { currentCanvasId } = canvasList

  const histVisible = computed(() =>
    state.histShowError ? state.historyItems : state.historyItems.filter((e) => (e.urls?.length ?? 0) > 0),
  )
  /** 当前页里有多少条异常（弹窗按它决定"显示异常"开关显不显示） */
  const histErrorCount = computed(() => state.historyItems.filter((e) => !e.urls || e.urls.length === 0).length)
  /** 历史弹窗上那些中文标签 ↔ 后台的英文值（显示层的事，写在显示层） */
  const HIST_KIND: Record<string, string> = { 图片: 'image', 视频: 'video', 音频: 'audio' }
  /**
   * 计数徽章：用后台的汇总（不是本地数当前页）。
   *
   * 后台的 byKind 键是**英文**（image / video / audio），而徽章上的标签是中文 —— 必须转一道，
   * 否则 `byKind['图片']` 永远是 undefined，三个计数全显示 0（用户报的就是这个）。
   */
  const histCount = (kind: string): number => state.historySummary.byKind[HIST_KIND[kind] ?? kind] ?? 0
  const assetCount = (kind: string): number => state.historySummary.byKind[HIST_KIND[kind] ?? kind] ?? 0

  /** 评级筛选的中文标签 ↔ 后台英文值 */
  const HIST_RATING: Record<string, string> = {
    所有评级: 'all',
    已通过: 'passed',
    待审核: 'pending',
    已拒绝: 'rejected',
  }
  /** 历史请求序号：只让最新一次请求的结果落表（防快速切页签时旧响应覆盖新响应） */
  let historyReqSeq = 0
  /** 最近一次历史请求的取消句柄（切页签时取消过期请求） */
  let historyAbort: AbortController | null = null
  /**
   * 「一轮筛选」的版本号：切换页签/范围/排序时 +1。
   * 同一轮里可能有多次请求（第 1 页 + 自动补页），只有**本轮**的响应才允许落表。
   * 这比单纯"请求序号"更严：连续切两次页签时，中间那轮晚到的第 2 页也会被丢掉。
   */
  let historyFilterEpoch = 0
  /**
   * 每个筛选条件（含页大小）已经加载到第几页。
   *
   * 用户口径 2026-10-28：切回「图片」时之前翻的 3 页全没了 —— 旧实现切页签一律回第 1 页、
   * 只拉 20 条，等于把已加载的数据丢掉。这里按筛选签名记页码：切回来时把已加载的页
   * **一次补齐**（第 1 页整表替换 + 后续页追加），画面和数据都回到离开前的样子。
   * 页大小档位（列数滑杆）也算在签名里：改了列数就是另一套分页，重新从第 1 页拉。
   */
  const histPageBySignature = new Map<string, number>()
  /**
   * 每个筛选条件已经拉到的整表数据（内存缓存）。
   * 切页签不再清空重拉：先恢复这份数据 + 瀑布流 DOM，视频不黑屏、音频波形不重建；
   * 随后在后台刷新第 1 页，新生成的任务只**插到最前面**，不重画已有卡片。
   */
  const histDataCache = new Map<string, {
    items: typeof state.historyItems
    page: number
    hasMore: boolean
    total: number
    summary: typeof state.historySummary
  }>()
  /**
   * 「整表重拉」在途计数：第 1 页（含按缓存回填的多页）还没落地。
   * >0 时补页**排队**等它完成 —— 不能像旧实现那样直接 return 丢掉
   * （用户实测 2026-10-28：切页签后滚到底再也不加载，得拖一下缩放滑杆才恢复）。
   */
  let historyFirstPagePending = 0
  /**
   * 当前这批数据是不是「按缓存回填」的一页（1 = 是）。
   * 回填会连续落表好几页，弹窗据此把这几拍都当成「整墙重建」，不能中途 append；
   * 否则第 2 页到达时新墙还没 init，append 空转 → 31 条只画出 17 张（真机 2026-10-28）。
   */
  let historyRestoring = false
  /** 后台刷新第 1 页的在途标记：避免同一切换连发多次 */
  let historyRefreshing = false
  /** 补页被挡下时的排队标记 */
  let histLoadMoreQueued = false
  /** 排队重试定时器（兜底：万一没有 finally 触发，也能自己续上） */
  let histLoadMoreRetryTimer: ReturnType<typeof setTimeout> | null = null
  /** 切筛选时调用：作废在途请求，并开启新一轮 */
  function resetHistoryRequest(): number {
    historyFilterEpoch += 1
    historyAbort?.abort()
    historyAbort = null
    historyFirstPagePending = 0
    histLoadMoreQueued = false
    if (histLoadMoreRetryTimer) {
      clearTimeout(histLoadMoreRetryTimer)
      histLoadMoreRetryTimer = null
    }
    state.histLoadingFirst = false
    historyRestoring = false
    historyRefreshing = false
    return historyFilterEpoch
  }

  /** 加载条最短显示时长（毫秒）：接口再快也要让用户看清（用户口径 2026-10-28：改 1 秒） */
  const HIST_LOADING_MIN_MS = 1000
  /** 本轮「加载更多」的起始时刻（0 = 没在显示） */
  let histLoadingSince = 0
  let histLoadingHideTimer: ReturnType<typeof setTimeout> | null = null
  /** 加载态令牌：新一轮开始后，旧请求的收尾不能把新加载条提前关掉 */
  let histLoadingToken = 0

  /** 开始一轮「加载更多」：立刻显示加载条，并记下起始时刻 */
  function beginHistLoading(): number {
    if (histLoadingHideTimer) {
      clearTimeout(histLoadingHideTimer)
      histLoadingHideTimer = null
    }
    const token = ++histLoadingToken
    histLoadingSince = Date.now()
    state.histLoadingShownAt = histLoadingSince
    state.histLoadingMore = true
    state.histLoadingMoreVisible = true
    return token
  }

  /** 这一轮加载至少还要显示多久（毫秒）——弹窗据此把加载条"/占位"再撑一会儿 */
  function histLoadingRemainingMs(): number {
    if (!histLoadingSince) return 0
    return Math.max(0, HIST_LOADING_MIN_MS - (Date.now() - histLoadingSince))
  }

  /** 第 1 页开始/结束：用计数而不是布尔，快速连点页签时不会被旧请求的 finally 提前清掉 */
  function noteFirstPageStart(): void {
    historyFirstPagePending += 1
    state.histLoadingFirst = true
  }

  function noteFirstPageEnd(): void {
    historyFirstPagePending = Math.max(0, historyFirstPagePending - 1)
    state.histLoadingFirst = historyFirstPagePending > 0
    if (!state.histLoadingFirst) flushPendingLoadMore()
  }

  /**
   * 补页被「第 1 页/回填在途」挡下时，排队等它完成。
   *
   * 旧实现直接 return 丢掉：切页签后 1.2 秒内滚到底的唯一一次触发会被吞掉，
   * 之后再没有任何东西来叫醒它（用户实测 2026-10-28：必须拖一下缩放滑杆才恢复）。
   */
  function flushPendingLoadMore(): void {
    if (histLoadMoreRetryTimer) {
      clearTimeout(histLoadMoreRetryTimer)
      histLoadMoreRetryTimer = null
    }
    if (!histLoadMoreQueued) return
    histLoadMoreQueued = false
    histLoadMoreRetryTimer = setTimeout(() => {
      histLoadMoreRetryTimer = null
      loadMoreHistory()
    }, 0)
  }

  /**
   * 结束加载条：不足 HIST_LOADING_MIN_MS 时**延迟到满 500ms**再隐藏。
   * 接口几十毫秒就回来的情况下，不延迟的话加载态一闪而过，用户只会看到列表"突然多了几项"。
   */
  function settleHistLoading(token: number): void {
    if (token !== histLoadingToken) return
    const elapsed = histLoadingSince > 0 ? Date.now() - histLoadingSince : HIST_LOADING_MIN_MS
    const wait = Math.max(0, HIST_LOADING_MIN_MS - elapsed)
    const hide = (): void => {
      histLoadingHideTimer = null
      histLoadingSince = 0
      state.histLoadingMore = false
      state.histLoadingMoreVisible = false
    }
    if (histLoadingHideTimer) {
      clearTimeout(histLoadingHideTimer)
      histLoadingHideTimer = null
    }
    if (wait === 0) hide()
    else histLoadingHideTimer = setTimeout(hide, wait)
  }

  /**
   * 从后台拉一页历史。
   *
   * 服务名是 `cloud-client:history`（由 plugin-cloud-client 挂上）。没装那个插件
   * （比如纯前端开着）时服务不存在 —— 给一句人话，而不是装作"没有历史"。
   */
  async function loadHistory(
    pageNo: number = state.histPage,
    /**
     * 发起时的筛选签名：**默认取此刻的值**，由调用方在"决定要哪一页"的同时一起传进来。
     * 只靠函数入口现读会在切换页签的竞态里取到新筛选（用户实测 2026-10-28：
     * 点"音频"时先跑了旧筛选的补页请求，它读到的是新页签条件，于是音频被当成第 2 页追加，
     * 第 1 页永远不来）。
     */
    signature: string = historySignature(),
    /** 回填模式：按缓存页数一次补齐（第 2 页起也做整表拼接，不校验"当前页 + 1"） */
    isRestore = false,
  ): Promise<void> {
    const isFirstPage = pageNo <= 1
    // 回填由 restoreHistoryPages 统一持有"整表在途"计数，这里不重复加减
    if (isFirstPage && !isRestore) noteFirstPageStart()
    try {
      const svc = readyHost.ctx?.get<{
        query(q?: Record<string, unknown> & { signal?: AbortSignal }): Promise<{
          items: Array<{
            id: string
            title: string
            kind: string
            finishedAt: number
            urls?: string[]
            canvasId?: string
            nodeId?: string
            prompts?: Array<{ type: 'tag' | 'prompt'; value: string }>
            values?: Record<string, unknown>
            resources?: Array<{ id?: string; kind: string; name?: string; url?: string; value?: string }>
            media?: { width?: number; height?: number; durationMs?: number; bytes?: number }
            error?: string
          }>
          total: number
          page: number
          pageSize: number
          summary: { total: number; byKind: Record<string, number> }
        }>
      }>('cloud-client:history')
      if (!svc) {
        state.historyReady = false
        return
      }
      // 请求序号：快速切页签/触底时多个请求并发，慢的旧响应不能覆盖新响应
      const seq = ++historyReqSeq
      const epoch = historyFilterEpoch
      // 取消上一次仍在路上的请求：快速切换页签时它已过期，继续占着连接只会让新结果排队。
      historyAbort?.abort()
      historyAbort = new AbortController()
      const signal = historyAbort.signal
      try {
        const page = await svc.query({
          page: pageNo,
          pageSize: state.histPageSize,
          signal,
          ...(state.histType ? { kind: HIST_KIND[state.histType] ?? state.histType } : {}),
          ...(state.histRating && state.histRating !== '所有评级'
            ? { rating: HIST_RATING[state.histRating] ?? state.histRating }
            : {}),
          order: state.histSortDesc ? 'desc' : 'asc',
          // 「本画布」= URL 里那个真实画布 id（`currentCanvasId`）
          ...(state.histScope === '本画布' ? { canvasId: currentCanvasId.value } : {}),
        })
        if (seq !== historyReqSeq) return // 已有更新的请求发出，丢弃这份过期响应
        if (epoch !== historyFilterEpoch) return // 已切换筛选：这份数据属于上一轮，不能落表
        // 请求发出后筛选变了：这份响应属于旧筛选，丢弃且**不推进 histPage**
        if (signature !== historySignature()) return
        /**
         * 分页归属校验：第 2 页起，只有"当前页 + 1"的响应才算追加。
         * 回填（restore）是整表替换，它自己带"最多到第几页"，不走这条追加校验。
         */
        if (pageNo > 1 && !isRestore && pageNo !== state.histPage + 1) return
        const mapped = page.items.map((e) => ({
          id: e.id,
          title: e.title,
          time: formatAgo(e.finishedAt),
          kind: e.kind === 'video' ? '视频' : e.kind === 'audio' ? '音频' : '图片',
          ...(e.urls && e.urls.length > 0 ? { urls: e.urls } : {}),
          ...(e.canvasId ? { canvasId: e.canvasId } : {}),
          ...(e.nodeId ? { nodeId: e.nodeId } : {}),
          finishedAt: e.finishedAt,
          ...(e.prompts && e.prompts.length > 0 ? { prompts: e.prompts } : {}),
          ...(e.values && Object.keys(e.values).length > 0 ? { values: e.values } : {}),
          ...(e.resources && e.resources.length > 0 ? { resources: e.resources } : {}),
          ...(e.media && Object.keys(e.media).length > 0 ? { media: e.media } : {}),
          ...(e.error ? { error: e.error } : {}),
        }))
        /**
         * 按 id 去重（用户实测 2026-10-29：视频页签出现一模一样的两张卡）。
         * 根因：同秒完成任务的时间戳并列时，后端排序在同一 key 上不稳定 ——
         * 第 1 页把它排后面、第 2 页又把它排前面，翻页就重复。同 id 出现两次时
         * 保留先到的（页码小的那份），后面的直接丢弃。
         */
        const dedup = <T extends { id?: string }>(rows: T[]): T[] => {
          const set = new Set<string>()
          return rows.filter((e) => {
            if (!e.id || set.has(e.id)) return false
            set.add(e.id)
            return true
          })
        }
        // 追加式分页：第 1 页（或筛选切换后回到第 1 页）替换整表；后续页**追加**
        if (pageNo <= 1) {
          /**
           * 只有「同一套筛选已经在表里」时才走"只插新卡"。
           * 首次进入某个页签时表里还留着上一个页签的数据（签名不同），
           * 这时必须整表替换 —— 否则会把图片 60 条和视频 20 条拼成 80 条
           * （真机 2026-10-28 实测的回归）。
           */
          if (isRestore && state.historyItems.length > 0 && state.histSignature === signature) {
            /**
             * 后台同步第 1 页：**只把新任务插到最前面**，已有卡片一律保留。
             * 用户口径 2026-10-28：不能因为来了新任务就整墙重画（视频会黑一下、
             * 音频波形会重建）。按 id 去重后 unshift，天然按新→旧排列。
             */
            const known = new Set(state.historyItems.map((e) => e.id))
            const fresh = dedup(mapped).filter((e) => !known.has(e.id))
            if (fresh.length > 0) state.historyItems.unshift(...fresh)
            state.histUpdateMode = fresh.length > 0 ? 'prepend' : 'none'
            state.histUpdateCount = fresh.length
            state.histHasMore = state.historyItems.length < page.total
          } else {
            state.historyItems = dedup(mapped)
            state.histUpdateMode = 'rebuild'
            state.histUpdateCount = mapped.length
            state.histPage = pageNo
            state.histHasMore = page.page * page.pageSize < page.total
          }
        } else {
          // 追加页也要先去重：后端分页窗口可能因为排序并列把同一条给两页
          const known = new Set(state.historyItems.map((e) => e.id))
          const fresh = dedup(mapped).filter((e) => !known.has(e.id))
          state.historyItems.push(...fresh)
          state.histUpdateMode = 'append'
          state.histUpdateCount = fresh.length
          state.histPage = pageNo
          state.histHasMore = page.page * page.pageSize < page.total
        }
        state.histSignature = signature
        // 回填期间落表的每一页都带这个标记：弹窗据此整墙重建（不中途 append）
        state.histRestoring = historyRestoring
        state.historySummary = page.summary
        state.histTotal = page.total
        // 记下这套筛选已经加载到第几页：切走再切回来时一次补齐（用户口径 2026-10-28）
        histPageBySignature.set(signature, pageNo)
        // 整表快照进内存缓存：下次切回来先显示它，再后台同步新任务（不闪白、不重建媒体）
        // 先按上限逐出最旧的：每套筛选存一整份列表，不设上限就随浏览历史一直涨
        trimMapToLimit(histDataCache, HIST_DATA_CACHE_LIMIT)
        histDataCache.set(signature, {
          items: state.historyItems.map((e) => ({ ...e })),
          page: state.histPage,
          hasMore: state.histHasMore,
          total: state.histTotal,
          summary: state.historySummary,
        })
        state.histDataVersion += 1
        state.historyReady = true
      } catch (err) {
        // 主动取消（切页签/换筛选）：不是失败，不要报"未连接"或推进版本
        if ((err as { name?: string } | null)?.name === 'AbortError') return
        console.warn('[ui] 拉历史失败', err)
        state.historyReady = false
        // 失败也要推进版本：弹窗可能在等新数据重建（filterSwitching 挂着会白屏）
        state.histDataVersion += 1
      }
    } finally {
      if (isFirstPage && !isRestore) noteFirstPageEnd()
    }
  }

  /** 时间戳 → 「2 分钟前」这种短文案（列表里看的是"多久之前"，不是精确时刻） */
  function formatAgo(ts: number): string {
    if (!Number.isFinite(ts)) return ''
    const diff = Math.max(0, Date.now() - ts)
    const min = Math.floor(diff / 60000)
    if (min < 1) return '刚刚'
    if (min < 60) return min + ' 分钟前'
    const hour = Math.floor(min / 60)
    if (hour < 24) return hour + ' 小时前'
    const day = Math.floor(hour / 24)
    if (day === 1) return '昨天'
    if (day < 30) return day + ' 天前'
    return new Date(ts).toLocaleDateString()
  }
  let disposeHistorySub: (() => void) | undefined
  function bindHistoryUpdates(): void {
    disposeHistorySub?.()
    disposeHistorySub = undefined
    const svc = readyHost?.ctx?.get<{ subscribe(fn: () => void): () => void }>('cloud-client:history')
    if (!svc || typeof svc.subscribe !== 'function') return
    /**
     * 收到「有新任务」信号：只后台同步当前页签的第 1 页，新卡片插到最前面。
     * 旧实现是按当前页码整页重拉，新任务要多翻一页才看得到，而且会整表替换 → 墙重画。
     * 用户口径 2026-10-28：新任务必须能看到，但不能让视频黑一下、音频波形重建。
     */
    disposeHistorySub = svc.subscribe(() => {
      if (!state.historyOpen) return
      void syncLatestHistory(historySignature())
    })
  }

  /** 撤掉历史订阅（宿主销毁时调用） */
  function unbindHistory(): void {
    disposeHistorySub?.()
    disposeHistorySub = undefined
    unbindHistoryFilters()
  }

  /** 上次对齐历史时是哪张画布（'' = 还没对齐过） */
  let historyCanvasKey = ''

  /**
   * 切画布后把历史状态对齐到新画布。返回是否真的换过画布。
   *
   * 为什么需要：ui 状态是模块级单例，切画布只重建路由组件、不清状态。
   * 用户在 A 画布翻到第 3 页，切到 B：画布 id 不在筛选 watch 的源里，没人重拉；
   * onReady 的 loadHistory() 又用**旧页码 3** 发起，落表前被「必须是当前页 + 1」
   * 的分页校验丢掉 —— 历史墙一直显示 A 画布的卡片。这里把页码/签名复位，
   * 后面的 loadHistory 自然拉第 1 页。
   */
  function alignHistoryToCanvas(): boolean {
    const id = currentCanvasId.value
    if (historyCanvasKey === id) return false
    historyCanvasKey = id
    resetHistoryRequest()
    state.histPage = 1
    // 签名清空：否则第 1 页会走「同一筛选下只插新卡」分支，旧画布的卡片留在墙上
    state.histSignature = ''
    // 旧画布的条目也清掉：数据要等第 1 页回来才有，留着就是「先给用户看别人的画布」
    // （缓存按画布 id 分开存，切回来时 showCachedHistory 仍能秒还原，不会因此变慢）
    state.historyItems = []
    // 页码表按旧签名（不含画布 id）记的：再也匹配不上，留着只是内存垃圾
    histPageBySignature.clear()
    return true
  }

  /**
   * 筛选条件（画布范围 / 类型 / 评级 / 排序）一变就重拉。
   *
   * 为什么必须有：这些条件是由 state 驱动的，以前只在**打开弹窗**时拉一次 ——
   * 用户点了「图片」「本画布」后列表纹丝不动（看上去就像筛选坏了）。
   * 只在弹窗开着时拉，避免后台白白扫一遍全量账本。
   */
  let disposeHistFilterWatch: (() => void) | undefined
  function bindHistoryFilters(): void {
    disposeHistFilterWatch?.()
    disposeHistFilterWatch = watch(
      () => [state.histScope, state.histType, state.histRating, state.histSortDesc, state.histPageSize],
      () => {
        if (!state.historyOpen) return
        /**
         * 切筛选：先秒还原缓存（不重建视频/音频），再后台同步最新第 1 页；
         * 没有缓存的页签才回填。缓存键是完整签名（含页大小），改列数滑杆自然回到第 1 页。
         * 走 openHistoryView 还能保证"作废旧请求 + 期间补页排队"两条不丢。
         */
        const signature = historySignature()
        state.histPage = 1
        openHistoryView(signature)
      },
    )
  }

  /**
   * 按缓存的页数把一套筛选的历史整表补回来：第 1 页替换整表，后续页按顺序追加。
   * 期间补页排队（state.histLoadingFirst），不会抢页码；全部落表后再放行。
   */
  async function restoreHistoryPages(signature: string, pages: number): Promise<void> {
    const target = Math.max(1, Math.min(pages, 50))
    noteFirstPageStart()
    historyRestoring = true
    state.histRestoring = true
    try {
      for (let p = 1; p <= target; p++) {
        await loadHistory(p, signature, true)
        // 中途切走了 / 关面板了：后面的页属于上一轮，别再发
        if (signature !== historySignature() || !state.historyOpen) return
      }
    } finally {
      // 先关标记再放行补页：否则哨兵会看到"回填中"又把自己排回去
      historyRestoring = false
      state.histRestoring = false
      // 再推一拍版本：弹窗在这一拍统一整墙重建（回填期间它一直没建墙）
      state.histDataVersion += 1
      noteFirstPageEnd()
    }
  }

  /**
   * 切回一个页签 / 重新打开面板：**先用内存缓存把画面一秒还原**，再后台同步第 1 页。
   *
   * 用户口径 2026-10-28：切页签时视频会黑一下、音频波形重建，数据一多很难受。
   * 所以这里不再清空重拉：缓存命中就直接落表（弹窗只换 DOM，不重建媒体元素），
   * 然后 fetch 第 1 页做 diff —— 新任务插到最前面，其他卡片保持不动。
   */
  function showCachedHistory(signature: string): boolean {
    const cached = histDataCache.get(signature)
    if (!cached) return false
    state.historyItems = cached.items.map((e) => ({ ...e }))
    state.histPage = cached.page
    state.histHasMore = cached.hasMore
    state.histTotal = cached.total
    state.historySummary = cached.summary
    state.histSignature = signature
    state.histUpdateMode = 'rebuild'
    state.histUpdateCount = cached.items.length
    state.histDataVersion += 1
    state.historyReady = true
    return true
  }

  /** 后台同步第 1 页（只补新任务，不整墙重画） */
  async function syncLatestHistory(signature: string): Promise<void> {
    if (historyRefreshing) return
    historyRefreshing = true
    try {
      await loadHistory(1, signature, true)
    } finally {
      historyRefreshing = false
    }
  }

  /**
   * 打开历史的统一入口（切页签 / 重新开面板 / 收到新任务信号都走它）：
   * 有缓存 → 秒还原 + 后台同步；没缓存 → 按缓存的页数补齐。
   */
  function openHistoryView(signature: string = historySignature()): void {
    const epoch = resetHistoryRequest()
    const cachedPages = histPageBySignature.get(signature) ?? 1
    const shown = showCachedHistory(signature)
    if (shown) {
      // 显示缓存后先别让补页抢跑：后台同步落地再放行
      noteFirstPageStart()
      void syncLatestHistory(signature).finally(() => {
        if (epoch === historyFilterEpoch) noteFirstPageEnd()
      })
      return
    }
    void restoreHistoryPages(signature, cachedPages)
  }

  /** 撤掉筛选 watch（宿主销毁时调用） */
  function unbindHistoryFilters(): void {
    disposeHistFilterWatch?.()
    disposeHistFilterWatch = undefined
  }

  /**
   * 无限滚动：历史弹窗滚到底部时拉下一页并**追加**（不重置 renderedCount，
   * 已渲染的卡片与滚动位置都保留 —— 参照 web2api 画廊「触底再加载一批」的体验）。
   */
  function loadMoreHistory(): void {
    if (!state.historyOpen || !state.histHasMore) return
    /**
     * 第 1 页 / 回填还在路上：**排队**，等它落地再拉下一页。
     * 这里绝不能直接 return 丢掉 —— 切页签后的第一次触底就靠这次排队续上
     * （用户实测 2026-10-28：切回图片后滚到底没反应，拖一下缩放滑杆才加载）。
     */
    if (state.histLoadingFirst) {
      histLoadMoreQueued = true
      return
    }
    /** 正在拉下一页：不重复发（按钮/哨兵可能同一拍各触发一次） */
    if (state.histLoadingMore) return
    const token = beginHistLoading()
    const nextPage = state.histPage + 1
    // 页码与筛选签名必须同时定格：晚一帧就可能拿到"新页签 + 旧页码"的错配组合
    const signature = historySignature()
    /**
     * 补页请求带上"它当时属于哪一轮筛选"：切换页签后这轮就作废了，
     * 晚到的第 2 页不能再把 histPage 推回 2（否则新页签会从第 2 页开始拉，
     * 第 1 页永远不来 —— 用户看到的就是"点音频没反应，还是图片"）。
     */
    const epoch = historyFilterEpoch
    void loadHistory(nextPage, signature).finally(() => {
      settleHistLoading(token)
      if (epoch !== historyFilterEpoch) return
    })
  }

  /**
   * 历史请求的"分类标记"：每次拉数据带上**发起时的筛选条件**。
   *
   * 根因（2026-10-28 用户报"点音频没反应，还是图片"）：
   * 切页签时 histPage 归 1，旧的"自动补页"请求还在路上；它落地后把 histPage 改成 2，
   * 紧接着新页签的第 1 页请求被当成了"第 2 页"，于是走 append、被塞进旧图片后面。
   * 现在按"筛选签名"判断：签名不一致的响应一律丢弃，且不推进 histPage。
   */
  function historySignature(): string {
    // 拼接规则抽在 historySignature.ts：ModalsArea 的墙面 key 也用同一份，两边不会漂移
    return historySignatureOf(
      {
        scope: state.histScope,
        type: state.histType,
        rating: state.histRating,
        sortDesc: state.histSortDesc,
        pageSize: state.histPageSize,
      },
      currentCanvasId.value,
    )
  }

  // ===== 批量操作（历史弹窗底部操作栏）=====
  /** 后台调用（同源；与 projectsApi 同风格但不 import —— 那份没覆盖 history 路由） */
  async function histReq<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
    if (!res.ok || data?.ok === false) throw new Error(data?.error || '请求失败（HTTP ' + res.status + '）')
    return data
  }

  /** 批量删除选中历史（后台删账本条目；产物资源文件不动） */
  async function batchDeleteHistory(): Promise<void> {
    const ids = [...state.histSelectedIds]
    if (ids.length === 0) return
    try {
      const r = await histReq<{ removed: number }>('/api/history/batch-delete', { ids })
      showToast('已删除 ' + r.removed + ' 条')
      state.histSelectedIds = []
      state.histPage = 1
      await loadHistory()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败')
    }
  }

  /** 批量改评级 */
  async function batchRateHistory(rating: 'passed' | 'pending' | 'rejected'): Promise<void> {
    const ids = [...state.histSelectedIds]
    if (ids.length === 0) return
    try {
      const r = await histReq<{ updated: number }>('/api/history/batch-rating', { ids, rating })
      showToast('已更新 ' + r.updated + ' 条评级')
      state.histSelectedIds = []
      state.histPage = 1
      await loadHistory()
    } catch (err) {
      showToast(err instanceof Error ? err.message : '评级失败')
    }
  }

  /**
   * 批量保存到资产 —— 与右键菜单「收藏到资产库」**同一条路**（用户口径 2026-10-27）。
   *
   * 旧实现直接 POST /api/history/batch-save-assets 静默入库：用户点了没有任何弹窗，
   * 既不能选保存位置、也不能改名/打标签，看起来就像"按钮没反应"。
   * 现在把选中记录的产物贴进 assetUploadBus，由 AssetUploadHost 打开左侧同一个上传弹窗，
   * 用户确认后才落库（去重、文件夹、标签都沿用上传弹窗那套）。
   */
  function batchSaveAssets(): void {
    const ids = [...state.histSelectedIds]
    if (ids.length === 0) return
    const picked = state.historyItems.filter((h) => h.id && ids.includes(h.id))
    const items: PendingUpload[] = []
    for (const e of picked) {
      const url = e.urls?.[0]
      if (!url) continue
      // 文件名：沿用产物地址里的后缀（上传弹窗据此判类型）；认不出就不硬补
      const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
      const safeExt = /^(png|jpe?g|webp|gif|mp4|mov|webm|mp3|wav|m4a|aac|ogg)$/.test(ext) ? '.' + ext : ''
      const name = (e.title || 'history') + '-' + (e.id?.slice(0, 6) ?? 'item') + safeExt
      items.push({ url, name })
    }
    if (items.length === 0) {
      showToast('选中的记录没有可保存的产物')
      return
    }
    queueUploads(items)
  }

  return {
    histVisible, histErrorCount, histCount,
    loadHistory, loadMoreHistory, batchDeleteHistory, batchRateHistory, batchSaveAssets,
    bindHistoryUpdates, unbindHistory, alignHistoryToCanvas, bindHistoryFilters, unbindHistoryFilters,
    openHistoryView, resetHistoryRequest, historySignature,
  }
}

export type HistoryScope = ReturnType<typeof createHistoryScope>

