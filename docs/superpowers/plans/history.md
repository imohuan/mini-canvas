你这个方向是对的。你现在看到的是“插件 API 用不了”和“节点不该硬编码”，但往上看还有一批更底层的架构问题。
我用 CodeGraph 和一些结构统计看了一遍，下面这份就是我建议你“大清洗”时一起考虑的架构问题清单。
总结一句话
现在这个项目最大的问题不是某个组件写得不好，而是：
Canvas.vue 成了总控中心，PluginSystem 没有真正成为应用内核，节点类型也没有真正插件化，导致数据、事件、节点、插件 API、存储、UI 面板都混在一起。
如果要大清洗，建议目标是：
把 Canvas.vue 从“上帝组件”降级成“画布壳子”，把插件系统升级成真正的应用内核。

1. 插件 API 没有统一访问入口
问题
你说的这个是核心问题。
现在插件 API 主要在 Canvas.vue 里拿：
src/canvas/core/Canvas.vue:1174
src/canvas/core/Canvas.vue:1469
但普通组件拿不到 PluginManager。
现在只有 storage 特殊处理：
src/canvas/core/hooks/useStorage.ts:20
src/canvas/core/Canvas.vue:1472
这相当于给 storage 开了一个后门。
影响
以后任何组件想用插件方法，都会变成：
再写一个全局单例
或者层层传 props
或者偷偷 import 某个模块
或者直接绕过插件系统
这会让插件系统名存实亡。
建议
做统一入口：
usePluginManager()
usePluginApi<T>('storage')
usePluginApi<T>('theme')
usePluginApi<T>('history')
Canvas.vue 里 provide：
provide(CanvasPluginManagerKey, manager)
组件里 inject。
2. 节点类型没有插件化
问题
现在 CustomNode.vue 里硬编码 text / image / video / stage：
src/canvas/core/components/CustomNode.vue:5-8
src/canvas/core/components/CustomNode.vue:19-40
Canvas 里也硬编码菜单和默认尺寸：
src/canvas/core/Canvas.vue:169
src/canvas/core/Canvas.vue:378
src/canvas/core/Canvas.vue:385
影响
新增一个节点类型，要改好几个地方：
CustomNode.vue
Canvas.vue 菜单
默认尺寸
toolbar
存储恢复逻辑
文件拖入逻辑
这不是真插件，是“伪扩展”。
建议
引入 NodeRegistry：
registerCanvasNode({
  type: 'image',
  node: ImageNode,
  topToolbar: ImageTopToolbar,
  bottomToolbar: ImageBottomToolbar,
  defaultSize: { cardWidth: 360, cardHeight: 270 },
  menuItem: { id: 'image', label: '图片', icon: 'image' },
})
然后把：
Text
Image
Video
Stage
迁移成 NodePlugin。
3. Canvas.vue 是上帝组件
证据
src/canvas/core/Canvas.vue 有 1641 行。
里面同时做了：
VueFlow 初始化
默认节点
localStorage 保存
节点创建菜单
连线逻辑
批量连线
插件安装
插件事件监听
storage 状态同步
theme 状态同步
layout 状态同步
快捷键同步
Pannel 参数拼装
SelectionFrame 挂载
典型位置：
持久化：Canvas.vue:56-124
节点创建：Canvas.vue:169, :378, :385
连线吸附：Canvas.vue:525, :629, :843
插件生命周期：Canvas.vue:1174, :1389
面板状态：Canvas.vue:1195, :1208, :1269, :1291
模板：Canvas.vue:1547
影响
任何功能都要改 Canvas.vue。
这会让：
bug 难定位
重构风险高
新插件接入困难
业务逻辑和 UI 绑定太死
建议拆分
至少拆成：
Canvas.vue                       只保留 VueFlow 壳子
useCanvasPluginRuntime.ts         插件安装/卸载/provide
useCanvasConnection.ts            连线、吸附、临时边
useCanvasPersistence.ts           保存/恢复
useCanvasMenu.ts                  右键菜单、节点创建菜单
useCanvasPanelState.ts            面板状态聚合
useCanvasShortcuts.ts             VueFlow 快捷键同步
4. 状态所有权混乱
问题
现在状态分散在很多地方：
Pinia store
src/canvas/core/useCanvasStore.ts:79
放了：
UI 配置
插件状态
快捷键
连接状态
选中状态
节点/边类型注册
VueFlow 内部状态
nodes
edges
selected
viewport
Plugin 内部闭包状态
比如 StoragePlugin：
src/canvas/core/plugins/storage/StoragePlugin.ts:119-125
Canvas.vue 局部状态
比如：
batchConnectState
menuState
installedPluginNames
storageState
影响
同一个概念可能有多个来源。
比如选中状态：
VueFlow 有 selected
Pinia 有 selectionState
SelectionFrame 还自己读 nodes
MultiSelectPlugin 也维护逻辑
一旦同步时机错，就会出现“节点蓝了但框没显示”这种问题。
建议
明确状态分层：
VueFlowRuntimeState     节点、边、viewport、运行时 selected
CanvasUIState           面板配置、主题、工具栏偏移
PluginState             每个插件自己的状态
DerivedState            selectedNodes、activeNode、menuItems
不要什么都塞进 useCanvasStore。
5. 事件系统是字符串散落，不可控
问题
事件名到处写字符串：
nodesChange
edgesChange
storage:connected
history:record
theme:changed
selection:change
canvas:setFlag
比如：
src/canvas/core/Canvas.vue:1391-1394
src/canvas/core/Canvas.vue:1459-1464
src/canvas/core/Canvas.vue:1560-1572
影响
没有类型保护。
事件名写错不会报错。
payload 改了也不会提醒。
插件之间越来越像“暗号通信”。
建议
建一个统一事件类型：
interface CanvasEvents {
  nodesChange: NodeChange[]
  edgesChange: EdgeChange[]
  'storage:status': StorageStatus
  'history:record': HistoryRecord
  'theme:changed': ThemeState
}
然后 EventBus 改成：
emit<K extends keyof CanvasEvents>(event: K, payload: CanvasEvents[K])
on<K extends keyof CanvasEvents>(event: K, handler: (payload: CanvasEvents[K]) => void)
6. PluginContext 太胖，而且有些能力没有闭环
问题
PluginContext.ts 有 683 行。
它现在包含：
logger
store
actions
selection
viewport
node type 注册
edge type 注册
component 注册
overlay mount
shortcut 注册
getPlugin
位置：
src/canvas/core/plugins/PluginContext.ts:172
src/canvas/core/plugins/PluginContext.ts:336
src/canvas/core/plugins/PluginContext.ts:354
src/canvas/core/plugins/PluginContext.ts:367
src/canvas/core/plugins/PluginContext.ts:410
但问题是：
registerComponent() 只是存进局部 Map
src/canvas/core/plugins/PluginContext.ts:305
src/canvas/core/plugins/PluginContext.ts:354
这个 Map 没有被全局 registry 消费。
所以这个能力看起来存在，实际没闭环。
mountOverlay() 对组件还没实现
src/canvas/core/plugins/PluginContext.ts:379-380
建议
把 PluginContext 拆成明确能力：
CanvasActions
CanvasSelection
CanvasViewport
CanvasRegistry
CanvasOverlay
CanvasEvents
CanvasPluginAccess
插件需要什么给什么，不要一个巨型 context 全塞进去。
7. PluginManager 也偏重，职责过多
问题
PluginManager.ts 有 714 行。
它负责：
插件安装
依赖排序
生命周期
回滚
eventBus
getPluginAPI
内部事件处理
context 创建
位置：
src/canvas/core/plugins/PluginManager.ts:17
src/canvas/core/plugins/PluginManager.ts:81
src/canvas/core/plugins/PluginManager.ts:285
src/canvas/core/plugins/PluginManager.ts:309
src/canvas/core/plugins/PluginManager.ts:633
建议
可以拆：
PluginManager.ts          对外门面
PluginInstaller.ts        install / uninstall / rollback
PluginDependencyGraph.ts  依赖排序、循环检测
PluginRegistry.ts         插件实例/API/context 存储
PluginLifecycle.ts        生命周期状态
短期不一定马上拆，但大清洗时值得做。
8. hooks 层有旧架构残留
问题
这些 hook 看起来像之前抽过一版，但现在没真正接入：
src/canvas/core/hooks/useCanvasFlow.ts
src/canvas/core/hooks/usePluginSystem.ts
src/canvas/core/hooks/useTheme.ts
src/canvas/core/hooks/useStorage.ts
CodeGraph 没找到 useCanvasFlow / usePluginSystem 的实际调用方。
影响
新人会误以为这些是主流程。
实际主流程还在 Canvas.vue。
这会增加理解成本。
建议
二选一：
方案 A：真的启用这些 hooks
把 Canvas.vue 逻辑迁进去。
方案 B：删掉旧 hook
只保留真正使用的：
usePluginApi()
usePluginManager()
useCanvasRegistry()
我更建议 A + 重命名，不要继续留半成品。
9. 存储系统职责太混
问题
StoragePlugin.ts 有 566 行，它同时管：
localStorage 项目索引
File System Access
IndexedDB handle
AssetManager
资源 URL 恢复
项目 CRUD
画布保存/加载
连接状态
默认项目
位置：
src/canvas/core/plugins/storage/StoragePlugin.ts:110
src/canvas/core/plugins/storage/StoragePlugin.ts:171
src/canvas/core/plugins/storage/StoragePlugin.ts:260
src/canvas/core/plugins/storage/StoragePlugin.ts:423
src/canvas/core/plugins/storage/StoragePlugin.ts:500
影响
任何存储问题都会改一个大文件。
资产和项目耦合太强。
以后如果加云端存储，会更难。
建议拆成：
StoragePlugin.ts             只组装 API
ProjectRepository.ts         项目列表/创建/删除/切换
CanvasRepository.ts          保存/加载 nodes/edges
AssetRuntimeService.ts       objectURL 创建/恢复/释放
LocalStorageProjectStore.ts
FileSystemProjectStore.ts
10. 保存链路有多套
问题
目前至少两套保存：
Canvas.vue 自己保存
src/canvas/core/Canvas.vue:56-124
写 canvas-data
AutoSavePlugin + StoragePlugin 保存
src/canvas/core/plugins/auto-save/AutoSavePlugin.ts:50
src/canvas/core/plugins/storage/StoragePlugin.ts:500
写 canvas-ai:project:*
影响
数据来源不统一。
刷新恢复时到底用哪份？容易混乱。
以后项目切换、撤销重做、自动保存会互相踩。
建议
只保留一条主链路：
VueFlow state
  -> AutoSavePlugin
  -> StoragePlugin.saveCanvas()
  -> ProjectStore
