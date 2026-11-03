# 组件拆分优化建议（2026-11-03）

本次只做原样拆分，下列项目**未实施**，留给后续独立改动与验证。

## 0. ModalsArea 拆分的待优化项

- `HistoryModal.vue` 的路径筛选、卡片墙缓存与批量勾选仍由入口编排；`historyCardDom.ts`
  目前已承接异常卡、信息行、详情按钮等纯 DOM 构建，后续可以把媒体卡与图片卡的
  建卡函数继续搬入，入口只保留状态接线。
- `buildAudioControls` 仍负责给每张音频卡绑定播放与进度事件；后续可考虑改用 Vue
  子组件渲染卡外控制行，但必须验证批量模式下的指针让位与波形拖动，不应只做视觉替换。
- 历史弹窗的无遮罩大面板仍用自绘缩放滑条；组件库已有 Slider，但当前交互要求整条轨道
  可拖，迁移前要在真实画布确认点击轨道、拖拽和键盘可达性一致。

## 1. 空态统一组件的外层样式钩子

`UiContent.vue` 的空态分支曾尝试抽成 `UiEmptyState.vue`，但发现外层 `.ui-empty` 的
`scoped` 数据标记留在宿主样式表里，抽走后极简宿主会丢失父级布局样式，因此已撤回。
如果后续要再抽，先在空态分支保留一层宿主自己的容器，或者把布局样式明确归属到子组件
并在真实画布验证主题空态件与兜底空态两种形态。

## 2. 空态兜底块仍留在入口

当前入口保留约 10 行空态模板和 17 行样式。它依赖宿主注入的 `nodeEmptyState`，
与主题 CSS、scoped 标记绑定较紧，暂不继续拆。后续可以考虑把主题组件和兜底 DOM
都放进子组件，同时验证是否有宿主外层选择器依赖。

## 3. `useUiDebugWindow.ts` 仍偏大

抽完后它约 400 行，仍同时处理邀请确认、SDK 文档拼接、调试窗口、消息回包与状态写入。
若要继续拆，建议单独拆出 `useUiDebugInvite.ts`（邀请/凭据/聚焦）、
`useUiDebugDocs.ts`（调试文档上报与重发）、`useUiDebugMessages.ts`（调试页与 SDK 消息）。
这一步涉及多处共享计时器和生命周期清理，应单独做回归与真机调试验证。

## 4. 入口里的上游素材计算仍偏长

`upstream` 计算包含 `NODE_KIND_FIELDS`、`TYPE_KINDS` 与从连线收集素材的逻辑，
可以抽成 `useUiUpstream.ts`。本次优先保持原顺序与依赖关系，未动这一块；
后续抽取时需保持“优先读 data 快照、否则从连线现算”的语义和空素材过滤。

## 5. 消息监听的注册与清理可以统一

入口仍分别注册 bridge、debug window、SDK 事件和 debug proxy 四个 message 监听，
卸载时分散在多个 `onBeforeUnmount`。后续可以收成一个 `useUiMessages.ts`，
返回唯一的 `dispose()`，减少“新增监听漏摘”的风险；改动前保留现有监听语义和来源校验。

## 6. 窗口消息类型可以收口

`useUiBridge.ts`、`useUiProxy.ts` 与 `useUiDebugWindow.ts` 都各自声明了一部分消息字段，
后续可以聚合成 `ui-content/protocol.ts` 的判别联合类型，让 `save / task / state / output`
等分支在编译期校验完整。本次为纯拆分，未改协议形状。

## 11. VideoContent 的视频舞台仍留在入口

`packages/plugins/plugin-node-video/src/VideoContent.vue` 已拆出视频源、播放、帧图、
音量菜单、截图、卡片尺寸与截帧菜单，入口现有 566 行，其中模板约 120 行、样式约 180 行。
画面舞台（帧图与 video 叠放、空态、取景样式）仍留在入口：它依赖 `videoRef` 与
`.video-stage.is-framed video.video-media` 选择器，抽走时要同时搬迁舞台样式并在真实画布验证
裁剪取景，不能只搬模板。

