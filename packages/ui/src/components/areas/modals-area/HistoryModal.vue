<script setup lang="ts">
// 生成历史弹窗：masonry 瀑布流、预览、详情与批量操作。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X, Grid2x2, LayoutGrid, ChevronDown, ArrowDownUp, ListChecks, Video, Image as ImageIcon, AudioLines, CheckSquare, Download } from 'lucide-vue-next'
import AppDialog from '../../AppDialog.vue'
import { scrollViewportOf } from '../../scrollPane'
// 浮层里的控件从画布 ctx 的 ui 注册表按名取（默认主题插件登记）。
import { useUiComponent } from '@mini-canvas/canvas-render'
import { useMasonry } from '../../../composables/useMasonry'
import { uiComponentOf, useUi, useUiComponentOutside } from '../../../composables/ui'
import { historySignatureOf } from '../../../composables/historySignature'
import { esc, formatBytes, formatDuration, mediaAspect } from './historyCardText'
import { useHistoryZoom } from './useHistoryZoom'
import { useHistoryPreview, type HistoryDetailItem } from './useHistoryPreview'
import HistoryDetailDialog from './HistoryDetailDialog.vue'
import { useHistoryLoadMore } from './useHistoryLoadMore'
import { createHistoryCardDom } from './historyCardDom'
import { useHistoryWallApps } from './useHistoryWallApps'
import { createHistoryCard, type HistItem } from './createHistoryCard'
import { createApp, h, type App as VueApp, type Component } from 'vue'

const ui = useUi()
const Button = useUiComponent('Button')
const Tabs = useUiComponent('Tabs')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')
const Slider = useUiComponent('Slider')
const DropdownMenu = useUiComponent('DropdownMenu')
const DropdownMenuContent = useUiComponent('DropdownMenuContent')
const DropdownMenuItem = useUiComponent('DropdownMenuItem')
const DropdownMenuTrigger = useUiComponent('DropdownMenuTrigger')
/** 历史卡片墙滚动层：组件库 ScrollArea（用户口径 2026-11-04）。 */
const ScrollArea = useUiComponent('ScrollArea')
/** 全屏预览走 ui 目录：换主题时一起换；取件晚到时预览晚一步出现，不会白屏。 */
const MediaViewer = useUiComponentOutside('mediaViewer')
const s = ui.state

/**
 * 评级相关 UI 的开关（用户口径 2026-10-27：「评级功能相关 UI 隐藏掉，不删除，直接隐藏即可」）。
 *
 * 评级目前是占位（归档时一律写 passed），摆出来的筛选与批量按钮只是假控件。
 * 这里保留全部逻辑与样式，只把入口收起来；将来真做了审核流程，把 true 改回来即可。
 */
const SHOW_RATING_UI = false

/** 类型页签点选：再点当前项等于取消筛选（沿用原来「可取消」的交互）。 */
function onHistTypeTabs(value: unknown): void {
  const next = String(value)
  s.histType = s.histType === next ? '' : next
}

const kindIcon = (k: string) => (k === '视频' ? Video : k === '音频' ? AudioLines : ImageIcon)

const { thumbOf, previewableUrl, historyPreviewGroup, previewItem, openHistoryItem } = useHistoryPreview(ui)

/** 点开「详情」的那一条历史（生成参数弹窗的数据源） */
const detailItem = ref<HistoryDetailItem | null>(null)

// ==================== Masonry 瀑布流（照 web2api TaskResultGalleryView 搬入） ====================
const masonry = useMasonry()
const MASONRY_ID = 'hist-masonry'
const ITEM_CLASS = 'hist-masonry-item'
const GUTTER = 16
/** 首屏只渲染 24 张，滚动到底再追加，避免一次创建全部 img 节点 */
const renderedCount = ref(24)
const masonryEl = ref<HTMLElement | null>(null)
/** 下一页加载哨兵（用户口径 2026-10-15：禁止滚动触发 —— 哨兵进可视区才拉下一页） */
const loadSentinelEl = ref<HTMLElement | null>(null)
/**
 * 已被**有意摘掉**的历史条目（坏资源、且「显示异常」开关关着时整格移除）。
 *
 * 为什么必须记：这些条目在数据里仍然存在，但 DOM 里本来就不该有卡。补漏逻辑如果只看
 * 「数据里有、DOM 里没有」，就会把摘掉的卡再画回来 —— 再加载失败、再摘，形成无限循环
 * （2026-10-30 用户实测：视频/音频页签持续闪烁、一直加载，电脑被拖崩）。
 * 记进来之后，补画与 canLoadMore 都跳过它们，并且**永不重画**（除非换筛选/重开面板）。
 */
const droppedHistoryIds = new Set<string>()
let lastColumnWidth = 0
let relayoutTimer: ReturnType<typeof setTimeout> | null = null
let rebuilding = false
/** 筛选切换标记：数据 watch 见到它就整墙重建，不把新数据当"追加分页"接上 */
let filterSwitching = false

const {
  BATCH_SIZE,
  canLoadMore,
  maybeLoadMorePage,
  fillViewportIfNeeded,
  syncRenderedCountWithWall,
  readLoadState,
  setupLoadSentinel,
  teardownLoadSentinel,
  observeLastItem,
  dispose: disposeLoadMore,
} = useHistoryLoadMore({
  s,
  ui,
  masonryEl,
  loadSentinelEl,
  renderedCount,
  droppedHistoryIds,
  lastColumnWidth: () => lastColumnWidth,
  appendMasonryItems: (from, to) => appendMasonryItems(from, to),
})

const {
  buildCheckOverlay,
  buildFactsLine,
  finishCard,
  buildErrorCard,
  buildDetailButton,
} = createHistoryCardDom({
  isBatchMode: () => s.histBatchMode,
  selectedIds: () => s.histSelectedIds,
  onCardClick,
  onAudioCardClick,
  onToggleSelected: toggleHistSelected,
  onDetail: (item) => { detailItem.value = item as HistItem },
  onBroken: showBrokenResourceCard,
  onRelayout: scheduleImageRelayout,
  previewComponent: (name) => uiComponentOf(name) as Component | undefined,
  registerCardApp: (card, app) => { appOfCard.set(card, app) },
})