Canvas.vue 不直接碰 localStorage。
11. 组件直接依赖底层存储 hook
问题
图片组件直接拿 storage：
src/canvas/core/components/nodes/image/ImageTopToolbar.vue:11
src/canvas/core/components/nodes/image/ImageTopToolbar.vue:63
FileDropPlugin 也直接 import hook：
src/canvas/core/plugins/file-drop/FileDropPlugin.ts
影响
组件绕过插件 API。
storage 变成全局服务，而不是插件。
将来换存储实现困难。
建议
都改成：
const storage = usePluginApi<StorageAPI>('storage')
插件内则用：
context.getPluginApi<StorageAPI>('storage')
或者扩展现有 context.getPlugin()，明确拿 API，不要拿插件定义对象。
12. UI 面板 Pannel 和业务绑定太死
问题
Pannel.vue 有 780 行，而且 props/emit 非常多。
位置：
src/canvas/core/Pannel.vue:26
src/canvas/core/Pannel.vue:67
src/canvas/core/Canvas.vue:1579
它直接知道：
edge 配置
handle 配置
selection 配置
plugin 列表
theme
storage
layout
影响
新增插件配置，需要改 Pannel 和 Canvas.vue。
插件不能自己贡献设置面板。
建议
让插件能注册面板 section：
context.registerPanelSection({
  id: 'storage',
  title: '存储',
  component: StoragePanel,
})
短期可以先拆 Pannel：
Pannel.vue
PanelGeneralTab.vue
PanelThemeTab.vue
PanelStorageTab.vue
PanelLayoutTab.vue
PanelPluginTab.vue
长期让插件自己贡献 UI。
13. DOM 直查太多，说明边界不干净
问题
多处使用：
document.querySelector
document.addEventListener
window.addEventListener
比如：
Canvas.vue
AlignGuidePlugin.ts
FileDropPlugin.ts
MultiSelectPlugin.ts
GroupPlugin.ts
SelectionFrame.vue
这不是绝对错误，但说明很多插件在自己摸 DOM。
影响
插件很依赖页面结构类名。
DOM 结构一变，插件就坏。
卸载清理容易漏。
建议
抽统一 DOM/interaction 服务：
context.dom.getPane()
context.dom.getViewport()
context.events.onDocument()
context.events.onWindow()
所有监听都返回 cleanup，并由插件卸载统一清理。
14. 快捷键系统是全局单例
问题
ShortcutManager 通过：
ShortcutManager.getInstance()
到处直接拿：
src/canvas/core/plugins/shortcut-manager/RemapDialog.vue
src/canvas/core/plugins/shortcut-manager/ShortcutHelpPanel.vue
src/canvas/core/plugins/PluginContext.ts:411
src/canvas/core/Canvas.vue:1476
影响
多个画布实例会互相影响。
测试困难。
生命周期不跟 Canvas 走。
建议
ShortcutManager 应该属于当前 Canvas Runtime：
canvasRuntime.shortcutManager
通过 PluginContext 或 provide 注入，而不是全局单例。
15. 数据模型缺少统一类型
问题
大量 any：
StoragePlugin.ts
Canvas.vue
ClipboardPlugin.ts
AutoLayoutPlugin.ts
ImageTopToolbar.vue
核心节点数据没有统一类型：
ImageNodeData
VideoNodeData
TextNodeData
StageNodeData
CanvasNodeData
影响
保存、裁剪、恢复、拖入、复制粘贴都在猜字段名。
比如 imageUrl / assetId / _cropMode / videoUrl 到处散落。
建议
定义统一模型：
type CanvasNodeKind = 'text' | 'image' | 'video' | 'stage'

