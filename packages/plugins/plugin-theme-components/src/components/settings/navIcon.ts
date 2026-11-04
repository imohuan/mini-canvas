/**
 * 设置导航图标表：真源已搬到 `@mini-canvas/theme-contract`。
 *
 * 为什么不留在这个包：图标表是纯数据（图标组件 + 分组名），设置面板、壳、各家插件都要读；
 * 留在组件包里会让画布包或其它插件为了拿一张表反过来 import 本包，插件之间又长出一条边。
 * 这里只做转出，不维护第二份，避免"加了一个分组图标却只改到一边"。
 */
export {
  SETTINGS_NAV_ICON_NAMES,
  SETTINGS_NAV_ICON_FALLBACK,
} from '@mini-canvas/theme-contract'
