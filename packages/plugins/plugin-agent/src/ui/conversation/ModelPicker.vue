<script setup lang="ts">
/**
 * ModelPicker —— 模型选择面板（Agent 输入区与底栏共用同一件）。
 *
 * 为什么抽出来（用户 2026-11-07）：
 * 「Agent 插件 UI 里已经有一个配置好的模型下拉菜单，能不能把它作为组件注册到上下文场域中，
 * 然后在底部状态栏里直接使用，这样他们就可以共用。」
 * 所以模型清单、平台分组、图标、搜索、卡片 / 分栏、滚动定位都只在这里实现一份，
 * 底栏按名字从 ui 场里取，不再自己写第二套。
 *
 * 职责边界（重要）：
 * 本组件**只负责“列出并选一个”**，不知道选中之后要干什么。
 * - Agent 输入区选中 = 换会话模型（setModel）；
 * - 底栏选中 = 只记下 provider/modelId，发送时随请求带上。
 * 两者用同一个 emit，由调用方决定。
 *
 * 外观：面板本体（头部 / 搜索 / 列表 / 分栏）常驻；触发器与浮层外壳留给调用方，
 * 这样 Agent 能继续用它原来的图标按钮，底栏能用自己的胶囊触发器。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import { Check, Layers, Search, X } from 'lucide-vue-next'
import type { ModelRow } from '../../service/types.js'
import { brandName, brandSvg, detectPlatform } from '../render/modelBrandIcons.js'
import { scrollTopForVisibleItem } from '../shared/selectionScroll.js'
import AgentScrollArea from './AgentScrollArea.vue'

const props = withDefaults(
  defineProps<{
    /** 全部模型（含没配密钥的）；组件内部自己筛「可用」 */
    models: ModelRow[]
    /** 当前选中（provider + modelId 一起比，避免同名模型同时点亮） */
    current?: { provider: string; modelId: string } | null
    /**
     * 只列有密钥的模型。默认 true（与 Agent 输入区口径一致）；
     * 底栏等场景想看全量时可以关掉。
     */
    usableOnly?: boolean
    /**
     * 紧凑模式：底栏这类窄容器用。
     * 只保留卡片视图、隐藏分栏切换，搜索框仍在。
     */
    /**
     * 已经不再使用：底栏也要卡片 + 分栏两种视图（用户 2026-11-07）。
     * 保留字段是为了不打断现有调用点，传 true 也不再隐藏分栏。
     */
    compact?: boolean
    /**
     * 受控视图（调用方决定卡片 / 分栏）。
     *
     * 为什么必须受控：Agent 的浮层宽度是按视图算的（卡片 340 / 分栏 588），
     * 状态如果只留在本组件内部，点「分栏」只有面板自己变、外层宽度不动 ——
     * 分栏会被塞进 340px，左栏挤没、右侧挤成一列（用户 2026-11-07 截图）。
     * 不传时仍按内部状态工作，底栏那种「自己管宽度」的场景不受影响。
     */
    view?: 'card' | 'split'
  }>(),
  { current: null, usableOnly: true, compact: false },
)

const emit = defineEmits<{
  /** 用户选了某个模型。调用方决定是切会话还是只记下来 */
  pick: [model: { provider: string; modelId: string }]
  /** 视图切到分栏时通知调用方（底栏据此把浮层加宽） */
  "update:view": [view: 'card' | 'split']
}>()

const Button = useUiComponent('Button')
const Badge = useUiComponent('Badge')
const Tabs = useUiComponent('Tabs')
const TabsList = useUiComponent('TabsList')
const TabsTrigger = useUiComponent('TabsTrigger')
const InputGroup = useUiComponent('InputGroup')
const InputGroupAddon = useUiComponent('InputGroupAddon')
const InputGroupButton = useUiComponent('InputGroupButton')
const InputGroupInput = useUiComponent('InputGroupInput')

/** 只有带密钥的模型能选（Agent 口径）；compact 场景也沿用，避免选了用不了的模型 */
const usableModels = computed(() =>
  props.usableOnly ? props.models.filter((m) => m.hasKey) : props.models.slice(),
)

const query = ref('')
const innerView = ref<'card' | 'split'>('card')
/** 受控优先，未传则用内部状态 */
const view = computed(() => props.view ?? innerView.value)
const platform = ref('all')



/**
 * 视图切换只认两个值；认不出就保持原样。
 * （reka 的 Tabs 偶尔传来奇数，回落成 card 会让“界面在分栏、页签在卡片”错位 —— 2026-11-06 实测。）
 */