interface BaseCanvasNodeData {
  nodeType: CanvasNodeKind
  label?: string
  cardWidth?: number
  cardHeight?: number
  resizable?: boolean
}

interface ImageNodeData extends BaseCanvasNodeData {
  nodeType: 'image'
  assetId?: string
  imageWidth?: number
  imageHeight?: number
}
运行时字段单独放：
runtime: {
  objectUrl?: string
  cropMode?: boolean
}
不要混在持久化 data 里。
16. 资产 URL 生命周期不属于节点组件
问题
现在 blob URL 在多个地方创建：
ImageTopToolbar.vue
FileDropPlugin.ts
AssetManager.ts
但节点删除、项目切换、插件卸载时未形成统一释放策略。
建议
资产 URL 应该只由 AssetRuntimeService 管：
getObjectUrl(assetId)
releaseObjectUrl(assetId)
releaseProjectUrls(projectId)
releaseAll()
节点组件只拿 URL，不负责创建和释放。
17. App.vue 负责插件装配，但插件配置不可扩展
问题
src/App.vue:25-103 硬编码 pluginSlots。
它知道所有插件：
AlignGuide
AutoSave
Clipboard
History
MultiSelect
Storage
ShortcutManager
Group
FileDrop
Theme
AutoLayout
影响
新增插件要改 App.vue。
插件元信息散在外部，不在插件自己那里。
建议
插件自己带 meta：
const StoragePlugin = {
  name: 'storage',
  meta: {
    label: '存储底座',
    description: '...',
    defaultEnabled: true,
  }
}
App.vue 只 import plugin preset：
const plugins = createDefaultCanvasPlugins()
18. 插件之间依赖 API 不清晰
问题
例如 AutoSavePlugin 依赖 storage：
src/canvas/core/plugins/auto-save/AutoSavePlugin.ts:27
src/canvas/core/plugins/auto-save/AutoSavePlugin.ts:37
但它通过 context.getPlugin('storage') as any 拿。
这不够清楚：
拿的是 plugin 定义？
还是 install result？
还是 api？
建议
明确 API：
context.getPluginApi<StorageAPI>('storage')
不要让业务插件知道 PluginManager 内部结构。
19. 插件 UI 和普通组件边界混乱
问题
一些插件有 Vue 组件：
SelectionFrame.vue
TopToolbar.vue
GroupNode.vue
ShortcutHelpPanel.vue
RemapDialog.vue
但它们的挂载方式不统一：
有些在 Canvas.vue 直接渲染
有些是节点组件
有些可能靠插件事件
有些直接用全局单例
建议
统一插件 UI 类型：
registerOverlay()
registerNodeType()
registerPanelSection()
registerToolbar()
registerDialog()
不要每个插件自己想办法挂。
20. 现在的重构计划需要升级
之前那份计划主要修：
保存 bug
资源清理
video 目录大小写
小性能问题
日志
但你现在要“大清洗”，建议换成三阶段架构重构。
我建议的大清洗路线
第一阶段：打地基
目标：解决插件 API 访问、类型、事件这些基础问题。
新增 CanvasRuntime
新增 PluginProvider
新增 usePluginManager
新增 usePluginApi
typed EventBus
删除 storage 单例后门
明确 getPluginApi
这一阶段完成后，组件就能正常用插件能力。
第二阶段：节点插件化
目标：Text/Image/Video/Stage 全部从硬编码变注册。
新增 NodeRegistry
CustomNode.vue 从 registry 取组件
Canvas 菜单从 registry 生成
默认尺寸从 registry 来
建 TextNodePlugin
建 ImageNodePlugin
建 VideoNodePlugin
建 StageNodePlugin
这一阶段完成后，节点就是插件了。
第三阶段：拆 Canvas.vue 和 StoragePlugin
目标：把上帝文件拆掉。
拆 Canvas.vue：
useCanvasConnection.ts
useCanvasMenu.ts
useCanvasPersistence.ts
useCanvasPanelState.ts
useCanvasShortcuts.ts
useCanvasPluginRuntime.ts
拆 StoragePlugin：
ProjectRepository
CanvasRepository
AssetRuntimeService
LocalStorageProjectStore
FileSystemProjectStore
拆 Pannel：
PanelGeneralTab
PanelThemeTab
PanelStorageTab
PanelLayoutTab
我建议你大清洗的最终目标结构
src/canvas/core/
  runtime/
    CanvasRuntime.ts
    CanvasRuntimeProvider.ts
    useCanvasRuntime.ts
    usePluginApi.ts
    CanvasEventBus.ts
    CanvasEvents.ts

  registry/
    NodeRegistry.ts
    PanelRegistry.ts
    ToolbarRegistry.ts

  plugins/
    PluginManager.ts
    PluginInstaller.ts
    PluginDependencyGraph.ts
    PluginContext.ts
    types.ts

  nodes/
    text/TextNodePlugin.ts
    image/ImageNodePlugin.ts
    video/VideoNodePlugin.ts
    stage/StageNodePlugin.ts

  storage/
    ProjectRepository.ts
    CanvasRepository.ts
    AssetRuntimeService.ts

  components/
    Canvas.vue
    CustomNode.vue
    Panel/
