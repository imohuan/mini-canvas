/**
 * PluginSettingsContent 的导航状态。
 *
 * 负责读取 settings.nav / settings.tab / settingsGroup 插槽、菜单与图标注册场，
 * 维护一级 / 二级选中态，以及切换设置页时的滚动锁。菜单数据推导在 settingsMenuModel.ts。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Component, ComponentPublicInstance } from 'vue'
import type { SettingsMenuView } from '@mini-canvas/canvas-data'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { SETTINGS_NAV_ICON_FALLBACK } from '../navIcon'
import { categoryOf, metaText, SETTINGS_NAV_CATEGORY_FIELD } from '../navCategory'
import { tierSectionAllowsField } from '../tierSection'
import {
  buildNavEntries,
  buildSectionMap,
  buildSections,
  buildSettingsNavItems,
  type ContentBlock,
  type NavEntry,
  type Section,
  type SlotOcc,
} from './settingsMenuModel'

export interface UseSettingsNavigationOptions {
  settings: () => SettingsPanelSource
  showSectionTabs: () => boolean
}

export function useSettingsNavigation(options: UseSettingsNavigationOptions) {
  const { ctx } = useCanvasRender()

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

  // 运行期 slots.register/remove（不经过插件装卸）同样要刷新：
  // 设置页里的快捷键配置页由宿主在就绪后挂上，不能只等插件装卸事件。
  const slotRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('slots')
  if (slotRegistry && typeof slotRegistry.subscribe === 'function') {
    disposers.push({ dispose: slotRegistry.subscribe(() => {
      reloadNav()
      reloadTabs()
      refreshTick.value += 1
    }) })
  }

  // 设置面板通常“打开时才挂载”：插件往往早于面板装好，
  // 若只信构造时读到的一份插槽，后装进来的快捷键配置页会永远缺席。挂载时再同步一次。
  onMounted(() => {
    reloadNav()
    reloadTabs()
    refreshTick.value += 1
  })

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
    return options.settings().groups()
  })

  /** 一级名 → 它下面的完整分组 key 列表 */
  const sectionMap = computed<Map<string, string[]>>(() => buildSectionMap(groups.value))

  /** 完整分组名集合：section 登记的是 '外观/形状' 这种全名，不能拿首段 Map 去查 */
  const groupSet = computed(() => new Set(groups.value))

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

  /** 新菜单读 ctx.get('settingsMenu')；旧装配没有这张表时用空树，全部走旧分组兜底 */
  const settingsMenu = ctx.tryGet<{ resolve(groups: readonly string[]): SettingsMenuView }>('settingsMenu')
  const menuTick = ref(0)
  if (settingsMenu && typeof (settingsMenu as { subscribe?: unknown }).subscribe === 'function') {
    disposers.push(
      (settingsMenu as unknown as { subscribe(fn: () => void): { dispose(): void } }).subscribe(
        () => void (menuTick.value += 1),
      ),
    )
  }

  const menuView = computed<SettingsMenuView>(() => {
    void menuTick.value
    return settingsMenu?.resolve(groups.value) ?? { categories: [], navs: [], issues: [] }
  })

  // —— 图标：独立场域 settings/navIcon，按一级名取，取不到用兜底 ——
  // 必须声明在 navEntries 之前：下面的 watch(navEntries, { immediate: true })
  // 会在 setup 阶段就求值，iconOf 若晚于它声明会撞上暂时性死区（打开设置白屏）。
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

  const navEntries = computed<NavEntry[]>(() =>
    buildNavEntries({
      navList: navList.value,
      groups: groups.value,
      groupSet: groupSet.value,
      menuView: menuView.value,
      categoryFor,
      iconOf,
    }),
  )

  /** 当前一级 */
  const activeNav = ref<string>('')

  const activeEntry = computed<NavEntry | undefined>(() =>
    navEntries.value.find((entry) => entry.key === activeNav.value),
  )

  const sections = computed<Section[]>(() =>
    buildSections({
      activeNav: activeNav.value,
      activeEntry: activeEntry.value,
      sectionMap: sectionMap.value,
      tabList: tabList.value,
    }),
  )

  /** 当前二级 */
  const activeSection = ref<string>('')

  const activeSectionIndex = computed<number>(() =>
    Math.max(0, sections.value.findIndex((section) => section.key === activeSection.value)),
  )

  /** 顶部页签条默认隐藏；宿主显式打开且确实有多个段时才出现 */
  const showTabs = computed<boolean>(() => options.showSectionTabs() && sections.value.length > 1)

  function selectNav(key: string): void {
    const entry = navEntries.value.find((e) => e.key === key)
    // 动作项要先执行：它可能一打开就是默认选中态，不能因为“key 没变”直接 return
    if (entry?.action) {
      ctx.emit('settings:ui-action', { action: entry.action })
      return
    }
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
      // 动作项（如快捷键）不占默认位置：打开设置应该落在第一个真正的配置页
      const first = entries.find((entry) => !entry.action) ?? entries[0]!
      if (!entries.some((entry) => entry.key === activeNav.value && !entry.action)) {
        activeNav.value = first.key
      }
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

  /**
   * 模板回调 ref：正文滚动层换成 ScrollPane 后，模板拿到的是组件实例，
   * 真正滚动的元素要经它暴露的 scrollElement() 取（问题 17）。
   */
  function setScrollEl(el: Element | ComponentPublicInstance | null): void {
    const exposed = (el as { scrollElement?: () => HTMLElement | null } | null) ?? null
    scrollEl.value = typeof exposed?.scrollElement === 'function' ? exposed.scrollElement() : (el instanceof HTMLElement ? el : null)
  }

  /** 内容插槽的摆放方式 */
  function slotMode(occ: SlotOcc): 'replace' | 'prepend' | 'append' {
    const mode = (occ.meta as { mode?: string } | undefined)?.mode
    return mode === 'prepend' ? 'prepend' : mode === 'append' ? 'append' : 'replace'
  }

  const occTick = ref(0)

  function blocksOf(groupKey: string): ContentBlock[] {
    void occTick.value
    void refreshTick.value
    const occs = ctx.slots
      .occupants('settingsGroup/' + groupKey)
      .map((entry) => ({ id: entry.id, order: entry.order, component: markRaw(entry.component as object), meta: entry.meta }))
    const fields = options.settings().groupOf(groupKey)
    if (!occs.length) {
      return fields.map((item) => ({ kind: 'field' as const, key: item.key, group: groupKey }))
    }
    const coexist = occs.some((occ) => slotMode(occ) !== 'replace')
    const sorted = (mode: string): SlotOcc[] =>
      occs.filter((occ) => slotMode(occ) === mode).sort((a, b) => a.order - b.order)
    const blocks: ContentBlock[] = []
    blocks.push(...sorted('prepend').map((occ) => ({ kind: 'slot' as const, occ, group: groupKey })))
    if (coexist) {
      blocks.push(...fields.map((item) => ({ kind: 'field' as const, key: item.key, group: groupKey })))
    }
    blocks.push(...sorted('replace').map((occ) => ({ kind: 'slot' as const, occ, group: groupKey })))
    blocks.push(...sorted('append').map((occ) => ({ kind: 'slot' as const, occ, group: groupKey })))
    return blocks
  }

  /** 一个二级段可能合并多个 Config.group；字段与内容槽按段的 group 顺序串起来。 */
  function sectionBlocks(section: Section): ContentBlock[] {
    return section.groups
      .flatMap((group) => blocksOf(group))
      .filter((block) => block.kind !== 'field' || tierSectionAllowsField(section.key, block.key))
  }

  // 自绘整页的二级节是否要用宽版工作区
  function isWideSection(section: Section): boolean {
    return section.groups.includes('主题工作台')
  }

  disposers.push(
    ctx.on('ctx:plugin-installed', () => void (occTick.value += 1)),
    ctx.on('ctx:plugin-uninstalled', () => void (occTick.value += 1)),
  )

  /** 左侧统一导航只吃数据：外观由 ShadcnSettingsNav 画，插件不再自绘 */
  const navItems = computed(() => buildSettingsNavItems(navEntries.value, iconOf))

  // 切换一级时回到顶部（插件热装只重算分组，不重置滚动位置）
  watch(activeNav, () => {
    activeSection.value = sections.value[0]?.key ?? ''
    void nextTick(scrollBodyToTop)
  })

  return {
    navItems,
    activeNav,
    activeEntry,
    selectNav,
    sections,
    activeSection,
    activeSectionIndex,
    showTabs,
    selectSection,
    setScrollEl,
    sectionBlocks,
    isWideSection,
  }
}
