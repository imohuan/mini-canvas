/**
 * @mini-canvas/ui 的**装配清单** —— 「这一版成品应用装了哪些插件」的唯一住址。
 *
 * 为什么独立成文件：`App.vue` 只该关心「页面长什么样」。换一套插件组合（加减插件、换主题皮）
 * 是**装配决定**，不该去改 UI 组件 —— 宿主组件一行不动，改这里的数组就够了。
 *
 * 数组顺序即装载顺序（`CanvasHost` 按数组顺序冷启动）。
 */
import type { CanvasNode, StorageAdapter } from '@mini-canvas/canvas-data'
import type { PluginModule } from '@mini-canvas/kernel'
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
// —— 以下 6 个「基础交互」插件是**自带件**（2026-10-12 用户要求：作为默认插件安装）——
// 它们冷启动直接装配，不再经「插件管理」装卸；package.json 相应从 installable 改成 builtin。
import { clipboardPlugin } from '@mini-canvas/plugin-clipboard'
import { contextMenuPlugin } from '@mini-canvas/plugin-context-menu'
import { fileDropPlugin } from '@mini-canvas/plugin-file-drop'
import { groupPlugin } from '@mini-canvas/plugin-group'
import { multiSelectPlugin } from '@mini-canvas/plugin-multi-select'
import { edgeCuttingPlugin } from '@mini-canvas/plugin-edge-cutting'
// web2api 改由「插件管理」从云服务清单安装（默认已装）—— 它已打成 UMD（见该包 vite.config.ts）。
// import { web2apiToolsPlugin } from '@mini-canvas/plugin-web2api-tools'
// import { pluginImageGenerationTools } from '@mini-canvas/plugin-tool-image-generation'
// import { pluginTextGenerationTools } from '@mini-canvas/plugin-tool-text-generation'
// 下面这批「布局 / 画布工具」类插件改由「插件管理」从云服务清单安装（默认已装）。
// 它们各自已有 UMD 构建（见各包 vite.config.ts），故可作外部插件装卸。
// import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'
// import { autoLayoutPlugin } from '@mini-canvas/plugin-auto-layout'
// import { alignArrangePlugin } from '@mini-canvas/plugin-align-arrange'
// import { canvasExportPlugin } from '@mini-canvas/plugin-canvas-export'
// import { nodeFindPlugin } from '@mini-canvas/plugin-node-find'
// import { miniMapPlugin } from '@mini-canvas/plugin-mini-map'
import { uiSettingsPanelPlugin } from './settingsPanelPlugin'
// 全局下拉：把成品应用那份带箭头的 AxDropdown 注册进 ui 目录（order -1 顶替主题默认件）。
// 详见该文件顶部注释：全应用只剩一份下拉实现，插件按名取到的也是它。
import { uiDropdownPlugin } from './uiDropdownPlugin'
// 热重载：设置面板「热重载」分类（开发工具：登记链接，产物变了自动重装插件）
import { uiHotReloadPlugin } from './hotReloadPlugin'
// 资产入库入口：节点右键 + 多选上控制栏的「加入资产库」（贴进上传弹窗；两个插件零改动）
import { uiAssetUploadPlugin } from './assetUploadPlugin'
import { agentPlugin } from '@mini-canvas/plugin-agent'
// 插件管理是**独立包**（曾住在 plugin-cloud-client 包内部，2026-10-11 拆出来）：
// 独立成包后它才是插件目录里的一个正经插件，能在「设置 → 插件 → 自带」里显示出来。
import { pluginManagerPlugin } from '@mini-canvas/plugin-manager'
// AI 可视化节点：声明「我有哪些数据」→ AI 生成 HTML 在节点里画出来。
// 生成那一步要后台（cloud-server 提供模型），纯前端模式下节点照常显示、只是生成会失败。
import { nodeUiPlugin } from '@mini-canvas/plugin-node-ui'
// 云端连接（cloud-client）：**按运行环境**决定是否随开机自动装配（见 builtinPluginsForUiHost）。
// 它默认是"可装卸"插件（面板里可选装），但**由 cloud-server 托管界面时**（也就是后台自己发
// 这一版应用）要直接启动 —— 用户口径：「如果是 cloud-server 启动的服务，cloud-client 应该放在
// 自带中直接启动」。判据见 CLOUD_HOST_FLAG。
import { cloudClientPlugin } from '@mini-canvas/plugin-cloud-client'

