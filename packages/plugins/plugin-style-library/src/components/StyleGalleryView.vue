<script setup lang="ts">
/**
 * StyleGalleryView —— 风格广场主界面（图 1 的复刻）。
 *
 * 布局：顶部页签行（风格广场 / 我的收藏 / 最近使用 + 搜索框 + 工具按钮）、
 * 分类行（推荐 / 摄影写真 / …  + 「仅看可商用」+ 排序）、瀑布式卡片网格。
 *
 * **取数全在 data/store**（组件可替换）；本组件只负责画与转发交互。
 * 滚动到底自动加载下一批：底部放一个哨兵元素，IntersectionObserver 见到它就 loadMore()。
 * 图片懒加载由卡片的 loading="lazy" 负责（只看可视区）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search, Star, History, LayoutGrid, Sparkles, RefreshCw, X } from 'lucide-vue-next'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { StyleCard } from '../data/types'
import type { LibraryService } from '../data/store'
import { UI_CARD } from '../names'

/**
 * 卡片按名从 ui 目录取（不是写死 import 本文件的 StyleCardView）——
 * 这正是"组件可替换"的落点：另注册一个 order 更小的 `styleLibraryCard`，
 * 广场不动、一行不改就换了卡片外观。名不存在时退回落本地默认件（不炸）。
 */
const CardFromRegistry = useUiComponent(UI_CARD)

const emit = defineEmits<{
  (e: 'toggle-star', item: StyleCard): void
  (e: 'open-detail', item: StyleCard): void
  /** preview 模式下点卡片（父组件开全屏预览） */
  (e: 'preview', item: StyleCard): void
  (e: 'use', item: StyleCard): void
}>()

/**
 * 正在加入画布的素材 id（父组件在提交期间通过 v-model 传下来）。
 *
 * 为什么放在广场：卡片是「按名从 ui 目录取」的可替换件，父组件拿不到它的内部状态；
 * 把「谁的按钮该转圈」放在这里，换卡片外观也不用重写这段。
 */
const props = withDefaults(
  defineProps<{
    service: LibraryService
    /** 收藏集合（受控；父组件持有并持久化） */
    starred: Array<number | string>
    /** 可用列数（视觉密度） */
    columns?: number
    /**
     * 交互模式：
     * - 'detail'（缺省，风格库）：点卡片/放大按钮 → 打开详情页
     * - 'preview'（特效库）：点卡片/放大按钮 → 全屏预览（没有详情页）
     */
    mode?: 'detail' | 'preview'
    /** 正在加入画布的素材 id（只影响那一张的按钮态） */
    usingIds?: Array<number | string>
  }>(),
  { columns: 4, mode: 'detail', usingIds: () => [] },
)

const svc = props.service
const s = svc.state

/** 顶部页签 */
const TAB_SQUARE = 'square'
const TAB_STAR = 'star'
const TAB_RECENT = 'recent'
type TabId = typeof TAB_SQUARE | typeof TAB_STAR | typeof TAB_RECENT
const tab = ref<TabId>(TAB_SQUARE)
const TABS: Array<{ id: TabId; label: string; icon: unknown }> = [
  { id: TAB_SQUARE, label: '全部', icon: LayoutGrid },
  { id: TAB_STAR, label: '我的收藏', icon: Star },
  { id: TAB_RECENT, label: '最近使用', icon: History },
]

const queryDraft = ref('')
const sentinel = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** 最近使用：本地记（不落盘也行；父组件可给） */
const recent = ref<Array<number | string>>([])

function markRecent(item: StyleCard): void {
  recent.value = [item.id, ...recent.value.filter((id) => id !== item.id)].slice(0, 60)
}

function onOpen(item: StyleCard): void {
  markRecent(item)
  // 特效库没有详情页：点了直接全屏预览；风格库仍走详情
  if (props.mode === 'preview') emit('preview', item)
  else emit('open-detail', item)
}

function onUse(item: StyleCard): void {
  markRecent(item)
  emit('use', item)
}

/** 卡片上的星标按钮 → 转给父组件（受控收藏集合在父组件） */
function onToggleStar(item: StyleCard): void {
  emit('toggle-star', item)
}

/** 卡片上的「加入画布」→ 与详情页的「使用」同一个出口（父组件落库并建节点） */
function onCardUse(item: StyleCard): void {
  markRecent(item)
  emit('use', item)
}

