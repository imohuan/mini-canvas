/**
 * @mini-canvas/ui 的**装配清单** —— 「这一版成品应用装了哪些插件」的唯一住址。
 *
 * 为什么独立成文件：`App.vue` 只该关心「页面长什么样」。换一套插件组合（加减插件、换主题皮）
 * 是**装配决定**，不该去改 UI 组件 —— 宿主组件一行不动，改这里的数组就够了。
 *
 * 数组顺序即装载顺序（`CanvasHost` 按数组顺序冷启动）。
 */
import type { CanvasNode, StorageAdapter } from '@mini-canvas/canvas-data'
import { LocalStorageAdapter } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { node3dPreviewPlugin } from '@mini-canvas/plugin-node-3d-preview'
import { nodeImageComparePlugin } from '@mini-canvas/plugin-node-image-compare'
import { nodeVideoPlugin } from '@mini-canvas/plugin-node-video'
import { pluginImageGenerationTools } from '@mini-canvas/plugin-tool-image-generation'
import { pluginTextGenerationTools } from '@mini-canvas/plugin-tool-text-generation'
import { multiSelectPlugin } from '@mini-canvas/plugin-multi-select'
import { edgeCuttingPlugin } from '@mini-canvas/plugin-edge-cutting'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
import { autoLayoutPlugin } from '@mini-canvas/plugin-auto-layout'
import { alignArrangePlugin } from '@mini-canvas/plugin-align-arrange'
import { contextMenuPlugin } from '@mini-canvas/plugin-context-menu'
import { clipboardPlugin } from '@mini-canvas/plugin-clipboard'
import { canvasExportPlugin } from '@mini-canvas/plugin-canvas-export'
import { nodeFindPlugin } from '@mini-canvas/plugin-node-find'
import { groupPlugin } from '@mini-canvas/plugin-group'
import { miniMapPlugin } from '@mini-canvas/plugin-mini-map'
import { fileDropPlugin } from '@mini-canvas/plugin-file-drop'
import { uiSettingsPanelPlugin } from './settingsPanelPlugin'

/**
 * 成品应用的插件清单（20 个源码插件，顺序即装载序）。
 *
 * 注意：`packages/plugins` 目录下另有 3 个**不**在清单里，是有意不装：
 * `plugin-auto-save` / `plugin-cloud-save` / `plugin-history` —— 它们是「按运行环境选装」的
 * （云端保存要有人提供后台；history 与宿主自带的撤销栈职责重叠）。
 * 云端保存那条路走的是运行期外部清单（cloud-server 的 `/plugin-manifest.json`），见 App.vue。
 */
export const APP_PLUGINS = [
  themeDefaultPlugin, // 画布默认皮：节点壳 / 边 / 背景 / 设置面板(settingsPanel 默认赢家)
  uiSettingsPanelPlugin, // 设置面板换皮：order -1 顶替默认皮，渲染本应用风格的设置界面
  nodeTextPlugin, // text 节点
  nodeImagePlugin, // image 节点
  nodeVideoPlugin, // video 节点：播放 / 裁剪画面 / 剪辑时长 / 截图 / 下载 / 全屏
  node3dPreviewPlugin, // 3D 预览节点：接一张图看 360° 全景（拖拽转向 / 滚轮缩放 / 重置）
  nodeImageComparePlugin, // 图片对比节点：连两张图用可拖拽分割线左右对照（最多 2 条，超了挤最老）
  pluginImageGenerationTools, // 图片生成工具：把第三方生成 API 注册成 ctx.tools 里的工具，供节点调用
  pluginTextGenerationTools, // 文本生成工具：同上，产出文本（工具注册独立成插件，节点零硬编码）
  edgeCuttingPlugin, // 连接线切割：按住 Alt 拖拽"刀光"划过连线即可删除
  multiSelectPlugin, // 多选：Shift+拖框选 / Ctrl+A 全选 / Escape 清除
  alignGuidePlugin, // 对齐辅助线：拖节点时吸附其它节点边缘/中心并显示蓝线
  autoLayoutPlugin, // 自动布局：Ctrl/Cmd+L 布局 / F 聚焦选中 / R 适应视图
  alignArrangePlugin, // 对齐排列：Ctrl+方向键紧凑排列 / 对齐/等距命令
  groupPlugin, // 分组：选中≥2 Ctrl+G 打组 / Ctrl+Shift+G 解组
  contextMenuPlugin, // 右键菜单：空白新建节点 / 节点删除 / 边删除
  clipboardPlugin, // 复制粘贴：Ctrl/Cmd+C/V/X/D
  canvasExportPlugin, // 导出：Ctrl/Cmd+E 整图 / Ctrl/Cmd+Shift+E 选中
  nodeFindPlugin, // 搜索：Ctrl/Cmd+F
  miniMapPlugin, // 小地图：Ctrl/Cmd+M
  // 不装 shortcut-manager：成品 UI 自带快捷键面板（DockArea「快捷键」按钮 + ModalsArea 浮层），
  // 插件版的 Ctrl+/ 帮助面板会与之重复。键盘分发由 CanvasHost 按命令 keys 统一做，不依赖该插件。
  fileDropPlugin, // 文件拖入 & 粘贴：把图片/视频/文本拖到画布或粘贴进来即建节点
]

/** 建一份成品应用默认的存储后端（本地 localStorage）。要换存储就换这里的实现。 */
export function createDefaultStorageAdapter(): StorageAdapter {
  return new LocalStorageAdapter()
}

/** 示例图片（首次打开的空画布塞一个 image 节点，让人一眼知道能干什么） */
export const SAMPLE_IMAGE_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">' +
      '<rect width="320" height="240" fill="#dbeafe"/>' +
      '<text x="160" y="118" font-family="sans-serif" font-size="20" fill="#1d4ed8" text-anchor="middle">v2 image 节点</text>' +
      '<text x="160" y="142" font-family="sans-serif" font-size="13" fill="#64748b" text-anchor="middle">data.imageUrl</text>' +
      '</svg>',
  )

/** 示例文本（首次打开的空画布塞一个 text 节点） */
export const SAMPLE_TEXT =
  '双击我输入内容\n\n· 从左右圆点可拖出连线\n· 拖动节点可移动\n· 点节点再按 Delete 删除'

/** 首次(存储为空)的默认画布 */
export function seedDefaultCanvas(): CanvasNode[] {
  return [
    { id: '1', type: 'text', position: { x: 120, y: 120 }, data: { text: SAMPLE_TEXT } },
    { id: '2', type: 'image', position: { x: 560, y: 160 }, data: { imageUrl: SAMPLE_IMAGE_URL } },
  ]
}