## 12. 两个播放控件宿主仍有重复的菜单逻辑

`VideoContent` 的音量/倍速菜单已抽到 `video-content/useVideoAudioMenu.ts`，
`VideoPreview` 仍保留自己的一套音量菜单和计时器。两份语义相同但宿主不同，后续可考虑
把纯状态部分合并为同一个 hook；合并前要分别验证节点内音量弹层延迟收起、全屏预览的
指针抓取与倍速菜单，避免为了去重改变交互。

## 7. LeftDrawer 的资产菜单动作与资产管理弹窗仍重复

本次把抽屉的资产树动作收进 `left-drawer/useAssetTreeActions.ts`，但
`AssetManageDialog.vue` 仍有同类的下载、批量删除、标签、移动动作。后续可以把两边
共用的动作抽到 `assets/useAssetTreeActions.ts`，让抽屉与弹窗共享同一份实现；注意弹窗
有独立的勾选状态和本地搜索，不能直接替换成抽屉的共享 state。

## 8. 抽屉的页签栏与底部状态条还可独立成组件

`LeftDrawer.vue` 仍保留 `SlotComposer` 页签栏、底部收起条和拖宽手柄。它们逻辑很薄，
但页签栏依赖 `drawerTabProps` / `slotShared` 与插件槽；后续可以拆成
`DrawerTabBar.vue` 和 `DrawerFooter.vue`，拆分时保持现有 `role="tablist"`、
`aria-selected` 和槽条目 id 不变。

## 9. 画布与资产两个工具栏的搜索态结构重复

两个工具行都包含同一套 AnimatePresence 搜索浮层，只是关键字、筛选项与右侧按钮不同。
后续可以抽一个 `DrawerSearchBar.vue`，通过插槽保留各自的筛选/关闭按钮；这属于视觉与
交互结构整理，不应混进本次纯拆分。

## 10. 资产树移动端/窄抽屉的可滚动提示可优化

本次仍沿用原有 `ScrollPane` 与固定 `bottom-[64px]` 批量条定位。窄抽屉里批量条内容
较多时只能横向滚动；后续若要改成换行布局或压缩按钮密度，需要单独做窄宽度视觉验证，
并保持现有 `role="toolbar"`、按钮 aria-label 和批量动作语义。

## 13. UI 规范审计：组件取件与通知（已核查，无需改动）

2026-11-03 全仓扫描结果：

- 业务插件与 `packages/ui` 的生产源码里**没有**直接 `import '@mini-canvas/ui-kit-shadcn'`。
  仅剩默认主题插件、`packages/ui/vite.config.ts`、`sharedGlobals.ts` 与测试文件引用，均属允许范围。
- 业务代码里**没有**直接 `import 'vue-sonner'`；唯一引用是 `ui-kit-shadcn` 自己的 `UiToaster.vue`。
- 直接 `import '@mini-canvas/plugin-theme-default'` 的只有 demo-kit 的 `ThemeLab.vue` /
  `ThemeStudio.vue`（主题实验室本身就在调主题 API），不算普通业务插件越界。

结论：`useUiComponent()` 取件与上下文 `notify` 两条硬规则当前是干净的，不需要返工。

## 14. 自绘界面清单（需要后续重构，本次不动）

按「是否自己画控件」排序，确认存在自绘 UI 的文件：

