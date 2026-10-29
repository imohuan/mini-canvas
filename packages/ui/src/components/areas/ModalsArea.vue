<script setup lang="ts">
// 浮层区：快捷键 / 生成历史（masonry 瀑布流）/ TV Director 设置 / Toast。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { X, Grid2x2, LayoutGrid, ChevronDown, ArrowDownUp, ListChecks, Video, Image as ImageIcon, AudioLines, CheckSquare, Download } from 'lucide-vue-next'
import { motion } from 'motion-v'
import AxDialog from '../AxDialog.vue'
import AxDropdown from '../AxDropdown.vue'
import AxMenu from '../AxMenu.vue'
import AxMenuItem from '../AxMenuItem.vue'
import AxScrollArea from '../AxScrollArea.vue'
import AxButton from '../AxButton.vue'
import { MediaViewer } from '@mini-canvas/plugin-theme-default'
import { useMasonry } from '../../composables/useMasonry'
import { uiComponentOf, useUi } from '../../composables/ui'
import { useAgentSettings } from '../../composables/agentSettings'
import { createApp, h, type Component } from 'vue'

const ui = useUi()
const s = ui.state

/**
 * 评级相关 UI 的开关（用户口径 2026-10-27：「评级功能相关 UI 隐藏掉，不删除，直接隐藏即可」）。
 *
 * 评级目前是占位（归档时一律写 passed），摆出来的筛选与批量按钮只是假控件。
 * 这里保留全部逻辑与样式，只把入口收起来；将来真做了审核流程，把 true 改回来即可。
 */
const SHOW_RATING_UI = false

const kindIcon = (k: string) => (k === '视频' ? Video : k === '音频' ? AudioLines : ImageIcon)

/**
 * 「后台对话 / 通知 / 目标预算」的真源在后台 KV（composables/agentSettings，键与路径照着设计定死）。
 * 组件只做绑定与提交：读它给的响应式快照，改它给的写入口 —— 组件里不放第二份本地状态。
 */
const agent = useAgentSettings()

/**
 * 「发送键」下拉：三种取值互斥（Ctrl+回车 / Shift+回车 / 回车），默认 Ctrl+回车。
 * 文案与 hint 都放常量里 —— 判定在 plugin-agent 的 composerKeys，展示顺序在设置页，
 * 两边共用同一组 value，改一处不会静默漂移。
 */
const sendKeyOpen = ref(false)
const SUBMIT_KEY_MODE_OPTIONS = [
  { value: 'ctrl-enter' as const, label: 'Ctrl + 回车', hint: '单独回车换行（默认）' },
  { value: 'shift-enter' as const, label: 'Shift + 回车', hint: '单独回车换行' },
  { value: 'enter' as const, label: '回车', hint: 'Shift + 回车换行' },
]
const sendKeyLabel = computed(
  () => SUBMIT_KEY_MODE_OPTIONS.find((m) => m.value === agent.state.submitKeyMode)?.label ?? 'Ctrl + 回车',
)

/**
 * 目标默认预算输入框：改完（失焦 / 回车）归一化再落 KV，并把归一化结果写回输入框
 * （0 / 空 / 负数都收成 0 = 不限）。不用 v-model：默认预算的真源在后台，本地再绑一个变量就是第三份状态。
 */
function agentBudgetOnChange(e: Event): void {
  const input = e.target as HTMLInputElement
  void agent.setGoalBudget(input.value).then((n) => { input.value = String(n) })
}

/**
 * 历史条目的缩略图地址。
 *
 * 后台给的 urls 可能是**跨端地址**（如 web2api 的 `http://localhost:8033/...`），在别处打不开；
 * 优先用同源的画布资源地址（`/api/canvases/<画布>/resources/<文件名>`）—— 那是后台把产物收下后
 * 稳定可取的形态，浏览器同源、一定能加载。拿不到同源地址才退回原 url。
 */
function thumbOf(item: { kind: string; urls?: string[]; canvasId?: string; nodeId?: string }): string | null {
  const url = item.urls?.[0]
  if (!url) return null
  // 已经是同源 / 相对地址就直接用（后台已把历史存成同源地址）
  if (url.startsWith('/')) return url
  const name = url.split('?')[0]?.split('/').pop() || ''
  if (name && item.canvasId) return '/api/canvases/' + item.canvasId + '/resources/' + name
  return url
}

/** 点开的预览：接主题注册的 MediaViewer（图片放大 / 视频 / 音频原生播放） */
/**
 * 预览项可带**同页签清单**（list / names / kinds / index）—— MediaViewer 本来就认
 * list + index，给它之后自动出现 ← / → 与页码，键盘 ←→ 也能切（与资产面板同层预览
 * 同一条路，2026-10-29 用户口径：生成历史里的卡片预览也要能来回切，不能只看单张）。
 */
const previewItem = ref<{
  name: string
  kind: string
  url: string
  list?: string[]
  names?: string[]
  kinds?: string[]
  index?: number
} | null>(null)

/**
 * 「生成历史卡片预览」的**同页签清单**：当前筛选下（同一个页签 + 排序）能预览的记录
 * 按画面顺序（= 数据顺序，用户看到的顺序）排成一列。
 *
 * 与资产面板的 assetSiblings 同一套取舍：
 *   · **只带当前筛选里的记录** —— 眼睛看到什么，← / → 就只在里面走（所见即所得）；
 *   · 只收有产物的记录 —— 没有产物的（失败/资源走丢）切过去只会一片空白；
 *   · 图片走 thumbOf 同源转换（卡片缩略图用的同一条），视频/音频用原始地址
 *     （改写音视频地址会把 /api/resources/... 拼成画布资源路径 → 加载失败）。
 *
 * 当前这条不在清单里（理论上点开的就是能预览的，异常情况兜底）时返回 null ——
 * 调用方退回单张预览。
 */
function historyPreviewGroup(item: HistItem): {
  list: string[]
  names: string[]
  kinds: string[]
  index: number
} | null {
  const rows = ui.histVisible.value.filter((e) => {
    // 静态判定「这条给得出可预览地址」：没有产物 / 图片转不出同源 / 音视频是跨端
    // 原始地址的，都不进清单（切过去必然是失败页）。
    return !!previewableUrl(e)
  })
  if (!rows.some((e) => e.id === item.id)) return null
  return {
    list: rows.map((e) => previewableUrl(e) as string),
    names: rows.map((e) => e.title),
    kinds: rows.map((e) => e.kind),
    index: Math.max(rows.findIndex((e) => e.id === item.id), 0),
  }
}

/**
 * 这条记录的产物地址**能不能预览**（不真的发请求，只做静态判定）：
 *   · 必须是**本画布服务**的地址（/ 开头）。后台留下的跨端原始地址
 *     （如 web2api 的 http://…:8033/...）在别的环境打不开，切过去必然「加载失败」；
 *     图片走 thumbOf 的「拼资源地址」兜底也一样 —— 后端只认内容哈希文件名，
 *     拼 chat-auto 这类旧文件名必得 400（真机 2026-10-29 实测）。
 *     —— 与「显示异常」开关关着时卡片被隐藏是同一条口径：预览清单里也不该出现。
 */
function previewableUrl(item: HistItem): string | null {
  const url = item.urls?.[0]
  if (!url) return null
  // 图片也一样收紧：原始地址不是本服务地址时，thumbOf 的「拼资源地址」兜底
  // 对旧记录（文件名不是内容哈希）会得到 400，同样打不开 —— 一律不放行。
  return url.startsWith('/') ? url : null
}

/** 点开「详情」的那一条历史（生成参数弹窗的数据源） */
const detailItem = ref<HistItem | null>(null)

// ==================== Masonry 瀑布流（照 web2api TaskResultGalleryView 搬入） ====================
const masonry = useMasonry()
const MASONRY_ID = 'hist-masonry'
const ITEM_CLASS = 'hist-masonry-item'
const GUTTER = 16
/** 首屏只渲染 24 张，滚动到底再追加，避免一次创建全部 img 节点 */
const BATCH_SIZE = 24
const renderedCount = ref(BATCH_SIZE)
const masonryEl = ref<HTMLElement | null>(null)
/** 下一页加载哨兵（用户口径 2026-10-15：禁止滚动触发 —— 哨兵进可视区才拉下一页） */
const loadSentinelEl = ref<HTMLElement | null>(null)
let sentinelObserver: IntersectionObserver | null = null
let lastBatchTime = 0
let lastItemVisible = false
let lastColumnWidth = 0
let relayoutTimer: ReturnType<typeof setTimeout> | null = null
let rebuilding = false
/** 筛选切换标记：数据 watch 见到它就整墙重建，不把新数据当"追加分页"接上 */
let filterSwitching = false

/**
 * 每个页签各自保留一面**已经建好的卡片墙**（DOM + 滚动位置 + 视频/音频实例）。
 *
 * 用户口径 2026-10-28：切页签 / 开批量操作时整面墙重画，视频会黑一下、音频波形会重建，
 * 数据一多很难受。现在切走只是把墙挪到旁边存着，切回来原样挂回 —— 媒体元素完全不重建。
 */
interface WallSnapshot {
  /** 墙的容器（masonry 直接挂在这上面） */
  wall: HTMLElement
  /** 墙里已经画了多少张（= 当时的 renderedCount） */
  count: number
  /** 当时的数据签名：和当前签名不一致就不复用 */
  signature: string
  /** 当时的列宽（缩放滑杆档位变了要重排） */
  columnWidth: number
  /** 滚动位置：切回来还停在原地 */
  scrollTop: number
}
const wallCache = new Map<string, WallSnapshot>()
/** 当前挂在页面上的墙属于哪个签名（'' = 还没建） */
let mountedWallKey = ''

/**
 * histZoom 滑杆 → 最小卡片宽度（px）：滑杆越大卡片越大、列数越少。
 * 瀑布流的列数随容器宽度自适应（calcColumns），这里只提供「最小列宽」。
 */
const minCardSize = computed(() => ({ 1: 340, 2: 280, 3: 220, 4: 170 }[s.histZoom] ?? 220))

/**
 * 缩放滑块（自绘，替代原生 input[type=range]）：
 * 原生 range 只有 thumb（14px）附近才能按下拖拽，点轨道只跳值不跟手 —— 用户实测"拖不动"。
 * 这里整条轨道自己接管 pointerdown/move/up：按下任意位置即跳档并进入拖拽，
 * 移动实时换算档位，松手结束。thumb 位置按 (value-1)/(max-1) 居中定位。
 */