function setView(value: string | number): void {
  // 只认两档；其它值（键盘切换偶尔传来奇数）保持原样，避免页签与界面错位
  if (value !== 'split' && value !== 'card') return
  const next = value as 'card' | 'split'
  if (innerView.value !== next) innerView.value = next
  // 受控时也要把用户意图发出去：外层据此改浮层宽度
  emit('update:view', next)
}

function modelNote(m: { contextWindow?: number; isVision: boolean }): string {
  if (m.contextWindow) return Math.round(m.contextWindow / 1000) + 'K'
  return m.isVision ? '视觉' : ''
}

/** provider + modelId 一起比才是「同一个模型」 */
function isPicked(m: { provider: string; modelId: string }): boolean {
  return props.current?.provider === m.provider && props.current?.modelId === m.modelId
}

/** 平台 key（图标与分组共用一把尺子） */
function platformOf(m: { provider: string; modelId: string }): string {
  return detectPlatform(m.modelId, m.provider)
}

function brandNameOf(m: { provider: string; modelId: string }): string {
  return brandName(platformOf(m))
}

function brandSvgOf(m: { provider: string; modelId: string }): string {
  return brandSvg(platformOf(m))
}

/** 分栏左列：按平台聚合（不是按 provider 原样列） */
const platformGroups = computed(() => {
  const rows: Array<{ key: string; label: string; count: number }> = []
  for (const m of usableModels.value) {
    const key = platformOf(m)
    const hit = rows.find((g) => g.key === key)
    if (hit) hit.count++
    else rows.push({ key, label: brandName(key), count: 1 })
  }
  return [{ key: 'all', label: '全部平台', count: usableModels.value.length }, ...rows]
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return usableModels.value.filter((m) => {
    if (platform.value !== 'all' && platformOf(m) !== platform.value) return false
    if (!q) return true
    const brand = brandName(platformOf(m))
    return (m.modelId + ' ' + m.provider + ' ' + modelNote(m) + ' ' + brand).toLowerCase().includes(q)
  })
})

/** 打开时把选中项滚进可视区（细节见函数体注释） */
const scrollRef = ref<HTMLElement | null>(null)

function scrollRootOf(value: unknown): HTMLElement | null {
  if (!value) return null
  if (value instanceof HTMLElement) return value
  const exposed = value as { rootElement?: () => HTMLElement | null }
  return typeof exposed.rootElement === 'function' ? exposed.rootElement() : null
}

/**
 * 把选中的那条滚进可视区。
 *
 * 用真实矩形换算（不用 offsetTop）：列表项与外层滚动区之间隔了好几层 offsetParent，
 * 相减出来的位置不准。选中态认 aria-selected="true" —— 那是唯一真相。
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
  // 落地后再量一次按实际差补齐：滚完滚动条可能出现/消失，实际位置会差几像素
  const selRect = item.getBoundingClientRect()
  const boxRect = box.getBoundingClientRect()
  if (selRect.bottom > boxRect.bottom) box.scrollTop += selRect.bottom - boxRect.bottom
  else if (selRect.top < boxRect.top) box.scrollTop -= boxRect.top - selRect.top
}

/** 滚两次：先立刻滚（面板刚挂上），200ms 后再校正（入场 scale 动画会把矩形缩过） */
let settleTimer: number | null = null
function scheduleScroll(): void {
  scrollSelectedIntoView()
  if (settleTimer !== null) window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => {
    settleTimer = null
    scrollSelectedIntoView()
  }, 200)
}

let observer: ResizeObserver | null = null
let resizeTimer: number | null = null

/**
 * 盯滚动区高度：入场动画 / 搜索收窄都会改变可用高度，只按某一刻算会差十几像素。
 * 尺寸变化先攒 80ms —— 写 scrollTop 本身会让滚动条出现，反过来又触发一次观察，
 * 不攒会把自己刚滚好的位置拉回去。
 */
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

/** 面板每次显示 / 切视图 / 换筛选，都重新定位一次选中项 */
function refreshLayout(): void {
  void nextTick(() => {
    scheduleScroll()
    observeBox()
  })
}

watch(
  () => [props.current?.provider, props.current?.modelId, props.models.length],
  () => refreshLayout(),
)
watch(view, () => refreshLayout())
watch(platform, () => refreshLayout())

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  if (settleTimer !== null) window.clearTimeout(settleTimer)
})

/** 点一项：交给调用方决定后续（换会话 / 只记选择） */
function pick(m: ModelRow): void {
  emit('pick', { provider: m.provider, modelId: m.modelId })
}

defineExpose({ refreshLayout })
</script>

