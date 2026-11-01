<script setup lang="ts">
/**
 * PluginSettingsContent —— 默认主题的设置内容区（左分类导航 + 右侧卡片小节）。
 *
 * 只画外壳里面那一格：遮罩、标题栏、✕、Esc、浮动窗都在渲染层 SettingsShell 里。
 *
 * 布局（用户口径 2026-11-01）：
 * - 左：第 0 级分类（个人 / 集成 / 画布 / 开发）+ 一级图标菜单，外观统一由 ShadcnSettingsNav 画。
 * - 右：一级标题 → 二级小标题 + 卡片（卡片内每行一条分割线）。
 * - 顶部页签条保留代码，默认隐藏；显式传 show-section-tabs 才出现。
 *
 * 三套插槽都保留：
 * - settings.nav：插件一级导航项，按 id 或 meta.title 命中默认项时顶替，否则追加。
 *   插件只提供数据（title / category / icon / page），不再自绘导航外观。
 * - settings.tab：二级页签，只对当前一级生效。
 * - settingsGroup/<完整分组 key>：整组正文，支持 prepend / append / replace。
 *
 * 关闭通道与滚动锁都不变：关闭仍由外壳广播 settings:ui-close；程序化滚动时锁住高亮。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import type { Component } from 'vue'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { SETTINGS_FIELD_RENDERER, useCanvasRender } from '@mini-canvas/canvas-render'
import ShadcnSettingsNav from './ShadcnSettingsNav.vue'
import ShadcnSettingsSection from './ShadcnSettingsSection.vue'
import SettingsSchemaField from './SettingsSchemaField.vue'
import { SETTINGS_NAV_ICON_FALLBACK } from './navIcon'
import {
  categoryOf,
  metaIcon,
  metaPage,
  metaText,
  SETTINGS_NAV_CATEGORY_FIELD,
} from './navCategory'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlotOcc = { id: string; order: number; component: any; meta?: any }

const props = withDefaults(
  defineProps<{
    settings: SettingsPanelSource
    /** 顶部二级页签条：默认关掉；需要按页签切换的宿主可以显式打开 */
    showSectionTabs?: boolean
  }>(),
  { showSectionTabs: false },
)

const { ctx } = useCanvasRender()

// 插件自绘的 settingsGroup 页也拿得到标准字段控件
provide(SETTINGS_FIELD_RENDERER, SettingsSchemaField)

const SEP = '/'

/** 一级名：分组名第一个 / 段（扁平分组取它自己） */
function navOf(key: string): string {
  return key.split(SEP)[0]
}

/** 二级展示名：取 / 后的部分 */
function leafLabelOf(key: string): string {
  const segs = key.split(SEP)
  return segs.slice(1).join(SEP) || segs[0]
}

// —— 左导航插槽：插件装卸时重读 ——
const navList = ref<SlotOcc[]>([])
function reloadNav(): void {
  navList.value = ctx.slots.occupants('settings.nav').map((e) => ({
    id: e.id,
    order: e.order,
    component: markRaw(e.component as object),
    meta: e.meta,
  }))
}
reloadNav()

// —— 二级页签插槽：同上 ——
const tabList = ref<SlotOcc[]>([])
function reloadTabs(): void {
  tabList.value = ctx.slots.occupants('settings.tab').map((e) => ({
    id: e.id,
    order: e.order,
    component: markRaw(e.component as object),
    meta: e.meta,
  }))
}
reloadTabs()

const disposers: Array<{ dispose(): void }> = []
disposers.push(
  ctx.on('ctx:plugin-installed', reloadNav),
  ctx.on('ctx:plugin-uninstalled', reloadNav),
  ctx.on('ctx:plugin-installed', reloadTabs),
  ctx.on('ctx:plugin-uninstalled', reloadTabs),
)

// schema 变化（插件热装卸）后重算分组
const refreshTick = ref(0)
const rawSettings = ctx.get('settings')
const schemaOff = rawSettings?.onSchemaChange(() => {
  refreshTick.value += 1
})
if (schemaOff) disposers.push(schemaOff)

onBeforeUnmount(() => {
  for (const d of disposers) d.dispose()
  // 关闭或换皮时把滚动锁一起收掉，避免旧的 release 放掉新面板的锁
  releaseScrollLock()
})

