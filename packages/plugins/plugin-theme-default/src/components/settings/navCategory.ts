/**
 * 设置左导航的「第 0 级」分类规则。
 *
 * 左边现在是「分类标题 + 分类下的一级菜单」，不再把所有一级菜单平铺。
 * 分类可以按下面的优先级覆盖（高 → 低）：
 *
 * 1. `settings.nav` 的 `meta.category`（只影响这一项）
 * 2. `settings/navCategory` 场域（按一级菜单名登记，推荐给由 Config 分组推导出来的菜单用）
 * 3. `DEFAULT_NAV_CATEGORY` 里的内置归类
 * 4. 都没写 → 「个人」
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
import { SETTINGS_NAV_ICON_FALLBACK } from './navIcon'

/** 没写分类时落在这里 */
export const DEFAULT_SETTINGS_CATEGORY = '个人'

/** 内置分类的显示顺序（后面的分类排最后） */
/**
 * 「外观」紧跟个人偏好：形状 / 字体 / 主题配色 / 亮暗模式都只改长相。
 * 用户口径（2026-11-02）：「主题配色应该全部放到外观里面」。
 */
export const SETTINGS_CATEGORY_ORDER: readonly string[] = ['个人', '外观', '集成', '画布', '开发']

/** `settings/navCategory` 场域名 */
export const SETTINGS_NAV_CATEGORY_FIELD = 'settings/navCategory'

/** 已知一级菜单的默认分类；没列出的走「个人」 */
export const DEFAULT_NAV_CATEGORY: Readonly<Record<string, string>> = {
  // 个人：跟着人走的偏好
  常规: '个人',
  通用: '个人',
  主题: '个人',
  导入: '个人',
  存储: '个人',
  配置: '个人',
  个性化: '个人',
  键盘快捷键: '个人',
  // 外观：形状 / 字体 / 配色这类"只改长相"的项。用户口径（2026-11-02）：
  // 「主题配色应该全部放到外观里面」—— 它也是外观，不该待在「个人」下被当成功能开关。
  外观: '外观',
  主题配色: '外观',
  暗色主题配色: '外观',
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
  if (explicit) return explicit
  // 「常规」这个一级菜单是历史包袱：功能开关与配色曾混在一起。
  // 配色已经独立成「外观/主题配色」组，剩下的「常规」菜单仍是功能开关，归个人。
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
export { SETTINGS_NAV_ICON_FALLBACK }
