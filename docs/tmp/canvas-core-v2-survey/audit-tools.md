# canvas-core v2 重构审计：交互工具类插件（14 个）

> 审计对象：`packages/canvas-core/src/plugins/` 下 history、group、multi-select、align-arrange、align-guide、edge-cutting、context-menu、clipboard、node-find、custom-handle、auto-layout、mini-map、canvas-export、file-drop 共 14 个插件。
> 目标：为 v2（`canvas-core-v2`，自研 Cordis 式内核 `ctx.plugin/inject/get/on` + registry + UI 命名插槽 + `ctx.save`）找出问题与最优重组合方案。
> 检索：codegraph MCP + 源码逐文件通读。以下每条均落到文件:行。

---

## 0. 一句话总览（先给结论）

这批 14 个插件在 v1 里**严重依赖两个隐性"总线"**，而不是依赖显式接口：

1. **事件字符串总线**（由 `Canvas.vue` 手动把 VueFlow 事件转发成 eventBus 字符串）：`nodeDrag / nodeDragStart / nodeDragStop / nodesChange / edgesChange / paneMouseMove / paneContextMenu / nodeContextMenu / edgeContextMenu / connectionRelease / paneDoubleClick / selection:clear …`，以及插件互发的 `history:record / history:begin-batch / history:end-batch / history:clear / history:undo / history:redo / clipboard:copy / clipboard:duplicate / group:create / canvas:rightDragPanChanged / align-guide:update / selection:change …`。**没有任何地方声明这张表**，任何一个事件在 `Canvas.vue` 里漏转发，相关插件就"静默失效"。
2. **全局原生事件**：一批插件直接 `window/document.addEventListener(..., capture)` 抢事件（edge-cutting、multi-select、group、align-arrange、file-drop），以及通过 `window.dispatchEvent(new CustomEvent)` 跨 Vue 组件↔插件通信（group 的 `canvas:group:ungroup`），与 EventBus 并存、两套体系不一致。

**`getPluginAPI` 在本批只有 file-drop、multi-select 两处真正在用**（前者调 storage、后者探 group/theme 存在性）。插件间的能力调用几乎全走字符串事件——这是 v2 最该用 `ctx.get('service')` 收编的地方。

次要总览：
- `Canvas.vue` 静态挂了大量本批插件的 UI（`SelectionFrame.vue`、右键菜单相关 flag、事件转发），插件"逻辑在插件、UI/接线在 Canvas.vue"，卸载不干净、不可移植。→ v2 应全部移进命名插槽。
- `MenuRegistry` 里有个**无任何调用方的死解析器** `resolveMenuItems`，而真正在跑的是 ContextMenuPlugin 自己写的 `resolveItems`——两份右键菜单解析器重复确认成立，且死的一份会持续漂移。

---

## 1. 逐个插件解剖

### 1.1 history（核心能力）`HistoryPlugin.ts`
- **注册**：快捷键 `ctrl+z/ctrl+shift+z/ctrl+y`（撤销/重做）、`delete/backspace`（删除选中）。`api`：`HistoryAPI{undo/redo/clear/record/beginBatch/endBatch/canUndo/canRedo/isRestoring}`。
- **消费其它能力**：无（不 getPluginAPI）。反向被大量插件用**事件**调：监听 `history:record / history:begin-batch / history:end-batch / history:clear / history:undo / history:redo`（255-260 行），并 `nodeDragStart/Stop`、`edgesChange`（265/278/328 行）自己记录拖拽/连线历史。
- **内部状态**：`undoStack/redoStack/isRestoring/currentBatch` 纯模块闭包，**不持久化**（合理）。
- **UI**：无自挂载。
- **关键**：对外同时暴露 `getPluginAPI('history')` **和**一套 `history:*` 事件。但生产代码都走事件，`getPluginAPI` 基本闲置 → 双通道冗余。也自带 `delete` 删除实现，与别处的删除命令并存（见问题 B3）。

### 1.2 group（核心能力）`GroupPlugin.ts`
- **注册**：节点类型 `group`（registerNodeType）；命令 `group.color/ungroup/batch-download` + 对应 toolbar（source 'group'，position top，`nodeTypes:['group']`，其中 color 用 `customRender: GroupColorButton`）；快捷键 `ctrl+g / ctrl+shift+g / f2`。暴露 `api: GroupAPI{createGroup/ungroup/getGroupNodeIds/recalculateBounds}`。
- **声明依赖**：`dependencies:['multi-select']`，但代码里**从不调用 multi-select 的 API**，只用 `context.selection`——假依赖。
- **被谁调**：multi-select 打组按钮发 `group:create` 事件（`CanvasGroupEvents.Create`）→ group 监听（447 行）；GroupNode.vue 里的"解组"按钮走 `window.dispatchEvent(new CustomEvent('canvas:group:ungroup'))` → group 用 `window.addEventListener` 收（334 行）。**同一插件的两个同类事件走两套机制**。
- **内部状态**：无持久化；打组过程靠 `requestAnimationFrame(reparentChildren)` 轮询等 group 节点入 store（180 行，时序 hack）。
- **UI**：`GroupNode.vue` 是普通自定义节点组件，但自带一份**独立 resize 手柄 + 标题编辑 + 子节点平移联动逻辑**，未复用共享 ResizeHandle；挂载正常（注册节点类型即可）。`GroupColorButton.vue` 是 toolbar 的 customRender，它**直接 `runtime.vueFlowInstance.updateNode` 改色**，绕开 actions/命令，且经 `runtime as any`（19-26 行）。
- **关键**：本插件还承担"拖拽进出组自动 re-parent"（pane/document 原生 pointerdown/up，317-318 行），和 drag-stop 重叠检测——这部分逻辑埋在监听器里，无命令、无 API、无历史。

