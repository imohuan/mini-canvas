/**
 * 设置面板左导航的**图标场域**（`registryOf('settings/navIcon')`）。
 *
 * 每个一级分组一个图标；同一分组多家登记时 order 最小者胜（换主题/换皮可整体替换）。
 * 插件想给自己的分组换图标：
 *
 * ```ts
 * ctx.registryOf('settings/navIcon').add('我的分组', MyIcon, { id: 'my-plugin', order: -1 })
 * ```
 *
 * 没登记的、或拿不到场时，设置面板回落到一个通用点状图标 —— 不会出现空位。
 * 这里只登记**设置导航**用到的图标，不是全局图标方案（各插件仍自带 SVG）。
 */
import type { Component } from 'vue'
import {
  Blocks,
  Bot,
  Brush,
  Bug,
  Cable,
  Circle,
  Database,
  Download,
  FolderTree,
  Grid2x2,
  Keyboard,
  LayoutGrid,
  Moon,
  MousePointer2,
  Palette,
  Pipette,
  Puzzle,
  RefreshCw,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  SquareStack,
  SunMoon,
  Upload,
  Wrench,
} from 'lucide-vue-next'

/** 设置面板的一级分组 → 默认图标（未登记的设置项不会空着）。 */
export const SETTINGS_NAV_ICON_NAMES: ReadonlyArray<readonly [string, Component]> = [
  // —— 个人 ——
  ['常规', SlidersHorizontal],
  ['通用', SlidersHorizontal],
  ['外观', Brush],
  ['主题配色', Palette],
  ['暗色主题配色', Moon],
  ['主题模式', SunMoon],
  ['主题', Brush],
  ['导入', Download],
  ['存储', Database],
  ['配置', SlidersHorizontal],
  ['个性化', Sparkles],
  ['键盘快捷键', Keyboard],
  ['快捷键', Keyboard],
  // —— 集成 ——
  ['插件', Puzzle],
  ['Agent', Bot],
  ['模型', Bot],
  ['连接', Cable],
  ['电脑操控', LayoutGrid],
  ['应用快照', SquareStack],
  ['浏览器', LayoutGrid],
  // —— 画布 ——
  ['节点', Blocks],
  ['边', Shapes],
  ['布局', Grid2x2],
  ['画布', LayoutGrid],
  ['交互', MousePointer2],
  ['工具', Wrench],
  ['资源库', FolderTree],
  ['素材', FolderTree],
  // —— 开发 ——
  ['调试', Bug],
  ['热重载', RefreshCw],
  ['光标', Pipette],
  ['上传', Upload],
  ['展示', Sparkles],
  ['演示', Sparkles],
]

/** 兜底图标：没登记的一级分组用它。 */
export const SETTINGS_NAV_ICON_FALLBACK: Component = Circle
