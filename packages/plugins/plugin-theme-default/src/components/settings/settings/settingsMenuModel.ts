/**
 * PluginSettingsContent 的菜单数据模型。
 *
 * 这里只放纯数据推导：分组 / 一级菜单 / 二级段 / 导航项。
 * 注册场、插件装卸、滚动锁等有状态逻辑在 useSettingsNavigation.ts。
 */
import type { Component } from 'vue'
import type { SettingsMenuView } from '@mini-canvas/canvas-data'
import { asSettingsIcon, metaIcon, metaPage, metaPageGroup, metaText } from '../navCategory'

export const SEP = '/'

/** 一级名：分组名第一个 / 段（扁平分组取它自己） */
export function navOf(key: string): string {
  return key.split(SEP)[0]
}

/** 二级展示名：取 / 后的部分 */
export function leafLabelOf(key: string): string {
  const segs = key.split(SEP)
  return segs.slice(1).join(SEP) || segs[0]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlotOcc = { id: string; order: number; component: any; meta?: any }

export interface NavEntry {
  /** 一级名，也是导航项的稳定 key */
  key: string
  /** section = 由分组推导；nav = 插件注册的组件 */
  kind: 'section' | 'nav'
  /** 该一级下的二级段（菜单注册顺序优先；旧分组按原顺序兜底） */
  sections: MenuSection[]
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
  /** 第 0 级分类在菜单里的最终位置（缺省按内置顺序） */
  categoryPosition?: number
  /** 图标 */
  icon?: unknown
  /** 非配置动作 id（如「快捷键」）；有值时点击执行动作，不切内容页 */
  action?: string
  /** 插件自绘的 nav 配置页（settings.nav occupant：如设置页快捷键面板） */
  navPage?: Component
}

/** 一个二级段：显示名 + 它收拢的配置分组（一个段可合并多个 group） */
export interface MenuSection {
  key: string
  label: string
  groups: string[]
  /** 插件自绘的整页（旧 settings.nav 的 meta.page，按 pageGroup 归到这一节） */
  page?: Component
}

export interface Section {
  key: string
  label: string
  kind: 'leaf' | 'tab'
  /** 这一段对应一个还是多个 Config.group */
  groups: string[]
  /** 插件自绘整页（pageGroup 归到这一节时使用） */
  page?: Component
  component?: Component
}

export type ContentBlock =
  | { kind: 'field'; key: string; group: string }
  | { kind: 'slot'; occ: SlotOcc; group: string }

export interface SettingsNavItem {
  key: string
  label: string
  category: string
  categoryPosition?: number
  icon: Component
  page?: Component
}

export function buildSectionMap(groups: readonly string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const group of groups) {
    const nav = navOf(group)
    if (!map.has(nav)) map.set(nav, [])
    map.get(nav)!.push(group)
  }
  return map
}

export interface BuildNavEntriesInput {
  navList: readonly SlotOcc[]
  groups: readonly string[]
  groupSet: ReadonlySet<string>
  menuView: SettingsMenuView
  categoryFor(nav: string, meta?: unknown): string
  iconOf(name: string): unknown
}

/**
 * 合并「0/1/2 级菜单」与旧 settings.nav：
 * - 菜单决定标题 / 分类 / 顺序；旧插槽只补 page、component、icon。
 * - 只有真有字段 / 内容 / 整页的菜单才出现：不展示空壳。
 * - 没注册菜单的旧入口按 groups 继续兜底，配置不会消失。
 */