优先级建议
如果你要一次大清洗，我建议先修这些：
Plugin API 访问机制
NodeRegistry
节点插件化
事件类型化
统一数据模型
统一保存链路
拆 Canvas.vue
拆 StoragePlugin
插件 UI 注册机制
清理旧 hooks / 全局单例
最重要的判断
你现在这个项目已经到了一个分界点：
如果继续小修小补，后面每加一个功能都会越来越难。
如果你准备“大清洗”，那就不要只修 bug，应该先定一个新的内核设计：
CanvasRuntime + PluginManager + Registry + Typed EventBus + NodePlugin

这套定下来后，后面的图片、视频、文本、存储、主题、布局都会自然很多。



1. 性能
严重度	问题	位置	建议	改造量
P1	连线吸附时会反复扫 DOM，并调用 getBoundingClientRect()，节点多时容易卡。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:525, :536, :629, :635, :713	拖拽开始时缓存节点矩形；鼠标移动时只读缓存。再加“按动画帧处理一次”。	中
P1	图片/视频 blob URL 有泄漏风险。拖入、粘贴、上传都会创建 URL，但很多地方没有统一释放。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\file-drop\FileDropPlugin.ts:200, :238, :346, :386; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\image\ImageTopToolbar.vue:57, :148	统一交给 AssetManager 管 URL；节点删除、项目切换、插件卸载时释放。	中
P1	同一份画布数据有两套保存逻辑：Canvas.vue 写 canvas-data，AutoSavePlugin + StoragePlugin 又写项目数据。会重复序列化、重复写本地存储。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:56, :106, :120; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\auto-save\AutoSavePlugin.ts:50; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts:500	保留一个主保存入口。建议让 StoragePlugin 做唯一保存入口，Canvas.vue 只负责初始化兜底。	中
P2	BaseNode 鼠标移动时持续更新响应式状态，节点多时会触发较多重算。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\Decoration\BaseNode.vue:180, :182, :249, :254	只有连线反馈需要时才更新；普通 hover 不要每次鼠标移动都写状态。	小
P2	SelectionFrame 拖拽时每次 mousemove 都逐个 updateNode，还直接改 node.position。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\multi-select\SelectionFrame.vue:180, :187, :195, :197	批量更新，按动画帧合并；避免直接改 props 里的 node。	中
P2	首屏没有拆包，所有插件和节点组件一次性进主包。	D:\Code\GitTest\canvas-ai\mini-canvas\src\App.vue:4-14; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\CustomNode.vue:5-8; D:\Code\GitTest\canvas-ai\mini-canvas\vite.config.ts:5	插件、图片裁剪器、快捷键面板等改成懒加载；必要时加 manualChunks。	中
P2	可见区域渲染默认关闭，大画布会多渲染。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\useCanvasStore.ts:130; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:1556	默认改成 true，除非有功能明确依赖全量渲染。	小
P3	主题切换会多次刷新 CSS 变量，还带大量 console。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\ThemePlugin.ts:120, :145, :157; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\colorUtils.ts:248	合并刷新，去掉生产环境日志。	小