/** 当前页签下要显示的条目 */
const visible = computed<StyleCard[]>(() => {
  if (tab.value === TAB_STAR) return s.items.filter((it) => props.starred.includes(it.id))
  if (tab.value === TAB_RECENT) {
    const order = new Map(recent.value.map((id, i) => [id, i]))
    return s.items
      .filter((it) => order.has(it.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }
  return s.items
})

/** 网格列数（由父组件/缩放决定；自适应最小宽度） */
const gridStyle = computed(() => ({
  gridTemplateColumns: 'repeat(auto-fill, minmax(' + Math.round(1000 / (props.columns ?? 4)) + 'px, 1fr))',
}))

/** 分类行：推荐 + 后台给的分类 */
const categories = computed(() => s.meta?.categories ?? [])

function pickCategory(name: string): void {
  void svc.setCategory(name === s.category ? '' : name)
}

function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { void svc.setQuery(queryDraft.value) }, 320)
}

function clearSearch(): void {
  queryDraft.value = ''
  void svc.setQuery('')
}

function onSort(sort: 'default' | 'hot' | 'like'): void {
  void svc.setSort(sort)
}

/** 触底加载：哨兵进入可视区（含下方 600px 缓冲）就拉下一页 */
function observeSentinel(): void {
  io?.disconnect()
  const el = sentinel.value
  if (!el) return
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) void svc.loadMore()
    },
    { root: null, rootMargin: '0px 0px 800px 0px' },
  )
  io.observe(el)
}

onMounted(() => {
  void svc.refresh().then(observeSentinel)
})
watch(sentinel, () => observeSentinel())
onBeforeUnmount(() => {
  io?.disconnect()
  if (searchTimer) clearTimeout(searchTimer)
})

defineExpose({ markRecent })
</script>

<template>
  <div class="sg">
    <!-- 顶部：页签 + 搜索 + 工具 -->
    <header class="sg-top">
      <nav class="sg-tabs" role="tablist" aria-label="素材库视图">
        <button v-for="t in TABS" :key="t.id" class="sg-tab" :class="{ 'is-on': tab === t.id }" type="button"
          role="tab" :aria-selected="tab === t.id" @click="tab = t.id">
          <component :is="t.icon" :size="14" /> {{ t.label }}
        </button>
      </nav>

      <label class="sg-search">
        <Search :size="14" class="sg-search-icon" aria-hidden="true" />
        <input v-model="queryDraft" type="text" class="sg-search-input" placeholder="搜索名称、作者"
          aria-label="搜索名称、作者" spellcheck="false" @input="onSearchInput" @keydown.enter.prevent="svc.setQuery(queryDraft)" />
        <button v-if="queryDraft" class="sg-search-clear" type="button" aria-label="清空搜索" @click="clearSearch">
          <X :size="13" />
        </button>
      </label>

      <div class="sg-tools">
        <button class="sg-icon" type="button" aria-label="换一批" title="换一批 / 重扫" @click="svc.rescan()">
          <RefreshCw :size="15" :class="{ spin: s.loading }" />
        </button>
      </div>
    </header>

    <!-- 分类行 -->
    <div class="sg-cats">
      <button class="sg-cat" :class="{ 'is-on': !s.category }" type="button" @click="void svc.setCategory('')">推荐</button>
      <button v-for="c in categories.slice(0, 14)" :key="c.name" class="sg-cat"
        :class="{ 'is-on': s.category === c.name }" type="button" :title="c.name + '（' + c.count + '）'"
        @click="pickCategory(c.name)">
        {{ c.name }}
      </button>
      <span class="sg-cats-spacer"></span>
      <div class="sg-sorts" role="group" aria-label="排序">
        <button class="sg-sort" :class="{ 'is-on': s.sort === 'default' }" type="button" @click="onSort('default')">默认</button>
        <button class="sg-sort" :class="{ 'is-on': s.sort === 'hot' }" type="button" @click="onSort('hot')">最热</button>
        <button class="sg-sort" :class="{ 'is-on': s.sort === 'like' }" type="button" @click="onSort('like')">最赞</button>
      </div>
    </div>

    <!-- 状态条：错误 / 概览 -->
    <p v-if="s.error" class="sg-error" role="alert">{{ s.error }}</p>
    <p v-else-if="s.meta" class="sg-status">
      <Sparkles :size="12" />
      共 {{ s.meta.itemCount }} 个素材 · {{ s.meta.fileCount }} 个文件
      <template v-if="s.meta.root"> · 数据源 <code>{{ s.meta.root }}</code></template>
      <template v-if="s.meta.source === 'scan'">（目录里没有索引，已按文件扫描）</template>
    </p>

    <!-- 网格 -->
    <div class="sg-scroll">
      <div v-if="s.loading && !s.items.length" class="sg-grid" :style="gridStyle">
        <div v-for="i in 12" :key="i" class="sg-ph"></div>
      </div>

      <div v-else-if="visible.length" class="sg-grid" :style="gridStyle">
        <component :is="CardFromRegistry ?? 'div'" v-for="it in visible" :key="it.id" :item="it"
          :starred="starred.includes(it.id)" :show-commercial="mode !== 'preview'"
          :busy="usingIds.includes(it.id)"
          @open="onOpen" @toggle-star="onToggleStar" @use="onCardUse" />
      </div>

      <div v-else class="sg-empty">
        <span v-if="tab === TAB_STAR">还没有收藏 —— 点卡片右上角的星标收藏</span>
        <span v-else-if="tab === TAB_RECENT">还没有最近使用</span>
        <span v-else-if="s.loading">加载中…</span>
        <span v-else>没有匹配的素材</span>
      </div>

      <!-- 触底哨兵 + 加载指示 -->
      <div ref="sentinel" class="sg-sentinel"></div>
      <p v-if="s.loadingMore" class="sg-more">加载中…</p>
      <p v-else-if="!s.hasMore && visible.length" class="sg-more sg-more--end">已经到底啦 · 共 {{ s.total }} 个</p>
    </div>
  </div>
