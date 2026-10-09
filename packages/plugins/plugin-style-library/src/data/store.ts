/**
 * store —— 素材库的**数据层**（分页 / 懒加载 / 筛选 / 设置），与 UI 完全分开。
 *
 * 为什么要分开（用户口径）：组件是可以替换的 —— 想换一套广场的外观，只换组件、
 * 不动这里。所以本文件里有全部"怎么取数、取多少、怎么筛"，没有一行模板/DOM。
 *
 * **一套逻辑服务两套数据**：「风格库」与「特效库」共用下面的 `createLibraryService(kind, …)`，
 * 只是 API 前缀不同（见 data/api.ts 的 LibraryKind）。宿主里建两个实例、注入成两个服务名
 * （`style-library` / `effect-library`），两边 UI 组件也通用。
 *
 * 数据形态：**一页一批**。UI 滚到底部调 `loadMore()`，这里按 offset 续拉；
 * "只加载可视区的图片"由组件的 `loading="lazy"` + IntersectionObserver 负责（那是渲染行为，
 * 不是数据行为）—— 数据层只管"该不该再要下一批"。
 */
import type { StyleCard, StyleMeta, StyleSort } from './types'
import { fetchItems, fetchMeta, fetchSettings, putRoot, reload, type CtxLike, resolveApiBase, type LibraryKind } from './api'
import { reactive } from 'vue'

export interface LibraryState {
  /** 库种类（风格 / 特效）—— UI 靠它决定点击行为 */
  kind: LibraryKind
  /** 后台根地址（同源时为空串） */
  base: string
  /** 面板是否打开（浮层显隐；组件读它） */
  open: boolean
  ready: boolean
  loading: boolean
  loadingMore: boolean
  error: string
  meta: StyleMeta | null
  /** 已加载的全部条目（按页追加） */
  items: StyleCard[]
  /** 后台一共有多少条（未筛选时） */
  total: number
  hasMore: boolean
  /** 当前筛选 */
  category: string
  query: string
  sort: StyleSort
  /** 布局：列数（紧凑度滑杆的另一处用法，1..5） */
  zoom: number
}

export interface LibraryService {
  readonly state: LibraryState
  /** 打开面板（首次打开会自动首屏加载） */
  open(): void
  close(): void
  toggle(): void
  /** 首屏加载（重置分页） */
  refresh(): Promise<void>
  /** 追加下一页（滚到底部调它；已在加载 / 没有更多时是空操作） */
  loadMore(): Promise<void>
  /** 换分类（重置分页并首屏加载） */
  setCategory(category: string): Promise<void>
  /** 搜索（重置分页并首屏加载） */
  setQuery(q: string): Promise<void>
  /** 排序 */
  setSort(sort: StyleSort): Promise<void>
  /** 只改本地布局密度，不触发请求 */
  setZoom(z: number): void
  /** 改每页条数（设置项改动时调；会重置分页并重拉首屏，立即生效） */
  setPageSize(n: number): Promise<void>
  /** 读当前资源目录 */
  loadRoot(): Promise<void>
  /** 改资源目录（后台校验 + 重扫） */
  saveRoot(root: string): Promise<void>
  /** 重扫目录 */
  rescan(): Promise<void>
}

/** 每页条数（用户口径"有可能是加载了 60 条"）：60 与 40 都合理，取 60 更接近实测 */
export const PAGE_SIZE = 60

/** 两个库的出厂默认目录（Config 默认值兜底；用户在设置里可改） */
export const DEFAULT_ROOT = 'I:/Assets/liblib-assets'
export const DEFAULT_EFFECT_ROOT = 'I:/Assets/liblib-effects'

/** 每个库的默认目录 */
export function defaultRootOf(kind: LibraryKind): string {
  return kind === 'effect' ? DEFAULT_EFFECT_ROOT : DEFAULT_ROOT
}

export interface CreateServiceOptions {
  ctx?: CtxLike
  /** Config 里给的默认根目录 */
  defaultRoot?: string
  /** 每页条数（Config 里给的；缺省用 PAGE_SIZE） */
  pageSize?: number
}

/**
 * 建一份素材库数据服务（组件只读 state、只调这几个方法）。
 * @param kind 'style' 风格库 / 'effect' 特效库 —— 只影响打哪个 API 前缀与默认目录
 */