const ZOOM_MIN = 1
// 用户口径 2026-10-28：删掉最小的那一档（原第 5 档只有 120px，效果太小）
const ZOOM_MAX = 4
const zoomPct = computed(() => ((s.histZoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100)
let zoomDragging = false

function zoomApply(clientX: number, track: HTMLElement): void {
  const rect = track.getBoundingClientRect()
  if (rect.width <= 0) return
  const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  s.histZoom = Math.round(ZOOM_MIN + f * (ZOOM_MAX - ZOOM_MIN))
}

function onZoomPointerDown(e: PointerEvent): void {
  const track = e.currentTarget as HTMLElement | null
  if (!track) return
  zoomDragging = true
  track.setPointerCapture(e.pointerId)
  zoomApply(e.clientX, track)
}
function onZoomPointerMove(e: PointerEvent): void {
  if (!zoomDragging) return
  zoomApply(e.clientX, e.currentTarget as HTMLElement)
}
function onZoomPointerUp(e: PointerEvent): void {
  zoomDragging = false
  ;(e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId)
}

/** 容器宽 + 最小列宽 → 实际列数与列宽（列宽均分撑满容器） */
function calcColumns(containerWidth: number): { cols: number; columnWidth: number } {
  const cols = Math.max(1, Math.floor((containerWidth + GUTTER) / (minCardSize.value + GUTTER)))
  const columnWidth = Math.floor((containerWidth - GUTTER * (cols - 1)) / cols)
  return { cols, columnWidth }
}

/** 当前页签的墙缓存键（完整筛选签名；改列数/排序/范围都会换键） */
function historyWallKey(): string {
  return [s.histScope, s.histType, s.histRating, s.histSortDesc, s.histPageSize].join('|')
}

/** 最后一张卡可见 → 追加下一批已拉到的数据（节流交给 maybeLoadMoreBatch，见下） */
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

/** 两次「拉下一页」之间的最小间隔（毫秒）—— 哨兵常驻可视区时也不会连发请求 */
const LOAD_MORE_INTERVAL_MS = 1000
let loadMoreObserver: IntersectionObserver | null = null
let lastLoadMoreAt = 0
let loadMoreRetryTimer: ReturnType<typeof setTimeout> | null = null
/** 已经挂上观察器的哨兵元素（同一个元素不重复 setup，元素换了才重挂） */
let observedSentinel: HTMLElement | null = null

/**
 * 哨兵进了可视区：离上次拉页超过间隔才真的拉（否则定时到点补拉一次）。
 * 数据到位后由 histDataVersion 的 watch 续接瀑布流（appendMasonryItems）。
 */
function maybeLoadMorePage(): void {
  if (!s.historyOpen || s.histLoadingMore) return
  if (!canLoadMore.value) return
  // 数据已全部拉到、只剩"没渲染的卡片"时，不需要再打接口：直接让最后一批接上瀑布流。
  if (!s.histHasMore) {
    if (renderedCount.value < ui.histVisible.value.length) {
      const from = renderedCount.value
      renderedCount.value = Math.min(renderedCount.value + BATCH_SIZE, ui.histVisible.value.length)
      nextTick(() => appendMasonryItems(from, renderedCount.value))
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
  const view = sentinel?.closest('.ax-sa-view') as HTMLElement | null
  if (!sentinel || !view) return false
  const s = sentinel.getBoundingClientRect()
  const v = view.getBoundingClientRect()
  return s.top <= v.bottom + 600 && s.bottom >= v.top
}

/** 列表没填满视口时继续拉下一页（幂等 + 节流，可放心在每次布局变化后调用） */
function fillViewportIfNeeded(): void {
  if (!s.historyOpen || !canLoadMore.value) return
  if (isSentinelInView()) maybeLoadMorePage()
}

/**
 * 还能不能继续加载：
 *   · 后端还有下一页 → 能（哨兵负责拉数据）
 *   · 数据已全拉到、但还有卡片没渲染 → 也能（哨兵负责把剩余卡片接上瀑布流）
 *
 * 两种"能"都要保留哨兵；只有真正到底（没数据、也全渲染完）才把它从 DOM 摘掉。
 */
const canLoadMore = computed(() => {
  if (renderedCount.value < ui.histVisible.value.length) return true
  return s.histHasMore
})

/**
 * 给自动化/排障用：把"到底能不能再加载"的真实状态挂到 DOM 上。
 * 真机排查时先看这几个数，避免只凭"画面没动"猜原因。
 */
function readLoadState(): Record<string, unknown> {
  const sentinel = loadSentinelEl.value
  const view = sentinel?.closest('.ax-sa-view') as HTMLElement | null
  // ⚠️ 不要用 s 命名：s 是 ui.state（被下面的 hasMore / loading 读取）。
  // 之前这里用 const s = rect 遮蔽了它，模板渲染时直接抛
  // "Cannot read properties of undefined (reading 'histHasMore')"，整个瀑布流不渲染。
  const rect = sentinel?.getBoundingClientRect()
  const v = view?.getBoundingClientRect()
  return {
    rendered: renderedCount.value,
    visible: ui.histVisible.value.length,
    type: s.histType,
    first: ui.histVisible.value[0]?.kind ?? null,
    hasMore: s.histHasMore,
    loading: s.histLoadingMore,
    errorCount: ui.histErrorCount.value,
    masonry: !!masonryEl.value,
    columns: lastColumnWidth,
    sentinel: !!sentinel,
    inView: !!(rect && v && rect.top <= v.bottom + 600 && rect.bottom >= v.top),
  }
}

/**
 * 监听底部哨兵。真正的滚动层是 AxScrollArea 内部的 .ax-sa-view（根元素本身不滚），
 * root 必须指到它 —— 否则哨兵相对 viewport 永远"在视口外"（弹窗内容超出视口），一次都不会触发。
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
    { root: sentinel.closest('.ax-sa-view') ?? null, rootMargin: '0px 0px 600px 0px' },
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

let sentinelWatchdog: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  if (sentinelWatchdog) clearInterval(sentinelWatchdog)
  sentinelWatchdog = setInterval(ensureLoadSentinelAlive, 800)
})

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

/** 监听最后一张卡：进入可视区（含下方 600px 缓冲）就追加下一批 */
function observeLastItem(): void {
  sentinelObserver?.disconnect()
  const container = masonryEl.value
  if (!container) return
  const els = container.querySelectorAll<HTMLElement>('.' + ITEM_CLASS)
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

/** HTML 转义（卡片 DOM 用 innerHTML 拼，标题来自后台要防注入） */
function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

/** 无产物（失败）的异常卡 / 有地址但资源打不开的中性卡：警示图标 + 标题（没数据 = 异常，不装作正常素材） */
function buildErrorCard(item: HistItem, opts?: { missingResource?: boolean }): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'hist-card-fallback' + (opts?.missingResource ? '' : ' is-error')
  wrap.innerHTML =
    '<span class="hist-card-fallback-icon">!</span>' +
    '<strong>' + esc(item.title) + '</strong>' +
    (opts?.missingResource
      ? '<span class="hist-card-meta">资源走丢 · 无法预览</span>'
      : '<span class="hist-card-meta hist-card-meta--danger">生成异常 · 无产物</span>') +
    '<span class="hist-card-meta">' + esc(item.kind) + ' · ' + esc(item.time) + '</span>'
  wrap.addEventListener('click', () => onCardClick(item))
  wrap.appendChild(buildDetailButton(item))
  // 勾选层由外层卡片统一挂载（这里再挂一次会出现两个叠加的勾选钮）
  return wrap
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
  card.replaceWith(fallback)
  masonry.layoutWhenReady()
}

/**
 * 点卡片：
 * - 普通模式 → 打开预览；
 * - 批量模式 → **整卡都能勾选/取消**（用户口径 2026-10-27：不想只点左上角小圆点）。
 *   点左上角那个圆钮仍走它自己的 stopPropagation，不会重复切换。
 */
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

/** 历史条目类型（卡片构建函数共用；id 参与批量勾选） */
interface HistItem {
  id?: string
  title: string
  kind: string
  time: string
  urls?: string[]
  canvasId?: string
  nodeId?: string
  /** 提示词 / 参数 / 参考素材 / 媒体元数据（详情弹窗与卡片角标用） */
  prompt?: string
  values?: Record<string, unknown>
  resources?: Array<{ kind: string; url?: string; value?: string }>
  media?: { width?: number; height?: number; durationMs?: number; bytes?: number }
  finishedAt?: number
  error?: string
}

/** 批量模式下的勾选覆盖层（点它切换选中；不在批量模式不出现） */
function buildCheckOverlay(id: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'hist-card-check' + (s.histSelectedIds.includes(id) ? ' is-on' : '')
  el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  el.addEventListener('click', (ev) => {
    ev.stopPropagation()
    toggleHistSelected(id)
  })
  return el
}

/** 勾选/取消一条 */
function toggleHistSelected(id: string): void {
  const i = s.histSelectedIds.indexOf(id)
  if (i >= 0) s.histSelectedIds.splice(i, 1)
  else s.histSelectedIds.push(id)
  // 重新刷这张卡的勾选态（覆盖层 class）
  const el = masonryEl.value?.querySelector('[data-hist-id="' + id + '"] .hist-card-check')
  if (el) el.classList.toggle('is-on', s.histSelectedIds.includes(id))
}

/**
 * 音频/视频卡：封面 + 播放圆钮（点卡片直接开 MediaViewer 预览/播放）。
 * 音频没有画面 —— 给柔和渐变底 + 波形点阵装饰；视频有封面帧。
 */
/**
 * 媒体（视频 / 音频）卡的外框：与图片卡**同一套瀑布流格子**，按产物真实宽高比排布。
 *
 * 用户口径 2026-10-27：
 * - 视频要和图片一样走瀑布流（以前视频卡写死 180px 高、16:9，所以整排等高、和图片格格不入）；
 * - 卡片上要有宽高比、时长、文件大小；图片卡上现有的"尺寸 + 时间"样式保持一致。
 * - 音视频地址打不开时不许出黑框，要和图片一样归入「显示异常」。
 */
function mediaAspect(item: HistItem, fallback: number): string {
  const w = item.media?.width
  const h = item.media?.height
  return w && h && w > 0 && h > 0 ? w + ' / ' + h : String(fallback)
}

/** 字节数 → 人能读的大小（0 / 缺省返回空串，不显示） */
function formatBytes(n?: number): string {
  if (!n || n <= 0) return ''
  const kb = 1024
  const mb = kb * 1024
  if (n >= mb) return (n / mb).toFixed(1) + ' MB'
  if (n >= kb) return Math.round(n / kb) + ' KB'
  return n + ' B'
}

/** 毫秒 → m:ss（缺省 / 非正数返回空串） */
function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return m + ':' + String(sec).padStart(2, '0')
}

/** 详情弹窗里的时长：带单位，超过一分钟说"X 分 Y 秒"，比 m:ss 更好读 */
function formatDurationLong(ms?: number): string {
  if (!ms || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return m > 0 ? m + ' 分 ' + sec + ' 秒' : sec + ' 秒'
}

/** 宽高 → 最简比（如 1086×1448 → 543:724；用最大公约数，不四舍五入成假比例） */
function ratioLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(Math.round(w), Math.round(h)) || 1
  return Math.round(w / g) + ':' + Math.round(h / g)
}

/** 完成时间：精确到分钟（卡片上只显示"多久前"，复盘要看具体时刻） */
function formatExactTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * 卡外信息行（方案 5 定稿，用户口径 2026-10-27）：
 *
 *   类型标签 | 宽高 · 时长 · 文件大小
 *
 * 标签在**文字最左侧**、整行都在图片**下方**，图片上不放任何文字。
 * 音频没有画面 → 不显示宽高，只显示时长与大小；图片没有时长。
 * 不显示标题（资源本来就没有名称）。
 */
function buildFactsLine(item: HistItem): HTMLElement {
  const row = document.createElement('div')
  row.className = 'hist-card-facts'
  const parts: string[] = []
  if (item.media?.width && item.media?.height) parts.push(item.media.width + '×' + item.media.height)
  const dur = formatDuration(item.media?.durationMs)
  if (dur) parts.push(dur)
  const size = formatBytes(item.media?.bytes)
  if (size) parts.push(size)
  row.innerHTML =
    '<span class="hist-card-kind">' + esc(item.kind) + '</span>' +
    '<span class="hist-card-fact-text">' + esc(parts.join(' · ')) + '</span>'
  return row
}

/**
 * 音频的「卡外控制行」：播放键 + 时间在左，尺寸/时长/大小在右。
 *
 * 用户口径 2026-10-28：波形条本身恢复成白底细条（不再是带边框的卡片），
 * 播放键与文字说明像图片卡那样放到卡片外。播放器组件自己不带这些按钮
 * （它在条内被隐藏了底栏），所以这里补一个最小的播放键 + 时间，
 * 点击/拖动进度仍走条内的波形（可点、可拖）。
 */
function buildAudioControls(item: HistItem, audio: HTMLAudioElement, card: HTMLElement): HTMLElement {
  const row = document.createElement('div')
  row.className = 'hist-card-audio-controls'
  /* 整行两端对齐 + 垂直居中（用户口径 2026-10-28：文字要跟按钮垂直居中）。
     用内联样式而不是只依赖样式表：这张卡是 JS 现拼的，样式表若被裁剪/覆盖也不会丢。 */
  row.style.display = 'flex'
  row.style.alignItems = 'center'
  row.style.justifyContent = 'space-between'
  /** 左半：类型 + 当前播放进度 */
  const left = document.createElement('div')
  left.className = 'hist-audio-left'
  const kind = document.createElement('span')
  kind.className = 'hist-card-kind'
  kind.textContent = item.kind
  const progress = document.createElement('span')
  progress.className = 'hist-audio-progress'
  left.appendChild(kind)
  left.appendChild(progress)

  /** 右半：总时长 + 播放按钮（纯图标，无边框无圆角） */
  const right = document.createElement('div')
  right.className = 'hist-audio-right'
  const duration = document.createElement('span')
  duration.className = 'hist-audio-duration'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'hist-audio-play'
  btn.setAttribute('aria-label', '播放')
  const playIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7,4 19,12 7,20"/></svg>'
  const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
  btn.innerHTML = playIcon
  right.appendChild(duration)
  right.appendChild(btn)
  /** 全屏预览按钮：单独一个，放在播放按钮右侧（用户口径 2026-10-28） */
  const expand = document.createElement('button')
  expand.type = 'button'
  expand.className = 'hist-audio-expand'
  expand.title = '全屏预览'
  expand.setAttribute('aria-label', '全屏预览：' + item.title)
  expand.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>'
  expand.addEventListener('click', (ev) => {
    ev.stopPropagation()
    openHistoryItem(item)
  })
  right.appendChild(expand)
  const fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00'
    const total = Math.round(sec)
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
  }
  const sync = (): void => {
    progress.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration)
    duration.textContent = fmt(audio.duration)
    btn.innerHTML = audio.paused ? playIcon : pauseIcon
    btn.setAttribute('aria-label', audio.paused ? '播放' : '暂停')
  }
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    if (audio.paused) void audio.play().catch(() => {})
    else audio.pause()
  })
  audio.addEventListener('timeupdate', sync)
  audio.addEventListener('play', sync)
  audio.addEventListener('pause', sync)
  audio.addEventListener('loadedmetadata', sync)
  sync()
  row.appendChild(left)
  row.appendChild(right)
  return row
}

