/**
 * 设置左导航的第 0 级分类规则（成品皮本地入口）。
 *
 * 规则本体在 plugin-theme-default 的 navCategory.ts —— 默认皮与成品皮必须用同一份归类，
 * 否则换皮后同一个一级菜单会跑到不同分类下。这里只做类型安全的转出。
 */
export {
  DEFAULT_NAV_CATEGORY,
  DEFAULT_SETTINGS_CATEGORY,
  SETTINGS_CATEGORY_ORDER,
  SETTINGS_NAV_CATEGORY_FIELD,
  categoryOf,
  categoryRank,
  metaIcon,
  metaPage,
  metaText,
} from '@mini-canvas/plugin-theme-default/components/settings/navCategory.js'
