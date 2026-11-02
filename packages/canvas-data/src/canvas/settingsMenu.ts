/**
 * settingsMenu —— 设置面板 0 / 1 / 2 级菜单的注册场（纯逻辑，零 Vue）。
 *
 * 规则与组件场域完全一致：
 * - **不同 id**：order 小者排在前面；before / after 只改位置，不改谁赢。
 * - **同一个 id**：不同插件各占一层；order 小者赢，同 order 后注册者赢；
 *   赢家卸载后自动露出下一层（RegistryImpl 的叠层语义）。
 * - **同一个插件同 id** 再注册 = 替换自己那一层（热更不叠高）。
 *
 * 三级各自独立排序，不跨级比较。菜单只决定“标题、图标、顺序、归属”；
 * 配置字段仍由 Config.group 归入二级分组，内容仍由 settingsGroup/<group> 渲染。
 */
import { RegistryImpl, orderSlotItems } from '@mini-canvas/kernel'
import type { Disposable, Registry } from '@mini-canvas/kernel'

/** 0 级分类 */
export interface SettingsCategoryDef {
  /** 稳定 id，例如 category/canvas */
  id: string
  title: string
  /** 小者排前面、同 id 时小者赢；缺省 1000 */
  order?: number
  before?: string
  after?: string
}

/** 1 级菜单 */
export interface SettingsNavDef {
  id: string
  /** 所属 0 级分类 id */
  category: string
  title: string
  /** 图标组件句柄（opaque；本层不 import Vue） */
  icon?: unknown
  /** 插件自绘整页；有就优先于二级分组 */
  page?: unknown
  order?: number
  before?: string
  after?: string
}

/** 2 级分组 */
export interface SettingsSectionDef {
  id: string
  /** 所属 1 级菜单 id */
  nav: string
  title: string
  /** 主 Config.group（完整分组名）；只负责把字段挂到这节，不再决定菜单层级 */
  group?: string
  /**
   * 这一节还可以收拢哪些 Config.group。
   *
   * 一个插件常把同一功能的字段拆成几个分组（方向 / 间距 / 聚焦），
   * 但用户只想看到一张「自动布局」卡片。把分组列在这里，菜单层负责合并展示；
   * Config.group 仍各自稳定，字段持久化的 key 不变。
   */
  groups?: readonly string[]
  order?: number
  before?: string
  after?: string
}

/** 解析后的菜单树（UI 直接消费） */
export interface SettingsMenuSection extends Omit<SettingsSectionDef, 'group' | 'groups'> {
  /** 主分组（兼容只读 group 的旧消费方） */
  group: string
  /** 本节声明的全部 Config.group（已去重，顺序即展示顺序） */
  groups: string[]
  /** 在所属一级菜单中的展示位置（0 起；已把 order + before / after 算进去） */
  position: number
  /** 配置里没显式注册、自动补出来的分组 */
  auto?: boolean
}

export interface SettingsMenuNav extends Omit<SettingsNavDef, 'page'> {
  page?: unknown
  /** 在所属分类中的展示位置（0 起；已把 order + before / after 算进去） */
  position: number
  sections: SettingsMenuSection[]
}

export interface SettingsMenuCategory extends SettingsCategoryDef {
  /** 分类的展示位置（0 起；已把 order + before / after 算进去） */
  position: number
  navs: SettingsMenuNav[]
}

export type SettingsMenuIssueKind = 'unregistered-group' | 'unregistered-nav'

export interface SettingsMenuIssue {
  kind: SettingsMenuIssueKind
  title: string
  group?: string
  nav?: string
}

export interface SettingsMenuView {
  categories: SettingsMenuCategory[]
  /** 全部一级（跨分类拍平，已按最终位置排好）——给需要“全部菜单”的消费方 */
  navs: SettingsMenuNav[]
  issues: SettingsMenuIssue[]
}

/** 注册插件拿到的句柄：方法随所属插件卸载自动撤销 */
export interface SettingsMenuScope {
  category(def: SettingsCategoryDef): Disposable
  nav(def: SettingsNavDef): Disposable
  section(def: SettingsSectionDef): Disposable
}

/** 三张表都用同一个键；真正的身份是条目 id（def.id），同 id 才叠层/覆盖 */
const MENU_KEY = 'settings-menu'

