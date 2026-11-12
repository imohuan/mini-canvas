/**
 * 设置左导航的「第 0 级」分类规则。
 *
 * 左边现在是「分类标题 + 分类下的一级菜单」，不再把所有一级菜单平铺。
 * 分类可以按下面的优先级覆盖（高 → 低）：
 *
 * 1. `settings.nav` 的 `meta.category`（只影响这一项）
 * 2. `settings/navCategory` 场域（按一级菜单名登记，推荐给由 Config 分组推导出来的菜单用）
 * 3. `DEFAULT_NAV_CATEGORY` 里的内置归类
 * 4. 都没写 → 「常规」
 *
 * 例子：
 * ```ts
 * // 方式一：导航项自带分类
 * ctx.slots.register('settings.nav', {
 *   id: 'my/nav',
 *   component: null,
 *   meta: { title: '我的工具', category: '集成', icon: MyIcon },
 * })
 *
 * // 方式二：给已有的 Config 分组补分类
 * ctx.registryOf<string>('settings/navCategory').add('我的分组', '集成', { id: 'my-plugin' })
 * ```
 *
 * 这个模块只放纯函数，两套设置皮共用同一份规则。
 */

import type { Component } from 'vue'
import { SETTINGS_NAV_ICON_FALLBACK } from '@plume-canvas/theme-contract'

/** 没写分类时落在这里 */
export const DEFAULT_SETTINGS_CATEGORY = '常规'

/**
 * 内置分类的显示顺序（后面的分类排最后）。
 *
 * 2026-11-12 用户口径：原来的「个人」和「外观」合成一个「常规」—— 左侧只该有
 * 四段（常规 / 集成 / 画布 / 开发），不再把"个人信息"和"页面长相"拆成两段。
 */
export const SETTINGS_CATEGORY_ORDER: readonly string[] = ['常规', '集成', '画布', '开发']

/**
 * 旧分类名 → 新分类名。
 *
 * 插件和文档里还大量写着 meta.category: '个人' / '外观'。这些字符串只决定
 * 「排在哪一段」，不再各造一个分类；否则合并分类后左侧会重新冒出两段旧标题。
 */
const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  个人: '常规',
  外观: '常规',
}

/** 把旧分类名收拢到当前分类名；未知分类原样返回 */
export function normalizeSettingsCategory(category: string): string {
  return LEGACY_CATEGORY_ALIASES[category] ?? category
}

/** `settings/navCategory` 场域名 */
export const SETTINGS_NAV_CATEGORY_FIELD = 'settings/navCategory'

/** 已知一级菜单的默认分类；没列出的走「常规」 */
export const DEFAULT_NAV_CATEGORY: Readonly<Record<string, string>> = {
  // 常规：跟着人走的偏好 + 只改长相的项（2026-11-12 起合成一段）
  常规: '常规',
  通用: '常规',
  主题: '常规',
  导入: '常规',
  存储: '常规',
  配置: '常规',
  个性化: '常规',
  键盘快捷键: '常规',
  外观: '常规',
  主题配色: '常规',
  暗色主题配色: '常规',
  // 集成：接外部能力的入口
  插件: '集成',
  Agent: '集成',
  连接: '集成',
  模型: '集成',
  电脑操控: '集成',
  应用快照: '集成',
  浏览器: '集成',
  web2api: '集成',
  // 画布：只影响画布本身
  节点: '画布',
  边: '画布',
  布局: '画布',
  画布: '画布',
  交互: '画布',
  工具: '画布',
  资源库: '画布',
  素材: '画布',
  光标: '画布',
  // 开发：调试与开发工具
  调试: '开发',
  调试插件: '开发',
  热重载: '开发',
  上传: '开发',
  展示: '开发',
  插件展示: '开发',
  // 颜色配方（主题工作台）：它调的就是主题配色，跟「主题」一起归「常规」。
  主题工作台: '常规',
}

