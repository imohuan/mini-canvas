/**
 * dev-plugins —— **只在 dev 构建里**存在的静态插件清单。
 *
 * 用户口径（2026-11-11）：dev 下直接 import 插件源码，改完立刻热更，方便调插件；
 * build 下界面包不含任何插件，全部由 cloud-server 的清单在启动时装载。
 *
 * 因此这份文件只被 `assembly.ts` 的 dev 分支引用；build 分支不会把它打进产物。
 * 一旦它被 build 引用，插件代码就会重新进入界面包（这正是要避免的事）。
 */
import type { PluginModule } from '@plume-canvas/kernel'
import { canvasRenderPlugin } from '@plume-canvas/canvas-render'
import { themeComponentsPlugin } from '@plume-canvas/plugin-theme-components'
import { themeCanvasPlugin } from '@plume-canvas/plugin-theme-canvas'
import { nodeTextPlugin } from '@plume-canvas/plugin-node-text'
import { nodeImagePlugin } from '@plume-canvas/plugin-node-image'
import { gridSplitPlugin } from '@plume-canvas/plugin-image-grid-split'
import { nodeRotatePlugin } from '@plume-canvas/plugin-node-rotate'
import { node3dPreviewPlugin } from '@plume-canvas/plugin-node-3d-preview'
import { nodeVideoPlugin } from '@plume-canvas/plugin-node-video'
import { nodeAudioPlugin } from '@plume-canvas/plugin-node-audio'
import { pluginBottomBar } from '@plume-canvas/plugin-bottom-bar'
import { clipboardPlugin } from '@plume-canvas/plugin-clipboard'
import { contextMenuPlugin } from '@plume-canvas/plugin-context-menu'
import { fileDropPlugin } from '@plume-canvas/plugin-file-drop'
import { groupPlugin } from '@plume-canvas/plugin-group'
import { multiSelectPlugin } from '@plume-canvas/plugin-multi-select'
import { edgeCuttingPlugin } from '@plume-canvas/plugin-edge-cutting'
import { hotReloadPlugin } from '@plume-canvas/plugin-hot-reload'
import { uiAssetUploadPlugin } from './assetUploadPlugin'
import { agentPlugin } from '@plume-canvas/plugin-agent'
import { styleLibraryPlugin } from '@plume-canvas/plugin-style-library'
import { projectsApiPlugin } from './projectsApiPlugin'
import { pluginManagerPlugin } from '@plume-canvas/plugin-manager'
import { nodeUiPlugin } from '@plume-canvas/plugin-node-ui'
import { cloudClientPlugin } from '@plume-canvas/plugin-cloud-client'
import { shortcutSettingsPlugin } from '@plume-canvas/plugin-shortcut-manager'

/** 一条静态装配记录：插件 + 它属于哪一层 + 为什么在这里（维护者与测试共读）。 */
export interface AppPluginEntry {
  plugin: PluginModule
  /** app = 应用级常驻；canvas = 进入画布才装 */
  kind: 'app' | 'canvas'
  /** 一句话理由，测试用它核对注释与实现是否一致 */
  reason: string
}

/** dev 下的完整装配清单（顺序即装载序） */
export const DEV_PLUGIN_REGISTRY: readonly AppPluginEntry[] = [
  { plugin: canvasRenderPlugin, kind: 'app', reason: '渲染层基础设施（能力包注册）' },
  { plugin: themeComponentsPlugin, kind: 'app', reason: '通用组件与设置面板' },
  { plugin: pluginManagerPlugin, kind: 'app', reason: '插件管理页' },
  { plugin: agentPlugin, kind: 'app', reason: 'Agent 对话与设置' },
  { plugin: hotReloadPlugin, kind: 'app', reason: '热重载开发工具' },
  { plugin: uiAssetUploadPlugin, kind: 'app', reason: '资产入库入口' },
  { plugin: styleLibraryPlugin, kind: 'app', reason: '素材库（项目页可浏览）' },
  { plugin: projectsApiPlugin, kind: 'app', reason: '项目数据服务（项目页面板可用）' },
  { plugin: shortcutSettingsPlugin, kind: 'app', reason: '设置页快捷键配置' },

  { plugin: themeCanvasPlugin, kind: 'canvas', reason: '节点壳 / 连线 / 背景' },
  { plugin: nodeTextPlugin, kind: 'canvas', reason: '文本节点' },
  { plugin: nodeUiPlugin, kind: 'canvas', reason: 'AI 可视化节点' },
  { plugin: pluginBottomBar, kind: 'canvas', reason: '节点底栏' },
  { plugin: node3dPreviewPlugin, kind: 'canvas', reason: '3D 预览节点' },
  { plugin: contextMenuPlugin, kind: 'canvas', reason: '右键菜单' },
  { plugin: clipboardPlugin, kind: 'canvas', reason: '复制粘贴' },
  { plugin: multiSelectPlugin, kind: 'canvas', reason: '多选' },
  { plugin: groupPlugin, kind: 'canvas', reason: '分组' },
  { plugin: edgeCuttingPlugin, kind: 'canvas', reason: '连线切割' },
  { plugin: fileDropPlugin, kind: 'canvas', reason: '文件拖入' },
  { plugin: nodeImagePlugin, kind: 'canvas', reason: '图片节点' },
  { plugin: gridSplitPlugin, kind: 'canvas', reason: '宫格切分' },
  { plugin: nodeRotatePlugin, kind: 'canvas', reason: '旋转与镜像' },
  { plugin: nodeVideoPlugin, kind: 'canvas', reason: '视频节点' },
  { plugin: nodeAudioPlugin, kind: 'canvas', reason: '音频节点' },
] as const

/** 应用级插件（dev） */
export const DEV_APP_PLUGINS: PluginModule[] = DEV_PLUGIN_REGISTRY.filter((e) => e.kind === 'app').map((e) => e.plugin)
/** 画布级插件（dev） */
export const DEV_CANVAS_PLUGINS: PluginModule[] = DEV_PLUGIN_REGISTRY.filter((e) => e.kind === 'canvas').map((e) => e.plugin)

/** cloud-server 托管时，云端连接算自带件，开机直接启动 */
export function devHostedExtras(): PluginModule[] {
  return [cloudClientPlugin as unknown as PluginModule]
}