export function buildNavEntries(input: BuildNavEntriesInput): NavEntry[] {
  const { navList, groups, groupSet, menuView, categoryFor, iconOf } = input
  const view = menuView
  const menuEntries: NavEntry[] = []
  const used = new Set<string>()
  const sorted = [...navList].sort((a, b) => a.order - b.order)
  /** 分类名 → 菜单位置：旧入口也按所在分类的最终位置排，不因没有菜单项而掉到最后 */
  const categoryPositions = new Map(view.categories.map((c) => [c.title, c.position]))

  for (const nav of view.navs) {
    const occ =
      sorted.find((o) => o.id === nav.id) ??
      sorted.find((o) => !used.has(o.id) && metaText(o.meta, 'title') === nav.title)
    if (occ) used.add(occ.id)
    const navSections: MenuSection[] = []
    for (const section of nav.sections) {
      const hit = section.groups.filter((group) => groupSet.has(group))
      if (!hit.length) continue
      navSections.push({
        key: section.id,
        label: section.title,
        groups: hit,
      })
    }
    // 旧 settings.nav 用 pageGroup 声明“我这个整页属于哪个配置分组”：
    // 归到对应二级节，不再额外长出一个一级入口（页仍由 meta.page 提供）。
    for (const item of sorted) {
      if (used.has(item.id)) continue
      const group = metaPageGroup(item.meta)
      if (!group) continue
      const section = navSections.find((s) => s.groups.includes(group))
      const page = metaPage(item.meta) as Component | undefined
      if (!section || !page) continue
      section.page = page
      used.add(item.id)
    }
    const leaves = navSections.flatMap((section) => section.groups)
    const page = (nav.page ?? metaPage(occ?.meta)) as Component | undefined
    // 动作项（如「快捷键」）没有配置分组：保留它，点击执行动作而不是点开空页
    const action = typeof nav.action === 'string' ? nav.action : ''
    // settings.nav 注册的配置页（navPage）即使没有 Config 分组也要保留：
    // 快捷键就是这样一页。旧式自绘整页靠 meta.page 识别，不能把带组件的旧入口也当成页。
    const navPage = !metaPage(occ?.meta) ? (occ?.component as Component | undefined) : undefined
    if (!leaves.length && !page && !navPage && !action) continue
    const category = view.categories.find((c) => c.id === nav.category)
    menuEntries.push({
      key: nav.id,
      kind: page || occ ? 'nav' : 'section',
      sections: navSections,
      leaves,
      // component 只留给旧式自绘入口；配置页走 navPage，避免 SettingsContent 把
      // 同一个组件当两套页面重复判断。
      component: page ? (occ?.component as Component | undefined) : undefined,
      navPage,
      page,
      title: nav.title,
      category: category?.title ?? categoryFor(nav.title, occ?.meta),
      ...(category ? { categoryPosition: category.position } : {}),
      icon: nav.icon ?? metaIcon(occ?.meta) ?? iconOf(nav.title),
      ...(action ? { action } : {}),
    })
  }

  // 旧分组兜底：没有注册成菜单的 group 仍按第一个 / 分段聚成一级
  const covered = new Set(
    menuEntries.flatMap((e) => e.sections.flatMap((section) => section.groups)),
  )
  const legacy = new Map<string, string[]>()
  for (const group of groups) {
    if (covered.has(group)) continue
    const nav = navOf(group)
    if (!legacy.has(nav)) legacy.set(nav, [])
    legacy.get(nav)!.push(group)
  }
  for (const [nav, leaves] of legacy) {
    const occ = sorted.find((o) => o.id === nav || metaText(o.meta, 'title') === nav)
    if (occ) used.add(occ.id)
    const category = categoryFor(nav, occ?.meta)
    menuEntries.push({
      key: nav,
      kind: 'section',
      sections: leaves.map((group) => ({
        key: group,
        label: leafLabelOf(group),
        groups: [group],
      })),
      leaves,
      component: occ?.component as Component | undefined,
      navPage: occ?.component as Component | undefined,
      page: metaPage(occ?.meta) as Component | undefined,
      title: nav,
      category,
      ...(categoryPositions.has(category) ? { categoryPosition: categoryPositions.get(category) } : {}),
      icon: metaIcon(occ?.meta),
    })
  }

  // 旧 settings.nav 里没被任何菜单 / 分组命中的，继续追加
  for (const occ of sorted) {
    if (used.has(occ.id)) continue
    const pageGroup = metaPageGroup(occ.meta)
    if (pageGroup && covered.has(pageGroup)) {
      // 整页已挂到菜单的二级节上：页本身仍然可见，但不再变成第二个一级入口
      const host = menuEntries.find((e) =>
        e.sections.some((section) => section.groups.includes(pageGroup) && section.page),
      )
      if (host) {
        used.add(occ.id)
        continue
      }
    }
    const title = metaText(occ.meta, 'title') || leafLabelOf(occ.id)
    const category = categoryFor(title, occ.meta)
    menuEntries.push({
      key: occ.id,
      kind: 'nav',
      sections: [],
      leaves: [],
      component: occ.component as Component,
      navPage: occ.component as Component,
      page: metaPage(occ.meta) as Component | undefined,
      title,
      category,
      ...(categoryPositions.has(category) ? { categoryPosition: categoryPositions.get(category) } : {}),
      icon: metaIcon(occ.meta),
    })
  }
  // 菜单树已经按 order + before / after 排好；这里保持该顺序，不再按原始 order 重排。
  return menuEntries
}

