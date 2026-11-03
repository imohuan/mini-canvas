# plugin-multi-select

## 一句话

Shift 框选、Ctrl+A 全选、Escape 清除、多选群组框、整组拖动、批量连线、上控制栏打组。它是本组里体量最大、DOM 粘连最深的插件。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-multi-select |
| 身份 | builtin |
| 源码文件 | 14 个（plugin 158 行 / engine 207 行 / config 645 行 / SelectionFrame 1597 行 / 其余组件与纯函数） |
| 测试文件 | 9 个，153 个用例 |
| 包依赖的其他插件 | 仅测试：@mini-canvas/plugin-theme-default（devDependencies） |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Service / PluginModule / Context | 是 | src/multiSelectPlugin.ts:19 |
| canvas-data | 类型 DocService / SelectionService / CanvasNode | 是 | 同上:20 |
| canvas-render | useCanvasRender / useCapability / useUiComponent / SelectionCapability | 是 | src/SelectionGroupToolbar.vue:18-20 |
| plugin-theme-default | MovingHandle / ConnectionLine（仅测试） | 测试用，但属于跨插件 import | src/__tests__/selectionFrameRender.test.ts:17 |
| 其他插件 | 源码无 | — | 全 src 无 plugin- import |

测试直接 import 主题包的组件（selectionFrameRender.test.ts:17），这是测试层面的 L3 依赖：主题组件改名/改导出，multi-select 测试会失败，但生产代码不受影响。按判据属于“测试耦合”，不是源码硬耦合，但应记录。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| doc | inject + get | 必需 | src/multiSelectPlugin.ts:49、83 |
| selection | inject + get | 必需 | 同上:49、80 |
| nodeLayout | 组件内 get | 必需（BoxSelectLayer / SelectionFrame 直接 get） | src/BoxSelectLayer.vue:145；src/SelectionFrame.vue:143 |
| viewport | 组件内 get | 必需 | src/SelectionFrame.vue:181 |
| settings | 组件内 tryGet + onChange | 可选 | src/BoxSelectLayer.vue:39；src/SelectionFrame.vue:488-495 |
| command | tryGet，仅用于 execute('group:create') | 可选 | src/SelectionGroupToolbar.vue:42 |
| multi-select 服务 | Service 构造即上架 | 对外提供 | src/multiSelectPlugin.ts:74-77 |
| selection/region 注册场 | attach out:top | 对外提供 | 同上:132-138 |
| overlay 槽 | order 30 与 40 | — | 同上:115-126 |
| 命令 | mod+a / Escape | — | 同上:141-154 |

跨插件契约：

0. 主题色的落值路径要分清。multi-select 声明了 6 个颜色键（src/multiSelectConfig.ts:353-400），读取时按当前主题挑亮/暗格塞进 frameConfig.outer.color / inner.color / boxSelect.color（:451-485），frameStrokeCss 优先用 stroke.color（:628-645）。这条链是插件自读 settings，不依赖宿主色板。
   但宿主色板不包含这几格：themeColorSlots() 只列 canvas-render 自己的 token（packages/canvas-render/src/contracts/themePalette.ts:171），而落值只遍历 themeColorSlots（packages/canvas-render/src/host/themePaletteSettings.ts:61-72）。因此“清空颜色 = 跟随主题”走的是 CSS 兜底 var(--ui-select-*)（ui-theme.css:87-93），自定义色走 frameConfig 直读。两条路都能工作，但同一个“主题配色”页签里混了两种机制：其它颜色由宿主写 --uic-*，这三个颜色由插件自己读 key。主题作者若按色板文档去加 --uic-multi-select-*，不会生效。这是需要文档说明的隐性分歧。