### 1.3 multi-select（核心能力）`MultiSelectPlugin.ts`
- **注册**：命令 `multi-select:group / multi-select:delete / multi-select.batch-color{,+N 个色值子命令,+custom}` + toolbar（source 'multi-select'，position top，`nodeTypes:[]`）；快捷键 `ctrl+a / escape`。暴露 `api: MultiSelectAPI{selectedNodeIds/selectedNodes/selectAll/clearSelection}`。
- **消费其它能力**：`getPluginAPI('group')`（探存在）、`getPluginAPI('theme').applyCustom`（批量改色，356/451/468 行）——**theme 是未声明依赖**。
- **调用别人**：向 group 发 `group:create`（381 行）。
- **内部状态**：直接 `useCanvasStore()`（55 行）读全局 Pinia `isBoxSelecting`；框选相关 `selectionBox/startX/isBoxSelecting` 模块闭包。
- **UI**：插件的 `createSelectionBox` div（142-154 行）是**Shift 拖拽进行中的框选虚线矩形**；而"多选达成后的虚线包围框 + 批量连线 + 中键平移 + 多选工具条"`SelectionFrame.vue` 由 **Canvas.vue 静态挂载**（`Canvas.vue:726`）并**直连 Pinia store 与 VueFlow updateNode**。同一插件的视觉 UI 一分为二：插件管"框选过程"，Canvas.vue 管"多选状态装饰/批量连线/工具条"，两处各自维护节点尺寸/选中同步，且 SelectionFrame 里注释明言**多选工具条"只取 source 为 multi-select 的"**（SelectionFrame.vue:34）——即任务点名的脆判断。
- **实现重**：capture 阶段拦 pane/document 的 pointer 事件做 Shift 框选、吞 click、给节点打 selectable、监听 nodesChange/edgesChange 手工同步选中集合（与 PluginContext.selection 双层状态）。**实现接近内核职责**（选中态管理），却以"插件 + 裸 DOM + 全局 store"姿态散落。

### 1.4 align-arrange（单用途/工具）`AlignArrangePlugin.ts`
- **注册**：panel 设置 `align-arrange.gap`；快捷键 `ctrl+方向键`（4 个，82-85 行）**同时**又自己 `document.addEventListener('keydown',capture)` 拦截 Ctrl+Arrow（80 行，为修 VueFlow 内置 nudge 漂移）——同一功能注册快捷键 + 抢原生事件两套并存。暴露 `api: AlignArrangeAPI{arrange/setGap/getConfig}`。
- **消费其它能力**：靠 `context.emit('history:record')` 记历史（50 行，事件耦合）；用 `context.selection/actions`。
- **内部状态**：`gap` 用 `store.toRef('gap')` 持久化；本地 `dragStart` 无。
- **UI**：无。
- **panel 清理缺失**：uninstall 只清了快捷键和原生监听，没清 `panels.registerSetting('align-arrange',…)`（不过 PanelRegistry 自动清 source===插件名，见 B5，此处 source 用的别名是 'align-arrange'=插件名，靠自动清理兜底）。

### 1.5 align-guide（单用途/工具）`AlignGuidePlugin.ts`
- **注册**：panel 开关 `align-guide.enabled`；无命令/快捷键/API。靠 `context.on('nodeDrag/Start/Stop')` 驱动（296-335 行）。
- **内部状态**：`enabled` 用 store.toRef 持久化；辅助线容器/线条 DOM 元素、`dragDimensions`（拖拽期锁定尺寸防抖）模块闭包。
- **UI**：**手动建 DOM**：在 `.canvas-container` 里 createElement 一个 `.align-guide-container` 并塞两根缓存 div（84-121 行），非 Vue、非 overlay 抽象。
- **实现**：直接改 `draggedNode.position.x += snapDeltaX`（276 行）实现吸附，emit `align-guide:update`（无消费者）。

### 1.6 edge-cutting（单用途/演示）`EdgeCuttingPlugin.ts`
- **注册**：6 个 panel 设置（enabled/tolerancePx/showCutPath/pathColor/bladeColor/bladeOnlyCut，178-240 行）；**无命令/无 API/无快捷键**——纯"按住 Alt 拖拽"即开，只能靠 panel 开关。无历史记录。
- **内部状态**：`enabled/tolerance/…` 全走 store.toRef 持久化；其余 overlay/points/cutting 闭包。
- **UI**：**最重的裸 DOM 派**——手写 SVG overlay 挂 `document.body` + 往 `<head>` 注入 `<style>`（87-162 行）；`window/document` 上一堆 capture 监听（keydown/keyup/pointermove/up/blur/focus/visibilitychange/wheel/resize，457-466 行）；靠 CSS 选择器猜 VueFlow 边的 DOM（`resolveEdgePath` 备了 6 个 fallback 选择器，55-72 行）再 `getPointAtLength` 采样做命中。
- **独立演示文件** `edge-cutting-demo.html`（不在打包链路）。