const {
  wallCache,
  mountedWallKey,
  MOUNTED_WALL,
  appOfCard,
  appsOfWall,
  unmountCardApp,
  unmountMountedApps,
  rekeyWallApps,
  trimWallCache,
} = useHistoryWallApps()
/**
 * histZoom 滑杆 → 最小卡片宽度（px）：滑杆越大卡片越大、列数越少。
 * 瀑布流的列数随容器宽度自适应（calcColumns），这里只提供「最小列宽」。
 */
const minCardSize = computed(() => ({ 1: 340, 2: 280, 3: 220, 4: 170 }[s.histZoom] ?? 220))

const { ZOOM_MIN, ZOOM_MAX } = useHistoryZoom(s)

/** Slider 回写：值是数组，取第一档；卡在 1~4 之间，防止外部传进越界值。 */
function onZoomChange(value: number[] | undefined): void {
  const next = Number(value?.[0] ?? s.histZoom)
  if (!Number.isFinite(next)) return
  s.histZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next)))
}

/** 容器宽 + 最小列宽 → 实际列数与列宽（列宽均分撑满容器） */
function calcColumns(containerWidth: number): { cols: number; columnWidth: number } {
  const cols = Math.max(1, Math.floor((containerWidth + GUTTER) / (minCardSize.value + GUTTER)))
  const columnWidth = Math.floor((containerWidth - GUTTER * (cols - 1)) / cols)
  return { cols, columnWidth }
}

/**
 * 「这一份数据是哪套筛选的」—— 与 ui.ts 里拉数据时的签名同源（不含显示开关）。
 * 数据 watch 用它判断「这次是新数据还是换了筛选」，与墙的 key 区分开。
 */
function historyDataKey(): string {
  return historySignatureOf(
    {
      scope: s.histScope,
      type: s.histType,
      rating: s.histRating,
      sortDesc: s.histSortDesc,
      pageSize: s.histPageSize,
    },
    ui.currentCanvasId.value,
  )
}

/** 当前页签的墙缓存键（完整筛选签名 + 显示开关；改列数/排序/范围都会换键） */
function historyWallKey(): string {
  /**
   * 「显示异常」也必须是 key 的一部分（2026-10-30 复测：打开开关后视频仍 14 张、占位卡 0）。
   * 开关会改变墙上该有哪些卡（回填占位 or 整条摘掉）；不带这一维，switchWall() 会用
   * 同一 key 的旧墙（14 张、无占位）把刚重建的新墙覆盖回去 —— 用户看到"开关没反应"。
   */
  return historyDataKey() + '|' + (s.histShowError ? 'e1' : 'e0')
}

/**
 * 进入/退出批量模式：**只就地增删勾选层**，绝不重建卡片墙。
 *
 * 用户口径 2026-10-28：点批量操作时整面墙重画，视频黑一下、音频波形重建，数据一多很难受。
 * 卡片本身没有任何变化（勾选层是绝对定位的独立按钮），逐张增删即可。
 */
function toggleBatchMode(): void {
  s.histBatchMode = !s.histBatchMode
  s.histSelectedIds = []
  // 进入批量模式：正在播的媒体先停掉（用户口径 2026-10-29：批量模式下不再播放/暂停，
  // 正在播的视频直接暂停；否则整卡点击=勾选之后，用户再也点不到暂停按钮）。
  if (s.histBatchMode) pauseAllHistoryMedia()
  syncBatchOverlays()
}

/**
 * 批量模式下「整卡点击 = 勾选」：把卡片里所有会吞点击的媒体层停掉并让出指针。
 *
 * 为什么要停播放：卡片上不再显示播放/暂停键（CSS 隐藏），插件内部的播放键与波形 seek
 * 也都被关掉 —— 正在播的视频会一直响，用户却没有任何入口停下（用户实测报的）。
 */
function pauseAllHistoryMedia(): void {
  const container = masonryEl.value
  if (!container) return
  for (const el of container.querySelectorAll<HTMLMediaElement>('.hist-card video, .hist-card audio')) {
    try {
      el.pause()
    } catch {
      /* 未就绪的媒体暂停会抛，忽略 */
    }
  }
}

/** 按当前批量状态，给已画出来的卡片增删勾选层（批量模式关着时全摘掉） */
function syncBatchOverlays(): void {
  const container = masonryEl.value
  if (!container) return
  for (const card of container.querySelectorAll<HTMLElement>('.hist-card')) {
    const id = card.dataset.histId
    const existing = card.querySelector('.hist-card-check')
    if (s.histBatchMode && id && !existing) {
      card.appendChild(buildCheckOverlay(id))
    } else if (!s.histBatchMode && existing) {
      existing.remove()
    }
    /**
     * 批量态标记要**在这里同步**，不能只在建卡时判断。
     * 旧写法只在 createMasonryElement / buildMediaCard 里加 hist-card--batch：
     * 卡片是先建好再进批量模式的，于是「先打开面板 → 再点批量操作」时标记永远不生效，
     * 音频波形继续吃指针（用户 2026-10-29 实测：批量模式下点音频卡没反应）。
     */
    card.classList.toggle('hist-card--batch', s.histBatchMode)
  }
}

/**
 * 有产物地址、但图片实际打不开（文件被清理 / 换地址）：这也算异常。
 *
 * 「显示异常」关着时**整条不显示** —— 用户的口径是"开关关着就不该看到异常卡"，
 * 只把红卡换成灰卡仍然算异常卡（实测 2026-10-27：关掉后还剩 2 张灰卡）。
 * 开着时才换成中性卡（用"资源走丢"而不是"生成失败"，因为生成其实成功过）。
 */
