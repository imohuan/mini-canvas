<script setup lang="ts">
/**
 * AppSettingsPanel —— 成品应用的设置内容区（左侧图标导航 + 右侧当前分类）。
 *
 * 只画 SettingsShell 里面那一格：遮罩、标题栏、关闭按钮、Esc、浮动窗都由外壳统一提供。
 * 因此这里不再重复画关闭按钮；关闭仍走外壳的 settings:ui-close 事件。
 *
 * 结构：
 * - 左：分组标题 + 一级菜单；每项一个图标，图标来自独立场域 settings/navIcon。
 * - 右：当前分类的配置项，一行一个：左边标题与说明，右边 shadcn 控件。
 * - 一级下只有一个二级分组时合并成一项；有多个时用页签切换。
 *
 * 兼容：
 * - settings.nav：插件导航项按 id / meta.title 命中默认一级项时顶替，否则追加。
 * - settings.tab：只对当前一级生效，可顶替或追加页签。
 * - settingsGroup/<完整 key>：内容插槽继续消费，prepend / append / replace 原样支持。
 *
 * 数据来自宿主的 props.settings；字段控件按 ui 目录取，主题没登记时回落默认皮。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import type { Component } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { SETTINGS_FIELD_RENDERER, useCanvasRender } from '@mini-canvas/canvas-render'
import DefaultSettingsSchemaField from '@mini-canvas/plugin-theme-default/components/settings/SettingsSchemaField.vue'
// 导航图标是设置面板自己的兜底，不依赖主题包的内部文件：
// 场域里没有该分组时，画一个通用圆点，保证每一行都有图标。
import { Circle } from 'lucide-vue-next'
import ShadcnSettingsNavItem from '@mini-canvas/plugin-theme-default/components/settings/ShadcnSettingsNavItem.vue'
import ShadcnSettingsSection from '@mini-canvas/plugin-theme-default/components/settings/ShadcnSettingsSection.vue'
import { useUiComponentOutside } from '../../composables/ui'
import { createSettingsFieldBridge } from './settingsFieldBridge'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlotOcc = { id: string; order: number; component: any; meta?: any }

const props = defineProps<{ settings: SettingsPanelSource }>()

const { ctx } = useCanvasRender()

/** 字段控件按 ui 目录取；没登记时用默认皮的 */
const SettingsSchemaField = useUiComponentOutside('settingsField')
const FieldRenderer = computed(() => (SettingsSchemaField.value ?? DefaultSettingsSchemaField) as Component)

/**
 * 给子树一个稳定的桥组件：目录热替换时，已挂载的插件自绘页也能跟着换。
 * provide 的值不参与响应式解包，所以不能直接传 computed。
 */
const SettingsFieldBridge = createSettingsFieldBridge(
  () => SettingsSchemaField.value as Component | undefined,
  DefaultSettingsSchemaField,
)
provide(SETTINGS_FIELD_RENDERER, markRaw(SettingsFieldBridge))

const SEP = '/'

/** 一级名：第一个 / 分段 */
function navOf(key: string): string {
  return key.split(SEP)[0]
}

/** 二级展示名：/ 之后的段 */
function leafLabelOf(key: string): string {
  const segs = key.split(SEP)
  return segs.slice(1).join(SEP) || segs[0]
}

// —— 插件装卸：重读导航、页签、内容插槽 ——
const occTick = ref(0)
const navList = ref<SlotOcc[]>([])
const tabList = ref<SlotOcc[]>([])

function reloadSlots(): void {
  navList.value = ctx.slots.occupants('settings.nav').map((entry) => ({
    id: entry.id,
    order: entry.order,
    component: markRaw(entry.component as object),
    meta: entry.meta,
  }))
  tabList.value = ctx.slots.occupants('settings.tab').map((entry) => ({
    id: entry.id,
    order: entry.order,
    component: markRaw(entry.component as object),
    meta: entry.meta,
  }))
}
reloadSlots()