### 1.7 context-menu（核心能力 + 承载 UI）`ContextMenuPlugin.ts`
- **注册**：`builtinMenuItems`（命令 `core.deleteNode / core.deleteEdge / clipboard.copy / clipboard.duplicate` + 菜单项 `node:copy/duplicate/delete、edge:delete`，areas node/edge）；panel 设置 `context-menu.panOnRightDrag`；快捷键 `shift+a`（添加节点）。
- **消费其它能力**：`canvasNodes`（NodeRegistry 的"创建节点"菜单 + defaultSize/acceptsInputs 校验）；`commands/menus`；监听 `pane/node/edge ContextMenu、paneDoubleClick、connectionRelease、connectionContextMenu` 等事件打开菜单。
- **UI**：**自建 createApp** `h(CanvasMenu)` 挂 `document.body`（389-392 行）——`CanvasMenu.vue` 由插件自渲染，绕开任何 overlay/面板抽象。**自带第二份菜单解析器** `resolveItems()`（19-90 行）合并 NodeRegistry 创建项 + MenuRegistry 操作项 + areas/nodeTypes 过滤 + GROUP_ORDER 排序，和 `MenuRegistry.resolveMenuItems()`（死代码）重复。
- **关键跨插件耦合**：copy/duplicate 命令**不发 `getPluginAPI('clipboard')`**，而是重写选中过滤后 `emit('clipboard:copy/duplicate',{nodes})`（builtinMenuItems 50-65 行）——把本可直接调用 clipboard 的能力又绕回事件。
- 右键平移开关：存 `panOnRightDrag`，watch 后 `emit('canvas:rightDragPanChanged')`，Canvas.vue 负责合进 VueFlow pan（147-149/387 行）→ **插件↔Canvas 隐式协议**。
- `uninstall` 较完整：清 menus.unregisterSource('context-menu')、panel、事件、快捷键、卸载 createApp。

### 1.8 clipboard（核心能力）`ClipboardPlugin.ts`
- **注册**：快捷键 `ctrl+c/v/x/d`。暴露 `api: ClipboardAPI{copy/paste/hasData}`。
- **内部状态**：**模块级全局变量** `clipboard/pasteCount`（21-22 行）——非 per-canvas、非 per-plugin 实例；多画布共用一份剪贴板缓冲（有跨实例脏数据风险，虽 install 时重置）。不持久化（粘贴只是内存克隆）。
- **消费其它能力**：`context.emit('history:record')` 记粘贴/剪切历史（225/282 行）；跟踪鼠标靠 `paneMouseMove` 事件（62 行）。
- **UI**：无。
- **两套事件契约冲突**：`clipboard:copy` 既是"复制完成通知"（payload `{nodeCount}`，145 行自 emit）又是"请复制这些节点"的请求（payload `{nodes}`，listener 311 行 + context-menu 发）。同名事件双 payload 契约，靠 listener 内 `payload?.nodes?.length` 区分，极易误触发/死锁隐患（目前靠不同字段规避）。duplicate 同理 329 行。

### 1.9 node-find（演示/单用途）`NodeFindPlugin.ts`
- **注册**：快捷键 `ctrl+f`（搜索节点）。无命令、无面板。
- **UI**：**自建 createApp `h(NodeFindOverlay)`** 挂 `document.body`（16-40 行），真正绕过抽象。
- 行为简单：取 getNodes() 快照传给 overlay 供点选聚焦 `viewport.setCenter`。

### 1.10 custom-handle（配置/单用途）`CustomHandlePlugin.ts`
- 只做一件事：`context.registerHandleConfig({radius:86,…})`（7 行），往全局 store state 写一串 handle 阈值（实际是连接核心的默认配置注入）。无 API、无 UI、无卸载（写 store 无副作用）。
- 注意：真正的"连接合法性校验"是 `ConnectionValidator.ts` 的 `isValidCanvasConnection/normalizeConnection`，**CustomHandlePlugin 并不引用它**——它被连接核心（useCanvasConnection）使用。custom-handle 名不副实，只余一段配置注入。

### 1.11 auto-layout（单用途/工具）`AutoLayoutPlugin.ts`
- **注册**：6 个 panel 设置（direction/intraSpacingX/Y/interSpacingX/Y/focusHeightRatio）；快捷键 `f`(聚焦) / `ctrl+l`(布局) / `r`(fitView)。暴露 `api: AutoLayoutAPI{run/getConfig/setConfig/focusSelected/focusNode}`。无命令（不可被菜单/工具栏触发）。
- **声明依赖**：`dependencies:['group']`，但**从不调 group API**——布局里自己 `calculateGroupFrameFromAbsoluteChildren`（groupBounds.ts）算组框、自己 reparent 子节点、自己改 GroupNode style。而 group 明明暴露了 `recalculateBounds`（注释写着"供 AutoLayoutPlugin 调用"）却没被用 → **组框计算逻辑在两处各写一份，且专用 API 空置**。
- **内部状态**：direction/间距/ratio 走 store.toRef 持久化；minZoom/maxZoom/debug 本地。
- **无历史记录**：布局把全部节点挪位后不 emit history，不可撤销。
- UI 无；依赖 VueFlow `computedPosition` 语义 + rAF 分帧写回（282-337 行，时序复杂）。