export interface BuildSectionsInput {
  activeNav: string
  activeEntry?: NavEntry
  sectionMap: ReadonlyMap<string, string[]>
  tabList: readonly SlotOcc[]
}

/** 当前一级下的段（菜单 section 优先；未注册的旧分组按原顺序兜底） */
export function buildSections(input: BuildSectionsInput): Section[] {
  const { activeNav: nav, activeEntry: entry, sectionMap, tabList } = input
  const leaves = entry?.leaves ?? sectionMap.get(nav) ?? []
  const occs = [...tabList]
    .filter((occ) => occ.id === nav || occ.id.startsWith(nav + SEP))
    .sort((a, b) => a.order - b.order)
  const byLeaf = new Map<string, SlotOcc>()
  const customs: SlotOcc[] = []
  for (const occ of occs) {
    if (leaves.includes(occ.id)) byLeaf.set(occ.id, occ)
    else customs.push(occ)
  }
  // 菜单注册的 section 顺序（含合并组）；旧分组没被收拢时再按 sectionMap 原顺序补
  const merged = new Set((entry?.sections ?? []).flatMap((section) => section.groups))
  const menuSections: Section[] = (entry?.sections ?? []).map((section) => {
    // 单组且该组注册了 settings.tab：沿用旧页签组件
    const occ = section.groups.length === 1 ? byLeaf.get(section.groups[0]!) : undefined
    return {
      key: section.key,
      label: section.label,
      kind: occ ? 'tab' : 'leaf',
      groups: section.groups,
      ...(section.page ? { page: section.page } : {}),
      ...(occ ? { component: occ.component as Component } : {}),
    }
  })
  const legacy: Section[] = leaves
    .filter((leaf) => !merged.has(leaf))
    .map((leaf) => {
      const occ = byLeaf.get(leaf)
      return {
        key: leaf,
        label: leafLabelOf(leaf),
        kind: occ ? ('tab' as const) : ('leaf' as const),
        groups: [leaf],
        ...(occ ? { component: occ.component as Component } : {}),
      }
    })
  const out: Section[] = [...menuSections, ...legacy]
  for (const occ of customs) {
    out.push({
      key: occ.id,
      label: metaText(occ.meta, 'title') || leafLabelOf(occ.id),
      kind: 'tab',
      groups: [],
      component: occ.component as Component,
    })
  }
  return out
}

/** 左侧统一导航只吃数据：外观由 ShadcnSettingsNav 画，插件不再自绘 */
export function buildSettingsNavItems(
  entries: readonly NavEntry[],
  iconOf: (name: string) => unknown,
): SettingsNavItem[] {
  return entries.map((entry) => ({
    key: entry.key,
    label: entry.title,
    category: entry.category,
    ...(entry.categoryPosition !== undefined ? { categoryPosition: entry.categoryPosition } : {}),
    icon: asSettingsIcon(entry.icon ?? iconOf(entry.title)),
    page: entry.page,
  }))
}