const disposers: Array<{ dispose(): void }> = [
  ctx.on('ctx:plugin-installed', () => {
    reloadSlots()
    occTick.value += 1
  }),
  ctx.on('ctx:plugin-uninstalled', () => {
    reloadSlots()
    occTick.value += 1
  }),
]

onBeforeUnmount(() => {
  for (const disposer of disposers) disposer.dispose()
  cancelScrollAnimation()
  releaseScrollLock()
})

// —— 分组 ——
const groups = computed<string[]>(() => {
  void occTick.value
  return props.settings.groups()
})

const sectionMap = computed<Map<string, string[]>>(() => {
  const map = new Map<string, string[]>()
  for (const group of groups.value) {
    const nav = navOf(group)
    if (!map.has(nav)) map.set(nav, [])
    map.get(nav)!.push(group)
  }
  return map
})

interface NavEntry {
  key: string
  kind: 'section' | 'nav'
  leaves: string[]
  component?: Component
  title: string
  order: number
}

/** 分组推导的一级项 + 插件导航项（命中默认项就顶替外观，否则追加） */
const navEntries = computed<NavEntry[]>(() => {
  const out: NavEntry[] = []
  let index = 0
  for (const [nav, leaves] of sectionMap.value) {
    out.push({ key: nav, kind: 'section', leaves, title: nav, order: 100 + index })
    index += 1
  }
  const byKey = new Map(out.map((entry) => [entry.key, entry]))
  const byTitle = new Map(out.map((entry) => [entry.title, entry]))
  const extras: NavEntry[] = []
  for (const occ of [...navList.value].sort((a, b) => a.order - b.order)) {
    const title = typeof occ.meta?.title === 'string' ? occ.meta.title : ''
    const hit = byKey.get(occ.id) ?? (title ? byTitle.get(title) : undefined)
    if (hit) {
      hit.kind = 'nav'
      hit.component = occ.component as Component
      continue
    }
    extras.push({
      key: occ.id,
      kind: 'nav',
      leaves: [],
      component: occ.component as Component,
      title: title || leafLabelOf(occ.id),
      order: occ.order,
    })
  }
  out.push(...extras)
  return out
})

const activeNav = ref<string>('')
const activeEntry = computed<NavEntry | undefined>(() =>
  navEntries.value.find((entry) => entry.key === activeNav.value),
)

interface Section {
  key: string
  label: string
  kind: 'leaf' | 'tab'
  component?: Component
}

/** 当前一级下的段：默认分组 + 插件页签 */
const sections = computed<Section[]>(() => {
  const nav = activeNav.value
  const leaves = sectionMap.value.get(nav) ?? []
  const occs = tabList.value
    .filter((occ) => occ.id === nav || occ.id.startsWith(nav + SEP))
    .sort((a, b) => a.order - b.order)
  const byLeaf = new Map<string, SlotOcc>()
  const customs: SlotOcc[] = []
  for (const occ of occs) {
    if (leaves.includes(occ.id)) byLeaf.set(occ.id, occ)
    else customs.push(occ)
  }
  const out: Section[] = leaves.map((leaf) => {
    const occ = byLeaf.get(leaf)
    return occ
      ? { key: leaf, label: leafLabelOf(leaf), kind: 'tab', component: occ.component as Component }
      : { key: leaf, label: leafLabelOf(leaf), kind: 'leaf' }
  })
  for (const occ of customs) {
    out.push({
      key: occ.id,
      label: typeof occ.meta?.title === 'string' ? occ.meta.title : leafLabelOf(occ.id),
      kind: 'tab',
      component: occ.component as Component,
    })
  }
  return out
})

const activeSection = ref<string>('')
const activeSectionIndex = computed<number>(() =>
  Math.max(0, sections.value.findIndex((section) => section.key === activeSection.value)),
)
const showTabs = computed<boolean>(() => sections.value.length > 1)

// 分组变化后保证高亮仍指向存在的项
watch(
  navEntries,
  (entries) => {
    if (!entries.length) {
      activeNav.value = ''
      return
    }
    if (!entries.some((entry) => entry.key === activeNav.value)) activeNav.value = entries[0].key
  },
  { immediate: true },
)