### 1.12 mini-map（演示/单用途）`MiniMapPlugin.ts`
- **注册**：5 个 panel 设置（width/height/sensitivityX/Y/visible）；命令 `mini-map.toggle` + 快捷键 `ctrl+m`（重复同逻辑，54-62 行）。
- **内部状态**：`width/…/visible` 全 store.toRef 持久化；`state{nodes/viewport/dimensions}` reactive 缓存。
- **UI**：**自建 createApp `h(MiniMap)`** 挂 `document.body`（position:fixed 右下，99-138 行）。
- **性能/卸载问题**：`syncViewport` 每帧 `requestAnimationFrame(syncViewport)` **永续自旋**（90-96 行），即使用户把 mini-map 隐藏（visible=false 只切 display）也照常每帧跑；靠监听 nodesChange/nodeDrag 快照 nodes。

### 1.13 canvas-export（演示/单用途）`CanvasExportPlugin.ts`
- **注册**：快捷键 `ctrl+e / ctrl+shift+e`。暴露 `api: CanvasExportAPI`。无命令、无菜单、无面板。
- 实现：`html-to-image` 的 `toPng` 拷 `.vue-flow__viewport`/选中节点 DOM clone，建 `<a>.click()` 下载。

### 1.14 file-drop（核心能力 / 内容注入）`FileDropPlugin.ts`
- **注册**：原生 `document` 'paste' 监听 + `.vue-flow` 容器 dragover/drop（458-475 行）。无命令/快捷键/panel/API。
- **消费其它能力**：`getPluginAPI<StorageAPI>('storage').assets.saveAsset`（214/243/364/395 行）——**未声明依赖 storage**（可选降级）；`context.emit('history:record')`（174 行）。
- **UI**：无。
- **与 clipboard 的 Ctrl+V 冲突**：FileDrop 注册**原生 paste 监听**，把剪贴板里的图片/视频/文本直接建成新节点；clipboard 的 Ctrl+V 走 ShortcutManager 快捷键把内存 `clipboard` 里的**画布节点克隆**粘贴。两条"粘贴"语义（贴外部素材 vs 贴画布克隆）在两个完全不同的输入通道里并存，谁先拦截取决于浏览器/事件顺序，语义含糊。且 FileDrop 建文本节点 → 在文本编辑器里 Ctrl+C 再在画布 Ctrl+V 会直接长文本节点，侵略性强。
- **nodeType 硬编码**：`NODE_SIZES['text'|'image'|'video']`（34-38 行）是这些节点类型的默认尺寸硬编码副本；`buildNode` 与 ContextMenu 的 `createNode` 是**同一套"按类型在 flow 坐标建 custom 节点"逻辑的第三份实现**（ContextMenu 用 `canvasNodes.get(type).defaultSize`，FileDrop 用硬编码表，会漂移）。

---

## 2. 逐条问题清单（按严重度）

### P0 —— 架构级：能力边界与通信方式

**P0-1 插件靠"事件字符串总线"互相调能力，接口无类型、无声明表。**
绝大多数跨插件调用是 `emit('history:record'/'group:create'/'clipboard:copy')`，事件名散落、无中心声明、`Canvas.vue` 手工转发一大串 VueFlow 事件。任何一个漏转发 → 静默失效。
改法（v2）：能力调用一律 `ctx.get('history')`、`ctx.get('group')` 等显式服务/插件引用；画布/内核事件收敛成**有 schema 的命名事件**（`ctx.on`），事件名常量集中，且内核自己发出（不再由 Canvas.vue 逐条转发）。可让 `ctx.emit` 有事件白名单校验（dev 下 warn 未声明事件）。

**P0-2 插件 ↔ Canvas.vue 双向隐式协议。**
`context-menu` 把右键平移开关通过 `canvas:rightDragPanChanged` 事件喂给 Canvas 去改 VueFlow `pan-on-drag`（ContextMenu 147/387、Canvas.vue 442）；`SelectionFrame.vue`、右键菜单相关 flag、以及全部 `@node-drag` 转发都硬编码在 Canvas.vue 模板里。插件不独立、Canvas 不可少。
改法（v2）：这些 UI 全部收进命名插槽（`overlay:*`、节点选中框插槽），Canvas 只留一个 `<slot>`；pan-on-drag 之类画布交互参数放进内核配置对象而非事件协议。

**P0-3 一批插件绕过 ctx/EventBus 直接用 `window/document.addEventListener`（capture）抢输入。**
edge-cutting（9 个 capture 监听）、multi-select、group、align-arrange、file-drop（paste），且 edge-cutting/multi-select/group 还得用 `.vue-flow__pane`、`.vue-flow__node` 等 **VueFlow DOM/CSS 类名猜画布元素**（edge 甚至 6 个 fallback 选择器）。改任一内部类名即碎。
改法（v2）：内核提供**统一指针/按键/拖拽/滚轮/粘贴 输入门面**（capture 语义内建、自动 cleanup、作用域回收），插件 `ctx.on('pointer:keydown')` 之类，禁止直接碰 `.vue-flow` DOM。overlay 一律走内核挂载 API。

**P0-4 全局消息双轨：EventBus 之外还有 `window.dispatchEvent(new CustomEvent('canvas:group:ungroup'))`。**
group 的 Vue 组件↔插件通信用原生 window 事件（GroupPlugin 334、GroupNode 发），与 `group:create`（EventBus）不一致。
改法（v2）：统一成 `ctx`；节点组件内通过注入的 ctx/服务调用，不再 dispatch window 事件。