/** 从 unknown meta 里安全取字符串 */
export function metaText(meta: unknown, key: 'title' | 'category'): string {
  if (!meta || typeof meta !== 'object') return ''
  const value = (meta as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** 从 unknown meta 里取图标组件（只认函数/对象，模板 :is 才不会拿到脏值） */
export function metaIcon(meta: unknown): unknown {
  if (!meta || typeof meta !== 'object') return undefined
  const value = (meta as Record<string, unknown>).icon
  return typeof value === 'function' || (value && typeof value === 'object') ? value : undefined
}

/**
 * 把 unknown 收窄成「能交给 <component :is> 的图标」。
 *
 * 只认函数/对象：字符串会被 Vue 当成原生标签名（'minimap' 渲染成空标签，
 * 或把 '-' 当文本画出来），这正是截图里出现破折号/空图标的原因。
 * 取不到就回落兜底图标，绝不留空位。
 */
export function asSettingsIcon(value: unknown): Component {
  if (typeof value === 'function' || (value && typeof value === 'object')) {
    return value as Component
  }
  return SETTINGS_NAV_ICON_FALLBACK
}

/** 从 unknown meta 里取自定义页面组件 */
export function metaPage(meta: unknown): unknown {
  if (!meta || typeof meta !== 'object') return undefined
  const value = (meta as Record<string, unknown>).page
  return typeof value === 'function' || (value && typeof value === 'object') ? value : undefined
}

/**
 * 旧 settings.nav 的整页归属分组。
 *
 * 插件还没迁到菜单、但它的整页其实只对应一个 Config.group 时，写这个字段：
 * 设置面板会把 meta.page 挂到收纳该 group 的二级 section 上，而不是再追加一个一级入口。
 */
export function metaPageGroup(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return ''
  const value = (meta as Record<string, unknown>).pageGroup
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 解析一个一级菜单属于哪个分类。
 *
 * @param nav 一级菜单名（分组第一个 / 前那段）
 * @param metaCategory 导航项 meta.category（最高优先级）
 * @param registryCategory settings/navCategory 场域里登记的值
 */
export function categoryOf(
  nav: string,
  metaCategory?: string,
  registryCategory?: string,
): string {
  const explicit = metaCategory?.trim() || registryCategory?.trim()
  if (explicit) return normalizeSettingsCategory(explicit)
  // 没写分类的一级菜单按内置表归类；表里没有的也落在「常规」。
  return DEFAULT_NAV_CATEGORY[nav] ?? DEFAULT_SETTINGS_CATEGORY
}

/** 分类排序：内置顺序优先，额外分类按首次出现顺序排后面 */
export function categoryRank(category: string, extraOrder: readonly string[]): number {
  const builtin = SETTINGS_CATEGORY_ORDER.indexOf(category)
  if (builtin >= 0) return builtin
  const extra = extraOrder.indexOf(category)
  return SETTINGS_CATEGORY_ORDER.length + (extra >= 0 ? extra : 999)
}

/** 一个分类的排序依据：菜单解析后的 position 优先，没有就按内置顺序。 */
export interface SettingsCategorySortKey {
  category: string
  /** 菜单树给的最终位置（0 起）；没有 = 旧装配，走内置顺序 */
  position?: number
}

/**
 * 分类排序：菜单 position 小者在前；都没有 position 时按内置顺序，
 * 新造的分类按首次出现顺序排最后。
 */
export function compareSettingsCategory(
  a: SettingsCategorySortKey,
  b: SettingsCategorySortKey,
  extras: readonly string[] = [],
): number {
  const ap = a.position ?? Number.POSITIVE_INFINITY
  const bp = b.position ?? Number.POSITIVE_INFINITY
  if (ap !== bp) return ap - bp
  return categoryRank(a.category, extras) - categoryRank(b.category, extras)
}

/** 设置导航图标兜底（与 navIcon.ts 的导出保持一致，避免两处各写一个组件） */

/** settings/hidden 场域名：登记“不要在设置页显示”的分组或单项。 */
export const SETTINGS_HIDDEN_FIELD = 'settings/hidden'

/**
 * 一条“隐藏”声明。
 *
 * - 有 group、没有 key  → 整个分组都不显示
 * - 同时有 group 和 key → 只隐藏这个分组里的某一项
 * - 只有 key            → 按 key 全局隐藏（跨分组同名项）
 *
 * 由提供更完整界面的一方登记（例如颜色配方取代了零散配色项），
 * 插件卸载时自动撤销，配置会重新出现。
 */
export interface SettingsHiddenDecl {
  group?: string
  key?: string
}

/**
 * 全部声明都落在同一个键下：场域按 key 分桶，这里只需要"一个桶里放所有声明"。
 * 读的时候一次 list() 全拿出来，比按 group 分桶更好维护（新增粒度不用改读取端）。
 */
export const SETTINGS_HIDDEN_KEY = '*'

/** 这条声明是否把整个分组藏起来。 */
export function hidesWholeGroup(decl: SettingsHiddenDecl): boolean {
  return Boolean(decl.group) && !decl.key
}

/** 这条声明是否命中某个具体配置项。 */
export function hidesKey(decl: SettingsHiddenDecl, group: string, key: string): boolean {
  if (!decl.key) return false
  if (decl.key !== key) return false
  return !decl.group || decl.group === group
}

export { SETTINGS_NAV_ICON_FALLBACK }