const groups = computed<string[]>(() => {
  void refreshTick.value
  return props.settings.groups()
})

/** 一级名 → 它下面的完整分组 key 列表 */
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
  /** 一级名，也是导航项的稳定 key */
  key: string
  /** section = 由分组推导；nav = 插件注册的组件 */
  kind: 'section' | 'nav'
  /** 该一级下的完整分组 key */
  leaves: string[]
  /** 插件导航组件（兼容旧插件；外观不再渲染它） */
  component?: Component
  /** 插件自绘整页（meta.page，优先于 settingsGroup） */
  page?: Component
  /** 显示名 */
  title: string
  /** 第 0 级分类 */
  category: string
  /** 图标 */
  icon?: unknown
  /** 保留给插件排序的原始 order */
  order: number
}

/** 第 0 级分类场域：按一级名登记，插件可覆盖默认归类 */
const navCategories = ctx.registryOf<string>(SETTINGS_NAV_CATEGORY_FIELD)
const categoryTick = ref(0)
if (navCategories && typeof navCategories.subscribe === 'function') {
  disposers.push(navCategories.subscribe(() => void (categoryTick.value += 1)))
}

function categoryFor(nav: string, meta?: unknown): string {
  void categoryTick.value
  const registered = navCategories?.top(nav)?.value
  return categoryOf(nav, metaText(meta, 'category'), typeof registered === 'string' ? registered : '')
}

/**
 * 合并“由分组推导的一级项”和“插件注册的导航项”。
 *
 * 插件的 id 与一级名相同，或 meta.title 与一级名相同，就算命中默认项（顶替数据）；
 * 没命中的作为自定义入口追加在后面。命中项不重复渲染，避免出现两个同名导航。
 */
const navEntries = computed<NavEntry[]>(() => {
  const out: NavEntry[] = []
  // 用 entries + 数字下标：Map.forEach 的第二个参数是 key（字符串），不是序号
  ;[...sectionMap.value.entries()].forEach(([nav, leaves], index) => {
    out.push({
      key: nav,
      kind: 'section',
      leaves,
      order: 100 + index,
      title: nav,
      category: categoryFor(nav),
    })
  })
  const byKey = new Map(out.map((entry) => [entry.key, entry]))
  const byTitle = new Map(out.map((entry) => [entry.title, entry]))
  const extras: NavEntry[] = []
  const sorted = [...navList.value].sort((a, b) => a.order - b.order)
  for (const occ of sorted) {
    const title = metaText(occ.meta, 'title')
    const hit = byKey.get(occ.id) ?? (title ? byTitle.get(title) : undefined)
    if (hit) {
      hit.kind = 'nav'
      hit.component = occ.component as Component
      hit.page = metaPage(occ.meta) as Component | undefined
      hit.icon = metaIcon(occ.meta)
      const metaCategory = metaText(occ.meta, 'category')
      if (metaCategory) hit.category = metaCategory
      continue
    }
    extras.push({
      key: occ.id,
      kind: 'nav',
      leaves: [],
      component: occ.component as Component,
      page: metaPage(occ.meta) as Component | undefined,
      title: title || leafLabelOf(occ.id),
      category: categoryFor(title || leafLabelOf(occ.id), occ.meta),
      icon: metaIcon(occ.meta),
      order: occ.order,
    })
  }
  out.push(...extras)
  return out
})

/** 当前一级 */
const activeNav = ref<string>('')

const activeEntry = computed<NavEntry | undefined>(() =>
  navEntries.value.find((entry) => entry.key === activeNav.value),
)

/** 当前一级下的段（默认段来自分组；插件页签可顶替或追加） */
interface Section {
  key: string
  label: string
  kind: 'leaf' | 'tab'
  component?: Component
}

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
      label: metaText(occ.meta, 'title') || leafLabelOf(occ.id),
      kind: 'tab',
      component: occ.component as Component,
    })
  }
  return out
})

/** 当前二级 */
const activeSection = ref<string>('')

const activeSectionIndex = computed<number>(() =>
  Math.max(0, sections.value.findIndex((section) => section.key === activeSection.value)),
)

/** 顶部页签条默认隐藏；宿主显式打开且确实有多个段时才出现 */
const showTabs = computed<boolean>(() => props.showSectionTabs && sections.value.length > 1)