**P0-5 `mountOverlay` 抽象是坏的，于是大家都自建 `createApp`。**
`context.mountOverlay` 只支持 `HTMLElement`，对 `Component` 直接 `warn('not yet implemented')`（PluginContext 417），而 target 依赖 `.vue-flow__viewport/.vue-flow__renderer/#app` CSS 选择器。结果 context-menu/node-find/mini-map 全各自 `createApp+h()` 手动挂 `document.body`，卸载/复用/主题全 DIY。
改法（v2）：内核给 `ctx.mount` / `overlay` 命名插槽，接受 Vue 组件并按插槽挂载/回收，删掉这个半成品。

### P1 —— 重复逻辑（建议 v2 收敛成共享服务）

**P1-1 右键菜单解析器两份（一份是活的、一份是死的）。**
ContextMenuPlugin 的 `resolveItems()`（19-90）是活的；`MenuRegistry.resolveMenuItems()`（MenuRegistry.ts 154，合并 createNodeItems + areas + nodeTypes + GROUP_ORDER）**全仓库无调用方**，纯死代码。二者各自维护一份 NodeRegistry"创建节点"合并 + 排序策略。
改法（v2）：删死代码；把"菜单解析"收敛成**内核统一 resolver 服务**，`ctx`/菜单 UI 都调它，策略（区域过滤、nodeTypes、命令 disabled、分组排序）只写一份。

**P1-2 "在 flow 坐标按类型建 custom 节点"至少 3 份实现。**
ContextMenuPlugin.createNode（92-120）、FileDropPlugin.buildNode（146-169）、以及各节点"添加"逻辑，各自算默认尺寸/port 位置/resizable。FileDrop 用硬编码 `NODE_SIZES`，ContextMenu 读 registry，必然漂移。
改法（v2）：内核/节点服务提供 `createNodeAt(type,pos)`（尺寸/port/resizable 都取自 registry definition），三者都调它。

**P1-3 组框计算两份 + 专用 API 空置。**
group 暴露 `recalculateBounds`（注释明说供 auto-layout 用），auto-layout 却自己写 `calculateGroupFrameFromAbsoluteChildren`（groupBounds.ts）。删除节点删除路径也重复（见 P2）。
改法（v2）：组框/children-reparent 收敛进 **group 服务**，auto-layout `ctx.get('group').recalculateBounds`；group 内部和 auto-layout 共用一个纯函数模块。

**P1-4 鼠标坐标跟踪复制两份。**
clipboard（62 行 paneMouseMove）、file-drop（136 行 paneMouseMove）、context-menu（143 行 `dom.onWindow pointermove`）各自维护 `lastMousePos`，且分属"paneMouseMove 事件"和"原生 pointermove"两通道。
改法（v2）：内核提供 `ctx.mouse`（当前 flow 坐标 + 屏幕坐标，响应式），各处直接读，删三份监听。

**P1-5 同一命名空间的 eventStore 命名空间 `store.plugins.<name>` 内每插件自治，保存姿势不统一。**
v1 靠 `store.toRef` 拼 ref + DynamicSettingsPanel 注册 setting 才能持久化，两者**没有显式绑定**（setting defaultValue 与 toRef 默认值各写一份，注册 setting 不会自动写 store）。align-arrange/edge-cutting/auto-layout/mini-map/align-guide/context-menu 都手工配对的 set→toRef。
改法（v2）：`ctx.save(state)` 统一持久化 + 自动推导 settings 元数据，删手工配对。这正是任务给的目标之一。

### P1 —— 跨插件隐式/未声明依赖

**P1-6 一堆"依赖"是假声明或未声明。**
- group `dependencies:['multi-select']` 但从不调其 API（假）；
- multi-select 真用 `theme`（getPluginAPI）却不声明（未声明）；
- file-drop 真用 `storage`（getPluginAPI）却不声明（未声明）；
- auto-layout 用 `group` 概念却不声明真依赖（假依赖却真耦合）。
- 真正声明依赖的 group/auto-layout 又都不按依赖办事。
改法（v2）：依赖 = "真调 ctx.get 的模块"才写；`ctx.get` 缺失时显式 fail/warn，杜绝"探存在则降级"的静默不确定性（multi-select 探 group 在/不在切换行为属可读性负担）。

**P1-7 history 双通道（getPluginAPI + 一整套 history:* 事件）而生产走事件。**
`HistoryAPI.record` 已够，别的插件却 `emit('history:record')`。这是最典型的"本可 ctx.get 却走字符串事件"。
改法（v2）：统一 `ctx.get('history').record(...)`；beginBatch/endBatch 同理。

**P1-8 clipboard 同名事件双 payload 契约（通知 vs 请求）。**
`clipboard:copy` 既广播"复制完成 {nodeCount}"又请求"复制这些 {nodes}"；context-menu 抄了一遍选中过滤后再发事件，而非调 ClipboardAPI.copy。
改法（v2）：context-menu 直接 `ctx.get('clipboard').copy()`；"复制/粘贴完成"改读 clipboard 自身返回值/状态，去掉事件双关。

### P2 —— 功能缺口 / 一致性

**P2-1 删除节点有 3+ 条路径且历史/状态不一致。**
history 的 delete/backspace → deleteHandler；context-menu `core.deleteNode`（命令，无历史）；multi-select `multi-select:delete`（命令+toolbar，无历史）。Delete 最终走哪条取决于聚焦/事件，行为可能不一（有些清空 selection、有些不清）。
改法（v2）：收敛成**单个内核删除命令**（删选中 + 记历史统一处理），菜单/工具栏/快捷键/历史全引用它，去掉重复实现。

