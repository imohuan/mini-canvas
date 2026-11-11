/**
 * 默认主题设置面板（SettingsPanel）的菜单数据模型。
 *
 * 这里只放纯数据推导：分组 / 一级菜单 / 二级段 / 导航项。
 * 注册场、插件装卸、滚动锁等有状态逻辑在 useSettingsNavigation.ts。
 */
import type { Component } from 'vue'
import type { SettingsMenuView } from '@plume-canvas/canvas-data'
import { asSettingsIcon, metaIcon, metaPage, metaPageGroup, metaText } from '../navCategory'

export const SEP = '/'

/** 一级名：第一个 / 分段 */
export function navOf(key: string): string {
  return key.split(SEP)[0]
}

/** 二级展示名：/ 之后的段 */
export function leafLabelOf(key: string): string {
  const segs = key.split(SEP)
  return segs.slice(1).join(SEP) || segs[0]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlotOcc = { id: string; order: number; component: any; meta?: any }

export interface NavEntry {
  key: string
  kind: 'section' | 'nav'
  /** 该一级下的二级段（菜单注册顺序优先；旧分组按原顺序兜底） */
  sections: MenuSection[]
  leaves: string[]
  component?: Component
  /** 插件自绘整页（优先于 settingsGroup） */
  page?: Component
  title: string
  category: string
  /** 第 0 级分类在菜单里的最终位置（缺省按内置顺序） */
  categoryPosition?: number
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
  /** 插件自绘整页（旧 settings.nav 的 meta.page，按 pageGroup 归到这一节） */
  page?: Component
}

export interface Section {
  key: string
  label: string
  kind: 'leaf' | 'tab'
  /** 这一段收拢的 Config.group（合并段可能有多个） */
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
  sectionMap: ReadonlyMap<string, string[]>
  groupSet: ReadonlySet<string>
  menuView: SettingsMenuView
  categoryFor(nav: string, meta?: unknown): string
  iconOf(name: string): unknown
}

/** 分组推导的一级项 + 插件导航项（命中默认项就顶替外观，否则追加） */
export function buildNavEntries(input: BuildNavEntriesInput): NavEntry[] {
  const { navList, sectionMap, groupSet, menuView, categoryFor, iconOf } = input
  const out: NavEntry[] = []
  const used = new Set<string>()
  const sorted = [...navList].sort((a, b) => a.order - b.order)
  /** 哪些 key 来自菜单树：它们的标题 / 分类由菜单决定，旧槽只补 page 与 component */
  const menuKeys = new Set(menuView.navs.map((nav) => nav.id))
  /** 分类名 → 菜单位置：旧入口也按所在分类的最终位置排，不因没有菜单项而掉到最后 */
  const categoryPositions = new Map(menuView.categories.map((c) => [c.title, c.position]))

  // 新菜单：order / before / after 已由设置菜单注册场排好
  for (const nav of menuView.navs) {
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
    // 旧 settings.nav 的 pageGroup：整页归到对应二级节，不再额外长出一级入口
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
    // 动作项（如「快捷键」）本来就没有配置分组：不能按空页过滤掉，否则点了没反应
    const action = typeof nav.action === 'string' ? nav.action : ''
    // settings.nav 注册的配置页（navPage）即使没有 Config 分组也要保留：
    // 快捷键就是这样一页。旧式自绘整页靠 meta.page 识别，不能把带组件的旧入口也当成页。
    const navPage = !metaPage(occ?.meta) ? (occ?.component as Component | undefined) : undefined
    if (!leaves.length && !page && !navPage && !action) continue
    const category = menuView.categories.find((c) => c.id === nav.category)
    out.push({
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

  // 旧分组兜底：没有菜单注册的配置仍按第一个 / 分段聚合，绝不隐藏
  const covered = new Set(
    out.flatMap((entry) => entry.sections.flatMap((section) => section.groups)),
  )
  for (const [nav, leaves] of sectionMap) {
    const uncovered = leaves.filter((g) => !covered.has(g))
    if (!uncovered.length) continue
    const occ = sorted.find((o) => o.id === nav || metaText(o.meta, 'title') === nav)
    if (occ) used.add(occ.id)
    const category = categoryFor(nav, occ?.meta)
    out.push({
      key: nav,
      kind: 'section',
      sections: uncovered.map((group) => ({
        key: group,
        label: leafLabelOf(group),
        groups: [group],
      })),
      leaves: uncovered,
      component: occ?.component as Component | undefined,
      navPage: occ?.component as Component | undefined,
      page: metaPage(occ?.meta) as Component | undefined,
      title: nav,
      category,
      ...(categoryPositions.has(category) ? { categoryPosition: categoryPositions.get(category) } : {}),
      icon: metaIcon(occ?.meta),
    })
  }

  const byKey = new Map(out.map((entry) => [entry.key, entry]))
  const byTitle = new Map(out.map((entry) => [entry.title, entry]))
  const extras: NavEntry[] = []
  for (const occ of sorted) {
    if (used.has(occ.id)) continue
    const pageGroup = metaPageGroup(occ.meta)
    if (pageGroup && covered.has(pageGroup)) {
      const host = out.find((entry) =>
        entry.sections.some((section) => section.groups.includes(pageGroup) && section.page),
      )
      if (host) {
        used.add(occ.id)
        continue
      }
    }
    const title = metaText(occ.meta, 'title')
    const hit = byKey.get(occ.id) ?? (title ? byTitle.get(title) : undefined)
    if (hit) {
      hit.kind = 'nav'
      hit.component = occ.component as Component
      hit.page = metaPage(occ.meta) as Component | undefined
      hit.icon = metaIcon(occ.meta)
      // 旧入口命中旧分组项时，导航项 meta 里的分类优先；菜单项的分类仍由菜单决定
      if (menuKeys.has(hit.key)) continue
      const metaCategory = metaText(occ.meta, 'category')
      if (metaCategory) {
        hit.category = metaCategory
        const position = categoryPositions.get(metaCategory)
        if (position !== undefined) hit.categoryPosition = position
      }
      continue
    }
    const category = categoryFor(title || leafLabelOf(occ.id), occ.meta)
    extras.push({
      key: occ.id,
      kind: 'nav',
      sections: [],
      leaves: [],
      component: occ.component as Component,
      navPage: occ.component as Component,
      page: metaPage(occ.meta) as Component | undefined,
      title: title || leafLabelOf(occ.id),
      category,
      ...(categoryPositions.has(category) ? { categoryPosition: categoryPositions.get(category) } : {}),
      icon: metaIcon(occ.meta),
    })
  }
  out.push(...extras)
  // 菜单树已经按 order + before / after 排好；这里保持该顺序，不再按原始 order 重排。
  return out
}

export interface BuildSectionsInput {
  activeNav: string
  activeEntry?: NavEntry
  sectionMap: ReadonlyMap<string, string[]>
  tabList: readonly SlotOcc[]
}

/** 当前一级下的段：菜单 section 优先；未注册的旧分组按原顺序兜底 */
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