function showBrokenResourceCard(card: HTMLElement, item: HistItem): void {
  if (!s.histShowError) {
    // 这张卡马上要被摘掉：先把它自己的播放器应用卸掉（否则视频还在后台解码/请求）。
    unmountCardApp(card)
    // 登记成"已摘":补漏逻辑据此不再把它画回来（防 补画→失败→摘 的无限循环）
    if (item.id) droppedHistoryIds.add(item.id)
    // 连外层瀑布流格子一起摘掉：只删内层卡会留下一个空白的列位（视觉上空一格）
    const slot = card.closest('.hist-masonry-item') ?? card
    /**
     * 必须走 masonry.remove（内部先摘项再 layout）。
     * 旧写法 `slot.remove()` + `layout()`：Masonry 仍把这一格当有效项，
     * 位置上留着空洞，后面的卡看起来就是错位的（用户口径 2026-10-28）。
     * 而且实例是异步建的，那一刻可能还没有实例 —— 交给 layoutWhenReady 兜住。
     */
    masonry.remove([slot as HTMLElement])
    slot.remove()
    // 摘掉一张后列表可能仍不足一屏：让哨兵重新评估
    nextTick(fillViewportIfNeeded)
    return
  }
  const fallback = buildErrorCard(item, { missingResource: true })
  if (s.histBatchMode && item.id) fallback.appendChild(buildCheckOverlay(item.id))
  // 替换出来的占位卡同样要带 id（否则补漏把它当成漏画，反复重建）
  if (item.id) fallback.dataset.histId = item.id
  // 卡片被替换掉：它自己的播放器应用必须先回收，否则视频还在后台跑（看不见但占 CPU/解码器）
  unmountCardApp(card)
  card.replaceWith(fallback)
  masonry.layoutWhenReady()
}

/**
 * 点卡片：
 * - 普通模式 → 打开预览；
 * - 批量模式 → **整卡都能勾选/取消**（用户口径 2026-10-27：不想只点左上角小圆点）。
 *   点左上角那个圆钮仍走它自己的 stopPropagation，不会重复切换。
 */
function toggleHistSelected(id: string): void {
  const i = s.histSelectedIds.indexOf(id)
  if (i >= 0) s.histSelectedIds.splice(i, 1)
  else s.histSelectedIds.push(id)
  // 重新刷这张卡的勾选态（覆盖层 class）
  const el = masonryEl.value?.querySelector('[data-hist-id="' + id + '"] .hist-card-check')
  if (el) el.classList.toggle('is-on', s.histSelectedIds.includes(id))
}

function onCardClick(item: HistItem): void {
  if (!s.histBatchMode) {
    openHistoryItem(item)
    return
  }
  if (item.id) toggleHistSelected(item.id)
}

/**
 * 点音频卡：**不打开全屏预览** —— 用户口径 2026-10-28：点音频要能直接拖波形换进度。
 * 批量模式下整卡仍然负责勾选（波形那层会被 CSS 关掉 pointer-events，点哪都落到卡上）。
 */
function onAudioCardClick(item: HistItem): void {
  if (s.histBatchMode && item.id) toggleHistSelected(item.id)
}

const { buildMediaCard, createMasonryElement } = createHistoryCard({
  s,
  thumbOf,
  previewableUrl,
  openHistoryItem,
  droppedHistoryIds,
  uiComponentOf,
  finishCard,
  buildErrorCard,
  buildDetailButton,
  buildFactsLine,
  buildCheckOverlay,
  showBrokenResourceCard,
  onCardClick,
  onAudioCardClick,
  scheduleImageRelayout,
  wallApps: { appsOfWall, appOfCard, MOUNTED_WALL },
})
/**
 * 完整重建瀑布流（**只在没有可复用墙时**用：首次打开 / 数据整表换掉 / 没有缓存）。
 *
 * 注意：这里是唯一会创建新卡片 DOM 的地方 —— 视频重新加载、音频重建波形都发生在这一步。
 * 日常切页签走的是 switchWall()（复用旧墙），不会进这里。
 */
function rebuildMasonry(): void {
  const container = masonryEl.value
  if (!container || rebuilding) return
  rebuilding = true
  masonry.destroy()
  // 整墙重建是唯一批量新建卡片的路径：先把旧墙的应用全部卸载，否则每次重建都多留一批
  // 活着的 <video>/<audio>（用户实测「进视频/音频页一直闪烁、一直加载」的根因）。
  unmountMountedApps()

  const containerWidth = container.clientWidth
  if (containerWidth === 0) { rebuilding = false; return }
  const { columnWidth } = calcColumns(containerWidth)
  lastColumnWidth = columnWidth
  container.innerHTML = ''
  mountedWallKey.value = ''

  const items = ui.histVisible.value.slice(0, renderedCount.value)
  for (const item of items) {
    const wrapper = buildWallWrapper(item, columnWidth)
    if (wrapper) container.appendChild(wrapper)
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!masonryEl.value) { rebuilding = false; return }
      masonry.init(masonryEl.value, { itemSelector: '.' + ITEM_CLASS, columnWidth, gutter: GUTTER })
      rebuilding = false
      // 记**墙的 key**（含显示开关）：记成数据签名的话，开关一开（key 多一位 e1）
      // 每次数据更新都会被判成「换了筛选」，整面墙反复重建 —— 视频一直重载。
      mountedWallKey.value = historyWallKey()
      observeLastItem()
      // 整墙重建后哨兵元素可能被换掉/才刚出现：统一在这里补挂一次观察器
      setupLoadSentinel()
      // 卡片数量可能仍不足一屏（首屏大量记录被"显示异常"过滤掉）：主动补拉下一页，
      // 不能等 observer 回调 —— 哨兵一直可见时它不会二次触发（用户实测 2026-10-28）。
      fillViewportIfNeeded()
    })
  })
}

/**
 * 统一建格子入口：三条建墙路径（rebuild / append / prepend）都走它。
 *
 * 为什么收口：被跳过的卡（不可预览的媒体）必须整个格子都不出现；各路径各写一份
 * 迟早漏掉一条，格子会留下空列位。返回 null = 这条不该画。
 */