**P2-2 历史记录覆盖不一致。**
history 自己管拖拽/连线/删除；align-arrange、clipboard、file-drop 显式 emit history；但 **group 打组/解组、multi-select 删除/清空、edge-cutting 切割边、auto-layout 布局挪位、group.color 改色、align-guide 吸附**全部不记历史 → 用户撤销在这些操作后直接断链。
改法（v2）：**默认开启"变更即历史"**（内核记录 add/remove/update 差异，或提供 `ctx.withHistory(()=>…)` 批量原语），各操作不用手写 record，杜绝"谁记得谁才有撤销"。

**P2-3 卸载自动清理依赖脆弱约定（menu 不在自动清理范围）。**
`PluginManager.uninstall` 只对 command/toolbar/panel 做 `unregisterSource(pluginName)`（194-196），**menu 不自动清**（靠插件自己 unregisterSource）；且这一切**默认 source===插件名**才有效，无任何强制。context-menu 手动清了 menu+panel，group 手动清了 toolbar+command（重复了自动清理），multi-select 完全没清自己注册的 command/toolbar（靠自动），align-arrange 只清快捷键不清 panel。清理动作靠"插件名当 source"这个不成文约定，注册来源一旦起别名就漏。
改法（v2）：内核按**注册来源 token**统一回收（每个注册项登记其 scope/来源，卸载 scope 时全量回收，涵盖 menu/node-type/overlay），不靠 name 字符串巧合。

**P2-4 UI 用 `source==='multi-select'` / `nodeTypes:['group']` / `position:'top'` 猜渲染位置，脆。**
Toolbar 把"多选上下文工具条"用 source='multi-select' 表达、group 工具条用 nodeTypes=['group'] 表达——位置/可见性判断散落在 registry/渲染层。任务已点名此坑。
改法（v2）：命名插槽 `toolbar:{context}` / `node:{type}:*`，按上下文（单选某节点 / 多选 / 空白）与类型路由，不再用 source/nodeTypes 字符串拼。

**P2-5 模块级/全局状态、永续循环。**
clipboard 的 `clipboard/pasteCount` 模块级共享（跨实例）；mini-map `syncViewport` 每帧 `rAF` 永续自旋且隐藏不暂停；`EventBus.emit` 额外 `window.dispatchEvent(CustomEvent)`（PluginContext 81）把内部事件洒向全局（可被外部监听/污染）。
改法（v2）：状态进 `ctx` 作用域（随作用域回收）；mini-map 用可见性/内容变化驱动；EventBus 去掉 window.dispatchEvent 副作用。

**P2-6 panel 设置 ↔ 行为开关是"松配对"。**
align-guide 的 enabled、context-menu 的 panOnRightDrag 等：注册 setting 不自动写 store，真正生效靠 toRef；设置项 id 用点号（`context-menu.panOnRightDrag`、`align-arrange.gap`）未来可能撞命名空间。见 P1-5，一并收编。

### P3 —— 细节 / 规范
- **P3-1 死代码**：`MenuRegistry.resolveMenuItems` 及其 GROUP_ORDER/createNodeItems（全仓库零调用）——该删。另 multi-select 的"框选过程矩形"（插件 div）与"多选包围框/批量连线/工具条"（Canvas.vue 静态 SelectionFrame）虽非同一时刻重复，但**同属"选中 UI"却分处插件与 Canvas、各自同步节点尺寸与选中态**，应唯一归一到 v2 的选中 overlay 槽，别留两处尺寸/选中同步逻辑。
- **P3-2 命令空实现**：group.color `run(){}` 空壳，真实逻辑在 customRender 组件里直接改 VueFlow（GroupColorButton 19-26），命令名不副实、不可被键盘/API 触发。v2 命令应可独立执行，customRender 只做"拾色 UI"，颜色落库走命令。
- **P3-3 硬编码尺寸/常量副本**：align-arrange/auto-layout/align-guide/multi-select/ContextMenu 多处 `dimensions?.width||256/200`、`style.width` parse 兜底各自猜节点尺寸；文件类型正则/`NODE_SIZES` 在 file-drop。v2 统一提供节点尺寸解析服务。
- **P3-4 `prompt()` 浏览器原生弹窗**（multi-select batch-color custom，466 行）不可自定义；改 v2 用共享取色/输入 UI。
- **P3-5 日志/调试大面积 `console.log`、长文件**（multi-select 548、group 569、edge-cutting 490、auto-layout 520 行），且 action/命令重复度（multi-select:delete 与 core.deleteNode）。v2 走统一 logger + 拆服务。
- **P3-6 edge-cutting/mini-map/canvas-export 无命令、无 API，仅快捷键或 Alt 手势**：不可发现、不可重绑定、不可被菜单/工具栏调用。v2 一律补命令 + 注册进命令面板/工具栏。

---

## 3. v2 最佳组合方案

### 3.1 分类：内核可复用基础能力 vs 单用途/演示

