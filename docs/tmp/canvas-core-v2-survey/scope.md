# canvas-core-v2 全体重构 —— 现状侦察 + 范围待确认

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 阶段：计划（侦察完成，待定设计方向）

## 一、新项目骨架已建
- `packages/canvas-core-v2/package.json`（@mini-canvas/canvas-core-v2，workspace 自动纳入）
- `packages/canvas-core-v2/src/index.ts`（占位）

## 二、现有 v1 架构侦察（codegraph + 读码）
规模：`canvas-core/src` **190 文件**（136 ts + 49 vue）。
顶层：Canvas.vue / components / composables / nodes / plugins / registry / runtime / storage / types / utils / index.ts

### 1. 插件系统（已接近 Cordis 雏形）
- `CanvasPlugin { name, version?, dependencies?, options?, install(ctx,options)→{api,uninstall}?, uninstall?, activate?, deactivate? }`（plugins/types.ts:175）
- `PluginContext`（types.ts:189）：canvasId / store / actions / selection / viewport / logger / registerNodeType|EdgeType|Component / canvasNodes / menus / commands / toolbars / panels / dom / connectionState / isConnecting / canShowConnectionMenu / registerHandleConfig / on|off|emit(事件总线) / mountOverlay / unmountOverlay / registerShortcut …
- `PluginManager`（PluginManager.ts）：plugins/contexts/installResults/lifecycles/loadOrder 多 map + eventBus 共享 + 拓扑排序依赖 + 卸载反向。已按 name 暴露 api（getPluginAPI）。
- 依赖注入靠 dependencies[] + 拓扑排序 + getPluginAPI('storage') 等。
- ShortcutManager：内存单例（非注入）。

### 2. pinia
- `useCanvasStore`(defineStore 'canvasState')：巨型 `state.core`（连线/工具栏/端口/多选框/LOD/快捷键映射…几十项）+ `state.plugins[pluginName]`（按插件命名空间塞任意值）；整体 `useStorage('canvas-state')` 写穿 localStorage。
- `usePluginStore(pluginName)`：namespace get/set —— 已是"key-value"雏形。
- 另有各 useCanvas* composables（连接/性能/面板态…）。

### 3. 保存/持久化（多套，正是用户觉得难受处）
- 配置/设置：canvas.state → useStorage 整体写穿（改即存）。
- 画布数据(nodes/edges)：StoragePlugin(本地) 或 BackendSyncPlugin(后台)，两者并跑、机制不同。
- 图片/视频资源字节：AssetStore 抽象（IndexedDB 本地 / BackendAssetStore 后台），AssetManager.saveAsset(getObjectURL) 封装。
- 快捷键：state.core.shortcutKeymap，只在 Canvas.onUnmounted 写回（刷新丢 bug 根因）。
- 以上各有各的 key/格式/时机，无统一抽象 → 难受。

### 4. UI 挂载/插槽（用户要提供插槽位）
- 现有天然"插槽位"：Canvas.vue（画布主体）、DynamicSettingsPanel（设置面板）、NodeToolbar/Toolbar 注册、菜单 ContextMenu、Overlay mountOverlay(viewport/canvas/root)、Prosemirror toolbar。
- registry：NodeRegistry / EdgeRegistry / CommandRegistry / ToolbarRegistry / MenuRegistry / PanelRegistry / DialogRegistry。
- nodes：image / Video / text / panorama / image-compare；components：Panel / Toolbar / Menu / Decoration / Ui / CustomEdge / CustomNode…

### 5. 技术栈
vue3.5 + pinia3 + @vue-flow/core1.48 + tailwind4 + vue-router（app 侧）+ pnpm workspace（packages/*）。canvas-core peerDeps 有 pinia/vue/vue-flow/@vueuse。

## 三、用户 v2 诉求（整理）
1. 全体重构，逻辑/保存太乱 → 新项目 `canvas-core-v2`，UI 由用户提供多个**插槽位**（设置界面、画布中…）。
2. **上下文(context) 支持注册**：快捷键 / 保存 / 插件配置 等。
3. 插件**可相互依赖**、可调用其它插件导出的函数。
4. **pinia 管理覆盖**进来。
5. 资源保存 / 画布保存 / 快捷键保存 / 配置保存 → **统一抽象成一个 key-value 保存**：`存(key, value, type)`；后台可任意管理、按 type 单独处理。
6. 采用 **Cordis 概念**。

## 四、待用户拍板的关键决策（决定后续设计文档走向）
1. **Cordis 载体**：用第三方 `@cordisjs/*`（Koishi 同源）还是**自研 Cordis-风格内核**（与 vue/pinia/UI 插槽深度集成）？—— 最影响方案。
2. **节点实现去留**：现有 image/video/text/panorama 等节点组件强耦合 v1 registry/context。v2 里**复用/迁入**还是**按新插槽+注册重写**？
3. **并行/里程碑**：v2 全新并跑、app 视图逐步切 v2？建议里程碑 M0(内核+插槽+keyvalue保存+demo) → M1(存储/资源) → M2(快捷键/配置) → M3(节点/画布)。
4. **首个可验证交付**：先做"最小内核 + 一个能跑的画布 + 统一保存 key-value + 设置/画布插槽"证明概念？