/** 一节声明的全部配置分组：group 在前，groups 补充，去重保序。 */
export function settingsSectionGroups(def: SettingsSectionDef): string[] {
  const out: string[] = []
  for (const group of [def.group, ...(def.groups ?? [])]) {
    const name = group?.trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * 0/1/2 级菜单注册表。
 *
 * 内部用三张 RegistryImpl，每张表一个 id 一摞层；赢家 / 顺序规则直接复用内核场域，
 * 不另写一套“优先级”。
 */
export class SettingsMenuRegistry {
  private categories = new RegistryImpl<SettingsCategoryDef>()
  private navs = new RegistryImpl<SettingsNavDef>()
  private sections = new RegistryImpl<SettingsSectionDef>()
  private listeners = new Set<() => void>()
  private unsubs: Array<() => void> = []

  constructor() {
    for (const reg of [this.categories, this.navs, this.sections]) {
      const off = reg.subscribe(() => this.notify())
      this.unsubs.push(off.dispose)
    }
  }

  /** UI 订阅：任何一级菜单增删 / 换赢家都通知 */
  subscribe(fn: () => void): Disposable {
    this.listeners.add(fn)
    return { dispose: () => this.listeners.delete(fn) }
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn()
      } catch {
        /* 单个订阅者异常不阻断其它 */
      }
    }
  }

  /**
   * 以某插件身份注册（同一张表、按 source 分层、随插件回收）。
   * @param onDispose 宿主可把撤销登记进插件 fiber；不传则用返回的 Disposable
   */
  forPlugin(plugin: string, onDispose?: (fn: () => void) => void): SettingsMenuScope {
    const keep = (handle: { dispose(): void }): void => {
      if (onDispose) onDispose(() => handle.dispose())
    }
    const category = this.categories.bind(plugin)
    const nav = this.navs.bind(plugin)
    const section = this.sections.bind(plugin)
    return {
      category(def) {
        const h = category.add(MENU_KEY, def, { id: def.id, order: def.order })
        keep(h)
        return h
      },
      nav(def) {
        const h = nav.add(MENU_KEY, def, { id: def.id, order: def.order })
        keep(h)
        return h
      },
      section(def) {
        const h = section.add(MENU_KEY, def, { id: def.id, order: def.order })
        keep(h)
        return h
      },
    }
  }

  /** 当前赢家定义（诊断 / 单测） */
  category(id: string): SettingsCategoryDef | undefined {
    return this.categories.get(MENU_KEY, id)?.value
  }

  nav(id: string): SettingsNavDef | undefined {
    return this.navs.get(MENU_KEY, id)?.value
  }

  section(id: string): SettingsSectionDef | undefined {
    return this.sections.get(MENU_KEY, id)?.value
  }

  /**
   * 解析成可直接渲染的 0/1/2 树。
   * 每个条目带 `position`（0 起），它就是最终展示顺序；消费方不要再按原始 order 排一次。
   * @param groups SettingsStore.groups()：没有注册的配置分组会补成 auto 小节，绝不隐藏
   */
  resolve(groups: readonly string[] = []): SettingsMenuView {
    const issues: SettingsMenuIssue[] = []
    const categories = this.sortedCategories()
    const navs = this.sortedNavs()
    const sections = this.sortedSections()

    const groupToSection = new Map<string, SettingsSectionDef>()
    for (const section of sections) {
      for (const group of settingsSectionGroups(section)) groupToSection.set(group, section)
    }

    // 未注册的 group：按「一级/二级」拆；一级没有就自动建到「个人」末尾
    const extraByNav = new Map<string, SettingsMenuSection[]>()
    for (const group of groups) {
      if (groupToSection.has(group)) continue
      const [navTitle, ...rest] = group.split('/')
      const title = rest.join('/') || navTitle || group
      const nav = navs.find((n) => n.title === navTitle)
      if (!nav) {
        issues.push({ kind: 'unregistered-nav', title: navTitle || group, group })
        continue
      }
      issues.push({ kind: 'unregistered-group', title, group, nav: nav.id })
      const list = extraByNav.get(nav.id) ?? []
      list.push({
        id: 'auto:' + group,
        nav: nav.id,
        title,
        group,
        groups: [group],
        order: 10000 + list.length,
        position: 0,
        auto: true,
      })
      extraByNav.set(nav.id, list)
    }

    // 一级都没注册的 group：按 group 的第一段建临时一级，归到「个人」
    const orphans = groups.filter((g) => {
      const navTitle = g.split('/')[0]
      return !navs.some((n) => n.title === navTitle) && !groupToSection.has(g)
    })
    if (orphans.length) {
      let personalCategory = categories.find((c) => c.title === '个人')
      if (!personalCategory) {
        personalCategory = { id: 'auto:category/personal', title: '个人', order: 10000 }
        categories.push(personalCategory)
      }
      const byTitle = new Map<string, SettingsMenuSection[]>()
      for (const group of orphans) {
        const [navTitle, ...rest] = group.split('/')
        const title = rest.join('/') || navTitle || group
        const list = byTitle.get(navTitle || group) ?? []
        list.push({
          id: 'auto:' + group,
          nav: 'auto:nav/' + (navTitle || group),
          title,
          group,
          groups: [group],
          order: 10000 + list.length,
          position: 0,
          auto: true,
        })
        byTitle.set(navTitle || group, list)
      }
      for (const [title, list] of byTitle) {
        const id = 'auto:nav/' + title
        navs.push({
          id,
          category: personalCategory.id,
          title,
          order: 10000 + navs.length,
        })
        extraByNav.set(id, list)
      }
    }

    const byNav = new Map<string, SettingsMenuSection[]>()
    for (const section of sections) {
      const groups = settingsSectionGroups(section)
      if (!groups.length) continue
      const list = byNav.get(section.nav) ?? []
      list.push({
        ...section,
        group: groups[0] ?? '',
        groups,
        position: 0,
      })
      byNav.set(section.nav, list)
    }
    for (const [navId, list] of extraByNav) {
      const current = byNav.get(navId) ?? []
      byNav.set(navId, [...current, ...list])
    }

    const tree: SettingsMenuCategory[] = categories.map((category) => ({
      ...category,
      position: 0,
      navs: navs
        .filter((nav) => nav.category === category.id)
        .map((nav) => ({
          ...nav,
          position: 0,
          sections: byNav.get(nav.id) ?? [],
        })),
    }))

    // 一级没有挂到任何分类的：临时补到「个人」，配置不消失
    const known = new Set(tree.flatMap((c) => c.navs.map((n) => n.id)))
    const loose = navs.filter((nav) => !known.has(nav.id))
    if (loose.length) {
      let personal = tree.find((c) => c.title === '个人')
      if (!personal) {
        personal = { id: 'auto:category/personal', title: '个人', order: 10000, position: 0, navs: [] }
        tree.push(personal)
      }
      for (const nav of loose) {
        issues.push({ kind: 'unregistered-nav', title: nav.title, nav: nav.id })
        personal.navs.push({ ...nav, position: 0, sections: byNav.get(nav.id) ?? [] })
      }
    }

    // 位置只在这里定一次：序号就是最终展示顺序，后续消费方直接读 position。
    // 这样 before / after 排出来的相对位置不会被“按 order 再排一次”覆盖。
    tree.forEach((category, categoryIndex) => {
      category.position = categoryIndex
      category.navs.forEach((nav, navIndex) => {
        nav.position = navIndex
        nav.sections.forEach((section, sectionIndex) => {
          section.position = sectionIndex
        })
      })
    })

    const flatNavs = tree.flatMap((category) => category.navs)
    return { categories: tree, navs: flatNavs, issues }
  }

  private sortedCategories(): SettingsCategoryDef[] {
    return orderSlotItems(this.winnerValues(this.categories)).items
  }

  private sortedNavs(): SettingsNavDef[] {
    return orderSlotItems(this.winnerValues(this.navs)).items
  }

  private sortedSections(): SettingsSectionDef[] {
    return orderSlotItems(this.winnerValues(this.sections)).items
  }

  /** list() 每个 id 只返回当前赢家；把 order / before / after 取赢家那条 */
  private winnerValues<T extends SettingsCategoryDef | SettingsNavDef | SettingsSectionDef>(
    registry: Registry<T>,
  ): T[] {
    return registry.list(MENU_KEY).map((entry) => ({
      ...entry.value,
      order: entry.order,
      ...(entry.value.before !== undefined ? { before: entry.value.before } : {}),
      ...(entry.value.after !== undefined ? { after: entry.value.after } : {}),
    }))
  }
}