/**
 * 整张卡的最后一行：图 + 卡外信息行。所有卡片（图片/视频/音频/异常）都走这一个出口。
 * 异常卡自己已经带"生成异常 · 无产物"与类型/时间，这里**只给正常卡**补信息行，
 * 避免同一张卡出现两行重复说明。
 */
function finishCard(card: HTMLElement, item: HistItem): HTMLElement {
  card.classList.add('hist-card--facts-out')
  if (!card.querySelector('.hist-card-fallback')) card.appendChild(buildFactsLine(item))
  return card
}

/**
 * 卡片右上角的「详情」小按钮：打开该条历史的生成参数弹窗。
 *
 * 用户口径 2026-10-27：历史里要能看到当时的提示词、参考图/视频/音频与参数，
 * 所以卡片上得有一个明确入口（点卡片本身仍是预览 / 批量勾选，不做第二语义）。
 */
function buildDetailButton(item: HistItem): HTMLElement {
  const btn = document.createElement('button')
  btn.className = 'hist-card-detail'
  btn.type = 'button'
  btn.title = '查看生成参数'
  btn.setAttribute('aria-label', '查看生成参数：' + item.title)
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation()
    detailItem.value = item
  })
  return btn
}

function buildMediaCard(item: HistItem, url: string, kind: 'audio' | 'video'): HTMLElement {
  const card = document.createElement('div')
  card.className = 'hist-card'
  if (item.id) card.dataset.histId = item.id
  const isAudio = kind === 'audio'
  // 音频/视频卡优先用节点插件注册的预览件（真播放器：波形 / 带控件的视频画面）；
  // 目录里没登记/没就绪才回落到静态装饰。视频以前直接把媒体地址塞 <img>，必然裂图。
  const PluginPreview = isAudio
    ? (uiComponentOf('audioPreview') as Component | undefined)
    : (uiComponentOf('videoPreview') as Component | undefined)
  // 媒体框：与图片卡同一套瀑布流格子。按产物真实宽高比给高度，
  // 这样竖版视频就是竖的、横版就是横的（不再全部写死 180px）。
  const media = document.createElement('div')
  media.className = isAudio
    ? 'hist-card-media hist-card-media--audio'
    : 'hist-card-media hist-card-media--video'
  /**
   * 音频：恢复成最开始那版的**横向细条**（宽度由瀑布流决定、高度 96px、白底），
   * 不做带边框的"卡片面板"（用户口径 2026-10-28：不喜欢现在这种卡片形式）。
   * 播放键与文字说明移到卡片外（见 finishCard 之后挂的 attachAudioControls）。
   * 图片/视频仍按产物真实宽高比。
   */
  if (isAudio) {
    media.style.height = '96px'
  } else {
    media.style.aspectRatio = mediaAspect(item, 16 / 9)
  }
  card.appendChild(media)
  if (PluginPreview) {
      const mount = document.createElement('div')
      mount.className = isAudio ? 'hist-card-audio-plugin' : 'hist-card-video-plugin'
      media.appendChild(mount)
      // 视频件自带「按宽度自适应」：小卡片走小屏态（只有一个居中播放键），宽了给完整控制栏。
      // 信息（类型 / 宽高 / 时长 / 大小）全部放在图外的一行里（见 finishCard），图上只留详情圆钮。
      //
      // 视频卡额外给 expandable + 接 expand：小屏态右下角出现「进入预览」小方块，
      // 点它打开全屏预览（用户口径：视频可以点进全屏）。组件自己不开窗 —— 它不知道
      // MediaViewer 挂在哪，所以由这里把事件接到 openHistoryItem 上。
      const app = createApp({
        render: () =>
          h(
            PluginPreview,
            isAudio
              // 音频：恢复成改之前那版 —— 播放器里带名称/时长/大小那一行信息
              ? { url, name: item.title, compact: true }
              : { url, name: item.title, expandable: true, onExpand: () => openHistoryItem(item) },
          ),
      })
      app.mount(mount)
      // 视频件自带的控制条自带 aria-label，不再额外补；这里只记录媒体元素，供加载失败与尺寸同步
      // 详情入口留在图上（右上角小圆钮）；信息行在图外，见 finishCard
      media.appendChild(buildDetailButton(item))
      // 媒体加载失败（文件被清理 / 换地址）：与图片卡同一口径，开关关着就整条隐藏
      const tag = isAudio ? 'audio' : 'video'
      const el = mount.querySelector(tag) as HTMLMediaElement | null
      el?.addEventListener('error', () => showBrokenResourceCard(card, item))
      if (el) {
        /**
         * 老记录没有 media 元数据（历史里还没存宽高/时长）。
         * 媒体加载出 metadata 后自己补上：卡片比例按真实宽高重排，左下角角标补宽高与时长，
         * 这样即使没重新生成，旧视频也能显示"宽高 + 时长"，而不是只有"视频 · 12 天前"。
         * 已经记过的（新记录）不覆盖 —— 后端量出来的值更准，也避免二次跳动。
         */
        const syncFromMedia = (): void => {
          // 视频元素才有 videoWidth/height；音频没有可视尺寸，只补时长
          const v = el as HTMLVideoElement
          const w = !isAudio ? v.videoWidth || 0 : 0
          const h = !isAudio ? v.videoHeight || 0 : 0
          const durSec = Number.isFinite(el.duration) ? el.duration : 0
          if (w > 0 && h > 0) {
            if (!item.media) item.media = {}
            if (!item.media.width) item.media.width = w
            if (!item.media.height) item.media.height = h
            if (!isAudio) media.style.aspectRatio = w + ' / ' + h
          }
          if (durSec > 0 && !item.media?.durationMs) {
            if (!item.media) item.media = {}
            item.media.durationMs = Math.round(durSec * 1000)
          }
          const old = card.querySelector('.hist-card-facts')
          if (old) old.replaceWith(buildFactsLine(item))
          scheduleImageRelayout()
        }
        el.addEventListener('loadedmetadata', syncFromMedia)
        el.addEventListener('loadeddata', syncFromMedia)
        // 音频：把真实时长回写到播放器（卡外那行的时长也用它），避免显示 0:00
        if (isAudio) {
          const durEl = mount.querySelector('.apv-time') as HTMLElement | null
          const fmt = (sec: number): string => {
            if (!Number.isFinite(sec) || sec <= 0) return '0:00'
            const total = Math.round(sec)
            return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
          }
          const syncAudioTime = (): void => {
            if (durEl) durEl.textContent = fmt(el.currentTime) + ' / ' + fmt(el.duration)
          }
          el.addEventListener('timeupdate', syncAudioTime)
          el.addEventListener('loadedmetadata', syncAudioTime)
        }
      }

      if (isAudio) card.addEventListener('click', () => onAudioCardClick(item))
      else card.addEventListener('click', () => onCardClick(item))
      // 批量模式下媒体层让位给整卡勾选：点在波形/视频上也要落到卡片本身。
      // 标记由 syncBatchOverlays 统一同步（进入/退出批量模式时也要生效，不只是建卡那一刻）。
      card.classList.toggle('hist-card--batch', s.histBatchMode)
      if (s.histBatchMode && item.id) card.appendChild(buildCheckOverlay(item.id))
      if (isAudio && el) {
        /**
         * 音频：卡外放"播放键 + 时间 + 尺寸信息"这一行（波形条内只留白底波形）。
         * 结构仍与图片卡一致：媒体条在上、说明在下。
         */
        const finished = finishCard(card, item)
        const facts = finished.querySelector('.hist-card-facts')
        if (facts) facts.remove()
        finished.appendChild(buildAudioControls(item, el as HTMLAudioElement, finished))
        return finished
      }
      return finishCard(card, item)
  }
  // 没有注册件时的兜底卡面：同样套在 media 框里，保留同一套角标与比例
  const inner = document.createElement('div')
  inner.style.cssText = 'position:absolute;inset:0'
  inner.innerHTML = isAudio
    ? '<div class="hist-card-audio"><span class="hist-card-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span></div>'
    : '<img src="' + esc(url) + '" alt="" loading="lazy" />'
  inner.insertAdjacentHTML('beforeend', '<div class="hist-card-play">▶</div>')
  media.appendChild(inner)
  media.appendChild(buildDetailButton(item))
  if (!isAudio) {
    const img = inner.querySelector('img')!
    img.addEventListener('load', () => {
      if (img.naturalWidth && img.naturalHeight) {
        media.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight
        scheduleImageRelayout()
      }
    })
    img.addEventListener('error', () => {
      // 与图片卡同一口径：地址打不开 ≠ 生成失败 —— 用中性「资源走丢」卡，
      // 不亮红色异常卡（否则"显示异常"关着也会冒出红叹号，用户实测 2026-10-27）。
      showBrokenResourceCard(card, item)
    })
  }
  card.addEventListener('click', () => onCardClick(item))
  if (s.histBatchMode && item.id) card.appendChild(buildCheckOverlay(item.id))
  card.classList.toggle('hist-card--batch', s.histBatchMode)
  return finishCard(card, item)
}

