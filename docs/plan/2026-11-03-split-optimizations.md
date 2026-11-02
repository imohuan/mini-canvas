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