function buildWallWrapper(item: HistItem, columnWidth: number): HTMLElement | null {
  const card = createMasonryElement(item)
  // 不可预览且显示异常关着：createMasonryElement 会返回带 histSkip 标记的空壳，整格不画
  if (card.dataset.histSkip === '1') return null
  const wrapper = document.createElement('div')
  wrapper.className = ITEM_CLASS
  wrapper.style.width = columnWidth + 'px'
  wrapper.style.marginBottom = GUTTER + 'px'
  wrapper.appendChild(card)
  return wrapper
}

/** 只把新增一批交给 Masonry（保留已有 DOM 与滚动位置） */
function appendMasonryItems(from: number, to: number): void {
  const container = masonryEl.value
  if (!container || from >= to) return
  const items = ui.histVisible.value
  /**
   * 按「墙上已经画过的 id」过滤（用户实测 2026-10-29：切回页签出现一张重复卡）。
   * 缓存墙挂回后 renderedCount 与数据下标可能短暂错位 —— 数据 append 时把墙上
   * 已有的条目再画一遍。DOM 里的 id 是唯一真相：出现过的绝不重画。
   */
  const drawnIds = new Set(
    [...container.querySelectorAll('[data-hist-id]')].map((el) => (el as HTMLElement).dataset.histId),
  )
  const columnWidth = lastColumnWidth || calcColumns(container.clientWidth).columnWidth
  const wrappers = items.slice(from, to).filter((item) => {
    if (item.id && drawnIds.has(item.id)) return false
    if (item.id) drawnIds.add(item.id)
    return true
  }).map((item) => {
    return buildWallWrapper(item, columnWidth)
  }).filter((w): w is HTMLElement => !!w)
  masonry.append(wrappers)
  observeLastItem()
  fillViewportIfNeeded()
}

/**
 * 新任务到达：在墙的最前面插入 `count` 张卡（只动新卡，已有卡片一张都不重建）。
 *
 * 用户口径 2026-10-28：新任务应该能被看到，但不能因此让视频黑一下、音频波形重建。
 * 新卡来自 `histVisible` 的前 count 条；页码和滚动位置保持不变。
 */
function prependMasonryItems(count: number): void {
  const container = masonryEl.value
  if (!container || count <= 0) return
  const columnWidth = lastColumnWidth || calcColumns(container.clientWidth).columnWidth
  // 插到最前面同样按墙上已有 id 去重（新任务与缓存墙挂回的时序竞争里，同一条可能已在墙上）
  const drawnIds = new Set(
    [...container.querySelectorAll('[data-hist-id]')].map((el) => (el as HTMLElement).dataset.histId),
  )
  const wrappers = ui.histVisible.value.slice(0, count).filter((item) => {
    if (item.id && drawnIds.has(item.id)) return false
    if (item.id) drawnIds.add(item.id)
    return true
  }).map((item) => {
    return buildWallWrapper(item, columnWidth)
  }).filter((w): w is HTMLElement => !!w)
  masonry.prepend(wrappers)
  renderedCount.value = Math.min(renderedCount.value + count, ui.histVisible.value.length)
  // 数据整体多了一条：异常卡过滤掉的那部分也要跟着参与"还能不能加载"的判断
  observeLastItem()
}

/** 卡片墙的滚动容器（ScrollArea 内部的 viewport，触底加载与位置恢复都读它） */
function historyScroller(): HTMLElement | null {
  return scrollViewportOf(masonryEl.value)
}

/**
 * 图片陆续加载完时的重排节流（用户口径 2026-10-28：30 张图快的快、慢的慢）。
 *
 * 每张图 load 都立刻 layout 一次，会让整面墙在一两秒里被反复推来推去；
 * 这里合并到一帧里只排一次 —— 先加载完的图仍然立即显示（不等待全部）。
 */
let imageRelayoutRaf = 0
function scheduleImageRelayout(): void {
  if (imageRelayoutRaf) return
  imageRelayoutRaf = requestAnimationFrame(() => {
    imageRelayoutRaf = 0
    masonry.layoutWhenReady()
  })
}

/**
 * 把当前墙收进缓存（切走页签 / 关面板时调用）。
 * 只挪 DOM、不删节点：墙里所有视频/音频/图片实例原样保留，切回来直接挂回。
 */
function stashCurrentWall(): void {
  const container = masonryEl.value
  if (!container) return
  const key = mountedWallKey.value || historyWallKey()
  if (!container.querySelector('.' + ITEM_CLASS)) return
  const wall = container.cloneNode(false) as HTMLElement
  wall.removeAttribute('id')
  wall.className = 'hist-masonry hist-masonry--stashed'
  while (container.firstChild) wall.appendChild(container.firstChild)
  trimWallCache()
  wallCache.set(key, {
    wall,
    // 以**实际画出来的卡片数**为准：renderedCount 是跨页签共用的，直接记它会把
    // 上一个页签的数字带进来（真机 2026-10-28：视频只有 11 张，记账却是 26）
    count: wall.querySelectorAll('.' + ITEM_CLASS).length,
    signature: historyDataKey(),
    columnWidth: lastColumnWidth,
    scrollTop: historyScroller()?.scrollTop ?? 0,
  })
  // DOM 搬进缓存快照了，但应用还活着（有意：切回来不用重建）。登记项跟着换名，
  // 这样这面墙被 LRU 逐出时能精确卸载它自己的播放器。
  rekeyWallApps(MOUNTED_WALL, key)
  mountedWallKey.value = ''
  masonry.destroy()
}

/**
 * 切到当前页签的墙：有缓存就把旧墙整块挂回来（不重建媒体元素），没有才重建。
 *
 * 用户口径 2026-10-28：切页签时视频黑一下、音频波形重建 —— 根因就是每次切都
 * destroy + create。这里把「墙」当成一份可保存的状态：切走时挪进 wallCache，
 * 切回来原样挂回，连滚动位置一起恢复。
 */
