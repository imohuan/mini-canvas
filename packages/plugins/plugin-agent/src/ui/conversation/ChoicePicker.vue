<script setup lang="ts">
/**
 * ChoicePicker —— 「卡片 / 分栏」两视图的通用选择面板（ModelPicker 的通用版）。
 *
 * 用户口径（2026-11-07）：
 * 「我 Agent 那个插件里面的模型下拉是有两种的：第一个是卡片形式，第二个是分栏形式。
 *   这边其实你的文本、图片和视频，下拉都可以使用这种方式。」
 *
 * 所以卡片/分栏这套交互从模型上剥离出来：
 * - 模型：调用方传模型清单（ModelPicker 就是它对 `ModelPicker` 的封装）；
 * - 图片 / 视频：调用方传生成动作清单（每个动作一条），同样能卡片、能分栏、能按平台聚合。
 *
 * 面板只负责「列出 → 选一个」，选中之后干什么由调用方决定（emit('pick')）。
 *
 * 注意：SVG 的渐变靠 url(#id) 引用，同一张图重复出现时 id 撞车会让后出现的变空白，
 * 所以这里统一用 brandSvg() 取图（它每次都给独立 id）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { Check, Layers, Search, X } from 'lucide-vue-next'
import { brandName, brandSvg, detectPlatform } from '../render/modelBrandIcons.js'
import { scrollTopForVisibleItem } from '../shared/selectionScroll.js'
import AgentScrollArea from './AgentScrollArea.vue'

/** 面板里的一行：模型或生成动作都归一成这个形状 */
export interface ChoiceItem {
  /** 唯一 id（选中回传给调用方） */
  id: string
  /** 主标题（卡片第一行） */
  title: string
  /** 副标题（平台名 / 说明） */
  subtitle?: string
  /** 右侧备注（上下文长度 / 参数摘要） */
  note?: string
  /** 平台 key；不传就按 title 猜 */
  platform?: string
  /** 是否默认项（右上角挂 Badge） */
  isDefault?: boolean
  /** 是否可用（无密钥的模型 / 当前节点不支持的动作） */
  disabled?: boolean
  /**
   * 这一行自己的图标（完整 `<svg>` 或 `<img>` 字符串），由调用方给。
   *
   * 为什么需要：面板原来只有「按 platform 查品牌图标」一条路，于是 provider 自带的
   * 图标只在触发器上出现、列表里被换成兜底图形（用户 2026-11-08 截图）。
   * 给了 svg 就原样渲染，platform 继续只负责分组与名字。
   */
  svg?: string
}

const props = withDefaults(
  defineProps<{
    items: ChoiceItem[]
    /** 当前选中项的 id */
    currentId?: string
    /** 面板标题（模型 / 生成） */
    title?: string
    /** 搜索占位文案 */
    placeholder?: string
    /** 分栏左列标题（平台 / 分类） */
    railLabel?: string
    /** 是否显示「全部」那一行 */
    showAll?: boolean
    /** 空态说明 */
    emptyText?: string
  }>(),
  {
    currentId: '',
    title: '选择',
    placeholder: '搜索…',
    railLabel: '平台',
    showAll: true,
    emptyText: '没有匹配项',
  },
)

const emit = defineEmits<{
  pick: [item: ChoiceItem]
  /** 视图切换（底栏据此在分栏时把浮层加宽加高） */
  'update:view': [view: 'card' | 'split']
}>()

const Button = useUiComponent('Button')
const Badge = useUiComponent('Badge')
const InputGroup = useUiComponent('InputGroup')
const InputGroupAddon = useUiComponent('InputGroupAddon')
const InputGroupButton = useUiComponent('InputGroupButton')
const InputGroupInput = useUiComponent('InputGroupInput')

const query = ref('')
const view = ref<'card' | 'split'>('card')
const platform = ref('all')

/** 只认 card / split；其它值（键盘切换偶尔传来奇数）保持原样，避免页签与界面错位 */
function setView(value: string | number): void {
  if (value === 'split' && view.value !== 'split') view.value = 'split'
  else if (value === 'card' && view.value !== 'card') view.value = 'card'
  emit('update:view', view.value)
}

function platformOf(item: ChoiceItem): string {
  return item.platform || detectPlatform(item.title, '')
}

const platforms = computed(() => {
  const rows: Array<{ key: string; label: string; count: number }> = []
  for (const item of props.items) {
    const key = platformOf(item)
    const hit = rows.find((g) => g.key === key)
    if (hit) hit.count++
    else rows.push({ key, label: brandName(key), count: 1 })
  }
  return props.showAll
    ? [{ key: 'all', label: '全部平台', count: props.items.length }, ...rows]
    : rows
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.items.filter((item) => {
    if (platform.value !== 'all' && platformOf(item) !== platform.value) return false
    if (!q) return true
    const brand = brandName(platformOf(item))
    return (item.title + ' ' + (item.subtitle ?? '') + ' ' + (item.note ?? '') + ' ' + brand).toLowerCase().includes(q)
  })
})