watch(
  sections,
  (list) => {
    if (!list.length) {
      activeSection.value = ''
      return
    }
    if (!list.some((section) => section.key === activeSection.value)) activeSection.value = list[0].key
  },
  { immediate: true },
)

function selectNav(key: string): void {
  if (activeNav.value === key) return
  activeNav.value = key
}

function selectSection(key: string): void {
  if (activeSection.value === key) return
  activeSection.value = key
  scrollBodyToTop()
}

// —— 滚动锁：与旧面板同一套目的，避免切换时被滚动回调打断 ——
const scrollEl = ref<HTMLElement | null>(null)
let scrollLocked = false
let scrollLockTimer: ReturnType<typeof setTimeout> | null = null
/** 当前挂着 scrollend 的容器与回调：释放时要精确摘掉，否则旧回调会放掉下一次的锁 */
let scrollLockEl: HTMLElement | null = null
let scrollLockOnEnd: (() => void) | null = null
const SCROLL_DURATION_MS = 240
const SCROLL_LOCK_MAX_MS = SCROLL_DURATION_MS + 200
let scrollRaf = 0

function cancelScrollAnimation(): void {
  if (scrollRaf === 0) return
  cancelAnimationFrame(scrollRaf)
  scrollRaf = 0
}

function releaseScrollLock(): void {
  scrollLocked = false
  if (scrollLockTimer !== null) {
    clearTimeout(scrollLockTimer)
    scrollLockTimer = null
  }
  if (scrollLockEl && scrollLockOnEnd) {
    scrollLockEl.removeEventListener('scrollend', scrollLockOnEnd)
  }
  scrollLockEl = null
  scrollLockOnEnd = null
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function prefersReducedMotion(): boolean {
  const match = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia
  return typeof match === 'function' ? match('(prefers-reduced-motion: reduce)').matches : false
}

/** 内容回顶：短补间 + scrollend 锁，避免切页瞬间的高亮抖动 */
function animateScrollTop(el: HTMLElement, top: number): void {
  cancelScrollAnimation()
  const from = el.scrollTop
  const delta = top - from
  if (!delta) return
  if (prefersReducedMotion()) {
    el.scrollTop = top
    return
  }
  const start = performance.now()
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / SCROLL_DURATION_MS)
    el.scrollTop = from + delta * easeOutCubic(t)
    scrollRaf = t < 1 ? requestAnimationFrame(step) : 0
  }
  scrollRaf = requestAnimationFrame(step)
}

function lockScrollUntilSettles(el: HTMLElement): void {
  scrollLocked = true
  if (scrollLockTimer !== null) clearTimeout(scrollLockTimer)
  scrollLockTimer = setTimeout(releaseScrollLock, SCROLL_LOCK_MAX_MS)
  if (scrollLockEl && scrollLockOnEnd && scrollLockEl !== el) {
    scrollLockEl.removeEventListener('scrollend', scrollLockOnEnd)
  }
  const onEnd = (): void => {
    el.removeEventListener('scrollend', onEnd)
    releaseScrollLock()
  }
  scrollLockEl = el
  scrollLockOnEnd = onEnd
  el.addEventListener('scrollend', onEnd)
}

function scrollBodyToTop(): void {
  const el = scrollEl.value
  if (!el) return
  lockScrollUntilSettles(el)
  animateScrollTop(el, 0)
}

watch(activeNav, () => {
  activeSection.value = sections.value[0]?.key ?? ''
  void nextTick(scrollBodyToTop)
})

// —— 图标：独立场域 settings/navIcon，order 小者胜；取不到用兜底 ——
const navIcons = ctx.registryOf<unknown>('settings/navIcon')
const iconTick = ref(0)
if (navIcons && typeof navIcons.subscribe === 'function') {
  const off = navIcons.subscribe(() => void (iconTick.value += 1))
  // Registry.subscribe 返回 Disposable
  disposers.push(off)
}

function iconOf(name: string): unknown {
  void iconTick.value
  return navIcons?.top(name)?.value ?? Circle
}