function switchWall(): void {
  const container = masonryEl.value
  if (!container) return
  const key = historyWallKey()
  /**
   * 容器宽度必须是"真的量到"的。首次打开 / 重开面板时这一帧可能还是 0
   * （弹窗刚 mount、样式还没算），用 0 去算列宽会得到错误的格子宽度，
   * 卡片就会排成一团，直到拖一下缩放滑杆才恢复（用户口径 2026-10-28）。
   * 所以量不到就退到 ResizeObserver 再量一次，绝不用 0/旧值硬建。
   */
  if (container.clientWidth <= 0) {
    requestAnimationFrame(() => {
      if (!s.historyOpen) return
      switchWall()
    })
    return
  }
  if (mountedWallKey.value === key && container.querySelector('.' + ITEM_CLASS)) {
    // 已经是这面墙：只补挂观察器（数据可能刚变过）
    masonry.layout()
    setupLoadSentinel()
    return
  }
  if (mountedWallKey.value && mountedWallKey.value !== key) stashCurrentWall()

  const cached = wallCache.get(key)
  const containerWidth = container.clientWidth
  const columnWidth = calcColumns(containerWidth).columnWidth
  if (cached) {
    container.innerHTML = ''
    while (cached.wall.firstChild) container.appendChild(cached.wall.firstChild)
    wallCache.delete(key)
    // 从缓存挂回来：应用一直是活的（那正是切页签不闪的原因），登记项跟着改回「挂载中」。
    rekeyWallApps(key, MOUNTED_WALL)
    renderedCount.value = cached.count
    lastColumnWidth = cached.columnWidth
    mountedWallKey.value = key
    /**
     * 列宽变了（拖过缩放滑杆 / 容器宽度变了）也**只改宽度**，不重建卡片：
     * 重建就等于把视频重新加载一遍。 */
    if (cached.columnWidth !== columnWidth) {
      container.querySelectorAll<HTMLElement>('.' + ITEM_CLASS).forEach((w) => { w.style.width = columnWidth + 'px' })
      lastColumnWidth = columnWidth
    }
    // 先把卡片挂回来再把实例指回去：masonry.init 认容器里的现有子节点
    masonry.init(container, { itemSelector: '.' + ITEM_CLASS, columnWidth: lastColumnWidth, gutter: GUTTER })
    syncBatchOverlays()
    observeLastItem()
    setupLoadSentinel()
    const view = historyScroller()
    if (view) view.scrollTop = cached.scrollTop
    fillViewportIfNeeded()
    return
  }
  // 没有可复用墙（或列宽变了）：这张卡从头建，属于必要的一次
  mountedWallKey.value = ''
  rebuildMasonry()
}

/** 滑杆 / 容器宽度变化：只改列宽后重排（保留 DOM，masonry 自带过渡动画） */
function relayoutMasonry(): void {
  const container = masonryEl.value
  if (!container) return
  const containerWidth = container.clientWidth
  if (containerWidth === 0) return
  const { columnWidth } = calcColumns(containerWidth)
  if (columnWidth === lastColumnWidth) return
  lastColumnWidth = columnWidth
  /**
   * 缩放到"当前一张都没渲染"的状态时（切筛选 / 首次打开都可能），
   * 只改列宽没有任何意义 —— 必须整墙重建，否则画面会一直空着（真机 2026-10-28：
   * 动一下缩放滑杆，整个历史面板就空白了，滚也回不来）。
   */
  if (!container.querySelector('.' + ITEM_CLASS)) {
    nextTick(rebuildMasonry)
    return
  }
  const wrappers = container.querySelectorAll<HTMLElement>('.' + ITEM_CLASS)
  wrappers.forEach((w) => { w.style.width = columnWidth + 'px' })
  masonry.setColumnWidth(columnWidth)
}

function onContainerResize(): void {
  if (relayoutTimer) clearTimeout(relayoutTimer)
  relayoutTimer = setTimeout(relayoutMasonry, 150)
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  resizeObserver = new ResizeObserver(onContainerResize)
})

// 弹窗打开 / 筛选变化 / 滑杆变化 / 数据到位 → 重建或重排
watch(() => s.historyOpen, (open) => {
  if (!open) {
    stashCurrentWall()
    teardownLoadSentinel()
    if (resizeObserver && masonryEl.value) resizeObserver.unobserve(masonryEl.value)
    return
  }
  // 首屏还没数据时不要夹到 1：否则数据回来后 renderedCount=1，会跳过第 1 张卡、
  // 只走"追加"路径（容器刚出现、瀑布流还没 init，append 直接空转）。
  if (renderedCount.value === 0) renderedCount.value = BATCH_SIZE
  nextTick(() => {
    switchWall()
    setupLoadSentinel()
    if (masonryEl.value) resizeObserver?.observe(masonryEl.value)
  })
})
watch(() => [s.histScope, s.histType, s.histRating, s.histSortDesc] as const, () => {
  if (!s.historyOpen) return
  filterSwitching = true
  /**
   * 换筛选 = 换一整套数据：已摘集合必须清空。
   * 不清的话，同一条记录在别的页签里就永远不画了（摘除是"这一轮墙里别画"，不是永久拉黑）。
   */
  droppedHistoryIds.clear()
  /**
   * 切筛选：**不销毁当前墙**，交给数据 watch 调 switchWall()。
   * 旧实现先 destroy + 清空容器，等于抖一下白屏；视频黑屏、音频重画都从这里来。
   * 目标页签有缓存墙时，switchWall 会在一帧内把完整墙面挂回去。
   */
})
/**
 * 数据版本变化（loadHistory 落表就 +1）：用版本号而不是数组长度感知更新 ——
 * 翻页后长度可能恰好不变（都是满页），长度 watch 会漏触发，画面就停在旧筛选的卡上。
 * 追加分页 → 只补新增的卡；筛选切换（filterSwitching 被置位）→ 整墙重建。
 */