/** 每个视图一个滚动容器，各自的 ref */
const scrollRef = ref<HTMLElement | null>(null)

function scrollRootOf(value: unknown): HTMLElement | null {
  if (!value) return null
  if (value instanceof HTMLElement) return value
  const exposed = value as { rootElement?: () => HTMLElement | null }
  return typeof exposed.rootElement === 'function' ? exposed.rootElement() : null
}

/**
 * 把选中项滚进可视区。
 *
 * 用真实矩形换算（不用 offsetTop）：列表项与外层滚动区之间隔了好几层 offsetParent。
 * 选中态认 aria-selected="true" —— 那是唯一真相。
 */
function scrollSelectedIntoView(): void {
  const root = scrollRootOf(scrollRef.value)
  const sel = (root ?? document).querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
  const scrollViewport = (el: Element | null | undefined): HTMLElement | null =>
    el?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? (el as HTMLElement | null) ?? null
  const box = scrollViewport(sel?.closest<HTMLElement>('.ac-split-scroll, .ac-menu-scroll') ?? scrollViewport(root))
  if (!box || box.clientHeight <= 0) return
  const item = sel && box.contains(sel) ? sel : box.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
  if (!item) return
  const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
  box.scrollTop = scrollTopForVisibleItem(
    { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight, clientHeight: box.clientHeight },
    { top, height: item.offsetHeight },
    4,
  )
  const selRect = item.getBoundingClientRect()
  const boxRect = box.getBoundingClientRect()
  if (selRect.bottom > boxRect.bottom) box.scrollTop += selRect.bottom - boxRect.bottom
  else if (selRect.top < boxRect.top) box.scrollTop -= boxRect.top - selRect.top
}

let settleTimer: number | null = null
let observer: ResizeObserver | null = null
let resizeTimer: number | null = null

/** 滚两次：立刻一次 + 入场动画结束后校正一次 */
function scheduleScroll(): void {
  scrollSelectedIntoView()
  if (settleTimer !== null) window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    scrollSelectedIntoView()
  }, 200)
}

/** 尺寸一变就重定位（先攒 80ms，避免自己滚动触发自己） */
function observeBox(): void {
  observer?.disconnect()
  observer = null
  const root = scrollRootOf(scrollRef.value)
  const box =
    root?.querySelector<HTMLElement>('.ac-split-scroll [data-slot="scroll-area-viewport"]') ??
    root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]') ??
    null
  if (!box || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null
      scrollSelectedIntoView()
    }, 80)
  })
  observer.observe(box)
}

function refreshLayout(): void {
  void nextTick(() => {
    scheduleScroll()
    observeBox()
  })
}

watch(() => [props.currentId, props.items.length], () => refreshLayout())
watch(view, () => refreshLayout())
watch(platform, () => refreshLayout())

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  if (settleTimer !== null) window.clearTimeout(settleTimer)
})

function pick(item: ChoiceItem): void {
  if (item.disabled) return
  emit('pick', item)
}

defineExpose({ refreshLayout })
</script>