export function createLibraryService(kind: LibraryKind, opts: CreateServiceOptions = {}): LibraryService {
  const base = resolveApiBase(opts.ctx)
  /** 每页条数（Config 可覆盖；只认正有限数） */
  let pageSize = typeof opts.pageSize === 'number' && opts.pageSize > 0 ? Math.floor(opts.pageSize) : PAGE_SIZE
  // ⚠️ state 必须**在这里**就包成 reactive，不能在装配处 reactive(service)。
  // 原因（实测踩坑）：reactive(service) 包的是外层对象，而本文件闭包里读写的 state 是**原始对象**，
  // 写入绕过了代理 → 数据确实变了、视图不更新（现象：滚到底数据从 60 涨到 240，DOM 停在 60）。
  // 在这里建代理，闭包内外的读写都走同一份代理，改一个字段就触发渲染。
  const state: LibraryState = reactive({
    kind,
    base,
    open: false,
    ready: false,
    loading: false,
    loadingMore: false,
    error: '',
    meta: null,
    items: [],
    total: 0,
    hasMore: true,
    category: '',
    query: '',
    sort: 'default',
    zoom: 3,
  })

  /** 并发闸门：同一时刻只允许一次"拉一页"（滚到底会连发多次） */
  let inflight: Promise<void> | null = null
  /** 首次打开才加载（避免插件一装载就去请求后台，浪费） */
  let firstLoaded = false

  function open(): void {
    state.open = true
    if (!firstLoaded) {
      firstLoaded = true
      void refresh()
    }
  }
  function close(): void {
    state.open = false
  }
  function toggle(): void {
    if (state.open) close()
    else open()
  }

  async function loadPage(offset: number): Promise<void> {
    const page = await fetchItems(base, kind, {
      offset,
      limit: pageSize,
      ...(state.category ? { category: state.category } : {}),
      ...(state.query ? { q: state.query } : {}),
      sort: state.sort,
    })
    state.total = page.total
    state.hasMore = page.hasMore
    state.items = offset === 0 ? page.items : [...state.items, ...page.items]
  }

  async function refresh(): Promise<void> {
    if (inflight) return inflight
    state.loading = true
    state.error = ''
    inflight = (async () => {
      try {
        const [meta] = await Promise.all([fetchMeta(base, kind), loadPage(0)])
        state.meta = meta
        state.ready = true
      } catch (err) {
        state.error = err instanceof Error ? err.message : String(err)
        state.ready = false
      } finally {
        state.loading = false
        inflight = null
      }
    })()
    return inflight
  }

  async function loadMore(): Promise<void> {
    if (inflight || state.loading || state.loadingMore || !state.hasMore || !state.ready) return
    state.loadingMore = true
    inflight = (async () => {
      try {
        await loadPage(state.items.length)
      } catch (err) {
        // 追加失败不把已有列表清空 —— 只提示，让用户能重试
        state.error = err instanceof Error ? err.message : String(err)
      } finally {
        state.loadingMore = false
        inflight = null
      }
    })()
    return inflight
  }

  async function setCategory(category: string): Promise<void> {
    state.category = category
    await refresh()
  }
  async function setQuery(q: string): Promise<void> {
    state.query = q.trim()
    await refresh()
  }
  async function setSort(sort: StyleSort): Promise<void> {
    state.sort = sort
    await refresh()
  }

  async function loadRoot(): Promise<void> {
    try {
      const s = await fetchSettings(base, kind)
      if (state.meta) state.meta.root = s.root
    } catch {
      /* 读目录失败不致命：设置页自己会提示 */
    }
  }
  async function saveRoot(root: string): Promise<void> {
    const r = await putRoot(base, kind, root)
    if (state.meta) state.meta.root = r.root
    await refresh()
  }
  async function rescan(): Promise<void> {
    await reload(base, kind)
    await refresh()
  }

  function setZoom(z: number): void {
    state.zoom = Math.min(5, Math.max(1, Math.round(z)))
  }
  async function setPageSize(n: number): Promise<void> {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return
    const next = Math.floor(n)
    if (next === pageSize) return
    pageSize = next
    await refresh() // 重置分页，按新粒度重拉首屏
  }

  return { state, open, close, toggle, refresh, loadMore, setCategory, setQuery, setSort, setZoom, setPageSize, loadRoot, saveRoot, rescan }
}

/**
 * 兼容旧名：以前只有风格库，函数叫 createStyleLibraryService。
 * 现在两库共用，保留这个名字做转发（免得到处改 import）。
 */
export function createStyleLibraryService(opts: CreateServiceOptions = {}): LibraryService {
  return createLibraryService('style', opts)
}