/**
 * 成品应用的插件清单（顺序即装载序）。
 *
 * **自带件（builtin）与可装卸件的区别**（用户在「设置 → 插件」里看到的分类）：
 * - 自带件：写在这个数组里冷启动装配，面板「自带」页只读展示、没有安装/卸载按钮；
 * - 可装卸件：不在这里，改由「插件管理」从云端清单（cloud-server 的 /plugin-catalog.json）装进来。
 *
 * 2026-10-12 用户要求：把 6 个「基础交互」插件（复制粘贴 / 右键菜单 / 文件拖入 / 分组 /
 * 多选 / 连线切割）作为**自带插件**。它们已从下面那批"改由插件管理安装"里移出，
 * 对应 package.json 也从 installable 改成 builtin（否则会同时出现在两个分类里）。
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
  // —— 6 个自带「基础交互」插件（2026-10-12 用户要求：作为默认插件安装）——
  // 顺序说明：context-menu 借「右键按 areas 收命令」接缝，uiAssetUploadPlugin 注册的命令要在它
  // **之前**就在命令表里（故 ui-asset-upload 排在更前）；multi-select 的 out:top 控制栏由
  // uiAssetUploadPlugin 经 selectionRegion.attach 挂上（它排在前，multi-select 后到即接手）。
  contextMenuPlugin, // 右键菜单：空白新建节点 / 节点删除 / 边删除
  clipboardPlugin, // 复制粘贴：Ctrl/Cmd+C/V/X/D
  multiSelectPlugin, // 多选：Shift+拖框选 / Ctrl+A 全选 / Escape 清除
  groupPlugin, // 分组：选中多个 Ctrl+G 打组 / Ctrl+Shift+G 解组
  edgeCuttingPlugin, // 连线切割：按住 Alt 拖拽划过连线即可删除
  fileDropPlugin, // 文件拖入：把图片/视频/文本拖到画布或粘贴进来即建节点
  // 底栏插件必须在三个节点插件**之前**装载：节点插件 apply 时 nodeBar 已在，走「取得到就注册」快路径
  pluginBottomBar, // 节点底部状态栏：可替换底栏 + 注册式动作 + 任务进度覆盖层
  nodeTextPlugin, // text 节点
  nodeImagePlugin, // image 节点
  nodeVideoPlugin, // video 节点：播放 / 裁剪画面 / 剪辑时长 / 截图 / 下载 / 全屏
  nodeAudioPlugin, // audio 节点：波形当进度条（可拖拽 seek）+ 播放动画；生成动作由 web2api 提供
  nodeUiPlugin, // 可视化节点：声明输入参数 → AI 生成 HTML 在节点里渲染（生成需后台）
  // web2api（把自建 MCP 服务的能力做成底栏动作）—— 改由「插件管理」安装（默认已装）。
  node3dPreviewPlugin, // 3D 预览节点：接一张图看 360° 全景（拖拽转向 / 滚轮缩放 / 重置）
  // nodeImageComparePlugin, // 图片对比节点 —— 改由「插件管理」安装（默认已装）
  // pluginImageGenerationTools, // 图片生成工具 —— 改由「插件管理」安装（默认已装）
  // pluginTextGenerationTools, // 文本生成工具 —— 改由「插件管理」安装（默认已装）
  // —— 以下「布局 / 画布工具」类插件改由「插件管理」从云服务清单安装（默认已装）：
  //    align-guide / auto-layout / align-arrange / canvas-export / node-find / mini-map
  //    （edge-cutting / multi-select / group / context-menu / clipboard / file-drop
  //      已于 2026-10-12 改为**自带件**，不在这批里，见上面那 6 行。）
  // 不装 shortcut-manager：成品 UI 自带快捷键面板（DockArea「快捷键」按钮 + ModalsArea 浮层），
  // 插件版的 Ctrl+/ 帮助面板会与之重复。键盘分发由 CanvasHost 按命令 keys 统一做，不依赖该插件。
  agentPlugin, // Agent 对话助手：内容组件（消息流 + 输入区）+ agent 服务 + 设置页（外壳在 packages/ui）
  pluginManagerPlugin, // 插件管理：设置面板「插件」页，安装/卸载/重装第三方插件（清单来自本地中转后台）
]

/**
 * 判断「这一版界面是不是被 cloud-server 托管的」。
 *
 * 为什么用 home.html 里那个标记而不是别的：
 * - 看 URL / 端口都不靠谱（dev 走 vite 代理、端口会顺延，同源看不出来是谁在托管）；
 * - 让 cloud-server 在它发出去的那份 index.html 里**插一行 <meta>** 最准 ——
 *   那是"服务端自己声明身份"，前端只读不猜（服务端在 static.ts 的 uiRoutes 里注入）。
 *
 * 注意要用 **document 现读**：单测/SSR 里没有 document，读不到就当"不是托管"（保持本地行为）。
 */