// —— 段落正文：内容插槽优先，否则按 schema 平铺 ——
function slotMode(occ: SlotOcc): 'replace' | 'prepend' | 'append' {
  const mode = (occ.meta as { mode?: string } | undefined)?.mode
  return mode === 'prepend' ? 'prepend' : mode === 'append' ? 'append' : 'replace'
}

type ContentBlock =
  | { kind: 'field'; key: string }
  | { kind: 'slot'; occ: SlotOcc }

function blocksOf(groupKey: string): ContentBlock[] {
  void occTick.value
  const occs = ctx.slots.occupants('settingsGroup/' + groupKey).map((entry) => ({
    id: entry.id,
    order: entry.order,
    component: markRaw(entry.component as object),
    meta: entry.meta,
  }))
  const fields = props.settings.groupOf(groupKey)
  if (!occs.length) return fields.map((item) => ({ kind: 'field' as const, key: item.key }))
  const coexist = occs.some((occ) => slotMode(occ) !== 'replace')
  const sorted = (mode: string): SlotOcc[] =>
    occs.filter((occ) => slotMode(occ) === mode).sort((a, b) => a.order - b.order)
  const blocks: ContentBlock[] = []
  blocks.push(...sorted('prepend').map((occ) => ({ kind: 'slot' as const, occ })))
  if (coexist) blocks.push(...fields.map((item) => ({ kind: 'field' as const, key: item.key })))
  blocks.push(...sorted('replace').map((occ) => ({ kind: 'slot' as const, occ })))
  blocks.push(...sorted('append').map((occ) => ({ kind: 'slot' as const, occ })))
  return blocks
}

/** 点击页签：只切内容；同一页里的长内容回到顶部 */
function selectTab(key: string): void {
  activeSection.value = key
  scrollBodyToTop()
}
</script>

<template>
  <div class="asp-root">
    <!-- 左：分组标题 + 图标导航 -->
    <aside class="asp-nav">
      <p class="asp-nav-caption">设置</p>
      <p v-if="!navEntries.length" class="asp-nav-empty">暂无设置分组</p>
      <div v-for="item in navEntries" :key="item.key" class="asp-nav-cell">
        <ShadcnSettingsNavItem
          v-if="item.kind === 'section'"
          :icon="iconOf(item.key)"
          :label="item.title"
          :active="activeNav === item.key"
          @select="selectNav(item.key)"
        />
        <!-- 插件导航沿用自己的组件；面板只收口行高/圆角，让整列对齐 -->
        <div v-else class="asp-nav-plugin">
          <component
            :is="item.component"
            v-if="item.component"
            :group="item.key"
            :active="activeNav === item.key"
            :on-select="selectNav"
          />
        </div>
      </div>
    </aside>

    <!-- 右：当前分类 -->
    <div class="asp-panel">
      <header class="asp-panel-head">
        <h3 class="asp-panel-title">{{ activeEntry?.title || '设置' }}</h3>
        <p v-if="activeEntry?.leaves.length" class="asp-panel-meta">
          {{ activeEntry.leaves.length }} 个分组
        </p>
      </header>

      <div
        v-if="showTabs"
        class="asp-tabbar"
        role="tablist"
        :aria-label="(activeEntry?.title || '设置') + '分类'"
      >
        <template v-for="section in sections" :key="section.key">
          <component
            :is="section.component"
            v-if="section.kind === 'tab' && section.component"
            :group="section.key"
            :active="activeSection === section.key"
            :on-select="selectTab"
            class="asp-tab-item"
            :data-tab="section.key"
          />
          <button
            v-else
            class="asp-tab-item"
            role="tab"
            :class="{ 'is-active': activeSection === section.key }"
            :aria-selected="activeSection === section.key"
            :data-tab="section.key"
            @click="selectTab(section.key)"
          >
            {{ section.label }}
          </button>
        </template>
      </div>

      <!-- 不用滚动反向切页：点在页签上的选择必须稳定，滚动只滚当前页 -->
      <div ref="scrollEl" class="asp-body">
        <div v-if="!sections.length" class="asp-empty">暂无设置项</div>

        <section
          v-for="(section, index) in sections"
          v-show="index === activeSectionIndex"
          :key="section.key"
          class="asp-section"
          :data-sec="section.key"
        >
          <ShadcnSettingsSection
            v-if="!showTabs"
            :title="section.label"
            :description="'这里集中放置「' + (activeEntry?.title || section.label) + '」相关选项。'"
          >
            <template v-for="block in blocksOf(section.key)" :key="block.kind === 'field' ? 'f-' + block.key : 's-' + block.occ.id">
              <component
                :is="FieldRenderer"
                v-if="block.kind === 'field'"
                :group="section.key"
                :field-key="block.key"
                :settings="props.settings"
              />
              <component
                v-else
                :is="block.occ.component"
                :group="section.key"
                :settings="props.settings"
              />
            </template>
            <p v-if="!blocksOf(section.key).length" class="asp-empty-line">这个分组还没有可配置项</p>
          </ShadcnSettingsSection>

          <template v-else>
            <template v-for="block in blocksOf(section.key)" :key="block.kind === 'field' ? 'f-' + block.key : 's-' + block.occ.id">
              <component
                :is="FieldRenderer"
                v-if="block.kind === 'field'"
                :group="section.key"
                :field-key="block.key"
                :settings="props.settings"
              />
              <component
                v-else
                :is="block.occ.component"
                :group="section.key"
                :settings="props.settings"
              />
            </template>
            <p v-if="!blocksOf(section.key).length" class="asp-empty-line">这个分组还没有可配置项</p>
          </template>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 外框与标题栏由 SettingsShell 提供，这里只画左导航 + 右侧内容 */