| 文件 | 自绘情况 | 建议 |
| --- | --- | --- |
| `packages/plugins/plugin-style-library/src/components/StyleGalleryView.vue` | 页签、搜索框、分类条、排序按钮全是原生 `<button>` / `<input>` + `sg-*` 自绘样式 | 页签换 `Tabs`，搜索换 `Input`，分类/排序换 `ToggleGroup` 或 `Button` 尺寸变体 |
| `packages/plugins/plugin-style-library/src/components/StyleDetailView.vue` | 关闭、上一张/下一张、缩略图页签、收藏/使用按钮均原生；整体浮层自绘 | 浮层改 `AppDialog`，按钮改 `Button`，缩略图条改 `Tabs` |
| `packages/plugins/plugin-style-library/src/components/StyleCardView.vue` | 卡片上的收藏、放大、加入画布三个悬浮按钮原生 | 改 `Button` 的 `size="icon-sm"` + `variant="ghost"`；先核对 hover 浮层定位 |
| `packages/plugins/plugin-style-library/src/components/StyleLibraryOverlay.vue` / `EffectLibraryOverlay.vue` | 标题栏按钮原生，浮层 `z-index:100000` 手写 | 与 StyleDetailView 一起迁到 `AppDialog`；注意「最小化/关闭」的窗口语义要保留 |
| `packages/plugins/plugin-shortcut-manager/src/ShortcutHelpPanel.vue`（784 行） | 4 个内联 SVG 图标按钮、原生搜索框、重映射徽标按钮；整套 `shortcut-help-*` 样式 | 图标换 lucide + `Button`，搜索换 `Input`；该文件同时偏大，建议先拆分再换件 |
| `packages/plugins/plugin-shortcut-manager/src/RemapPanel.vue` | 录制按钮、重置/重新录制/完成按钮原生，内联 SVG | 按钮换 `Button`，SVG 换 lucide；录制态的脉冲环保留 |
| `packages/plugins/plugin-cursor-effect/src/components/settings/CursorSettingsPage.vue` | 光标/跟随/点击三组 `ce-tile` 选择格子是原生 `<button>`，自绘选中态 | 换 `ToggleGroup` 或 `Button` + `aria-pressed`；缩略图布局需保留 |
| `packages/plugins/plugin-bottom-bar/src/PromptActionSettings.vue` | 图标预设、模板变量 chips 是原生按钮 | 换 `ToggleGroup` / `Button`；图标网格密度较高，迁移时保持现有间距 |
| `packages/plugins/plugin-context-menu/src/ContextMenu.vue`（662 行） | 整份右键菜单自绘（行、图标托、键帽、二级菜单），与旧版菜单母体一致 | 组件库没有等价「右键菜单」，可保留自绘，但应复用 `DropdownMenu` 的定位与键盘语义，至少统一键帽与行样式 token |
| `packages/plugins/plugin-context-menu/src/ConnectionMenuContent.vue` | 连线菜单同样是原生按钮列表 | 同上，和 ContextMenu 共用一套菜单行组件 |
| `packages/plugins/plugin-group/src/GroupTopToolbar.vue` | 分组颜色九宫格是原生 `<button>` + `group-color-swatch` | 色板本身可保留自绘（需要色块预览），外部容器已用 `DropdownMenu`，只需统一 focus 态与 token |
| `packages/plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue` | 左侧设置页签是原生 `<button class="psd-tab-item">` | 主题插件自己可以继续自绘，但建议换 `Tabs` 以获得键盘方向键导航 |
| `packages/plugins/plugin-demo-kit/src/theme-lab/ThemeLab.vue` / `ThemeStudio.vue` / `gallery/ThemeGalleryOverlay.vue` | 大量原生按钮与自绘色调/模式切换 | demo-kit 是开发演示件，优先级最低；换成组件库前先确认它不依赖宿主主题变量 |
| `packages/plugins/plugin-demo-kit/src/shell-slots/DrawerTabButton.vue` / `DockEndButton.vue` | 原生按钮演示槽位 | 演示件，保持现状即可 |

可以保留原生的地方（不算违规）：