<template>
  <div class="ac-panel ac-model-panel mp-root" :class="{ 'is-split': view === 'split' }" role="listbox" aria-label="选择模型">
    <div class="ac-panel-head">
      <div class="ac-panel-head-top">
        <div class="ac-panel-heading">
          <span class="ac-panel-title">模型</span>
          <span class="ac-panel-count">{{ usableModels.length }}</span>
        </div>
        <!-- 紧凑模式（底栏）不显示分栏切换：窄容器里左栏 + 右栏放不下 -->
        <Tabs :model-value="view" @update:model-value="setView">
          <TabsList aria-label="面板布局">
            <TabsTrigger value="card" :data-state="view === 'card' ? 'active' : 'inactive'"
              :aria-selected="view === 'card'" @click="setView('card')">卡片</TabsTrigger>
            <TabsTrigger value="split" :data-state="view === 'split' ? 'active' : 'inactive'"
              :aria-selected="view === 'split'" @click="setView('split')">分栏</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <!-- 搜索框：常显（不折成放大镜），组件库默认样式 -->
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <Search :size="14" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput v-model="query" type="search" name="mp-model-search"
          data-ac-search="model" placeholder="搜索模型或平台" aria-label="搜索模型或平台" autocomplete="off" spellcheck="false" />
        <InputGroupAddon v-if="query" align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="query = ''">
            <X />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>

    <div v-if="!usableModels.length" class="ac-menu-empty">没有可用模型（先去设置里配一个）</div>

    <div v-else ref="scrollRef" data-model-scroll class="ac-menu-scroll ac-panel-body">
      <div class="ac-view-stack">
        <AgentScrollArea class="ac-panel-scroll ac-view-pane" :class="{ 'is-active': view === 'card' }"
          body-class="ac-panel-scroll-body ac-model-scroll-body">
          <div v-if="filtered.length" class="ac-model-grid">
            <Button v-for="m in filtered" :key="m.provider + '/' + m.modelId" variant="ghost" size="sm"
              role="option" :aria-selected="isPicked(m)" @click="pick(m)">
              <span class="ac-model-brand" :title="brandNameOf(m)" aria-hidden="true" v-html="brandSvgOf(m)"></span>
              <span class="ac-model-copy">
                <span class="ac-model-card-top">
                  <span class="ac-model-id">{{ m.modelId }}</span>
                  <Badge v-if="m.isDefault" variant="secondary">默认</Badge>
                  <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
                </span>
                <span class="ac-model-meta">
                  <span>{{ brandNameOf(m) }}</span>
                  <span class="ac-dot-sep" aria-hidden="true"></span>
                  <span>{{ modelNote(m) }}</span>
                </span>
              </span>
            </Button>
          </div>
          <div v-else class="ac-empty-state">
            <span class="ac-empty-icon"><Search :size="18" /></span>
            <span class="ac-empty-title">没有找到模型</span>
            <span class="ac-empty-desc">换个模型名或平台名试试。</span>
          </div>
        </AgentScrollArea>

        <div class="ac-view-pane ac-split" :class="{ 'is-active': view === 'split' }">
          <aside class="ac-split-rail" aria-label="模型平台">
            <div class="ac-rail-label">平台</div>
            <AgentScrollArea class="ac-rail-scroll" body-class="ac-rail-scroll-body">
              <Button v-for="g in platformGroups" :key="g.key" variant="ghost" size="sm"
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
                <Button v-for="m in filtered" :key="m.provider + '/' + m.modelId" variant="ghost" size="sm"
                  role="option" :aria-selected="isPicked(m)" @click="pick(m)">
                  <span class="ac-model-brand" :title="brandNameOf(m)" aria-hidden="true" v-html="brandSvgOf(m)"></span>
                  <span class="ac-model-copy">
                    <span class="ac-model-id">{{ m.modelId }}</span>
                    <span class="ac-model-meta">
                      <span>{{ brandNameOf(m) }}</span>
                      <span class="ac-dot-sep" aria-hidden="true"></span>
                      <span>{{ modelNote(m) }}</span>
                    </span>
                  </span>
                  <span class="ac-model-badges">
                    <Badge v-if="m.isDefault" variant="secondary">默认</Badge>
                  </span>
                  <span class="ac-check-mark" aria-hidden="true"><Check :size="16" :stroke-width="2" /></span>
                </Button>
              </div>
              <div v-else class="ac-empty-state">
                <span class="ac-empty-icon"><Search :size="18" /></span>
                <span class="ac-empty-title">没有找到模型</span>
                <span class="ac-empty-desc">换个模型名或平台名试试。</span>
              </div>
            </AgentScrollArea>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./agent-composer/part4.css"></style>
<style scoped src="./agent-composer/part3.css"></style>
<style scoped src="./agent-composer/part2.css"></style>