2. 代码结构
严重度	问题	位置	建议	改造量
P1	Canvas.vue 太大，职责太多：持久化、连线、菜单、插件、存储、主题、快捷键都在一个文件。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:1，文件 1641 行；典型位置 :525, :843, :1174, :1221, :1389, :1547	拆成 useCanvasPersistence、useCanvasConnection、useCanvasMenu、useCanvasPlugins、CanvasViewport.vue 等。	大
P1	StoragePlugin 同时管项目、localStorage、文件系统、资产 URL、数据清洗，后续很容易出错。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts:110, :125, :171, :500	拆成项目服务、画布保存服务、资产恢复服务。	中
P1	Pannel.vue 也是超大文件，面板 UI、表单、存储、主题、布局全混在一起。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Pannel.vue:1，文件 780 行	拆成 GeneralTab、ThemeTab、StorageTab、LayoutTab。	中
P2	已知问题：video 目录首字母应大写。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\video\index.ts:1; 引用在 D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\CustomNode.vue:7	用 git mv video Video_tmp 再 git mv Video_tmp Video，避免 Windows 大小写重命名失效；同步改 import。	小
P2	节点顶部/底部工具栏重复代码多。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\video\VideoTopToolbar.vue:4-29; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\text\TextTopToolbar.vue:4-45; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\stage\StageTopToolbar.vue:2-27	抽一个 NodeToolbarShell 和 ToolbarAction 配置数组。	中
P2	CustomNode 静态引入所有节点类型，不利于懒加载。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\CustomNode.vue:5-8, :19-40	改成节点注册表，或按类型动态 import。	中
P3	有一些看起来不用的旧 hook，容易误导。CodeGraph 没找到调用方。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\hooks\useCanvasFlow.ts:32; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\hooks\usePluginSystem.ts:13; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\hooks\useStorage.ts:37	没用就删；如果只保留 setStorageApi/getAssetManager，文件名别叫 useStorage。	小
P3	没发现循环依赖。	全项目 import 图	这个是好事，暂时不用动。	无

