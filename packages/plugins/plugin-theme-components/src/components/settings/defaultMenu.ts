/**
 * defaultMenu —— 默认主题提供的 0/1/2 级设置菜单定义。
 *
 * 这是**默认数据**，不是要求所有插件维护的总表：其它插件引用这些 id，或注册自己的 id。
 * 同一个 id 有更小 order 时覆盖；上游卸载后自动露出这里。
 */
import { Blocks, Brush, Grid2x2, Layers, Puzzle } from 'lucide-vue-next'
import type { SettingsCategoryDef, SettingsMenuScope, SettingsNavDef, SettingsSectionDef } from '@mini-canvas/canvas-data'

const C = {
  personal: 'category/personal',
  appearance: 'category/appearance',
  integration: 'category/integration',
  canvas: 'category/canvas',
  development: 'category/development',
} as const

const categories: SettingsCategoryDef[] = [
  { id: C.personal, title: '个人', order: 10 },
  { id: C.appearance, title: '外观', order: 20 },
  { id: C.integration, title: '集成', order: 30 },
  { id: C.canvas, title: '画布', order: 40 },
  { id: C.development, title: '开发', order: 50 },
]

const navs: SettingsNavDef[] = [
  { id: 'nav/personal/general', category: C.personal, title: '通用', order: 10 },
  /**
   * 快捷键：设置页里的真实配置页。面板由 plugin-shortcut-manager 注册为
   * settings.nav occupant（id 与这里一致），两套设置皮按 id 命中同一页。
   * 不能再标成 action —— 那会只弹出帮助浮层，右侧仍是空白。
   */
  { id: 'nav/personal/shortcuts', category: C.personal, title: '快捷键', order: 20 },
  { id: 'nav/appearance/theme', category: C.appearance, title: '主题', order: 10, icon: Brush },
  { id: 'nav/integration/agent', category: C.integration, title: 'Agent', order: 10 },
  { id: 'nav/integration/plugins', category: C.integration, title: '插件', order: 20, icon: Puzzle },
  { id: 'nav/integration/connect', category: C.integration, title: '连接', order: 30 },
  { id: 'nav/canvas/interaction', category: C.canvas, title: '交互', order: 10 },
  { id: 'nav/canvas/layout', category: C.canvas, title: '布局', order: 20, icon: Grid2x2 },
  { id: 'nav/canvas/node', category: C.canvas, title: '节点', order: 30, icon: Blocks },
  { id: 'nav/canvas/edge', category: C.canvas, title: '边', order: 40, icon: Layers },
  { id: 'nav/canvas/tools', category: C.canvas, title: '工具', order: 50 },
  { id: 'nav/development/debug', category: C.development, title: '调试', order: 10 },
  { id: 'nav/development/demo', category: C.development, title: '演示', order: 20 },
]

const s = (
  nav: string,
  key: string,
  title: string,
  group: string | readonly string[],
  order: number,
): SettingsSectionDef => {
  const groups = typeof group === 'string' ? [group] : [...group]
  return {
  id: 'section/' + nav + '/' + key,
  nav: 'nav/' + nav,
  title,
  group: groups[0],
  groups,
  order,
  }
}