1. 打组按钮调用 group:create 命令（src/SelectionGroupToolbar.vue:42）。这是命令 id 契约，且没有 when/存在性判断：group 未装时点击静默无操作。
2. 端口命中检测读主题类名 .moving-handle-anchor（src/SelectionFrame.vue:841；纯函数注释 batchConnect.ts:46-47 也承认这是主题通用端口标记）。这是 L3 实现细节：主题改类名，批量连线端口会被误判成框内空白，整组平移会抢走端口事件。
3. 多选隐藏标题读 multiSelectHideTitles 设置键，消费方在主题 BaseNode（packages/plugins/plugin-theme-default/src/components/node/BaseNode.vue:109-117、147-158）。这是 settings 全局平面命名的跨插件契约：键由 multi-select 声明，主题按裸名读取。
4. 选中数 > 1 时 align-guide 自动让位（packages/plugins/plugin-align-guide/src/AlignGuideOverlay.vue:46-51、83-86）。multi-select 不需要知道 align-guide，但两者共享“选中数”语义。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| document pointerdown/move/up（捕获） | 框选手势 | 高，全局捕获 | src/BoxSelectLayer.vue:184-186 |
| document.body.classList 'mc-pointer-down' | CSS 兜底 | 中，全局类 | src/pointerPress.ts:16、37、45 |
| window pointermove/pointerup | 整组拖动 | 高，全局监听 | src/SelectionFrame.vue:281-282、908-909 |
| .vue-flow / .vue-flow__viewport / .vue-flow__node / .vue-flow__edge / .vue-flow__handle / .vue-flow__controls / .vue-flow__minimap / .vue-flow__panel | 命中判定与事件转发 | 高，VueFlow 实现细节 | src/SelectionFrame.vue:826-831、1283-1284、1315-1338 |
| .csurface 根 | 捕获监听宿主 | 中，宿主类名 | src/SelectionFrame.vue:1315-1324 |
| .selection-frame-batch-slot | 自身 DOM 类名，用于跳过 | 低 | src/pointerPress.ts:35；src/SelectionFrame.vue:840 |
| .moving-handle-anchor | 主题端口类名 | 高，跨插件类名 | src/SelectionFrame.vue:841 |
| body:has(.dragging) CSS | 拖动中隐藏端口 | 中，依赖 VueFlow 状态类 | src/SelectionFrame.vue:1570-1574 |
| 无 localStorage / 固定 URL / 定时器 | — | 无 | 本包 src 检索为空（除 rAF 类无） |

SelectionFrame 1597 行里有 4 处 window 监听（:281-282、:908-909）；整个插件另有 BoxSelectLayer 的 3 处 document 捕获监听（src/BoxSelectLayer.vue:184-186）与 pointerPress 的 2 处 document 监听（src/pointerPress.ts:31、41），合计 9 处全局监听。这是本组最重的宿主粘连。

## 内部职责与风险

一个插件同时做：框选、群组框绘制、整组拖动、批量连线、打组按钮、快捷键、配置 schema（645 行）。职责明显超载。纯逻辑已拆出 multiSelectEngine / batchConnect / boxSelectGuard / dragFollow / selectionRegion，测试覆盖 157 例，是本组测试最厚的包；但 SelectionFrame.vue 的 DOM 生命周期、事件捕获顺序、与 VueFlow d3-zoom 的竞争没有组件级测试，只有渲染快照。

最危险的一条是捕获阶段 stopImmediatePropagation（src/SelectionFrame.vue:852、1311-1312、1331-1333）。它必须抢在 d3-zoom 之前，否则画布会跟着平移；代价是与任何未来在更早捕获阶段监听的插件互斥。目前没有其它插件在 .csurface 捕获 pointerdown，但这是一条隐式顺序契约。

另一条是框选结束后的 click 守卫：BoxSelectLayer 在 pane 的捕获阶段吞掉那次 click（src/BoxSelectLayer.vue:159、168-169、182），阻止宿主的 onPaneClick 清空选中（packages/canvas-render/src/host/CanvasHost.vue:654-658）。这是“插件知道宿主默认行为并主动拦截”的隐式契约；宿主若改 onPaneClick 的语义或换事件名，守卫会失效，用户表现为“框选后选中被清空”。

批量连线的合法性判定走 doc.transaction + connectEdge（src/SelectionFrame.vue 内 batch 落边逻辑；纯函数 planBatchApply 在 batchConnect.ts:266-285），与宿主单条连线共用同一守门人，这是正确方向。

## 单独装卸判断

可独立装卸，但卸载影响面大：align-guide 的多选让位逻辑仍按选中数工作（不依赖本插件）；group 的打组按钮消失；宿主 UI 的“多选上控制栏”槽位没有 occupant；整组拖动、批量连线、框选全部消失。装本插件不依赖其它插件，但打组按钮依赖 group:create 命令存在。

## 建议改法

1. 最小改动：把 .moving-handle-anchor 改为公开的 data 属性或能力查询（例如 node 端口 API），不要读主题类名。
2. 把 .vue-flow__* 选择器收进 canvas-render 的公开 DOM 契约（已有 viewport.getRootEl/getPaneEl/queryNodeEl，可继续扩展），插件只调服务。
3. 拆分 SelectionFrame：框选、群组框、整组拖动、批量连线各自独立组件/模块；先拆批量连线，它是独立能力。
4. 验证：补一条“主题改端口类名后批量连线仍可用”的契约测试，以及“group 未装时打组按钮禁用/提示”的测试。

## 待验证

- 已确认 .csurface 是公开结构：packages/canvas-render/src/host/CanvasSurface.vue:426 的根节点，packages/docs/canvas-render/z-index.md 与 canvas-host.md:110 都有层级说明。
- body:has(.dragging) 在目标浏览器（含 Firefox 旧版）的支持情况；未真机验证。这条是 CSS 兜底，即使失效也只影响拖动中端口显隐。
- 批量连线落边的事务代码在 SelectionFrame 1500+ 行区间，本次未逐行核对；只确认纯函数 planBatchApply 的语义。