3. 可维护性
严重度	问题	位置	建议	改造量
P0	保存数据时会把当前节点类型改坏。现在节点实际是 type: 'custom'，但 sanitizeForSave 会强行改成不存在的 image-input。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts:70-95	删除这段旧类型过滤，保留 type: 'custom' 和 data.nodeType。这是最先要修的。	小
P1	StoragePlugin 没有 uninstall 清理，里面的 URL、timer、cache 可能残留。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts:124, :125, :175, :564; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:1471-1472	返回 uninstall()：清 timer、assetManager.revokeAllURLs()、清 cache，并在 Canvas 卸载时 setStorageApi(null)。	小
P1	beforeunload 里调用异步保存，不可靠，页面关闭时可能没保存完。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\auto-save\AutoSavePlugin.ts:69-75	页面关闭前只做同步兜底；文件系统保存不要依赖 beforeunload 完成。	中
P1	大量 any，后续改字段很容易踩坑。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts:23-25; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\useCanvasStore.ts:146-148; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:112, :200	定义 CanvasNodeData、ImageNodeData、VideoNodeData、TextNodeData。	中
P2	ImageCropper 在 computed 里改 ref，这是比较绕的写法，也容易引起重复更新。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\image\ImageCropper.vue:37-50	computed 只算值；containerW/H 用 watch 或直接从 computed 返回值里读。	小
P2	ImageCropper 的定时器没在卸载时清掉。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\image\ImageCropper.vue:210-214	加 onUnmounted 清 emitTimer。	小
P2	VideoNode 缺少视频加载失败兜底。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\components\nodes\video\VideoNode.vue:19	加 @error、空地址提示、加载中状态。	小
P2	文件名 Pannel.vue 拼写像是错的。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Pannel.vue:1; 引用 D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:11	建议改成 Panel.vue。	小
P2	部分错误被直接吞掉，排查问题会很难。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\adapters\FileSystemAdapter.ts:13-20; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\storage\StoragePlugin.ts:131-137	至少区分“文件不存在”和“JSON 坏了”，坏数据要打 warning。	小
P3	日志很多，部分在高频路径里。	D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\Canvas.vue:210, :220, :339, :911; D:\Code\GitTest\canvas-ai\mini-canvas\src\canvas\core\plugins\theme\ThemePlugin.ts:75, :134	生产环境关掉，开发环境走统一 logger。	小