function selectNav(key: string): void {
  if (activeNav.value === key) return
  activeNav.value = key
}

function selectSection(key: string): void {
  if (activeSection.value === key) return
  activeSection.value = key
  scrollBodyToTop()
}

// 分组变化后，保证高亮仍指向存在的项
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

// —— 滚动锁：切换页时让高亮稳定，不被滚动事件中途改掉 ——
const scrollEl = ref<HTMLElement | null>(null)
let scrollLocked = false
let scrollLockTimer: ReturnType<typeof setTimeout> | null = null
const SCROLL_LOCK_MAX_MS = 400

function releaseScrollLock(): void {
  scrollLocked = false
  if (scrollLockTimer !== null) {
    clearTimeout(scrollLockTimer)
    scrollLockTimer = null
  }
}

function lockScrollUntilSettles(): void {
  scrollLocked = true
  if (scrollLockTimer !== null) clearTimeout(scrollLockTimer)
  scrollLockTimer = setTimeout(releaseScrollLock, SCROLL_LOCK_MAX_MS)
}

function scrollBodyToTop(): void {
  const el = scrollEl.value
  if (!el) return
  lockScrollUntilSettles()
  el.scrollTop = 0
  releaseScrollLock()
}

/** 内容插槽的摆放方式 */
function slotMode(occ: SlotOcc): 'replace' | 'prepend' | 'append' {
  const mode = (occ.meta as { mode?: string } | undefined)?.mode
  return mode === 'prepend' ? 'prepend' : mode === 'append' ? 'append' : 'replace'
}

type ContentBlock =
  | { kind: 'field'; key: string }
  | { kind: 'slot'; occ: SlotOcc }

const occTick = ref(0)

