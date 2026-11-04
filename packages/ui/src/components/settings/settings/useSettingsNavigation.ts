/**
 * AppSettingsPanel 的导航状态。
 *
 * 负责读取 settings.nav / settings.tab / settingsGroup 插槽、菜单与图标注册场，
 * 维护一级 / 二级选中态，以及切换设置页时的滚动锁。菜单数据推导在 settingsMenuModel.ts。
 */
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Component, ComponentPublicInstance } from 'vue'
import type { SettingsMenuView } from '@mini-canvas/canvas-data'
import type { SettingsPanelSource } from '@mini-canvas/canvas-render'
import { useCanvasRender } from '@mini-canvas/canvas-render'
import { Circle } from 'lucide-vue-next'
import {
  categoryOf,
  metaText,
  SETTINGS_NAV_CATEGORY_FIELD,
} from '../navCategory'
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
import { tierSectionAllowsField } from '@mini-canvas/plugin-theme-default/components/settings/tierSection.js'

export interface UseSettingsNavigationOptions {
  settings: () => SettingsPanelSource
  showSectionTabs: () => boolean
}

export function useSettingsNavigation(options: UseSettingsNavigationOptions) {
  const { ctx } = useCanvasRender()

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

  // 设置面板通常是“打开时才挂载”：插件（含快捷键配置页）往往早于面板装好，
  // 这里若只信构造时读到的一份插槽，就会永远少掉后装进来的导航。每次挂载再同步一次。
  onMounted(() => {
    reloadSlots()
    occTick.value += 1
  })

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

  // 运行期 slots.register/remove（不经过插件装卸、也不在面板挂载那一刻）同样要刷新：
  // 快捷键配置页就是由已有快捷键作用域挂上来的。直接订阅底层注册表，少一个时序窗口。
  const slotRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('slots')
  if (slotRegistry && typeof slotRegistry.subscribe === 'function') {
    disposers.push({ dispose: slotRegistry.subscribe(() => {
      reloadSlots()
      occTick.value += 1
    }) })
  }

  onBeforeUnmount(() => {
    for (const disposer of disposers) disposer.dispose()
    cancelScrollAnimation()
    releaseScrollLock()
  })

  // —— 分组 ——
  const groups = computed<string[]>(() => {
    void occTick.value
    return options.settings().groups()
  })

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

  /** 0/1/2 级菜单：以插件注册的新菜单为准，旧分组只补未注册项 */
  const settingsMenu = ctx.tryGet<{
    resolve(groups: readonly string[]): SettingsMenuView
    subscribe?(fn: () => void): { dispose(): void }
  }>('settingsMenu')
  const menuTick = ref(0)
  if (settingsMenu?.subscribe) {
    disposers.push(settingsMenu.subscribe(() => void (menuTick.value += 1)))
  }

  const menuView = computed<SettingsMenuView>(() => {
    void menuTick.value
    return settingsMenu?.resolve(groups.value) ?? { categories: [], navs: [], issues: [] }
  })

  // —— 图标：独立场域 settings/navIcon，order 小者胜；取不到用兜底 ——
  // 必须声明在 navEntries 之前：下面的 watch(navEntries, { immediate: true })
  // 会在 setup 阶段就求值，iconOf 若晚于它声明会撞上暂时性死区（打开设置白屏）。
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

  const navEntries = computed<NavEntry[]>(() =>
    buildNavEntries({
      navList: navList.value,
      sectionMap: sectionMap.value,
      groupSet: groupSet.value,
      menuView: menuView.value,
      categoryFor,
      iconOf,
    }),
  )

  /** 左侧统一导航只吃数据：外观由 ShadcnSettingsNav 画，插件不再自绘 */
  const navItems = computed(() => buildSettingsNavItems(navEntries.value, iconOf))

  const activeNav = ref<string>('')
  const activeEntry = computed<NavEntry | undefined>(() =>
    navEntries.value.find((entry) => entry.key === activeNav.value),
  )

  /** 当前一级下的段：菜单 section 优先；未注册的旧分组按原顺序兜底 */
  const sections = computed<Section[]>(() =>
    buildSections({
      activeNav: activeNav.value,
      activeEntry: activeEntry.value,
      sectionMap: sectionMap.value,
      tabList: tabList.value,
    }),
  )

  const activeSection = ref<string>('')
  const activeSectionIndex = computed<number>(() =>
    Math.max(0, sections.value.findIndex((section) => section.key === activeSection.value)),
  )
  /** 顶部页签条默认隐藏；宿主显式打开且确实有多个段时才出现 */
  const showTabs = computed<boolean>(() => options.showSectionTabs() && sections.value.length > 1)

  // 分组变化后保证高亮仍指向存在的项。注意：这里只读 entries（不读 activeNav），
  // SSR 首帧才不会因为「先取 activeNav 再回填 entries」把首项吞掉。
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

  /**
   * 非配置动作（如「快捷键」）：默认主题的菜单把它标成 action，
   * 这里负责把它变成真实行为，而不是让用户点开一个空页。
   *
   * 走 ctx.emit 而不是直接调 composable：设置面板是可替换槽，
   * 不应当依赖成品应用内部的 ui 单例。宿主订阅后打开帮助浮层。
   */
  function runNavAction(action: string): boolean {
    if (!action) return false
    ctx.emit('settings:ui-action', { action })
    return true
  }

  function selectNav(key: string): void {
    const entry = navEntries.value.find((e) => e.key === key)
    // 动作项要先执行：它可能一打开就是默认选中态，不能因为“key 没变”直接 return
    if (entry?.action && runNavAction(entry.action)) return
    if (activeNav.value === key) return
    activeNav.value = key
    activeSection.value = ''
  }

  function selectSection(key: string): void {
    if (activeSection.value === key) return
    activeSection.value = key
    scrollBodyToTop()
  }

  /** 点击页签：只切内容；同一页里的长内容回到顶部 */
  function selectTab(key: string): void {
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

  /**
   * 模板回调 ref：正文滚动层换成 ScrollPane 后，模板拿到的是组件实例，
   * 真正滚动的元素要经它暴露的 scrollElement() 取（问题 17）。
   */
  function setScrollEl(el: Element | ComponentPublicInstance | null): void {
    const exposed = el as { scrollElement?: () => HTMLElement | null } | null
    scrollEl.value = typeof exposed?.scrollElement === 'function'
      ? exposed.scrollElement()
      : el instanceof HTMLElement ? el : null
  }

  watch(activeNav, () => {
    activeSection.value = sections.value[0]?.key ?? ''
    void nextTick(scrollBodyToTop)
  })

  // —— 段落正文：内容插槽优先，否则按 schema 平铺 ——
  function slotMode(occ: SlotOcc): 'replace' | 'prepend' | 'append' {
    const mode = (occ.meta as { mode?: string } | undefined)?.mode
    return mode === 'prepend' ? 'prepend' : mode === 'append' ? 'append' : 'replace'
  }

  function blocksOf(groupKey: string): ContentBlock[] {
    void occTick.value
    const occs = ctx.slots.occupants('settingsGroup/' + groupKey).map((entry) => ({
      id: entry.id,
      order: entry.order,
      component: markRaw(entry.component as object),
      meta: entry.meta,
    }))
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
    selectTab,
    setScrollEl,
    sectionBlocks,
  }
}