/** 生成瀑布流里一张卡的 DOM（图片卡带骨架屏 + 底部渐变信息栏；无产物退图标卡） */
function createMasonryElement(item: HistItem): HTMLElement {
  const card = document.createElement('div')
  card.className = 'hist-card'
  if (item.id) card.dataset.histId = item.id
  const url = thumbOf(item)

  // 音频/视频先行：它们的 urls[0] 是媒体地址（不是图片），交给专属媒体卡
  // （之前顺序反了：音频地址先被当图片 <img> 加载 → error → 被误换成"异常卡"，
  //  而点开其实能播 —— 用户实测抓到的就是这个）。
  const isAudio = item.kind === '音频' || item.kind === 'audio'
  const isVideo = item.kind === '视频' || item.kind === 'video'
  if ((isAudio || isVideo) && item.urls?.[0]) {
    return buildMediaCard(item, item.urls[0], isAudio ? 'audio' : 'video')
  }

  if (url) {
    // 图片卡：优先用历史里记下的真实宽高（不用等图加载，卡片不会先闪 1:1 再跳）；
    // 早期记录没有 media 时退回 1/1 骨架，等 onload 再按真实宽高比重设。
    const known = !!(item.media?.width && item.media?.height)
    card.innerHTML =
      '<div class="hist-card-media" style="aspect-ratio:' + (known ? mediaAspect(item, 1) : '1/1') + '">' +
      '<img src="' + esc(url) + '" alt="" loading="lazy" />' +
      (known ? '' : '<div class="hist-card-skeleton"><span class="hist-card-pulse"></span></div>') +
      '</div>'
    const mediaEl = card.querySelector('.hist-card-media') as HTMLElement
    mediaEl.appendChild(buildDetailButton(item))
    const img = card.querySelector('img')!
    const media = card.querySelector('.hist-card-media') as HTMLElement
    img.addEventListener('load', () => {
      if (img.naturalWidth && img.naturalHeight) {
        media.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight
        card.querySelector('.hist-card-skeleton')?.remove()
        // 老记录没有 media 元数据时，用实测尺寸补到**卡外的信息行**
        if (!item.media) item.media = {}
        if (!item.media.width) item.media.width = img.naturalWidth
        if (!item.media.height) item.media.height = img.naturalHeight
        const facts = card.querySelector('.hist-card-facts')
        if (facts) facts.replaceWith(buildFactsLine(item))
        scheduleImageRelayout()
      }
    })
    img.addEventListener('error', () => {
      // 裂图：记录有产物、文件却被清理/换地址了 —— 同样归入异常，
      // 开关关着时整条隐藏，开着时给中性「资源走丢」卡（不占用红色的"生成失败"）。
      showBrokenResourceCard(card, item)
    })
    /**
     * 加载超时兜底（用户口径 2026-10-28：截图里出现一块空白卡片，拖缩放才消失）。
     *
     * 有些地址既不会触发 error、也不会 load（连接挂住 / 被浏览器静默丢弃 / 缓存层返回空），
     * 卡片就一直是"有格子没画面"的白块。12 秒还没拿到尺寸就按裂图处理：
     * 归入「显示异常」（开关关着整条隐藏）—— 不留白格，也不误留一幅假图。
     */
    window.setTimeout(() => {
      if (!img.isConnected) return
      if (img.complete && img.naturalWidth > 0) return
      if (s.histShowError) return // 用户要看异常时，交给 error 回调统一成中性卡
      showBrokenResourceCard(card, item)
    }, 12000)
    card.addEventListener('click', () => onCardClick(item))
  } else {
    card.appendChild(buildErrorCard(item))
  }
  if (s.histBatchMode && item.id) card.appendChild(buildCheckOverlay(item.id))
  card.classList.toggle('hist-card--batch', s.histBatchMode)
  return finishCard(card, item)

}

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

  const containerWidth = container.clientWidth
  if (containerWidth === 0) { rebuilding = false; return }
  const { columnWidth } = calcColumns(containerWidth)
  lastColumnWidth = columnWidth
  container.innerHTML = ''
  mountedWallKey = ''

  const items = ui.histVisible.value.slice(0, renderedCount.value)
  for (const item of items) {
    const wrapper = document.createElement('div')
    wrapper.className = ITEM_CLASS
    wrapper.style.width = columnWidth + 'px'
    wrapper.style.marginBottom = GUTTER + 'px'
    wrapper.appendChild(createMasonryElement(item))
    container.appendChild(wrapper)
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!masonryEl.value) { rebuilding = false; return }
      masonry.init(masonryEl.value, { itemSelector: '.' + ITEM_CLASS, columnWidth, gutter: GUTTER })
      rebuilding = false
      mountedWallKey = s.histSignature || historyWallKey()
      observeLastItem()
      // 整墙重建后哨兵元素可能被换掉/才刚出现：统一在这里补挂一次观察器
      setupLoadSentinel()
      // 卡片数量可能仍不足一屏（首屏大量记录被"显示异常"过滤掉）：主动补拉下一页，
      // 不能等 observer 回调 —— 哨兵一直可见时它不会二次触发（用户实测 2026-10-28）。
      fillViewportIfNeeded()
    })
  })
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
    const wrapper = document.createElement('div')
    wrapper.className = ITEM_CLASS
    wrapper.style.width = columnWidth + 'px'
    wrapper.style.marginBottom = GUTTER + 'px'
    wrapper.appendChild(createMasonryElement(item))
    return wrapper
  })
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
    const wrapper = document.createElement('div')
    wrapper.className = ITEM_CLASS
    wrapper.style.width = columnWidth + 'px'
    wrapper.style.marginBottom = GUTTER + 'px'
    wrapper.appendChild(createMasonryElement(item))
    return wrapper
  })
  masonry.prepend(wrappers)
  renderedCount.value = Math.min(renderedCount.value + count, ui.histVisible.value.length)
  // 数据整体多了一条：异常卡过滤掉的那部分也要跟着参与"还能不能加载"的判断
  observeLastItem()
}