function blocksOf(groupKey: string): ContentBlock[] {
  void occTick.value
  void refreshTick.value
  const occs = ctx.slots
    .occupants('settingsGroup/' + groupKey)
    .map((entry) => ({ id: entry.id, order: entry.order, component: markRaw(entry.component as object), meta: entry.meta }))
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

disposers.push(
  ctx.on('ctx:plugin-installed', () => void (occTick.value += 1)),
  ctx.on('ctx:plugin-uninstalled', () => void (occTick.value += 1)),
)

// —— 图标：独立场域 settings/navIcon，按一级名取，取不到用兜底 ——
const navIcons = ctx.registryOf<unknown>('settings/navIcon')
const iconTick = ref(0)
if (navIcons && typeof navIcons.subscribe === 'function') {
  const off = navIcons.subscribe(() => void (iconTick.value += 1))
  // 注册场的 subscribe 直接返回 Disposable，和下面的监听一起释放
  disposers.push(off)
}

function iconOf(name: string): unknown {
  void iconTick.value
  return navIcons?.top(name)?.value ?? SETTINGS_NAV_ICON_FALLBACK
}

/** 左侧统一导航只吃数据：外观由 ShadcnSettingsNav 画，插件不再自绘 */
const navItems = computed(() =>
  navEntries.value.map((entry) => ({
    key: entry.key,
    label: entry.title,
    category: entry.category,
    icon: entry.icon ?? iconOf(entry.key),
    page: entry.page,
  })),
)

// 切换一级时回到顶部（插件热装只重算分组，不重置滚动位置）
watch(activeNav, () => {
  activeSection.value = sections.value[0]?.key ?? ''
  void nextTick(scrollBodyToTop)
})
</script>

<template>
  <div class="psd-content-root">
    <!-- 左：第 0 级分类 + 一级图标菜单（统一外观） -->
    <ShadcnSettingsNav
      class="psd-nav"
      :items="navItems"
      :active="activeNav"
      @select="selectNav"
    />

    <!-- 右：一级标题 → 二级小标题 + 卡片 -->
    <div class="psd-panel">
      <header class="psd-panel-head">
        <h3 class="psd-panel-title">{{ activeEntry?.title || '设置' }}</h3>
        <p v-if="activeEntry?.leaves.length" class="psd-panel-meta">
          {{ activeEntry.leaves.length }} 个分组
        </p>
      </header>

      <!-- 二级页签：保留代码，默认关掉（showSectionTabs） -->
      <div v-if="showTabs" class="psd-tabbar" role="tablist" :aria-label="(activeEntry?.title || '设置') + '分类'">
        <template v-for="section in sections" :key="section.key">
          <component
            :is="section.component"
            v-if="section.kind === 'tab' && section.component"
            :group="section.key"
            :active="activeSection === section.key"
            :on-select="selectSection"
            class="psd-tab-item"
            :data-tab="section.key"
          />
          <button
            v-else
            class="psd-tab-item"
            role="tab"
            :class="{ 'is-active': activeSection === section.key }"
            :aria-selected="activeSection === section.key"
            :data-tab="section.key"
            @click="selectSection(section.key)"
          >
            {{ section.label }}
          </button>
        </template>
      </div>

      <div ref="scrollEl" class="psd-body">
        <!-- 插件自绘整页：只换外层标题，内部内容仍归插件（业务逻辑不动） -->
        <div v-if="activeEntry?.page" class="psd-page">
          <component :is="activeEntry.page" :group="activeEntry.key" :settings="props.settings" />
        </div>

        <div v-else-if="!sections.length" class="psd-empty">暂无分组</div>

        <!-- 卡片模式：所有二级小节依次排开，每节一张卡片 -->
        <template v-else-if="!showTabs">
          <section
            v-for="section in sections"
            :key="section.key"
            class="psd-section"
            :data-sec="section.key"
          >
            <ShadcnSettingsSection :title="section.label">
              <template
                v-for="block in blocksOf(section.key)"
                :key="block.kind === 'field' ? 'f-' + block.key : 's-' + block.occ.id"
              >
                <SettingsSchemaField
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
              <p v-if="!blocksOf(section.key).length" class="psd-empty-line">这个分组还没有可配置项</p>
            </ShadcnSettingsSection>
          </section>
        </template>

        <!-- 页签模式：只显示当前段 -->
        <template v-else>
          <section
            v-for="(section, index) in sections"
            v-show="index === activeSectionIndex"
            :key="section.key"
            class="psd-section"
            :data-sec="section.key"
          >
            <ShadcnSettingsSection :title="section.label">
              <template
                v-for="block in blocksOf(section.key)"
                :key="block.kind === 'field' ? 'f-' + block.key : 's-' + block.occ.id"
              >
                <SettingsSchemaField
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
              <p v-if="!blocksOf(section.key).length" class="psd-empty-line">这个分组还没有可配置项</p>
            </ShadcnSettingsSection>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 中间层：左导航 + 右设置项。窗口级样式（遮罩/标题栏/关闭）在外壳里。 */
.psd-content-root {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  gap: 0;
}

/* 导航外观在 ShadcnSettingsNav 里；这里只让它在弹性行里占固定宽度 */
.psd-nav {
  width: 192px;
}

.psd-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.psd-panel-head {
  display: flex;
  flex: none;
  align-items: baseline;
  gap: 8px;
  padding: 2px 22px 12px;
}

.psd-panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--ui-ink, #18202b);
  text-align: left;
}

.psd-panel-meta {
  margin: 0;
  font-size: 11px;
  color: var(--ui-ink-mute, #8c95a3);
}

.psd-tabbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 0 18px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ui-line-soft, #eef0f4);
  scrollbar-width: none;
}

.psd-tabbar::-webkit-scrollbar {
  display: none;
}

.psd-tab-item {
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

.psd-tab-item:hover {
  color: var(--ui-ink, #18202b);
}

.psd-tab-item.is-active {
  color: var(--ui-accent, #0891b2);
}

.psd-tab-item.is-active::after {
  content: '';
  position: absolute;
  right: 8px;
  bottom: 0;
  left: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--ui-accent, #0891b2);
}

.psd-body {
  flex: 1;
  min-height: 0;
  padding: 0 22px 24px;
  overflow-y: auto;
}

.psd-section {
  max-width: 760px;
}

.psd-page {
  max-width: 760px;
  padding: 4px 0 8px;
}

.psd-empty {
  padding: 36px 0;
  text-align: center;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
}

.psd-empty-line {
  margin: 0;
  padding: 12px 0;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
}

@media (max-width: 560px) {
  .psd-nav {
    width: 150px;
  }
}
</style>