<template>
  <div class="ac-panel cp-panel" :class="{ 'is-split': view === 'split' }" role="listbox" :aria-label="title">
    <div class="ac-panel-head">
      <div class="ac-panel-head-top">
        <div class="ac-panel-heading">
          <span class="ac-panel-title">{{ title }}</span>
          <span class="ac-panel-count">{{ items.length }}</span>
        </div>
        <!-- 卡片 / 分栏：Agent 模型下拉的同一套交互，图片 / 视频也用它 -->
        <!--
          与 ModelPicker 同一条规矩：页签只走 update:model-value 一条通道，
          不再手写 @click（同一次点击 setView 被调两次 → 页签与界面错位）。
          data-state / aria-selected 交给 reka。
        -->
        <!--
          卡片 / 分栏页签：**自定义按钮**，不再用 shadcn Tabs。
          用户 2026-11-07：reka Tabs 的选中态是组件内部状态，切换时高亮与内容
          长期不同步（连续反馈 5+ 次）。自定义版的高亮直接绑在本组件的 view 上，
          类一变立刻重渲染，不存在第二份状态。
        -->
        <div class="ac-view-tabs" role="tablist" aria-label="面板布局">
          <button
            type="button"
            class="ac-view-tab"
            :class="{ 'is-active': view === 'card' }"
            :aria-selected="view === 'card'"
            role="tab"
            @click="setView('card')"
          >卡片</button>
          <button
            type="button"
            class="ac-view-tab"
            :class="{ 'is-active': view === 'split' }"
            :aria-selected="view === 'split'"
            role="tab"
            @click="setView('split')"
          >分栏</button>
        </div>
      </div>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <Search :size="14" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput v-model="query" type="search" name="cp-search" :placeholder="placeholder"
          :aria-label="placeholder" autocomplete="off" spellcheck="false" />
        <InputGroupAddon v-if="query" align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="query = ''">
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>

    <div v-if="!items.length" class="ac-menu-empty">{{ emptyText }}</div>

    <div v-else ref="scrollRef" class="ac-menu-scroll ac-panel-body">
      <div class="ac-view-stack">
        <AgentScrollArea class="ac-panel-scroll ac-view-pane" :class="{ 'is-active': view === 'card' }"
          body-class="ac-panel-scroll-body ac-model-scroll-body">
          <div v-if="filtered.length" class="ac-model-grid">
            <Button v-for="item in filtered" :key="item.id" variant="ghost" size="sm"
              role="option" :aria-selected="item.id === currentId" :disabled="item.disabled" @click="pick(item)">
              <span class="ac-model-brand" :title="brandName(platformOf(item))" aria-hidden="true"
                v-html="item.svg || brandSvg(platformOf(item))"></span>
              <span class="ac-model-copy">
                <span class="ac-model-card-top">
                  <span class="ac-model-id">{{ item.title }}</span>
                  <Badge v-if="item.isDefault" variant="secondary">默认</Badge>
                  <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
                </span>
                <span class="ac-model-meta">
                  <span>{{ item.subtitle || brandName(platformOf(item)) }}</span>
                  <template v-if="item.note">
                    <span class="ac-dot-sep" aria-hidden="true"></span>
                    <span>{{ item.note }}</span>
                  </template>
                </span>
              </span>
            </Button>
          </div>
          <div v-else class="ac-empty-state">
            <span class="ac-empty-icon"><Search :size="18" /></span>
            <span class="ac-empty-title">{{ emptyText }}</span>
            <span class="ac-empty-desc">换个关键词或平台试试。</span>
          </div>
        </AgentScrollArea>

        <div class="ac-view-pane ac-split" :class="{ 'is-active': view === 'split' }">
          <aside class="ac-split-rail" :aria-label="railLabel">
            <div class="ac-rail-label">{{ railLabel }}</div>
            <AgentScrollArea class="ac-rail-scroll" body-class="ac-rail-scroll-body">
              <Button v-for="g in platforms" :key="g.key" variant="ghost" size="sm"
                :aria-pressed="platform === g.key" @click="platform = g.key">
                <span v-if="g.key === 'all'" class="ac-rail-icon" aria-hidden="true"><Layers :size="14" /></span>
                <span v-else class="ac-rail-brand" :title="g.label" aria-hidden="true" v-html="brandSvg(g.key)"></span>
                <span class="ac-rail-name">{{ g.label }}</span>
                <span class="ac-rail-count">{{ g.count }}</span>
              </Button>
            </AgentScrollArea>
          </aside>
          <div class="ac-split-main">
            <AgentScrollArea class="ac-split-scroll" body-class="ac-split-scroll-body">
              <div v-if="filtered.length" class="ac-model-row-list">
                <Button v-for="item in filtered" :key="item.id" variant="ghost" size="sm"
                  role="option" :aria-selected="item.id === currentId" :disabled="item.disabled" @click="pick(item)">
                  <span class="ac-model-brand" :title="brandName(platformOf(item))" aria-hidden="true"
                  v-html="item.svg || brandSvg(platformOf(item))"></span>
                  <span class="ac-model-copy">
                    <span class="ac-model-id">{{ item.title }}</span>
                    <span class="ac-model-meta">
                      <span>{{ item.subtitle || brandName(platformOf(item)) }}</span>
                      <template v-if="item.note">
                        <span class="ac-dot-sep" aria-hidden="true"></span>
                        <span>{{ item.note }}</span>
                      </template>
                    </span>
                  </span>
                  <span class="ac-model-badges">
                    <Badge v-if="item.isDefault" variant="secondary">默认</Badge>
                  </span>
                  <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
                </Button>
              </div>
              <div v-else class="ac-empty-state">
                <span class="ac-empty-icon"><Search :size="18" /></span>
                <span class="ac-empty-title">{{ emptyText }}</span>
                <span class="ac-empty-desc">换个关键词或平台试试。</span>
              </div>
            </AgentScrollArea>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./agent-composer/part2.css"></style>
<style scoped src="./agent-composer/part3.css"></style>
<style scoped src="./agent-composer/part4.css"></style>

