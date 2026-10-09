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
// 下面三个插件改为经「插件管理」插件安装（本地中转后台发清单）—— 故意不冷启动装配。
// 想恢复成冷启动：取消注释 import 与 APP_PLUGINS 里的对应行即可（见文件尾说明）。
// import { nodeImageComparePlugin } from '@mini-canvas/plugin-node-image-compare'
import { nodeVideoPlugin } from '@mini-canvas/plugin-node-video'
import { nodeAudioPlugin } from '@mini-canvas/plugin-node-audio'
import { pluginBottomBar } from '@mini-canvas/plugin-bottom-bar'
// web2api 改由「插件管理」从云服务清单安装（默认已装）—— 它已打成 UMD（见该包 vite.config.ts）。
// import { web2apiToolsPlugin } from '@mini-canvas/plugin-web2api-tools'
// import { pluginImageGenerationTools } from '@mini-canvas/plugin-tool-image-generation'
// import { pluginTextGenerationTools } from '@mini-canvas/plugin-tool-text-generation'
// 下面这批「布局 / 画布工具」类插件改由「插件管理」从云服务清单安装（默认已装）。
// 它们各自已有 UMD 构建（见各包 vite.config.ts），故可作外部插件装卸。
// import { multiSelectPlugin } from '@mini-canvas/plugin-multi-select'
// import { edgeCuttingPlugin } from '@mini-canvas/plugin-edge-cutting'
// import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
// import { autoLayoutPlugin } from '@mini-canvas/plugin-auto-layout'
// import { alignArrangePlugin } from '@mini-canvas/plugin-align-arrange'
// import { contextMenuPlugin } from '@mini-canvas/plugin-context-menu'
// import { clipboardPlugin } from '@mini-canvas/plugin-clipboard'
// import { canvasExportPlugin } from '@mini-canvas/plugin-canvas-export'
// import { nodeFindPlugin } from '@mini-canvas/plugin-node-find'
// import { groupPlugin } from '@mini-canvas/plugin-group'
// import { miniMapPlugin } from '@mini-canvas/plugin-mini-map'
// import { fileDropPlugin } from '@mini-canvas/plugin-file-drop'
import { uiSettingsPanelPlugin } from './settingsPanelPlugin'
// 全局下拉：把成品应用那份带箭头的 AxDropdown 注册进 ui 目录（order -1 顶替主题默认件）。
// 详见该文件顶部注释：全应用只剩一份下拉实现，插件按名取到的也是它。
import { uiDropdownPlugin } from './uiDropdownPlugin'
// 热重载：设置面板「热重载」分类（开发工具：登记链接，产物变了自动重装插件）
import { uiHotReloadPlugin } from './hotReloadPlugin'
// 资产入库入口：节点右键 + 多选上控制栏的「加入资产库」（贴进上传弹窗；两个插件零改动）
import { uiAssetUploadPlugin } from './assetUploadPlugin'
import { agentPlugin } from '@mini-canvas/plugin-agent'
// 插件管理已并入 plugin-cloud-client 包（见该包 src/manager/），仍是一个可独立装卸的插件。
import { pluginManagerPlugin } from '@mini-canvas/plugin-cloud-client/manager'

/**
 * 成品应用的插件清单（顺序即装载序）。
 *
 * 注意：有 3 个插件**故意**不在这里冷启动装配 —— `plugin-node-image-compare` /
 * `plugin-tool-image-generation` / `plugin-tool-text-generation`：它们改由「插件管理」插件
 * 从云服务（cloud-server 的 /plugin-catalog.json）装进来（用户要求：默认设为已安装）。
 * 想把某个恢复成冷启动：取消它 import 与下方对应行的注释即可。
 *
 * 另有 3 个插件是**按运行环境选装**，一直不在清单里：
 * `plugin-auto-save` / `plugin-cloud-save` / `plugin-history` —— 它们是「按运行环境选装」的
 * （云端保存要有人提供后台；history 与宿主自带的撤销栈职责重叠）。
 * 云端保存那条路走的是运行期外部清单（cloud-server 的 `/plugin-manifest.json`），见 App.vue。
 */