const sections: SettingsSectionDef[] = [
  s('personal/general', 'basic', '基础', '通用/基础', 10),
  s('integration/agent', 'settings', 'Agent 设置', '集成/Agent', 10),
  s('integration/plugins', 'catalog', '插件管理', '集成/插件', 10),
  s('appearance/theme', 'shape', '形状', '外观/形状', 10),
  s('appearance/theme', 'font', '字体', '外观/字体', 20),
  s('appearance/theme', 'size', '尺寸', '外观/尺寸', 30),
  s('appearance/theme', 'popup', '浮层', '外观/浮层', 32),
  s('appearance/theme', 'mode', '主题模式', '外观/主题模式', 35),
  s('appearance/theme', 'palette', '主题配色', '外观/主题配色', 40),
  s('appearance/theme', 'palette-dark', '暗色主题配色', '外观/暗色主题配色', 50),
  s('appearance/theme', 'lab', '主题工作台', '外观/主题工作台', 60),
  s('integration/connect', 'generate', '生成', ['常规/图片生成', '常规/文本生成'], 10),
  s('integration/connect', 'upstream', '上游', '常规/上游接口', 20),
  s('integration/connect', 'cloud', '云端', ['常规/云端客户端', '连接/云端'], 30),
  s('integration/connect', 'web2api', 'web2api', ['web2api/连接', 'web2api/任务', '连接/web2api'], 40),
  s('canvas/interaction', 'basic', '基础', ['常规/画布', '交互/基础'], 10),
  s('canvas/layout', 'guide', '对齐辅助线', '布局/对齐辅助线', 10),
  s(
    'canvas/layout',
    'auto-layout',
    '自动布局',
    ['布局/自动布局', '布局/自动布局方向', '布局/自动布局间距', '布局/自动布局聚焦'],
    20,
  ),
  s('canvas/layout', 'group', '分组', ['布局/分组', '布局/分组留白'], 30),
  s('canvas/layout', 'storyboard', '分镜', ['布局/分镜', '布局/分镜组'], 40),
  s('canvas/layout', 'multi-select', '多选', '布局/多选', 50),
  s(
    'canvas/layout',
    'node-size',
    '节点尺寸',
    ['布局/图片节点尺寸', '布局/视频节点尺寸', '布局/文本节点尺寸', '布局/可视化节点尺寸'],
    55,
  ),
  s('canvas/layout', 'toolbar', '控制栏', ['布局/控制栏', '常规/底栏'], 60),
  s('canvas/layout', 'diagnose', '诊断', '布局/诊断', 70),
  s('canvas/node', 'port', '端口', '节点/端口', 10),
  s('canvas/node', 'port-zone', '活动区域', '节点/端口活动区', 15),
  s('canvas/node', 'title', '标题', '节点/标题', 20),
  s(
    'canvas/node',
    'detail',
    '细节',
    ['节点/细节', '节点/低细节', '节点/多选标记', '节点/文本LOD'],
    30,
  ),
  s('canvas/node', 'snap-zone', '吸附区域', '节点/吸附带', 16),
  s('canvas/node', 'size', '尺寸', '节点/尺寸', 40),
  s(
    'canvas/node',
    'content',
    '可视化节点分档',
    ['节点/内容', '可视化节点/渲染清晰度', '常规/可视化节点'],
    50,
  ),
  s('canvas/node', 'image-tiers', '图片分档', '节点/缩略图', 52),
  s('canvas/node', 'video-tiers', '视频分档', '节点/缩略图', 54),
  // 加载态分档：全局一份（图片 / 视频 / 可视化 / 文本节点共用同一只加载件）。
  // 放在「节点」分类下、紧跟两个缩略图分档，因为它们是同一类"缩放档位"设置。
  s('canvas/node', 'loading-tiers', '加载态分档', '常规/节点加载态', 56),
  s('canvas/node', 'audio', '音频', ['节点/音频', '节点/音频节点'], 60),
  s('canvas/node', 'video-edit', '视频剪辑', '节点/视频剪辑', 70),
  s('canvas/edge', 'line', '连线', ['边/连线', '节点/连线菜单'], 10),
  s('canvas/edge', 'cutting', '连线切割', '边/连线切割', 20),
  s('canvas/tools', 'export', '导出', ['工具/导出', '导出'], 10),
  s('canvas/tools', 'minimap', '小地图', ['工具/小地图', '常规/小地图'], 20),
  s('canvas/tools', 'cursor', '光标', '工具/光标', 30),
  s('canvas/tools', 'library', '风格库', '常规/风格库', 40),
  s('development/debug', 'debug', '调试', ['常规/调试', '调试/调试'], 10),
  s('development/debug', 'hot-reload', '热重载', ['调试/热重载', '调试插件'], 20),
  s('development/demo', 'showcase', '展示台', ['演示/展示台', '插件展示'], 10),
  s('development/demo', 'gallery', '组件展厅', '演示/组件展厅', 20),
]

/** 默认主题 apply 时注册一次。order 遵循场域：小者赢、排前面 */
export function registerDefaultSettingsMenu(menu: SettingsMenuScope): void {
  for (const category of categories) menu.category(category)
  for (const nav of navs) menu.nav(nav)
  for (const section of sections) menu.section(section)
}