.asp-root {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.asp-nav {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 2px;
  width: 192px;
  min-height: 0;
  padding: 4px 10px 12px 2px;
  overflow-y: auto;
  border-right: 1px solid var(--ui-line-soft, #eef0f4);
}

.asp-nav-caption {
  margin: 6px 0 6px 10px;
  padding: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ui-ink-mute, #8c95a3);
}

.asp-nav-cell + .asp-nav-cell {
  margin-top: 1px;
}

/* 插件导航项统一收进 34px 行高：不同插件自带 44px 会把整列撑得忽高忽低 */
.asp-nav-plugin :deep(button) {
  min-height: 34px;
  padding-top: 0;
  padding-bottom: 0;
  border-radius: var(--radius-control, 8px);
}

.asp-nav-empty {
  margin: 0;
  padding: 18px 10px;
  font-size: 12px;
  color: var(--ui-ink-mute, #8c95a3);
}

.asp-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.asp-panel-head {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 8px;
  padding: 2px 22px 8px;
}

.asp-panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ui-ink, #18202b);
}

.asp-panel-meta {
  margin: 0;
  font-size: 11px;
  color: var(--ui-ink-mute, #8c95a3);
}

.asp-tabbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 0 18px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
  scrollbar-width: none;
}

.asp-tabbar::-webkit-scrollbar {
  display: none;
}

.asp-tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: var(--ui-ink-dim, #6b7280);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--dur-hover, 0.18s) ease;
}

.asp-tab-item:hover {
  color: var(--ui-ink, #18202b);
}

.asp-tab-item.is-active {
  color: var(--ui-accent, #0891b2);
}

.asp-tab-item.is-active::after {
  content: '';
  position: absolute;
  right: 8px;
  bottom: 0;
  left: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--ui-accent, #0891b2);
}

.asp-body {
  flex: 1;
  min-height: 0;
  padding: 4px 22px 24px;
  overflow-y: auto;
}

.asp-section {
  max-width: 760px;
}

.asp-empty {
  padding: 36px 0;
  text-align: center;
  font-size: 12px;
  color: var(--ui-ink-mute, #8c95a3);
}

.asp-empty-line {
  margin: 0;
  padding: 12px 0;
  font-size: 12px;
  color: var(--ui-ink-mute, #8c95a3);
}

@media (max-width: 560px) {
  .asp-nav {
    width: 150px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .asp-tab-item {
    transition: none;
  }
}
</style>