- 隐藏的文件选择 `<input type="file">`：`VideoTopToolbar.vue`、`ImageTopToolbar.vue`、`AudioTopToolbar.vue`、
  `CursorSettingsPage.vue`、`AgentConversation.vue`、`AssetUploadDialog.vue`。这些是浏览器平台能力，
  组件库没有替代品，视觉上也是 `visually-hidden`。
- `plugin-theme-default` 的 `TitleLabel.vue` 用 `contenteditable`：注释说明换 `<input>` 会改变行高，
  属于经过实测的设计决策，不要动。
- `VideoPlayerBar.vue` 的透明 `<input type="range">` 叠在自绘轨道上：为了接管手势，
  迁移到 `Slider` 前必须验证拖动、点击跳转与键盘步进一致。
- `plugin-theme-default` 的 `ToolOptionGrid.vue`、`ToolRatioGrid.vue`、`ToolParamGroup.vue`、
  `PrecisionSlider.vue`、`ColorField.vue` 本身就是主题层 UI 原语，允许自绘，但要遵守
  `docs/design/ui-style-guide.md` 的 token 与尺寸。

## 15. `packages/ui` 外壳的换件与滚动容器

这些文件在装配层，取件入口是 `useUiComponentOutside()`：

- `ChatPanel.vue`（140 行）**已无任何引用**，只有历史文档提到它；`ui.ts` 里的 `chat*` 演示状态
  也只服务它。建议单独一次提交删除，并清理 `chatMessages / chatSuggestions / chatModes /
  sendChat / renameChat / startChatDrag / startChatResize` 等残留，删前再确认一次全仓引用。
- `AssetManageDialog.vue`（613 行）：11 处原生按钮/输入框，弹窗是手写 `fixed inset-0` + `role="dialog"`，
  正文用裸 `overflow-y-auto`。建议迁到 `AppDialog` + `ScrollPane` + `Button`/`Input`；
  它和 `LeftDrawer` 的资产动作重复，可和第 7 条一起做。
- `AssetUploadDialog.vue`：12 处原生控件，同样手写弹窗与裸滚动容器；「+」按钮依赖隐藏 file input，
  迁移时别把 `chooseFiles()` 的触发链弄断。
- `AssetTree.vue`：8 处原生按钮/输入框（展开、行点击、就地改名）。行内改名输入框可换 `Input`，
  但行本身是「整行可点 + 内部按钮」结构，换 `Button` 会产生嵌套按钮，需要改成 `div role="button"`
  或拆开命中区域——属于交互结构调整，需单独验证。
- `ProjectsPage.vue`：搜索框原生；正文 `overflow-y-auto` 应换 `ScrollPane`。
- `App.vue`：插件面板列表用 `overflow-y-auto`，应换 `ScrollPane`。
- `ShortcutModal.vue`、`DirectorSettingsDialog.vue`、`AssetManageDialog.vue`、`AssetUploadDialog.vue`：
  四处裸滚动容器，统一换 `ScrollPane` 时要保持父级 `min-h-0` / 固定高度。

上述换件都涉及真实交互与视觉，必须用 @Chrome 实测亮色/暗色、窄容器和空数据后再提交。

## 16. NodeBottomBar 拆分后的待办

- `node-bottom-bar/bottom-bar.css` 是从入口整段迁出的全局样式表（约 66KB），声明与数值未改。
  后续可按子组件拆成同目录局部 CSS，或改回 scoped；改前要确认手建 DOM（Ctrl 拖拽影子、
  starting 提示）依赖非 scoped 选择器，不能直接全改 scoped。
- 样式里有死代码：`.nb-preview*` 浮层类当前没有对应模板，可删除前先确认没有动态拼接。
- 入口顶部还留着大段历史说明注释，可精简成当前职责说明。
- `useBottomBarCards.ts` 仍约 24KB，可继续拆「上传/换绑」与「卡片点击/排序」两个 hook。
- `onRun` 仍留在入口，可并入 `useBottomBarActions`；迁移时保持提交与 `submitted` 复位的顺序。
- `BottomBarCardList.vue` 事件透传较多，可收敛成单个对象回调。