/** 卡片墙的滚动容器（AxScrollArea 内部真正滚的那一层） */
function historyScroller(): HTMLElement | null {
  return (masonryEl.value?.closest('.ax-sa-view') as HTMLElement | null) ?? null
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
  const key = mountedWallKey || historyWallKey()
  if (!container.querySelector('.' + ITEM_CLASS)) return
  const wall = container.cloneNode(false) as HTMLElement
  wall.removeAttribute('id')
  wall.className = 'hist-masonry hist-masonry--stashed'
  while (container.firstChild) wall.appendChild(container.firstChild)
  wallCache.set(key, {
    wall,
    // 以**实际画出来的卡片数**为准：renderedCount 是跨页签共用的，直接记它会把
    // 上一个页签的数字带进来（真机 2026-10-28：视频只有 11 张，记账却是 26）
    count: wall.querySelectorAll('.' + ITEM_CLASS).length,
    signature: s.histSignature || key,
    columnWidth: lastColumnWidth,
    scrollTop: historyScroller()?.scrollTop ?? 0,
  })
  mountedWallKey = ''
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
  if (mountedWallKey === key && container.querySelector('.' + ITEM_CLASS)) {
    // 已经是这面墙：只补挂观察器（数据可能刚变过）
    masonry.layout()
    setupLoadSentinel()
    return
  }
  if (mountedWallKey && mountedWallKey !== key) stashCurrentWall()

  const cached = wallCache.get(key)
  const containerWidth = container.clientWidth
  const columnWidth = calcColumns(containerWidth).columnWidth
  if (cached) {
    container.innerHTML = ''
    while (cached.wall.firstChild) container.appendChild(cached.wall.firstChild)
    wallCache.delete(key)
    renderedCount.value = cached.count
    lastColumnWidth = cached.columnWidth
    mountedWallKey = key
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
  mountedWallKey = ''
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
    sentinelObserver?.disconnect()
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
  const switching = filterSwitching || (mountedWallKey !== '' && mountedWallKey !== historyWallKey())
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
  const wallReadyForAppend = !!masonry.instance.value && mountedWallKey === historyWallKey() && !switching
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
  if (s.histSignature !== historyWallKey()) {
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
    renderedCount.value = Math.min(BATCH_SIZE, ui.histVisible.value.length)
    nextTick(() => {
      rebuildMasonry()
      // 过滤后卡片数可能不足一屏：哨兵还在，但瀑布流重建过；重新确认观察器仍然指向当前元素
      nextTick(setupLoadSentinel)
    })
  }
})
onBeforeUnmount(() => {
  masonry.destroy()
  sentinelObserver?.disconnect()
  teardownLoadSentinel()
  if (sentinelWatchdog) clearInterval(sentinelWatchdog)
  sentinelWatchdog = null
  resizeObserver?.disconnect()
  if (relayoutTimer) clearTimeout(relayoutTimer)
})

/**
 * 点一张卡：有产物就打开预览；没有产物（失败 / 老记录）就不弹空窗，给个提示。
 *
 * 2026-10-29：带上**同页签清单**（historyPreviewGroup），MediaViewer 自动出现
 * ← / → 与页码、支持键盘 ←→ —— 与资产面板同层预览同一套交互。
 * 清单给不出（异常兜底）就退回单张预览，行为与从前一致。
 */
function openHistoryItem(item: HistItem): void {
  const url = item.urls?.[0]
  if (!url) {
    ui.showToast('这条记录没有产物（可能失败或已过清理）')
    return
  }
  // 预览地址必须走同源转换（原始 urls 可能是跨端地址打不开）；
  // kind 用原始中文标签即可 —— MediaViewer 里做了归一化。
  // 媒体（视频/音频）的地址本身就可能是画布资源地址，原样给它，别按缩略图规则改写。
  // 图片才按缩略图规则换成同源地址；音视频必须用原始地址（改写会把
  // /api/resources/... 拼成画布资源路径 → 找不到文件 → 卡片「加载失败」）。
  const viewUrl = previewableUrl(item)
  if (!viewUrl) {
    ui.showToast('这条记录没有可预览的产物')
    return
  }
  const group = historyPreviewGroup(item)
  previewItem.value = {
    name: item.title,
    kind: item.kind,
    url: viewUrl,
    ...(group && group.list.length > 1 ? group : {}),
  }
}


/** 箭头水平偏移：dock 可能被左右抽屉挤偏，视口正中≠快捷键按钮中心，打开时实测对准 */
const arrowShift = ref(0)
watch(() => s.shortcutsOpen, async (open) => {
  if (!open) { arrowShift.value = 0; return }
  await nextTick()
  const btn = document.querySelector('[aria-label="快捷键"]')
  if (!btn) return
  arrowShift.value = btn.getBoundingClientRect().left + btn.getBoundingClientRect().width / 2 - window.innerWidth / 2
})

function closeShortcutPanel(): void {
  s.shortcutsOpen = false
}

/**
 * 点面板外面就关（用户口径 2026-10-28：「就和 AxDropdown 一样」）。
 *
 * 判定用和 AxDropdown 同一个 hook（@vueuse/core 的 onClickOutside），它把监听挂在
 * document 的捕获阶段，所以外壳顶栏 / 底栏 / 状态条即使层级更高、即使写了
 * `@pointerdown.stop`，也照样能判出「点到面板外面了」。
 *
 * 只把「快捷键」按钮排除在外：它有自己的 toggle，不排除会「先关再开」，看着像没反应。
 */
const shortcutPanelRef = ref(null)
onClickOutside(
  shortcutPanelRef,
  (e) => {
    if (!s.shortcutsOpen) return
    /**
     * 触发器自己不算「外面」。
     *
     * 不能只靠 onClickOutside 的 `ignore`：它把 ignore 判定放在 pointerdown 上，
     * 而底栏容器写了 `@pointerdown.stop`（见 DockArea），那个 pointerdown 到不了 window，
     * ignore 就白写了；随后 click 先关面板、按钮自己的 toggle 再打开 —— 看着像没反应。
     * 这里在回调里再挡一次，两种事件顺序下都稳。
     */
    const target = e.target
    if (target instanceof Element && target.closest('[aria-label="快捷键"]')) return
    closeShortcutPanel()
  },
  { ignore: ['[aria-label="快捷键"]'] },
)

</script>