| 类别 | 插件 | 判断依据 |
|---|---|---|
| **内核级/基础能力**（进内核或作内置必装服务，纳入 ctx 管理） | history、group、multi-select、clipboard、context-menu、file-drop | 分别对应撤销/命令基础设施、节点层级分组、选中态引擎、剪贴板服务、右键菜单+命令桥、素材/内容注入。属于任何画布都可复用，且与内核选中/节点/命令/连线强咬合 |
| **单用途/工具**（保持插件，但服务化 + 补命令） | align-arrange、align-guide、auto-layout、custom-handle | 一次性操作/一次性辅助，逻辑纯、依赖少，好剥离成服务 |
| **纯演示/单用途 UI**（v2 收进命名插槽或 demo） | mini-map、node-find、canvas-export、edge-cutting | mini-map/export 是旁路 UI + 单快捷键；edge-cutting/node-find 目前是自包含单点功能 |

> 注：不是叫它"内核级"就要重写，而是说它的**能力应成为 ctx 内可注入的服务/命令**，而不是"靠事件总线 + Canvas.vue 硬接线"的插件。逐一对 slot 映射见下。

### 3.2 每个插件在 v2 应注册到哪个 slot、注入什么、ctx.get 依赖谁

约定：v2 插槽按任务给 `settings: / context-menu:{mode} / toolbar:{context} / node:{type}:* / overlay:*`；服务经 `ctx.get`，事件经 `ctx.on`；状态经 `ctx.save`。

- **history** → **应上收为内核命令/历史服务**（不占 UI 槽）。它提供的 `undo/redo/delete/record` 应变成内建命令 + 内核"变更即历史"层，所有插件默认受益。`toolbar` 若有撤销/重做按钮，走 `toolbar:{context}`。若保留插件形态：`ctx.get('history')` 提供 record；删除命令统一为内核 `command:delete`。
- **group** → 服务 `group`（提供 createGroup/ungroup/recalculateBounds/reparent/isNodeInGroup），**不再是"事件被动接收器"**。节点 UI `node:group:*`（title、color、resize），`toolbar:node-type-group` 收 color/ungroup/batch-download。拖动进出组 auto-reparent 交给内核拖拽结束钩子 + group 服务，去掉裸 DOM 监听。解除对 multi-select 的假依赖；对外只留服务 API，别让人探存在性切换。
- **multi-select** → **内核选中态引擎**（selection/box-select/marquee/全选/清空/连线多选）。把"Shift 框选过程矩形"+"多选包围框/批量连线/中键平移"+"多选工具条"三块从插件 div / Canvas.vue(SelectionFrame+Pinia) 并进统一的 `overlay:selection` + `toolbar:{multi}`，去掉 Canvas.vue 静态硬挂、Pinia 直连、裸 DOM capture。`ctx.get('group')`（打组）、`ctx.get('theme')`（改色，声明依赖）。
- **clipboard** → 服务 `clipboard`，**作用域内状态**（不再模块级全局）。`ctx.get('clipboard').copy/paste`。粘贴语义拆分：贴画布克隆（service.copy 的内存缓冲）vs 贴外部素材（交给 file-drop）——避免 Ctrl+V 双通道打架。
- **context-menu** → 拆成「**右键菜单宿主内核服务**（收 unified resolver + `context-menu:{pane,node,edge,connection}` 插槽）+ 内置命令集」。`ctx.get('clipboard').copy`、删除走 `command:delete`。pan-on-drag 并入内核画布配置，删事件协议。createApp 改插槽渲染。
- **file-drop** → 服务/能力 `ctx.get('file-drop')`？建议其"建节点"与"外部素材粘贴"分开：素材导入走 `node:{image|video|text}:create` 工厂（复用 `createNodeAt`），粘贴监听收到输入门面统一信号，`ctx.get('storage').assets` 声明依赖，去掉硬编码 NODE_SIZES 与 `document.addEventListener('paste')`。
- **align-arrange / align-guide / auto-layout** → 纯工具服务（arrange / alignGuide / layout）。命令进 `toolbar:{multi}` 或命令面板（对齐/排列/布局按钮）。吸附/布局与内核"节点尺寸、组框、绝对/相对坐标"服务共享。align-guide 的参考线渲染走 `overlay:guides`。auto-layout `ctx.get('group').recalculateBounds`。三者都补历史。
- **custom-handle** → 并入连接内核的配置（一段 handle 阈值默认值），不单独成插件；或作为 `settings:connection-handle` 的默认配置源。
- **mini-map** → 渲染 `overlay:minimap`（或 `settings:minimap` 配显隐），命令 `command:minimap-toggle`。修永续 rAF。
- **node-find** → `overlay:node-find` + `command:node-find-open`（命令面板可触发），不要独立 createApp。
- **canvas-export** → `toolbar:{multi|context}` + 命令面板 `command:export-{full|selection}`，去掉硬编码 Ctrl+E 才可用的问题。
- **edge-cutting** → `settings:edge-cutting` 保 panel，补 `command:edge-cutting-toggle`，**渲染收敛到 overlay 层**、输入走内核输入门面，去 `.vue-flow` DOM 猜测。若定位"演示"则独立 demo 包、不进 core 主链路。

### 3.3 应收敛成共享服务 / 可合并的点