watch(() => s.histDataVersion, async () => {
  const len = ui.histVisible.value.length
  if (!s.historyOpen) return
  /**
   * 是否切了页签：除了筛选 watch 的标记，再用"墙上记的键 ≠ 当前键"兜底。
   * 两个 watch 的触发顺序不保证，只看标记会在某些时序下把新页签当成追加。
   */
  const switching = filterSwitching || (mountedWallKey.value !== '' && mountedWallKey.value !== historyWallKey())
  if (switching) {
    filterSwitching = false
  }
  /**
   * 容器是 v-if（有可见数据才渲染）：面板比数据先打开时，rebuildMasonry 当时
   * masonryEl 还是 null、瀑布流没 init。数据到位后如果只走 append，瀑布流永远不初始化
   * —— 卡片会按原生块元素排成一列，且底下的加载哨兵也没人观察（用户实测 2026-10-27）。
   * 所以这里统一"没实例就整墙重建"：既补上 init，也从第 1 张卡开始画。
   */
  /**
   * 筛选切换也走"整墙重建"：不重建就会留在旧筛选的卡片上
   * （用户实测 2026-10-28：点"音频"，网络里已经在拉 audio，画面还是图片）。
   * 只有"同一筛选下又拉到新数据"（分页追加）才走 append 分支。
   */
  /**
   * 回填多页时也整墙重建：几页数据会接连落表，中间那几拍 append 到还没 init 的墙上
   * 会全部丢失（真机 2026-10-28：切回图片，31 条只画出 17 张）。
   */
  /**
   * 回填还没走完（后面还有页）时**先不建墙**：这一拍重建只会画出第 1 页那 24 张，
   * 后续页到达时墙已 init，被当成普通 append —— 但旧 DOM 已被清空，只剩一部分卡。
   * 等 histRestoring 落到 false 的那一拍统一重建一次，31 条全在。
   */
  /**
   * 已经挂着的墙还能接新卡（切回页签时后台同步多出来的新任务就是这样）：
   * 必须在"切页签/回填"判断之前识别，否则这一拍只切墙、新卡全丢。
   */
  await nextTick()
  const wallReadyForAppend = !!masonry.instance.value && mountedWallKey.value === historyWallKey() && !switching
  if (wallReadyForAppend && renderedCount.value < len) {
    const from = renderedCount.value
    renderedCount.value = Math.min(from + BATCH_SIZE, len)
    await nextTick()
    appendMasonryItems(from, renderedCount.value)
    setupLoadSentinel()
    return
  }
  if (s.histRestoring) {
    await nextTick()
    setupLoadSentinel()
    return
  }
  const mode = s.histUpdateMode
  /**
   * 数据签名换了（例如首次进视频页签）：这一拍不是"追加/插新"，必须整墙重建。
   * 否则会把 A 页签的墙当 B 页签的墙继续用（真机 2026-10-28：图片↔视频来回切后卡数错乱）。
   */
  // 这里比的是**数据**签名：墙的 key 多了显示开关那一维，拿它比会永远不相等
  if (s.histSignature !== historyDataKey()) {
    renderedCount.value = Math.min(BATCH_SIZE, len)
    await nextTick()
    rebuildMasonry()
    setupLoadSentinel()
    return
  }
  await nextTick()
  if (switching) {
    // 切页签：有缓存墙就整块挂回（不重建媒体），没有才新建
    switchWall()
    setupLoadSentinel()
    await nextTick()
    fillViewportIfNeeded()
    return
  }
  if (mode === 'prepend' && s.histUpdateCount > 0) {
    // 新任务：只把新卡插到最前面，已有卡片（含正在播的视频）一张都不动
    prependMasonryItems(s.histUpdateCount)
  } else if (mode === 'append') {
    const to = Math.min(renderedCount.value + BATCH_SIZE, len)
    const from = renderedCount.value
    if (from < to) {
      renderedCount.value = to
      await nextTick()
      appendMasonryItems(from, to)
    }
  } else if (!masonry.instance.value && len > 0) {
    renderedCount.value = Math.min(BATCH_SIZE, len)
    await nextTick()
    rebuildMasonry()
  } else if (renderedCount.value > len) {
    // 数据变少（异常回落）：整墙重建兜底
    renderedCount.value = Math.min(BATCH_SIZE, len)
    await nextTick()
    rebuildMasonry()
  } else if (renderedCount.value < len) {
    const from = renderedCount.value
    /**
     * 一次只接一批（BATCH_SIZE），不要把剩余全部一次渲染完 ——
     * 一次全渲染会让哨兵立刻满足"到底了"被摘掉，短列表里就再也触发不到下一批。
     */
    renderedCount.value = Math.min(from + BATCH_SIZE, len)
    await nextTick()
    appendMasonryItems(from, renderedCount.value)
  }
  // 哨兵是 v-if（数据 + hasMore）渲染的：数据到位之前它不在 DOM 里，setup 时只能空手而归。
  // 这里在 DOM 更新完再挂一次 —— 否则"先开面板、后到数据"时永远等不到翻页（用户实测 2026-10-27）。
  // 同一元素重复调用会被 setup 里的幂等判断挡掉，不会重复观察。
  await nextTick()
  setupLoadSentinel()
})
watch(() => s.histZoom, () => {
  if (!s.historyOpen) return
  // 缩放变化后列宽可能不变（同一档），也必须保证墙上有卡可显示。
  nextTick(() => {
    const container = masonryEl.value
    const empty = !container || !container.querySelector('.' + ITEM_CLASS)
    if (empty) rebuildMasonry()
    else relayoutMasonry()
    fillViewportIfNeeded()
  })
})
/**
 * 瀑布流容器是 v-if（有可见数据才出现）。数据来得比面板晚时，容器挂载那一刻
 * 才是"可以 init"的时机 —— 只靠数据版本 watch 里的 nextTick 仍可能早于子节点挂载完。
 * 观察到容器出现就补一次重建（已有实例时 rebuildMasonry 内部有 rebuilding 守卫，
 * 不会重复初始化）。
 */