<template>
  <!-- 快捷键：毛玻璃，相对**整个视口**居中；底部箭头指向 dock 的「快捷键」按钮（中轴对齐） -->
  <div v-if="s.shortcutsOpen" class="fixed inset-0 z-[90] flex flex-col items-center justify-end pb-[74px]">
    <motion.section
      ref="shortcutPanelRef"
      class="shortcut-modal relative flex h-[437px] w-[min(1152px,calc(100vw-48px))] flex-col rounded-2xl border border-line bg-glass text-ink shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-[28px] backdrop-saturate-[1.4]"
      role="dialog" aria-modal="true" aria-label="快捷键" :initial="{ opacity: 0, scale: 0.96, y: 8 }"
      :animate="{ opacity: 1, scale: 1, y: 0 }" :transition="{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }"
      @pointerdown.stop>
      <!-- 顶部条：四个蓝色分组标题（编辑/画布/视图/更多）与关闭按钮同行。
           网格参数与内容区严格一致（pl-5 + pr-[42px] + mr-[10px] + gap-x-6 + grid-cols-4），组头才能逐列对齐。
           顶栏 min-h-10(40px) ≥ 按钮(6+32=38px 占位) → 下方滚动条的轨道从按钮下面才开始，不再重叠。 -->
      <div class="grid min-h-10 grid-cols-4 items-center gap-x-6 pl-5 pr-[42px] mr-[10px]">
        <h4 v-for="col in ui.shortcuts" :key="col.group" class="text-xs font-bold text-brand">{{ col.group }}</h4>
        <button
          class="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink"
          aria-label="关闭快捷键面板" @click="closeShortcutPanel">
          <X :size="15" />
        </button>
      </div>
      <!-- 内容区：与顶栏同参数的网格；每组自己的 h4 移除（组头已上移到顶栏） -->
      <div
        class="grid min-h-0 flex-1 content-start grid-cols-4 gap-x-6 gap-y-1 overflow-y-auto pb-5 pl-5 pr-[42px] mr-[10px]">
        <div v-for="col in ui.shortcuts" :key="col.group" class="shortcut-col">
          <div v-for="row in col.items" :key="row[0]"
            class="flex min-h-[34px] items-center justify-between gap-2.5 text-xs text-ink">
            <span>{{ row[0] }}</span>
            <span class="flex items-center gap-1"><template v-for="(k, i) in row[1]" :key="k + i"><kbd
                  class="rounded-md border border-line bg-veil px-1.5 py-0.5 text-[10px] text-ink">{{ k }}</kbd><em
                  v-if="i < row[1].length - 1" class="not-italic text-ink-dim">+</em></template></span>
          </div>
        </div>
      </div>
    </motion.section>
    <!-- 箭头：面板底部中央，向下指向 dock 的「快捷键」按钮（实测按钮位置对准；translate+rotate 必须同写一个 transform，否则位移会落到旋转坐标系里） -->
    <span
      class="relative z-[1] -mt-[7px] size-[14px] rounded-[3px] border-b border-r border-line bg-arrow backdrop-blur-[28px] backdrop-saturate-[1.4]"
      :style="{ transform: `translateX(${arrowShift}px) rotate(45deg)` }" aria-hidden="true"></span>
  </div>

  <!-- 生成历史：无遮罩大弹窗（照 LibTV 实测 min(90vw,1600px) × calc(100vh-160px)） -->
  <AxDialog :model-value="s.historyOpen" :with-overlay="true" width="min(90vw, 1600px)" height="calc(100vh - 160px)"
    radius="24px" overlay-class="axdlg-overlay--soft" @update:model-value="!$event && (s.historyOpen = false)">
    <div class="flex flex-none items-center justify-between gap-4 px-6 pb-5 pt-6">
      <span class="text-lg font-medium leading-[26px] text-ink">生成历史</span>
      <div class="flex items-center gap-4">
        <div class="hist-zoom-wrap flex items-center gap-2 rounded-lg bg-veil p-2" role="group" aria-label="缩放">
          <Grid2x2 :size="16" class="text-ink" />
          <!-- 自绘滑块：整条轨道可按下拖拽（原生 range 只有 thumb 可拖，用户实测"拖不动"） -->
          <div class="hist-zoom-track relative h-4 w-[120px] cursor-pointer touch-none" role="slider"
            :aria-valuenow="s.histZoom" :aria-valuemin="ZOOM_MIN" :aria-valuemax="ZOOM_MAX"
            aria-label="调整卡片宽度（大值列多图小）"
            @pointerdown="onZoomPointerDown" @pointermove="onZoomPointerMove"
            @pointerup="onZoomPointerUp" @pointercancel="onZoomPointerUp">
            <span class="hist-zoom-rail" />
            <span class="hist-zoom-fill" :style="{ width: zoomPct + '%' }" />
            <span class="hist-zoom-thumb" :style="{ left: zoomPct + '%' }" />
          </div>
          <LayoutGrid :size="16" class="text-ink" />
        </div>
        <AxButton variant="ghost" size="icon" aria-label="关闭生成历史" @click="s.historyOpen = false">
          <X :size="16" />
        </AxButton>
      </div>
    </div>
    <div class="h-px flex-none bg-line"></div>
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex flex-none flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-0.5 rounded-xl bg-veil p-0.5" role="tablist">
            <button v-for="sc in s.histScopes" :key="sc"
              class="relative h-8 rounded-[10px] px-3 text-sm transition-colors"
              :class="s.histScope === sc ? 'text-ink' : 'text-ink/60 hover:text-ink'" role="tab"
              :aria-selected="s.histScope === sc" @click="s.histScope = sc">
              <span v-if="s.histScope === sc"
                class="absolute inset-0 rounded-[10px] border border-line bg-canvas-bg"></span>
              <span class="relative">{{ sc }}</span>
            </button>
          </div>
          <span class="h-4 w-px bg-line"></span>
          <div class="flex items-center gap-4 pl-1">
            <button v-for="t in s.histTypes" :key="t"
              class="flex h-8 items-center gap-1.5 text-[13px] transition-colors"
              :class="s.histType === t ? 'text-brand' : 'text-ink'" @click="s.histType = s.histType === t ? '' : t">
              <span>{{ t }}</span><span
                class="inline-flex h-4 min-w-4 items-center justify-center rounded bg-chip px-1 text-[11px]">{{
                  ui.histCount(t) }}</span>
            </button>
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
            <AxDropdown v-model="s.histRatingOpen" placement="bottom-end" menu-width="140px">
              <template #trigger><button
                  class="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink transition-colors hover:bg-hover"
                  aria-label="所有评级">{{ s.histRating }}
                  <ChevronDown :size="14" />
                </button></template>
              <template #default="{ close }">
                <AxMenu>
                  <AxMenuItem v-for="r in ['所有评级', '已通过', '待审核', '已拒绝']" :key="r" @click="s.histRating = r; close()">{{ r }}
                  </AxMenuItem>
                </AxMenu>
              </template>
            </AxDropdown>
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
      <AxScrollArea class="min-h-0 flex-1" direction="y" body-class="px-10 pb-6">
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
      </AxScrollArea>
      <!-- 批量操作栏（图2 参考效果）：进入批量模式才出现 -->
      <div v-if="s.histBatchMode" class="hist-batch-bar flex flex-none items-center justify-between border-t border-line px-6 py-3">
        <span class="text-[13px] text-ink">已选择 {{ s.histSelectedIds.length }} 项</span>
        <div class="flex items-center gap-2">
          <button class="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-ink transition-colors hover:bg-hover"
            aria-label="批量删除" @click="ui.batchDeleteHistory()">删除</button>
          <!-- 批量评级：UI 已隐藏（逻辑保留，见 SHOW_RATING_UI 注释） -->
          <button v-if="SHOW_RATING_UI"
            class="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-ink transition-colors hover:bg-hover"
            aria-label="批量评级" @click="ui.batchRateHistory('passed')">评级</button>
          <button class="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-ink transition-colors hover:bg-hover"
            aria-label="保存到资产" @click="ui.batchSaveAssets()">保存到资产</button>
          <button class="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] text-primary-ink transition-colors hover:opacity-90"
            aria-label="完成选择" @click="toggleBatchMode">完成</button>
        </div>
      </div>
    </div>
  </AxDialog>

  <!-- 历史预览：与资产面板同一只 MediaViewer（Esc / 点遮罩 / 右上角关闭；历史不可删 → 不传 onDelete）。
       视频/音频/文本的预览件由 MediaViewer 自己按名取（树外也能取，见 canvas-render 的 uiCatalog）。 -->
  <MediaViewer :item="previewItem" @close="previewItem = null" />

  <!-- 生成详情：一条历史的完整参数（提示词 / 参数 / 参考素材 / 产物信息）。
       用户口径 2026-10-27：卡片上要有入口，能复盘"当时到底用了什么"。 -->
  <AxDialog :model-value="!!detailItem" width="640px" height="auto" max-height="80vh" radius="16px"
    @update:model-value="!$event && (detailItem = null)">
    <div v-if="detailItem" class="hist-detail">
      <header class="hist-detail-head">
        <div class="min-w-0">
          <strong class="hist-detail-title">{{ detailItem.title }}</strong>
          <span class="hist-detail-sub">{{ detailItem.kind }} · {{ detailItem.time }}</span>
        </div>
        <AxButton variant="ghost" size="icon" aria-label="关闭生成详情" @click="detailItem = null">
          <X :size="15" />
        </AxButton>
      </header>

      <AxScrollArea class="min-h-0 flex-1" direction="y" body-class="px-4 pb-4">
        <div class="hist-detail-body">
          <!-- 产物信息：图片给宽高比，视频/音频额外给时长，所有类型都给文件大小 -->
          <section class="hist-detail-sec">
            <h4 class="hist-detail-h">产物</h4>
            <dl class="hist-detail-kv">
              <template v-if="detailItem.media?.width && detailItem.media?.height">
                <dt>宽高</dt>
                <dd>{{ detailItem.media.width }}×{{ detailItem.media.height }}
                  <span class="hist-detail-dim">（{{ ratioLabel(detailItem.media.width, detailItem.media.height) }}）</span>
                </dd>
              </template>
              <template v-if="detailItem.media?.durationMs">
                <dt>时长</dt><dd>{{ formatDurationLong(detailItem.media.durationMs) }}</dd>
              </template>
              <template v-if="detailItem.media?.bytes">
                <dt>文件大小</dt><dd>{{ formatBytes(detailItem.media.bytes) }}</dd>
              </template>
              <template v-if="detailItem.finishedAt">
                <dt>完成时间</dt><dd>{{ formatExactTime(detailItem.finishedAt) }}</dd>
              </template>
              <template v-if="detailItem.error">
                <dt>失败原因</dt><dd class="hist-detail-danger">{{ detailItem.error }}</dd>
              </template>
            </dl>
          </section>

          <section class="hist-detail-sec">
            <h4 class="hist-detail-h">提示词</h4>
            <p v-if="detailItem.prompt" class="hist-detail-prompt">{{ detailItem.prompt }}</p>
            <p v-else class="hist-detail-empty">这条记录没有保存提示词（早期记录没有这一项）</p>
          </section>

          <section v-if="detailItem.values && Object.keys(detailItem.values).length" class="hist-detail-sec">
            <h4 class="hist-detail-h">生成参数</h4>
            <dl class="hist-detail-kv">
              <template v-for="(v, k) in detailItem.values" :key="k">
                <dt>{{ k }}</dt><dd>{{ String(v) }}</dd>
              </template>
            </dl>
          </section>

          <section class="hist-detail-sec">
            <h4 class="hist-detail-h">参考素材</h4>
            <div v-if="detailItem.resources?.length" class="hist-detail-refs">
              <div v-for="(r, i) in detailItem.resources" :key="i" class="hist-detail-ref">
                <span class="hist-detail-ref-kind">{{ r.kind }}</span>
                <img v-if="r.url && r.kind !== 'video' && r.kind !== 'audio'" :src="r.url" alt="" loading="lazy" />
                <span v-else-if="r.url" class="hist-detail-ref-url">{{ r.url }}</span>
                <span v-else class="hist-detail-ref-value">{{ r.value }}</span>
              </div>
            </div>
            <p v-else class="hist-detail-empty">这条记录没有参考素材（早期记录没有这一项）</p>
          </section>
        </div>
      </AxScrollArea>
    </div>
  </AxDialog>

  <!-- TV Director 全局设置：独立全局弹窗（不在 Agent 面板内） -->
  <AxDialog :model-value="s.directorOpen" width="600px" height="532px" radius="12px"
    @update:model-value="!$event && (s.directorOpen = false)">
    <div class="flex items-center justify-between px-4 pb-2.5 pt-4">
      <div><span class="block text-[9px] font-extrabold tracking-[0.12em] text-ink-dim">TV DIRECTOR</span><strong
          class="text-[15px]">全局设置</strong></div>
      <AxButton variant="ghost" size="icon" aria-label="关闭全局设置" @click="s.directorOpen = false">
        <X :size="15" />
      </AxButton>
    </div>
    <!-- <div class="mx-4 mb-3 rounded-lg bg-veil px-3 py-2 text-xs text-gold">非会员每天免费对话 3 轮，即刻体验！</div> -->
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
      <div class="mb-4 rounded-xl border border-line p-3">
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">协作模式</strong>
            <p class="text-xs text-ink-dim">自动生成图片/视频/音频/剧本</p><small class="block text-[11px] text-ink-mute">开启后，TV
              Director 可直接消耗积分，提交生成任务，无需逐次确认</small><em
              class="block text-[10px] not-italic text-ink-dim">新建会话默认生效，当前会话请前往输入框底部切换</em>
          </div>
          <button
            class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform"
            :class="{ 'after:translate-x-4 bg-brand': s.director.collab }" role="switch"
            :aria-checked="s.director.collab" aria-label="协作模式"
            @click="s.director.collab = !s.director.collab"></button>
        </div>
        <!-- 后台对话：开=连接断了这一轮也跑完（config/agentRunMode = 'background'）；关=旧行为（'followTab'） -->
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">后台对话</strong>
            <p class="text-xs text-ink-dim">开启后，对话在后台继续跑：离开或关闭浏览器也会进行，刷新后重新进入该对话能继续之前的对话流</p>
          </div>
          <button
            class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform"
            :class="{ 'after:translate-x-4 bg-brand': agent.state.runMode === 'background' }" role="switch"
            :aria-checked="agent.state.runMode === 'background'" aria-label="后台对话"
            @click="agent.setRunMode(agent.state.runMode === 'background' ? 'followTab' : 'background')"></button>
        </div>
        <!-- 发送中显示队列（config/agentQueuePrefs）：队列里「发送中」条目要不要画出来（用户口径 2026-10-15） -->
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">发送中显示队列</strong>
            <p class="text-xs text-ink-dim">开启后，排队消息在真实发送期间仍显示「发送中」状态；关闭则发送后立即从列表消失</p>
          </div>
          <button
            class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform"
            :class="{ 'after:translate-x-4 bg-brand': agent.state.queueShowSending }" role="switch"
            :aria-checked="agent.state.queueShowSending" aria-label="发送中显示队列"
            @click="agent.setQueueShowSending(!agent.state.queueShowSending)"></button>
        </div>
        <!-- 目标设置的默认预算（config/agentGoalDefaults）：点 + 选目标时取这里的值，0 = 不限 -->
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">目标设置</strong>
            <p class="text-xs text-ink-dim">点 + 选目标时用这里的默认预算；之后可以点目标标签单独改</p>
          </div>
          <input :value="agent.state.goalBudget" type="number" min="0" step="1000" placeholder="0 = 不限"
            class="h-8 w-28 rounded-lg border border-line bg-veil px-2 text-xs text-ink outline-none"
            aria-label="目标默认预算" @change="agentBudgetOnChange" />
        </div>
        <!-- 发送键（用户口径 2026-10-25）：目标设置下面配「哪一种回车提交」。
             为什么用下拉而不是开关：三种取值互斥，开关只能表达两态。 -->
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">发送键</strong>
            <p class="text-xs text-ink-dim">选哪一种回车发送消息；@ 下拉打开时回车始终用于选择菜单项</p>
          </div>
          <AxDropdown v-model="sendKeyOpen" placement="bottom-end" menu-width="180px">
            <template #trigger><button
                class="flex h-8 items-center gap-1 rounded-lg border border-line bg-veil px-2 text-xs text-ink transition-colors hover:bg-hover"
                aria-label="发送键">{{ sendKeyLabel }}
                <ChevronDown :size="13" />
              </button></template>
            <template #default="{ close }">
              <AxMenu>
                <AxMenuItem v-for="m in SUBMIT_KEY_MODE_OPTIONS" :key="m.value"
                  :active="agent.state.submitKeyMode === m.value" :hint="m.hint"
                  @click="agent.setSubmitKeyMode(m.value); close()">{{ m.label }}
                </AxMenuItem>
              </AxMenu>
            </template>
          </AxDropdown>
        </div>
        <!-- <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">积分预算管理</strong>
            <p class="text-xs text-ink-dim">开启后，当本项目累计消耗积分达到设置阈值时，会提醒你留意用量</p>
          </div>
          <button
            class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform"
            :class="{ 'after:translate-x-4 bg-brand': s.director.budget }" role="switch"
            :aria-checked="s.director.budget" aria-label="积分预算管理"
            @click="s.director.budget = !s.director.budget"></button>
        </div> -->
        <div v-if="s.director.budget" class="flex items-center justify-between gap-3 border-t border-line pt-2">
          <span class="text-xs text-ink-dim">提醒阈值设置</span>
          <input v-model.number="s.director.budgetLimit" type="number" min="100" step="100"
            class="h-8 w-28 rounded-lg border border-line bg-veil px-2 text-xs text-ink outline-none"
            aria-label="提醒阈值设置" />
        </div>
      </div>
      <div class="rounded-xl border border-line p-3">
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">浏览器通知</strong>
            <p class="text-xs text-ink-dim">TV Director 回复完成后，会在系统通知提醒</p>
          </div>
          <button
            class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform"
            :class="{ 'after:translate-x-4 bg-brand': agent.state.notify.browser }" role="switch"
            :aria-checked="agent.state.notify.browser" aria-label="浏览器通知"
            @click="agent.setNotify({ browser: !agent.state.notify.browser })"></button>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">通知声音</strong>
            <p class="text-xs text-ink-dim">开启后，收到通知时播放提示音</p>
          </div>
          <button
            class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform"
            :class="{ 'after:translate-x-4 bg-brand': agent.state.notify.sound }" role="switch"
            :aria-checked="agent.state.notify.sound" aria-label="通知声音"
            @click="agent.setNotify({ sound: !agent.state.notify.sound })"></button>
        </div>
      </div>
    </div>
    <div class="flex flex-none justify-end border-t border-line p-3">
      <button
        class="rounded-lg border border-line px-3 py-1.5 text-xs text-ink transition-colors hover:bg-hover hover:text-ink"
        @click="s.directorOpen = false; ui.showToast('设置已保存')">完成</button>
    </div>
  </AxDialog>