1. **统一菜单 resolver**（删 MenuRegistry 死代码；解析策略唯一）。
2. **节点创建工厂 `createNodeAt(type,pos)`**（吸收 ContextMenu.createNode / FileDrop.buildNode）。
3. **尺寸/边界/绝对坐标工具服务**（吸收 5+ 处各自猜 `dimensions/style/computedPosition`）。
4. **组框 + children reparent**（group.recalculateBounds 与 auto-layout.groupBounds 合并，group 提供）。
5. **统一鼠标坐标**（`ctx.mouse`，删三份 lastMousePos）。
6. **统一删除命令**（3 条删除路径合并成一个带历史的 `command:delete`）。
7. **变更即历史**（内核层，吸收各插件手写 `history:record`）。
8. **统一输入门面 / overlay 挂载**（吸收全部裸 DOM capture + createApp）。
9. **clipboard/file-drop 的"复制/粘贴语义"拆分**。

---

## 4. 可直接照做的结论清单

### 4.1 换层皮就能进 v2（逻辑已基本服务化/自洽，主要是把"事件调用+裸 DOM+Canvas 接线"换成 ctx + 插槽）

- **history**：本身已自洽（undo/redo 栈 + API 齐全）。改动小：把"被事件调"改成 `ctx.get('history')`，把删除/撤销快捷键与别处删除命令合并。低风险。
- **clipboard**：核心 copy/paste 已独立成 API。改：状态移进 ctx 作用域、去事件双关、去 paneMouseMove 追踪（改 ctx.mouse）。低-中风险。
- **align-arrange**：纯逻辑已在 arrangeEngine + gap ref。改：收编 input 门面、补 panel 显式清理、补命令。低风险。
- **align-guide**：算法自包含。改：参考线渲染走 overlay 槽、输入走 ctx、尺寸用共享服务。中风险（依赖 VueFlow 拖拽事件被 ctx 收编）。
- **file-drop**：建节点+storage 逻辑清楚。改：粘贴语义与 clipboard 拆分、节点工厂复用、声明 storage、输入走 ctx。中风险（行为较广，测试面大）。
- **custom-handle**：整段挪进连接内核配置即可。超低风险。

> 判断标准：它们**不靠"别插件在不在"切换行为、不自带碎片 UI、无复杂时序/回调风暴**。

### 4.2 需要先重构再进 v2（行为与内核耦合深，或内部就烂）

- **context-menu**：先做"菜单解析唯一化 + 命令桥（copy/delete 走 ctx 服务）+ createApp→插槽"三步重构，再进 v2，否则会把双解析器/事件双关/裸挂载带过去。**高优先**（它是菜单基座）。
- **group**：先解耦"拖动进出组 auto-reparent"（从裸 DOM 监听迁到内核拖拽钩子）＋统一 `canvas:group:ungroup` 窗口事件 → ctx；再服务化 recalculateBounds。**高优先**。
- **multi-select**：本身塞了太多内核职责（选中引擎 + 框选 + 命令 + toolbar + batch-color）且 UI 与 Canvas 分裂。先拆出"选中态引擎"作内核候选，再把框选渲染唯一化、去 `useCanvasStore`。**高优先、工作量最大**。
- **auto-layout**：先消除"自写组框/reparent"对 group 的重复（改用 group 服务），并补历史；时序（rAF 多段写回）建议在 v2 用内核"批量变更"原语重写。中-高工作量。
- **edge-cutting**：DOM/SVG 手写 + capture 风暴 + CSS 猜 DOM，属于"重 UI"。要么收敛到内核 overlay/输入抽象（中高成本），要么降级为独立 demo 不进主链路。先定定位。
- **mini-map**：先修永续 rAF + 去 createApp（换 overlay 槽）成本不高，但它价值与主画布关系弱，可归 demo。低-中成本。
- **node-find / canvas-export**：先补命令/改插槽（node-find 去 createApp、export 补命令入口），本身薄，快。低成本。

---

## 附：审计证据索引（关键文件:行）
- 事件总线转发：`Canvas.vue` 681-693（node-drag / nodesChange / pane-mouse-move…）、261-322（右键/双击/连接释放）、436-442（selection:change / rightDragPanChanged）
- EventBus 含 `window.dispatchEvent`：`plugins/PluginContext.ts` 58-97
- `mountOverlay` 组件不可用：`plugins/PluginContext.ts` 404-435
- `PluginManager` 仅自动清 command/toolbar/panel、menu 自清：`plugins/PluginManager.ts` 193-196
- 死解析器 `resolveMenuItems`：`registry/MenuRegistry.ts` 154-197（零调用）
- 活解析器 `resolveItems`：`context-menu/ContextMenuPlugin.ts` 19-90
- group `window` 事件双轨：`group/GroupPlugin.ts` 334 / 447（`CanvasGroupEvents.Create`）
- group 自写 rAF reparent：`group/GroupPlugin.ts` 160-181
- auto-layout 自写组框：`auto-layout/AutoLayoutPlugin.ts` 282-337 + `groupBounds.ts`（group 的 `recalculateBounds` 489 行空置）
- clipboard 模块级全局 + 事件双关：`clipboard/ClipboardPlugin.ts` 21-22 / 145 / 311-329
- multi-select 直连 store + 裸 DOM：`multi-select/MultiSelectPlugin.ts` 55 / 142-154 / 505-508；`Canvas.vue` 726 SelectionFrame
- 三份鼠标跟踪：clipboard 62、file-drop 136、context-menu 143
- 三份建节点：context-menu 92、file-drop 146（+NODE_SIZES 34）
- 三份删除路径：history 417-418 deleteHandler、context-menu builtinMenuItems core.deleteNode、multi-select:delete