export const APP_PLUGINS = [
  themeDefaultPlugin, // 画布默认皮：节点壳 / 边 / 背景 / 设置面板(settingsPanel 默认赢家)
  uiSettingsPanelPlugin, // 设置面板换皮：order -1 顶替默认皮，渲染本应用风格的设置界面
  uiDropdownPlugin, // 全局下拉：order -1 顶替主题默认件（全应用唯一一份 dropdown 实现）
  uiHotReloadPlugin, // 设置面板「热重载」分类：登记链接，产物变了自动重装（开发工具）
  uiAssetUploadPlugin, // 「加入资产库」：节点右键 + 多选上控制栏 → 贴进上传弹窗（注册式，不改 multi-select/context-menu）
  // 底栏插件必须在三个节点插件**之前**装载：节点插件 apply 时 nodeBar 已在，走「取得到就注册」快路径
  pluginBottomBar, // 节点底部状态栏：可替换底栏 + 注册式动作 + 任务进度覆盖层
  nodeTextPlugin, // text 节点
  nodeImagePlugin, // image 节点
  nodeVideoPlugin, // video 节点：播放 / 裁剪画面 / 剪辑时长 / 截图 / 下载 / 全屏
  nodeAudioPlugin, // audio 节点：波形当进度条（可拖拽 seek）+ 播放动画；生成动作由 web2api 提供
  // web2api（把自建 MCP 服务的能力做成底栏动作）—— 改由「插件管理」安装（默认已装）。
  node3dPreviewPlugin, // 3D 预览节点：接一张图看 360° 全景（拖拽转向 / 滚轮缩放 / 重置）
  // nodeImageComparePlugin, // 图片对比节点 —— 改由「插件管理」安装（默认已装）
  // pluginImageGenerationTools, // 图片生成工具 —— 改由「插件管理」安装（默认已装）
  // pluginTextGenerationTools, // 文本生成工具 —— 改由「插件管理」安装（默认已装）
  // —— 以下「布局 / 画布工具」类插件改由「插件管理」从云服务清单安装（默认已装）：
  //    edge-cutting / multi-select / align-guide / auto-layout / align-arrange /
  //    group / context-menu / clipboard / canvas-export / node-find / mini-map / file-drop
  // 不装 shortcut-manager：成品 UI 自带快捷键面板（DockArea「快捷键」按钮 + ModalsArea 浮层），
  // 插件版的 Ctrl+/ 帮助面板会与之重复。键盘分发由 CanvasHost 按命令 keys 统一做，不依赖该插件。
  agentPlugin, // Agent 对话助手：内容组件（消息流 + 输入区）+ agent 服务 + 设置页（外壳在 packages/ui）
  pluginManagerPlugin, // 插件管理：设置面板「插件」页，安装/卸载/重装第三方插件（清单来自本地中转后台）
]

/** 建一份成品应用默认的存储后端（本地 localStorage）。要换存储就换这里的实现。 */
export function createDefaultStorageAdapter(): StorageAdapter {
  return new LocalStorageAdapter()
}

/** 示例图片（首次打开的空画布塞一个 image 节点，让人一眼知道能干什么） */
// 下面 SVG 里的色值是**示例节点内容**（画进图片节点里当素材），不是界面配色 → 不跟随主题
export const SAMPLE_IMAGE_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">' +
      '<rect width="320" height="240" fill="#dbeafe"/>' + // 主题色白名单: 示例图的 SVG 内容色（节点素材，非界面外观）
      '<text x="160" y="118" font-family="sans-serif" font-size="20" fill="#1d4ed8" text-anchor="middle">v2 image 节点</text>' + // 主题色白名单: 同上
      '<text x="160" y="142" font-family="sans-serif" font-size="13" fill="#64748b" text-anchor="middle">data.imageUrl</text>' + // 主题色白名单: 同上
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