## 17. AgentConversation 拆分后的待办

- `AgentComposer.vue` 约 3100 行（含约 2700 行样式），可继续把模型 / 技能 / MCP / 审查 / 认证 /
  模式六套下拉抽成子组件；抽时要保留 `switchComposerMenu` 的互斥关闭语义。
- `useAgentConversation.ts` 约 2330 行，可按队列 / 目标 / 模型面板 / MCP 面板继续拆 composable；
  它现在通过 `provide('agentConversation')` 一份控制器下发给两个子组件，改绑定粒度需要评审。
- 拆分后的样式按选择器前缀分给了消息流与输入区，少数规则（如 `.ac-editing-badge`）留在消息流侧；
  后续若再调结构，要同步检查归属，避免 scoped 属性对不上导致样式静默失效。
- 入口只保留引导块与 `<MediaViewer>`；`.ac-onboard*` 样式因此留在入口（scoped 必须与模板同组件）。
  若以后把引导块也抽成组件，样式要一起搬。

## 18. `ui.ts` 拆分后的待办

- `ui.ts` 现在只有约 130 行的组合入口，按域拆出 18 个文件（`createUiState`、`useUiHost`、
  `useCanvasTreeScope`、`useCanvasList`、`useHistoryScope`、`useAssetScope`、`useAgentShell`、
  `useCanvasToggles`、`useThemeScope`、`useShortcutsScope`、`useShellControls`、`useViewportControls`、
  `useCanvasNodeActions`、`useCreateNode`、`usePanelResize`、`useUiLifecycle` 等）。
- 其中 `useHistoryScope.ts`（约 31KB）与 `useCreateNode.ts`（约 26KB）仍偏大，是下一轮拆分的首选。
- 组合入口目前用大对象字面量逐个转出成员（约 60 行）。后续可考虑按域返回嵌套对象再展开，
  但会改变部分调用点的可选链写法，需要整体评估，不要只为缩短行数而改。
- `createUi()` 里各域按原顺序创建，存在隐式先后依赖（history 依赖 canvasList、nodes 依赖 assets
  + viewport、lifecycle 依赖全部）。后续若调整顺序，必须先补集成测试验证初始化副作用。

## 19. CanvasHost 拆分后的待办

- 拖线全局监听（`document` 上的 `mousemove` / `mouseup`）在组件卸载且没收到 `connect-end` 时
  没有兜底解绑；下一次 `connect-start` 会再绑一遍。建议加幂等解绑，并补一条“卸载时清干净”的测试。
- `useCanvasConnections.ts` 仍有约 455 行，可拆成「候选校验」与「拖线手势」两层。
- `useCanvasCulling.ts` 的拖拽保护缓存可以和剔除计算分开。
- `useCanvasLifecycle.ts` 的插件重装订阅可独立成 `usePluginRemount.ts`。
- 这套 hook 目前没有事件配对的行为测试；建议补最小 DOM 测试，覆盖拖线监听注销、卸载清理、
  键盘/剪贴板仲裁这三条最容易回归的路径。

## 20. SelectionFrame 拆分后的待办

- 批量连线目前按抓取的源节点逐个计算反馈，目标是多件组合时会重复工作；可改成一次几何命中，
  但必须先实测多源反馈的视觉与性能。
- `useGroupDragState.ts` 单独存在只为保持原来的初始化时序，后续可并回 `useSelectionFrame`。
- 控制栏仍是自绘定位加屏幕钳制，可复用画布布局里的公共定位工具。
- 入口保留约 35 行跨子件兜底选择器（`.selection-frame-batch-slot`、`body.mc-pointer-down`）；
  继续下沉会改变 scoped 边界，动之前先确认这些类在哪些子件里落地。
- 源码文本回归测试现在跨两个文件读取，后续可改成行为测试，减少对源码形状的依赖。