watch(masonryEl, (el) => {
  if (!el || !s.historyOpen) return
  if (masonry.instance.value) return
  nextTick(rebuildMasonry)
})
// 显示异常开关：切换会过滤/恢复无产物的卡 → 整墙重建（含批量勾选层）
watch(() => s.histShowError, () => {
  if (s.historyOpen) {
    // 打开"显示异常"要把之前摘掉的条目重新认作可画：它们这时会画成中性异常卡，不该再被跳过
    droppedHistoryIds.clear()
    /**
     * 旧墙缓存一律丢弃：key 现在带开关位，旧 key 的墙再也挂不回来，留着只是内存垃圾；
     * 更要紧的是避免任何"开关前那面 14 张的墙"被误挂回（用户实测：开了开关还是 14 张）。
     */
    wallCache.clear()
    renderedCount.value = Math.min(BATCH_SIZE, ui.histVisible.value.length)
    // 缓存里的旧墙再也不会挂回来（key 已变）：连同它们的播放器一起回收。
    // 当前正在显示的那面墙由紧接着的 rebuildMasonry 负责卸载。
    unmountMountedApps('*')
    nextTick(() => {
      rebuildMasonry()
      // 过滤后卡片数可能不足一屏：哨兵还在，但瀑布流重建过；重新确认观察器仍然指向当前元素
      nextTick(setupLoadSentinel)
    })
  }
})
onBeforeUnmount(() => {
  masonry.destroy()
  // 弹窗卸载：墙缓存里和当前墙上的播放器应用一并回收（否则关掉面板后视频/音频仍在后台跑）。
  unmountMountedApps('*')
  wallCache.clear()
  disposeLoadMore()
  resizeObserver?.disconnect()
  if (relayoutTimer) clearTimeout(relayoutTimer)
})

</script>

