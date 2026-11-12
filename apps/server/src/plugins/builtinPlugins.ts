/**
 * builtin-plugins —— 哪些插件算「自带」的唯一事实源。
 *
 * 归属由**项目**决定，不由插件自己写 `plume.builtin` 决定：同一个插件在别的发行版里
 * 可能只是可装卸件。这里的每一条都会被 cloud-server 打包进 `assets/plugins`，
 * 前端首启时直接从这些目录装载。
 *
 * 字段：
 *   dir      —— 仓库里的目录名（packages/plugins/<dir>）
 *   reason   —— 为什么算自带（面板上展示、排查时也看这一行）
 *   first    —— 是否在首启安装序列里排到最前（cloud-client 必须，否则后台能力不可用）
 */
export interface BuiltinPluginEntry {
  /** 仓库内目录名（也是包内 assets/plugins 下的目标目录名） */
  dir: string
  /** 归为自带的理由 */
  reason: string
  /** 首启时优先安装（典型：cloud-client） */
  first?: boolean
}

export const BUILTIN_PLUGINS: readonly BuiltinPluginEntry[] = [
  { dir: 'plugin-theme-components', reason: '构建时随 UI 冷启动，同时作为自带插件出现在面板' },
  { dir: 'plugin-theme-canvas', reason: '节点壳 / 连线 / 背景，缺了画布开不了' },
  { dir: 'plugin-manager', reason: '插件管理页本身' },
  { dir: 'plugin-agent', reason: 'Agent 对话与设置' },
  { dir: 'plugin-node-ui', reason: '可视化节点（含后台半）' },
  { dir: 'plugin-bottom-bar', reason: '节点底栏' },
  { dir: 'plugin-node-text', reason: '文本节点' },
  { dir: 'plugin-node-image', reason: '图片节点' },
  { dir: 'plugin-node-video', reason: '视频节点' },
  { dir: 'plugin-node-audio', reason: '音频节点' },
  { dir: 'plugin-node-3d-preview', reason: '3D 预览节点' },
  { dir: 'plugin-node-rotate', reason: '旋转与镜像' },
  { dir: 'plugin-image-grid-split', reason: '宫格切分' },
  { dir: 'plugin-clipboard', reason: '复制粘贴' },
  { dir: 'plugin-context-menu', reason: '右键菜单' },
  { dir: 'plugin-file-drop', reason: '文件拖入' },
  { dir: 'plugin-group', reason: '分组' },
  { dir: 'plugin-multi-select', reason: '多选' },
  { dir: 'plugin-edge-cutting', reason: '连线切割' },
  { dir: 'plugin-style-library', reason: '风格库（含后台半）' },
  { dir: 'plugin-shortcut-manager', reason: '快捷键帮助面板与设置页的快捷键配置' },
  { dir: 'plugin-cloud-client', reason: '云端连接：后台能力入口，首启必须最先装上', first: true },
] as const

/** 目录名 → 条目 */
export const BUILTIN_BY_DIR: ReadonlyMap<string, BuiltinPluginEntry> = new Map(
  BUILTIN_PLUGINS.map((e) => [e.dir, e]),
)

/** 首启必须最先装的插件（顺序即安装顺序） */
export const FIRST_INSTALL_DIRS: readonly string[] = BUILTIN_PLUGINS.filter((e) => e.first).map((e) => e.dir)