</template>

<style scoped>
.sg { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--ui-panel, #fff); }

/* 顶部 */
.sg-top {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
}
.sg-tabs { display: flex; gap: 4px; }
.sg-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.sg-tab:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); color: var(--ui-ink, #18202b); }
.sg-tab.is-on { background: var(--ui-chip, rgb(0 0 0 / 0.07)); color: var(--ui-ink, #18202b); }
.sg-tab:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }

.sg-search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 160px;
  max-width: 420px;
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));
  transition: background 0.18s ease;
}
.sg-search:focus-within { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
.sg-search-icon { color: var(--ui-ink-mute, #8c95a3); flex: none; }
.sg-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--ui-ink, #18202b);
}
.sg-search-input::placeholder { color: var(--ui-ink-mute, #8c95a3); }
.sg-search-clear {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
}
.sg-search-clear:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }

.sg-tools { display: flex; gap: 4px; margin-left: auto; }
.sg-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.sg-icon:hover { background: var(--ui-hover, rgb(0 0 0 / 0.06)); color: var(--ui-ink, #18202b); }
.sg-icon:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.spin { animation: sg-spin 0.9s linear infinite; }
@keyframes sg-spin { to { transform: rotate(360deg); } }

/* 分类行 */
.sg-cats {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 8px 16px;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
  overflow-x: auto;
}
.sg-cat {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}
.sg-cat:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); color: var(--ui-ink, #18202b); }
.sg-cat.is-on {
  color: var(--ui-accent-hover, #0e7490);
  background: var(--ui-accent-soft, rgb(8 145 178 / 0.12));
  border-color: color-mix(in srgb, var(--ui-accent, #0891b2) 30%, transparent);
}
.sg-cat:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }
.sg-cats-spacer { flex: 1; min-width: 8px; }
.sg-sorts { display: flex; gap: 2px; flex: none; }
.sg-sort {
  height: 28px;
  padding: 0 9px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  cursor: pointer;
}
.sg-sort:hover { color: var(--ui-ink, #18202b); }
.sg-sort.is-on { color: var(--ui-ink, #18202b); background: var(--ui-chip, rgb(0 0 0 / 0.07)); font-weight: 600; }
.sg-sort:focus-visible { outline: 2px solid var(--ui-accent-ring, rgb(8 145 178 / 0.6)); outline-offset: 1px; }

.sg-status {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  margin: 0;
  padding: 8px 16px 0;
  font-size: 11px;
  color: var(--ui-ink-mute, #8c95a3);
}
.sg-status code {
  padding: 0 5px;
  border-radius: 4px;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));
}
.sg-error { flex: none; margin: 8px 16px 0; padding: 8px 10px; border: 1px solid var(--ui-danger, #ef4444); border-radius: 8px; font-size: 12px; color: var(--ui-danger, #ef4444); }

/* 网格区 */
.sg-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 20px; }
.sg-grid { display: grid; gap: 14px; }
.sg-ph {
  aspect-ratio: 3 / 4;
  border-radius: 12px;
  background: var(--ui-veil, rgb(0 0 0 / 0.04));
  animation: sg-pulse 1.4s ease-in-out infinite;
}
@keyframes sg-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }

.sg-empty {
  display: grid;
  place-items: center;
  padding: 60px 12px;
  font-size: 13px;
  color: var(--ui-ink-mute, #8c95a3);
}
.sg-sentinel { height: 1px; }
.sg-more { margin: 12px 0 0; text-align: center; font-size: 12px; color: var(--ui-ink-mute, #8c95a3); }
.sg-more--end { color: var(--ui-ink-mute, #8c95a3); }

@media (prefers-reduced-motion: reduce) {
  .sg-tab, .sg-cat, .sg-sort, .sg-icon, .sg-search, .spin, .sg-ph { transition: none !important; animation: none !important; }
}
</style>