export const CLOUD_HOST_FLAG = 'mini-canvas-host'

/** 读 cloud-server 注入的宿主标记（读不到 = 不是它托管的） */
export function isCloudServerHosted(): boolean {
  if (typeof document === 'undefined') return false
  const meta = document.querySelector('meta[name="' + CLOUD_HOST_FLAG + '"]')
  return meta?.getAttribute('content') === 'cloud-server'
}

/**
 * 按**运行环境**决定还要不要追加几个自带插件 —— 目前只有云端连接（cloud-client）。
 *
 * 语义（与用户口径对齐）：
 * - **cloud-server 托管**（后台发界面）→ 云端连接算自带件，**开机直接启动**：后台就在同源、
 *   这类部署本来就是要连后台的，不该让用户先去面板里点一次。
 * - **其它**（ui 单独 dev、或别人拿这个包自己托管）→ 不自动装，仍由用户在「设置 → 插件」里装，
 *   这样本地单跑画布时不会被强行接管存档。
 *
 * 为什么不在托管时把它从"可装卸清单"里去掉：留着也无害 —— 它已经装在内核里，
 * 面板那一行会显示「已安装」，用户点卸载就能退回本地存储（这正是"自己挑"的兜底）。
 *
 * 为什么不做成"放进 APP_PLUGINS 就完事"：那份数组是**静态**的，本地 dev 也会跟着装 ——
 * 于是本地单跑时画布会去连一个不存在的后台。要"只在托管时启动"，这个判断只能放在运行期。
 */
export function builtinPluginsForUiHost(): PluginModule[] {
  // cloud-client 为了"产物自包含"用的是**自己的类型垫片**（见其 src/shims.ts），
  // Config 在那里是 unknown，与内核的 ConfigSchema 不完全同形 —— 运行时完全一致，
  // 只是类型层面要对上。这里在**边界处**收一次口（断言），好过把内核类型硬塞进插件、
  // 破坏它"零 import 自包含"的前提。宿主实际按 { name, inject, Config, apply } 使用。
  return isCloudServerHosted() ? [cloudClientPlugin as unknown as PluginModule] : []
}

/** 最终装载清单 = 静态装配 + 按环境追加的自带件（宿主按这个数组冷启动） */
export function resolveAppPlugins(): PluginModule[] {
  return [...APP_PLUGINS, ...builtinPluginsForUiHost()]
}

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