<template>
  <!-- 生成历史：无遮罩大弹窗（照 LibTV 实测 min(90vw,1600px) × calc(100vh-160px)） -->
  <AppDialog :model-value="s.historyOpen" :close-on-overlay="false" :with-overlay="false" width="min(90vw, 1600px)" height="calc(100vh - 160px)"
    radius="24px" @update:model-value="!$event && (s.historyOpen = false)">
    <div class="flex flex-none items-center justify-between gap-4 px-6 pb-3 pt-4">
      <span class="text-lg font-medium leading-[26px] text-ink">生成历史</span>
      <div class="flex items-center gap-4">
        <div class="hist-zoom-wrap flex items-center gap-2 rounded-lg bg-veil p-2" role="group" aria-label="缩放">
          <Grid2x2 :size="16" class="text-ink" />
          <!-- 缩放滑块：组件库 Slider（reka），值是数组；点轨道任意位置也能跳过去 -->
          <Slider class="hist-zoom-slider w-[120px]" :model-value="[s.histZoom]" :min="ZOOM_MIN"
            :max="ZOOM_MAX" :step="1" aria-label="调整卡片宽度（大值列多图小）"
            @update:model-value="onZoomChange" />
          <LayoutGrid :size="16" class="text-ink" />
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭生成历史" @click="s.historyOpen = false">
          <X :size="16" />
        </Button>
      </div>
    </div>
    <div class="h-px flex-none bg-line"></div>
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex flex-none flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div class="flex items-center gap-4">
          <!-- 范围页签：组件库 Tabs 的默认（分段）样式，不额外改外观 -->
          <Tabs :model-value="s.histScope" @update:model-value="(v: unknown) => s.histScope = String(v)">
            <TabsList aria-label="历史范围">
              <TabsTrigger v-for="sc in s.histScopes" :key="sc" :value="sc">
                {{ sc }}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <span class="h-4 w-px bg-line"></span>
          <!-- 类型筛选也是页签，用 line 变体（无胶囊底、选中项下方一条下划线）；
               再点一次当前项 = 取消筛选，所以用 Tabs 的 model-value 自己做开关，
               不走 reka 的「点了必选中」。数字仍是 chip 小标。 -->
          <div class="hist-type-tabs flex items-center gap-1 pl-1">
            <Tabs :model-value="s.histType" @update:model-value="onHistTypeTabs">
              <TabsList variant="line" aria-label="按类型筛选">
                <TabsTrigger v-for="t in s.histTypes" :key="t" :value="t" class="gap-1.5">
                  <span>{{ t }}</span><span
                    class="inline-flex h-4 min-w-4 items-center justify-center rounded bg-chip px-1 text-[11px]">{{
                      ui.histCount(t) }}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <!-- 显示异常开关：只有存在异常记录时出现（默认关 = 不显示异常卡） -->
          <label v-if="ui.histErrorCount.value > 0" class="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] text-ink select-none hover:bg-hover"
            title="显示没有产物的异常记录">
            <input v-model="s.histShowError" type="checkbox" class="hist-error-toggle" aria-label="显示异常记录" />
            显示异常<span class="inline-flex h-4 min-w-4 items-center justify-center rounded bg-chip px-1 text-[11px]">{{ ui.histErrorCount.value }}</span>
          </label>
          <!-- 评级筛选：UI 已隐藏（用户口径 2026-10-27：评级功能还没做，别摆一个假控件）。
               逻辑与样式保留，要恢复时把 v-if 改成 true 即可。 -->
          <template v-if="SHOW_RATING_UI">
            <DropdownMenu v-model:open="s.histRatingOpen">
              <DropdownMenuTrigger as-child><button
                  class="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink transition-colors hover:bg-hover"
                  aria-label="所有评级">{{ s.histRating }}
                  <ChevronDown :size="14" />
                </button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" :style="{ minWidth: '140px' }">
                <DropdownMenuItem v-for="r in ['所有评级', '已通过', '待审核', '已拒绝']" :key="r"
                  @select="s.histRating = r">{{ r }}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
          <span class="h-4 w-px bg-line"></span>
          <button
            class="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink transition-colors hover:bg-hover"
            aria-label="时间倒序" @click="s.histSortDesc = !s.histSortDesc">
            <ArrowDownUp :size="14" /> {{ s.histSortDesc ? '时间倒序' : '时间正序' }}
          </button>
          <button
            class="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink transition-colors"
            :class="s.histBatchMode ? 'bg-brand text-primary-ink hover:bg-brand hover:opacity-90' : 'hover:bg-hover'"
            aria-label="批量操作" @click="toggleBatchMode">
            <ListChecks :size="16" /> {{ s.histBatchMode ? '退出批量' : '批量操作' }}
          </button>
        </div>
      </div>
      <ScrollArea class="min-h-0 flex-1 mr-1">
      <div class="pl-10 pr-9 pb-6">
        <!-- masonry 瀑布流：卡片按图片原始宽高比展示，列数随容器宽自适应（照 TaskResultGalleryView）。
             卡片 DOM 由 createMasonryElement 手工构建（骨架屏/裂图回退/底部信息栏都在那里）。 -->
        <!-- 卡片墙：容器**永远在**（不随数据 v-if 挂载/卸载）。切页签只是把旧墙整块
             收进 wallCache、把目标墙挂回来 —— DOM 不重建，视频不黑、音频波形不重建。
             墙是动态造的空 div，不交给 Vue 管内容（卡片仍由 createMasonryElement 手工建）。 -->
        <div :id="MASONRY_ID" ref="masonryEl" class="hist-masonry"></div>
        <div v-if="s.histLoadingMoreVisible" class="hist-loading" role="status" aria-live="polite">
          <span class="hist-loading-spinner" aria-hidden="true"></span>
          <span class="hist-loading-text">正在加载更多</span>
        </div>
        <!-- 加载下一页哨兵（用户口径 2026-10-15：禁止滚动触发）：它在滚动区最底部，
             进入可视区才拉下一页；两次拉页之间至少隔 1 秒，不会无限连发。 -->
        <!--
          哨兵的渲染条件 = "还能继续加载"：
            · 后端还有下一页（histHasMore），**或者**
            · 已拉到但还没渲染完（renderedCount < 可见条数，每次只渲染 24 张）

          后一条是用户 2026-10-28 报的"滚到底不加载更多"的根因：
          前面几页全部拉完后 histHasMore=false，哨兵被整个从 DOM 移除，
          于是最后那批没渲染的卡片永远没有触发点 —— 画面底部留一大片空白，
          滚到底也不会再动。渲染完最后一页（或后端也没有更多）时才真正隐藏。
        -->
        <!--
          哨兵**常驻**（只要有卡片就渲染），是否真的去加载由脚本里的 canLoadMore 判断。
          以前用 v-if 把它挂在"还有下一页"上：数据一拉完它就消失，之后无论怎么滚都没有
          触发点；而且"数据到了但还没渲染完"这一种情况也会把哨兵一起摘掉。常驻之后
          这两种坑都不存在（元素只有 1px 高、aria-hidden，不影响观感）。
        -->
        <div v-if="ui.histVisible.value.length" ref="loadSentinelEl" class="hist-load-sentinel"
          :data-load-state="JSON.stringify(readLoadState())" aria-hidden="true"></div>
        <!-- 空状态只在**真的一张卡都没有**时出现。
             以前这两个 v-else 挂在"加载哨兵"那个 v-if 上：没有下一页时哨兵不渲染，
             于是列表明明有卡片，底部也会冒出一句"暂无历史记录"（真机截到）。
             现在改成独立 v-if，用自己的条件判断。 -->
        <p v-if="!ui.histVisible.value.length && !s.historyReady" class="pt-24 text-center text-[13px] text-ink/50">
          未连接云端服务 —— 生成历史由后台记录<br />
          <span class="text-[11px] text-ink-mute">用 <code>npx mini-canvas-cloud serve</code> 起服务后即可看到</span>
        </p>
        <p v-else-if="!ui.histVisible.value.length" class="pt-24 text-center text-[13px] text-ink/50">暂无历史记录</p>
      </div>
      </ScrollArea>
      <!-- 批量操作栏（图2 参考效果）：进入批量模式才出现 -->
      <div v-if="s.histBatchMode" class="hist-batch-bar flex flex-none items-center justify-between border-t border-line px-6 py-3">
        <span class="text-[13px] text-ink">已选择 {{ s.histSelectedIds.length }} 项</span>
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" class="text-[13px]" aria-label="批量删除" @click="ui.batchDeleteHistory()">删除</Button>
          <!-- 批量评级：UI 已隐藏（逻辑保留，见 SHOW_RATING_UI 注释） -->
          <Button v-if="SHOW_RATING_UI" variant="ghost" size="sm" class="text-[13px]"
            aria-label="批量评级" @click="ui.batchRateHistory('passed')">评级</Button>
          <Button variant="ghost" size="sm" class="text-[13px]" aria-label="保存到资产" @click="ui.batchSaveAssets()">保存到资产</Button>
          <Button size="sm" class="text-[13px]" aria-label="完成选择" @click="toggleBatchMode">完成</Button>
        </div>
      </div>
    </div>
  </AppDialog>

  <!-- 历史预览：与资产面板同一只 MediaViewer（Esc / 点遮罩 / 右上角关闭；历史不可删 → 不传 onDelete）。
       视频/音频/文本的预览件由 MediaViewer 自己按名取（树外也能取，见 canvas-render 的 uiCatalog）。 -->
    <component :is="MediaViewer" v-if="previewItem && MediaViewer" :item="previewItem" @close="previewItem = null" />

  <HistoryDetailDialog :item="detailItem" @close="detailItem = null" />
</template>

<style scoped src="./HistoryModal.css"></style>
<!--
  ===== masonry 瀑布流卡片样式（非 scoped）=====
  卡片 DOM 由 createMasonryElement / buildMediaCard / buildErrorCard 用 JS 手工创建，
  带不上 Vue scoped 的 data-v 属性 → scoped 样式对它们全部失效。
-->
<style src="./HistoryModal.global.css"></style>