</template>

<style scoped>
/* 自绘缩放滑块：整条轨道可拖（原生 range 只有 thumb 可拖，用户实测"拖不动"） */
.hist-zoom-track { display: flex; align-items: center; }
.hist-zoom-rail { position: absolute; left: 0; right: 0; top: 50%; height: 4px; transform: translateY(-50%); border-radius: 9999px; background: var(--ui-hover-strong); }
.hist-zoom-fill { position: absolute; left: 0; top: 50%; height: 4px; transform: translateY(-50%); border-radius: 9999px; background: var(--ui-accent, #0891b2); }
.hist-zoom-thumb { position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 9999px; background: var(--ui-ink); transform: translate(-50%, -50%); box-shadow: 0 0 0 3px var(--ui-panel, #fff); pointer-events: none; }
.hist-zoom-track:hover .hist-zoom-thumb { box-shadow: 0 0 0 3px var(--ui-panel, #fff), 0 0 0 5px var(--ui-veil, rgb(0 0 0 / 0.06)); }
/* 显示异常开关（checkbox 自绘小方块） */
.hist-error-toggle { appearance: none; width: 14px; height: 14px; margin: 0; border: 1.5px solid var(--ui-ink-mute, #888); border-radius: 4px; background: transparent; cursor: pointer; display: grid; place-items: center; }
.hist-error-toggle:checked { border-color: var(--ui-accent, #0891b2); background: var(--ui-accent, #0891b2); }
.hist-error-toggle:checked::after { content: ""; width: 8px; height: 8px; background: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E"); }
/* 批量操作栏 */
.hist-batch-bar { background: var(--ui-panel, #fff); }

/* 详情弹窗：与历史面板同一套中性灰阶；只有失败原因用语义红 */
.hist-detail { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.hist-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 12px 8px 16px; }
.hist-detail-title { display: block; font-size: 15px; font-weight: 700; color: var(--ui-ink, inherit); }
.hist-detail-sub { display: block; margin-top: 2px; font-size: 11px; color: var(--ui-ink-mute, #888); }
.hist-detail-body { display: flex; flex-direction: column; gap: 14px; padding-top: 4px; }
.hist-detail-sec { display: flex; flex-direction: column; gap: 6px; }
.hist-detail-h { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--ui-ink-mute, #888); }
.hist-detail-kv { display: grid; grid-template-columns: 68px 1fr; gap: 4px 10px; margin: 0; font-size: 12px; }
.hist-detail-kv dt { color: var(--ui-ink-mute, #888); }
.hist-detail-kv dd { margin: 0; color: var(--ui-ink, inherit); word-break: break-word; }
.hist-detail-dim { color: var(--ui-ink-mute, #888); }
.hist-detail-danger { color: var(--ui-danger, #ef4444); }
.hist-detail-prompt { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--ui-veil, rgb(127 127 127 / .08)); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--ui-ink, inherit); }
.hist-detail-empty { margin: 0; font-size: 12px; color: var(--ui-ink-mute, #888); }
.hist-detail-refs { display: flex; flex-wrap: wrap; gap: 8px; }
.hist-detail-ref { display: flex; flex-direction: column; gap: 4px; width: 104px; padding: 6px; border-radius: 8px; border: 1px solid var(--ui-line, rgb(128 128 128 / .2)); background: var(--ui-veil, rgb(127 127 127 / .06)); }
.hist-detail-ref img { width: 100%; height: 68px; object-fit: cover; border-radius: 6px; display: block; }
.hist-detail-ref-kind { font-size: 10px; color: var(--ui-ink-mute, #888); text-transform: uppercase; }
.hist-detail-ref-value { font-size: 11px; line-height: 1.4; color: var(--ui-ink, inherit); max-height: 68px; overflow: auto; }
.hist-detail-ref-url { font-size: 10px; line-height: 1.35; color: var(--ui-ink-mute, #888); word-break: break-all; max-height: 68px; overflow: auto; }

/* 加载更多指示（用户口径 2026-10-28：显示 1 秒、要更清楚）。
   中性灰阶：转圈 + 文案，居中放在列表底部；不用主题色。 */
.hist-loading {
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 0;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12.5px;
  letter-spacing: 0.01em;
}
.hist-loading-spinner {
  flex: none;
  width: 16px;
  height: 16px;
  border: 2px solid var(--ui-line, rgb(128 128 128 / 0.25));
  border-top-color: var(--ui-ink-dim, #6b7280);
  border-radius: 999px;
  animation: hist-loading-spin 0.75s linear infinite;
}
@keyframes hist-loading-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .hist-loading-spinner { animation: none; }
}

/* 下一页加载哨兵：滚动区最底部的一小块占位（IntersectionObserver 只认几何，不需要可见样式） */
.hist-load-sentinel { height: 1px; width: 100%; }
</style>

<!--
  ===== masonry 瀑布流卡片样式（非 scoped）=====
  卡片 DOM 由 createMasonryElement / buildMediaCard / buildErrorCard 用 JS 手工创建，
  带不上 Vue scoped 的 data-v 属性 → scoped 样式对它们全部失效（实测：信息条 position
  变 static、渐变条消失、音频卡布局崩）。这些类全部 hist- 前缀且只在 .hist-masonry
  容器内出现，放开到全局不会与其它模块冲突。
-->
<style>
.hist-masonry { min-height: 200px; }
.hist-card { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid var(--ui-line, rgba(128,128,128,.2)); background: var(--ui-veil, rgba(127,127,127,.08)); transition: border-color .16s ease, box-shadow .16s ease; }
/* 强调色走规范青（ui-style-guide §2.1：全界面只有青一种强调色；--ui-brand 全仓未定义，会掉进蓝色兜底） */
.hist-card:hover { border-color: var(--ui-accent, #0891b2); box-shadow: 0 2px 10px var(--ui-scrim, rgb(0 0 0 / 0.08)); }
.hist-card-media { position: relative; width: 100%; overflow: hidden; cursor: pointer; background: var(--ui-scrim, rgb(0 0 0 / 0.06)); }
.hist-card-media img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
/* 骨架屏：onload 后由 JS 移除 */
.hist-card-skeleton { position: absolute; inset: 0; z-index: 1; display: grid; place-items: center; background: var(--ui-veil, rgba(127,127,127,.12)); }
.hist-card-pulse { width: 40px; height: 40px; border-radius: 12px; background: var(--ui-hover, rgba(127,127,127,.25)); animation: hist-pulse 1.4s ease-in-out infinite; }
@keyframes hist-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
/* ===== 方案 5 定稿（用户口径 2026-10-27）：信息全部在图片外 =====
   卡片本体只包图片；下方一行 = 类型标签（最左）+ 宽高 · 时长 · 大小。
   图片上不再有任何渐变条/标签文字，缩略图完整可见。 */
.hist-card--facts-out { border: 0; background: transparent; border-radius: 0; overflow: visible; }
.hist-card--facts-out:hover { border-color: transparent; box-shadow: none; }
.hist-card--facts-out .hist-card-media { border-radius: 10px; }
.hist-card-facts { display: flex; align-items: center; gap: 6px; margin-top: 7px; min-width: 0; font-size: 10.5px; color: var(--ui-ink-mute, #888); font-variant-numeric: tabular-nums; }
.hist-card-kind { flex: none; display: inline-flex; align-items: center; padding: 1px 5px; border-radius: 4px; background: var(--ui-veil, rgb(127 127 127 / 0.1)); color: var(--ui-ink-dim, #6b7280); font-size: 9.5px; line-height: 1.6; letter-spacing: .02em; }
.hist-card-fact-text { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 异常卡不套图片框：保持原来的居中说明，去掉父级透明卡带来的圆角/边框差异 */
.hist-card--facts-out .hist-card-fallback { border-radius: 10px; background: var(--ui-veil, rgba(127,127,127,.06)); }
/* 播放圆钮：音频/视频卡中央，hover 微放大 */
.hist-card-play { position: absolute; left: 50%; top: 50%; z-index: 3; transform: translate(-50%, -50%); display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--ui-scrim, rgb(0 0 0 / 0.45)); color: var(--ui-tip-ink, #fff); font-size: 12px; backdrop-filter: blur(4px); transition: transform 0.16s ease; pointer-events: none; }
.hist-card-media:hover .hist-card-play { transform: translate(-50%, -50%) scale(1.1); }
/* 音频卡（静态装饰兜底）：柔和渐变底 + 波形竖条 */
.hist-card-audio { position: absolute; inset: 0; display: grid; place-items: center; background: var(--ui-veil, rgb(127 127 127 / 0.06)); }
.hist-card-wave { display: flex; align-items: center; justify-content: center; gap: 3px; width: 70%; height: 46%; }
.hist-card-wave i { flex: 1 1 auto; max-width: 5px; height: 30%; border-radius: 2px; background: var(--ui-ink-mute, #9ca3af); opacity: .75; }
.hist-card-wave i:nth-child(3n) { height: 62%; }
.hist-card-wave i:nth-child(4n) { height: 44%; }
.hist-card-wave i:nth-child(5n) { height: 78%; }
.hist-card-wave i:nth-child(7n) { height: 24%; }
/* 音频注册件卡（上下布局）：组件舞台定高 96px 自适应宽，下方信息条 fixed 行高 —— 用户口径 */
.hist-card-audio-plugin { position: absolute; inset: 0; overflow: hidden; background: var(--ui-panel, #fff); }
.hist-card-audio-plugin .apv-root { height: 100%; }
.hist-card-audio-plugin .apv-wave { min-height: 0; flex: 1 1 auto; }
/* 历史卡里的音频波形一律中性灰阶（用户口径 2026-10-27：不要主题紫）。
   只覆盖卡片内的表现，节点里的播放器仍按自己的主题走。 */
/* 音频：波形本身要**卡片边框包住**（用户口径 2026-10-28 附红框截图），
   白底 + 1px 细边框 + 圆角；与图片/视频卡同一套卡片外观。 */
.hist-card-media--audio {
  border: 1px solid var(--ui-line, rgba(128, 128, 128, 0.2));
  background: var(--ui-panel, #fff);
  border-radius: 10px;
}
/* 播放键/文字说明由宿主放到卡片外：播放器自带的底栏（时长/大小/文件名）在条内隐藏，
   避免和卡外说明重复。 */
.hist-card-audio-plugin .apv-bar { display: none; }
/* 卡外底栏（用户口径 2026-10-28 定稿）：
   左 = 类型 + 当前播放进度；右 = 时长 + 播放按钮。
   整行用 flex + items-center 做**垂直居中**对齐（用户反馈：之前文字看着没有居中）。 */
.hist-card-audio-controls {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-top: 7px; min-width: 0;
  font-size: 10.5px; color: var(--ui-ink-mute, #888); font-variant-numeric: tabular-nums;
  line-height: 1;
}
.hist-audio-left, .hist-audio-right { display: flex; align-items: center; gap: 6px; min-width: 0; }
.hist-audio-left { flex: 0 1 auto; }
.hist-audio-right { flex: none; }
/* 文字用等宽数字 + 与按钮同高，避免"字比按钮高一截"看起来没对齐 */
.hist-audio-progress, .hist-audio-duration { white-space: nowrap; line-height: 18px; }
.hist-audio-left .hist-card-kind { line-height: 18px; }
/* 单独一个按钮：不要圆角边框，不要底色（用户口径） */
.hist-audio-play {
  flex: none; display: inline-grid; place-items: center;
  width: 18px; height: 18px; padding: 0; margin-left: 2px;
  border: 0; border-radius: 0; background: transparent;
  color: var(--ui-ink, #18202b); cursor: pointer;
}
.hist-audio-play:hover { color: var(--ui-accent, #0891b2); }
.hist-audio-play svg { width: 11px; height: 11px; }
/* 全屏预览：播放键右侧的独立图标按钮，同样是「无边框无圆角」（用户口径 2026-10-28） */
.hist-audio-expand {
  flex: none; display: inline-grid; place-items: center;
  width: 18px; height: 18px; padding: 0; margin-left: 4px;
  border: 0; border-radius: 0; background: transparent;
  color: var(--ui-ink, #18202b); cursor: pointer;
}
.hist-audio-expand:hover { color: var(--ui-accent, #0891b2); }
.hist-audio-expand svg { width: 11px; height: 11px; }
.hist-audio-expand:focus-visible { outline: 2px solid var(--ui-accent, #0891b2); outline-offset: 2px; }
/* 批量模式：只让波形层让位（点波形落到整卡勾选）；
   媒体框本身仍可点 —— 右上角「详情」钮是它的子元素，不能一起关掉。 */
.hist-card--batch .hist-card-audio-plugin { pointer-events: none; }
.hist-card--batch .hist-card-audio-controls { pointer-events: none; }
.hist-card--batch .hist-card-video-plugin,
.hist-card--batch .hist-card-video-plugin * { pointer-events: none; }
.hist-card--batch .vpv-dense-play,
.hist-card--batch .vpv-dense-expand,
.hist-card--batch .vpv-bar-wrap,
.hist-card--batch .vpv-scrim { display: none; }
.hist-card-audio-plugin .aw-wave-bar { background: var(--ui-ink-mute, #9ca3af); opacity: .55; }
.hist-card-audio-plugin .aw-wave-bar.is-played { background: var(--ui-ink, #374151); opacity: .9; }
.hist-card-audio-plugin .aw-wave:hover .aw-wave-bar,
.hist-card-audio-plugin .aw-wave:hover .aw-wave-bar.is-played { background: var(--ui-ink, #374151); }
.hist-card-audio-plugin .aw-knob::after { background: var(--ui-ink, #374151); }
.hist-card-audio-plugin .aw-knob:hover::after,
.hist-card-audio-plugin .aw-knob:active::after { background: var(--ui-ink, #111827); }
.hist-card-audio-plugin .aw-progress-fill { background: var(--ui-ink-mute, #9ca3af); }
.hist-card-audio-plugin .aw-progress-thumb { border-color: var(--ui-ink-mute, #9ca3af); }
.hist-card-video-plugin { position: absolute; inset: 0; overflow: hidden; background: var(--ui-scrim, #000); /* 主题色白名单: 视频黑边属媒体底色，不随主题 */ }
.hist-card-video-plugin .vpv-root { height: 100%; }
/* 异常卡：警示圆圈 + 「生成异常 · 无产物」说明 */
.hist-card-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 130px; padding: 16px 12px; cursor: pointer; text-align: center; }
/* 批量模式勾选层：卡片左上角圆形勾选钮。
   必须放在全局块里 —— 卡片是 createMasonryElement 用 createElement 现拼的，拿不到
   scoped 的 data-v 属性；写在 scoped 里等于整段样式不存在，内联 SVG 会按默认 300×150
   铺满整张卡（用户实测 2026-10-27：勾选后每张卡都是一个大对勾）。 */
.hist-card-check { position: absolute; left: 6px; top: 6px; z-index: 5; display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border-radius: 9999px; border: 1.5px solid var(--ui-tip-ink, rgb(255 255 255 / 0.85)); background: var(--ui-scrim, rgb(0 0 0 / 0.35)); color: transparent; cursor: pointer; backdrop-filter: blur(4px); transition: background .15s ease, border-color .15s ease, transform .15s ease; }
.hist-card-check svg { width: 12px; height: 12px; flex: none; }
.hist-card-check:hover { transform: scale(1.08); }
.hist-card-check.is-on { border-color: var(--ui-accent, #0891b2); background: var(--ui-accent, #0891b2); color: var(--ui-on-accent, #fff); /* 主题色白名单: 勾选态对勾在主题色上的前景色 */ }
/* 卡片右上角的「详情」入口：中性玻璃小圆钮，压在画面上也看得清（不抢缩略图） */
.hist-card-detail { position: absolute; right: 6px; top: 6px; z-index: 6; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--ui-line, rgb(255 255 255 / .35)); border-radius: 9999px; background: var(--ui-panel, rgb(0 0 0 / .45)); color: var(--ui-ink, #fff); cursor: pointer; opacity: .82; transition: opacity .15s ease, transform .15s ease; }
.hist-card-detail:hover { opacity: 1; transform: scale(1.08); }
.hist-card-detail svg { width: 13px; height: 13px; }
/* 视频卡详情钮仍是右上角。
   ⚠️ 不要在这里把图标强制成白色：详情钮的底是 --ui-panel（亮色主题 = 纯白），
   白图标压在白底上 = 看不见（用户截图 2026-10-28：视频卡右上角只有一个空圆圈）。
   图标颜色统一跟随主题文字色 --ui-ink 即可，深浅两套主题都清楚。 */
.hist-card-fallback .hist-card-fallback-icon { display: grid; place-items: center; width: 32px; height: 32px; margin-bottom: 2px; border-radius: 50%; border: 1.5px solid var(--ui-ink-mute, #888); color: var(--ui-ink-mute, #888); font-size: 15px; font-weight: 700; }
.hist-card-fallback.is-error .hist-card-fallback-icon { display: grid; place-items: center; width: 32px; height: 32px; margin-bottom: 2px; border-radius: 50%; border: 1.5px solid var(--ui-danger, #ef4444); color: var(--ui-danger, #ef4444); font-size: 15px; font-weight: 700; }
.hist-card-fallback strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 600; color: var(--ui-ink, inherit); }
.hist-card-fallback .hist-card-meta { font-size: 10px; color: var(--ui-ink-mute, #888); }
.hist-card-fallback .hist-card-meta--danger { color: var(--ui-danger, #ef4444); }
</style>
