# 组件拆分扫描（2026-11-03）

> 执行记录（同日）：ModalsArea 已拆为 shortcut / history / director 入口组合；LeftDrawer、
> UiContent、VideoContent 已按本文件的目录约定拆出子组件与 hooks。后续优化项集中记录在
> `docs/plan/2026-11-03-split-optimizations.md`。

扫描范围：packages/** 的 .vue / .ts / .js，排除 node_modules、dist、backup、vendor、packages/docs、根 src、测试与 e2e。

统计口径：文件总行数；Vue 另列 script / template / style 三段。行数只用来找候选，是否拆分看职责是否混在一起。

## 结论

超过 600 行的源码文件 57 个，其中 Vue 28 个、TS 29 个。真正需要优先拆的是 11 个“一个文件干了好几件事”的缝合怪；其余大多是数据表、注册清单、测试或单一算法的长文件。

### A 类：高优先级，职责明显混杂

| 文件 | 行数 | 混杂了什么 | 建议拆法 |
|---|---:|---|---|
| packages/plugins/plugin-agent/src/components/AgentConversation.vue | 6684（script 2073 / template 1083 / style 3526） | 消息流、输入框、下拉选择器、队列、目标、MCP 探测、模型/技能/MCP 三套选择面板、通知、快捷键、图片附件 | 新建 agent-conversation/ 文件夹；AgentConversation.vue 只留编排；拆 AgentMessageList.vue、AgentComposer.vue、AgentPendingQueue.vue、AgentModelMenu.vue、AgentSkillMenu.vue、AgentMcpMenu.vue、AgentReviewMenu.vue、AgentNoticeBar.vue；hooks：useAgentComposer.ts、useAgentAttachments.ts、useAgentQueue.ts、useAgentGoal.ts、useAgentMcpProbe.ts、useAgentModelMenu.ts |
| packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue | 4997（script 2664 / template 599 / style 1732） | 节点类型订阅、动作/参数、提示词编辑器、上游素材、参考格、AI 按钮、标签菜单、Ctrl 拖拽、预览浮层、全局设置展开 | 新建 node-bottom-bar/ 文件夹；NodeBottomBar.vue 只留外壳；拆 BottomBarActionPicker.vue、BottomBarPromptEditor.vue、BottomBarMaterialCards.vue、BottomBarReferenceSlots.vue、BottomBarAiActions.vue、BottomBarTagMenu.vue、BottomBarPreview.vue、BottomBarSettingsPanel.vue；hooks：useBottomBarActions.ts、useBottomBarPrompt.ts、useBottomBarMaterials.ts、useBottomBarAiActions.ts、useBottomBarTagMenu.ts、useCtrlResourceDrag.ts、useBottomBarPreview.ts |
| packages/plugins/plugin-agent/src/agentService.ts | 2067 | 会话、流、队列、目标、模型、提示词、技能、MCP、审批策略全在一个 service 对象 | 按域拆成 sessions.ts / queue.ts / goals.ts / models.ts / prompts.ts / skills.ts / mcp.ts / policy.ts，agentService.ts 只做组合与共享状态 |
| packages/ui/src/composables/ui.ts | 2996 | 左侧树、画布列表、项目、历史、资产/文件夹/标签、设置绑定、Agent 外壳、视口、快捷键、主题、面板拖拽、建节点 | 新建 composables/ui/ 文件夹；按域拆 hooks：useCanvasTreeScope.ts、useCanvasList.ts、useHistoryScope.ts、useAssetScope.ts、useAgentShell.ts、useCanvasToggles.ts、useViewportControls.ts、useThemeScope.ts、usePanelResize.ts、useCreateNode.ts；ui.ts 保留组合入口 |
| packages/ui/src/components/areas/ModalsArea.vue | 2413（script 1817 / template 399 / style 195） | 快捷键面板、生成历史（含手写瀑布流引擎）、历史详情、TV Director 设置四个互不相关的弹窗 | 新建 modals-area/ 文件夹；拆 ShortcutModal.vue、HistoryModal.vue、HistoryDetailDialog.vue、DirectorSettingsDialog.vue；瀑布流拆 useHistoryMasonry.ts、HistoryMasonryWall.vue、HistoryCardHtml.ts（DOM 造卡） |
| packages/canvas-render/src/host/CanvasHost.vue | 1672 | 可见剔除、主题装配、视口持久化、拖拽/选择/连线/键盘/剪贴板/右键菜单全塞在一起 | 用 hooks 提取：useCanvasCulling.ts、useCanvasTheme.ts、useCanvasViewport.ts、useCanvasSelection.ts、useCanvasConnections.ts、useCanvasKeyboard.ts、useCanvasClipboard.ts、useCanvasContextMenu.ts；CanvasHost.vue 只接线 |
| packages/plugins/plugin-multi-select/src/SelectionFrame.vue | 1598 | 选区内框、批量连线、组拖拽、上下控制栏定位、滚轮穿透、引导线 | 拆 SelectionBox.vue、SelectionBatchHandles.vue、SelectionToolbar.vue；hooks：useSelectionFrame.ts、useBatchConnect.ts、useGroupDrag.ts、useToolbarAnchor.ts、useWheelPassthrough.ts |
| packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue | 1599 | 缩放/LOD、卡尺寸、标题编辑、区域路由、能力包、连接反馈/瞄准、调试叠加、端口显隐、多选 | 注意红线：先读核心节点契约；新建 base-node/ 文件夹；hooks：useNodeCardAppearance.ts、useNodeRegions.ts、useNodeConnectionFeedback.ts、useNodeTitleEdit.ts、useNodeMultiSelectState.ts、useNodeDebugOverlay.ts；子组件 NodeTitleBar.vue、NodeDebugOverlay.vue、NodeSnapZones.vue |
| packages/plugins/plugin-node-ui/src/UiContent.vue | 1510 | iframe 沙箱、桥接协议、代理请求、调试窗口、输出落盘、主题/档位、交互态 | 新建 ui-content/ 文件夹；hooks：useUiFrame.ts、useUiBridge.ts、useUiProxy.ts、useUiDebugWindow.ts、useUiOutput.ts、useUiRaster.ts；组件 UiDebugPrompt.vue、UiEmptyState.vue |
| packages/plugins/plugin-node-video/src/VideoContent.vue | 1374 | 视频源/帧图、播放、音量/倍速、裁剪、剪辑、截图、卡片尺寸 | 新建 video-content/ 文件夹；hooks：useVideoSource.ts、useVideoPlayback.ts、useVideoFrameThumb.ts、useVideoAudioMenu.ts、useVideoCapture.ts、useVideoCardSize.ts；组件 VideoStage.vue、VideoCaptureMenu.vue、VideoVolumeMenu.vue |
| packages/ui/src/components/areas/LeftDrawer.vue | 1145 | 插件页签、画布树、资产树交互、拖到画布、上传、批量、文件夹菜单、画布行菜单 | 新建 left-drawer/ 文件夹；拆 DrawerTabs.vue、CanvasTreePanel.vue、AssetTreePanel.vue、AssetUploadDialogHost.vue；hooks：useDrawerTabs.ts、useCanvasTreeActions.ts、useAssetTreeActions.ts、useAssetCanvasDrop.ts |

### B 类：需要拆，但先把同类抽出来

| 文件 | 行数 | 问题 |
|---|---:|---|
| packages/plugins/plugin-demo-kit/src/theme-lab/ThemeLab.vue | 2457 | 主题库、设置读写、插件开关、场景、指示线、画布启动、展示辅助、嵌入页 |
| packages/plugins/plugin-demo-kit/src/theme-lab/ThemeStudio.vue | 1525 | 主题 CRUD、颜色求值、预览画板、导出 CSS |
| packages/prosemirror-editor-bundle/src/useEditor.ts | 2727 | 光标修复、拖放光标、资源 chip、粘贴、标签扫描、schema、hook 本体 |
| packages/plugins/plugin-node-audio/src/AudioWavePlayer.vue | 925 | 波形窗口、峰值缓存、播放、拖动 seek、边缘滚动 |
| packages/plugins/plugin-node-video/src/VideoClipPanel.vue | 1016 | 剪辑范围、时间轴、拖拽吸附、键盘、播放预览 |
| packages/plugins/plugin-theme-default/src/components/ui/MediaViewer.vue | 690 | 打开/关闭、图片变换、多图切换、下载、键盘 |
| packages/plugins/plugin-node-3d-preview/src/PanoramaContent.vue | 674 | three 初始化、贴图来源、resize、事件、全屏搬迁 |
| packages/ui/src/components/AssetManageDialog.vue | 613 | 弹窗外壳 + 资产树动作与 LeftDrawer 大量重复 |
| packages/plugins/plugin-manager/src/components/settings/PluginManagerPage.vue | 786 | 本地插件、npm 市场、安装/更新/卸载、卡片视图 |
| packages/plugins/plugin-shortcut-manager/src/ShortcutHelpPanel.vue | 784 | 帮助列表、搜索、冲突提示、重映射入口、导入导出 |

### 跨文件重复：拆的时候一起收

| 重复实现 | 文件 | 说明 |
|---|---|---|
| 设置导航与内容聚合 | packages/ui/src/components/settings/AppSettingsPanel.vue（923）、packages/plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue（839） | 两套几乎一样的导航条目 / 菜单段 / 分组 / 图标 / 页签 / 滚动锁。应抽 settings/settingsMenuModel.ts、settings/useSettingsNavigation.ts、settings/SettingsNav.vue、settings/SettingsContent.vue |
| 资产树动作 | packages/ui/src/components/areas/LeftDrawer.vue（1145）、packages/ui/src/components/AssetManageDialog.vue（613）、packages/ui/src/components/AssetTree.vue（713） | 改名、拖放、文件夹菜单、批量选择、下载、加入画布在三个文件各有一份。应抽 assets/useAssetTreeActions.ts、assets/useAssetSelection.ts、assets/useAssetDragDrop.ts |
| 视频播放与菜单 | packages/plugins/plugin-node-video/src/VideoContent.vue（1374）、VideoClipPanel.vue（1016）、VideoPreview.vue（703）、VideoPlayerBar.vue（390） | 播放/暂停、音量、倍速、seek、截图菜单分散在四个文件。应抽 video/useVideoPlayback.ts、video/useVideoMenus.ts、video/VideoPlayerControls.vue |
| Agent 选择器 | packages/plugins/plugin-agent/src/components/AgentConversation.vue 与 settings/ModelsPage.vue、SkillsPage.vue、McpPage.vue | 模型、技能、MCP 的列表、搜索、检查状态在对话下拉和设置页各写一遍。应共享 agent/modelCatalog.ts、agent/skillCatalog.ts、agent/mcpCatalog.ts 与对应的 ItemGrid.vue |

### C 类：行数大，但职责比较单一

这些先不拆，或只做机械拆分：packages/kernel/src/Context.ts（生命周期/装载/注册/事件四个面，可拆但风险高）、packages/canvas-render/src/host/CanvasSurface.vue（只做 VueFlow 转发）、packages/plugins/plugin-theme-default/src/components/node/MovingHandle.vue（单一跟随动画）、packages/plugins/plugin-theme-default/src/components/edge/CustomEdge.vue（单一连线绘制）、packages/plugins/plugin-context-menu/src/ContextMenu.vue（菜单浮层）、packages/canvas-render/src/components/SettingsShell.vue（只做窗口拖拽/最小化）、packages/plugins/plugin-agent/src/agentApi.ts、packages/plugins/plugin-agent/src/sessionModel.ts、packages/plugins/plugin-agent/src/server/agent/config.ts（按配置域可拆，但属于服务端数据装配）、packages/plugins/plugin-node-ui/src/uiData.ts、packages/plugins/plugin-node-video/src/videoOps.ts、packages/plugins/plugin-node-image/src/imageOps.ts、packages/plugins/plugin-bottom-bar/src/panelSource.ts。

### D 类：不建议按“组件”拆

packages/plugins/plugin-web2api-tools/src/presets.ts、packages/ui-kit-shadcn/src/theme/colors.ts、packages/plugins/plugin-theme-default/src/index.ts、packages/cloud-server/src/server.ts 这类是数据表或装配清单，按业务域拆文件即可，没有 hooks。

## 当前工作区状态

扫描时工作区已有大量未提交改动（包括本次想拆的主要文件）。真正开工前要先定基线：把现有改动提交，或者新开分支/worktree，否则拆分 diff 会混在一起。

## 超过 600 行的源码清单（57 个）

| 文件 | 类型 | 行数 |
|---|---|---:|
| packages/plugins/plugin-agent/src/components/AgentConversation.vue | vue | 6684 |
| packages/plugins/plugin-bottom-bar/src/NodeBottomBar.vue | vue | 4997 |
| packages/ui/src/composables/ui.ts | ts | 2996 |
| packages/prosemirror-editor-bundle/src/useEditor.ts | ts | 2727 |
| packages/plugins/plugin-demo-kit/src/theme-lab/ThemeLab.vue | vue | 2457 |
| packages/ui/src/components/areas/ModalsArea.vue | vue | 2413 |
| packages/plugins/plugin-agent/src/agentService.ts | ts | 2067 |
| packages/plugins/plugin-node-ui/src/server.ts | ts | 1706 |
| packages/canvas-render/src/host/CanvasHost.vue | vue | 1672 |
| packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue | vue | 1599 |
| packages/plugins/plugin-multi-select/src/SelectionFrame.vue | vue | 1598 |
| packages/plugins/plugin-demo-kit/src/theme-lab/ThemeStudio.vue | vue | 1525 |
| packages/plugins/plugin-node-ui/src/UiContent.vue | vue | 1510 |
| packages/plugins/plugin-agent/src/server/agent/config.ts | ts | 1497 |
| packages/plugins/plugin-node-video/src/VideoContent.vue | vue | 1374 |
| packages/ui/src/components/areas/LeftDrawer.vue | vue | 1145 |
| packages/plugins/plugin-agent/src/server/routes/agentSessions.ts | ts | 1120 |
| packages/plugins/plugin-hot-reload/src/data/hotReload.ts | ts | 1112 |
| packages/kernel/src/Context.ts | ts | 1088 |
| packages/plugins/plugin-agent/src/server/agent/runtime.ts | ts | 1080 |
| packages/plugins/plugin-node-video/src/VideoClipPanel.vue | vue | 1016 |
| packages/cloud-server/src/server.ts | ts | 1004 |
| packages/plugins/plugin-manager/src/pluginManagerService.ts | ts | 999 |
| packages/plugins/plugin-theme-default/src/index.ts | ts | 979 |
| packages/plugins/plugin-node-audio/src/AudioWavePlayer.vue | vue | 925 |
| packages/ui/src/components/settings/AppSettingsPanel.vue | vue | 923 |
| packages/plugins/plugin-node-video/src/videoOps.ts | ts | 901 |
| packages/plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue | vue | 839 |
| packages/plugins/plugin-image-grid-split/src/storyboardDrag.ts | ts | 835 |
| packages/plugins/plugin-bottom-bar/src/panelSource.ts | ts | 832 |
| packages/canvas-render/src/components/SettingsShell.vue | vue | 827 |
| packages/plugins/plugin-node-ui/src/uiData.ts | ts | 815 |
| packages/canvas-render/src/contracts/standardCapabilities.ts | ts | 791 |
| packages/plugins/plugin-manager/src/components/settings/PluginManagerPage.vue | vue | 786 |
| packages/plugins/plugin-shortcut-manager/src/ShortcutHelpPanel.vue | vue | 784 |
| packages/plugins/plugin-web2api-tools/src/presets.ts | ts | 771 |
| packages/plugins/plugin-node-image/src/imageOps.ts | ts | 749 |
| packages/cloud-server/src/mcp/canvasDoc.ts | ts | 743 |
| packages/plugins/plugin-theme-default/src/components/node/MovingHandle.vue | vue | 718 |
| packages/ui-kit-shadcn/src/theme/colors.ts | ts | 714 |
| packages/ui/src/components/AssetTree.vue | vue | 713 |
| packages/prosemirror-editor-bundle/demo/App.vue | vue | 705 |
| packages/plugins/plugin-agent/src/agentApi.ts | ts | 703 |
| packages/plugins/plugin-node-video/src/VideoPreview.vue | vue | 703 |
| packages/plugins/plugin-node-video/src/videoThumbCanvas.ts | ts | 700 |
| packages/plugins/plugin-theme-default/src/components/edge/CustomEdge.vue | vue | 696 |
| packages/plugins/plugin-theme-default/src/components/ui/MediaViewer.vue | vue | 690 |
| packages/plugins/plugin-node-3d-preview/src/PanoramaContent.vue | vue | 674 |
| packages/cloud-server/src/mcp/server.ts | ts | 673 |
| packages/plugins/plugin-context-menu/src/ContextMenu.vue | vue | 662 |
| packages/canvas-data/src/nodeStore.ts | ts | 659 |
| packages/plugins/plugin-canvas-export/src/canvasExportPlugin.ts | ts | 659 |
| packages/canvas-render/src/host/CanvasSurface.vue | vue | 651 |
| packages/plugins/plugin-multi-select/src/multiSelectConfig.ts | ts | 646 |
| packages/ui/src/components/AssetManageDialog.vue | vue | 613 |
| packages/plugins/plugin-agent/src/server/agent/sessionStore.ts | ts | 605 |
| packages/plugins/plugin-agent/src/sessionModel.ts | ts | 601 |

## 命名约定（按 shadcn）

- 一个 UI 组件一个文件夹：components/ui/dropdown-menu/DropdownMenu.vue
- 文件夹 kebab-case，组件 PascalCase，hook 用 useXxx.ts
- 组合导出放同目录 index.ts
- 子组件贴着父组件放，例如 agent-conversation/AgentMessageList.vue
- 入口文件保留原名，旧引用路径不变：例如 AgentConversation.vue 仍在原路径，子件进 agent-conversation/

## 建议顺序

1. ModalsArea.vue：四块完全独立，收益最大、风险最低
2. LeftDrawer.vue / AssetManageDialog.vue：先把重复的资产动作收进 hook
3. NodeBottomBar.vue
4. AgentConversation.vue + agentService.ts
5. CanvasHost.vue、SelectionFrame.vue（核心交互，改完必须跑回归）
6. BaseNode.vue（红线文件，最后做，单独评审）
