# canvas-core-v2 侦察：UI 多插槽位 + 插件可注册

> 调查对象：`packages/canvas-core`（src 下 registry / Canvas.vue / components / plugins / nodes）
> 目的：为"v2 重构：UI 多插槽位 + 插件可注册"梳理现有挂载位、registry 形状与建议固化插槽。
> 侦察方式：codegraph MCP（projectPath=`D:/Code/Git/mini-canvas`）+ read_file 逐文件核实，file:line 均为实测。

---

## 0. 核心架构一句话

节点 / 画布 / 设置面板 / 右键菜单四块 UI 都由 **registry（reactive Map，集中注册项）** 提供数据，再由一组**固定渲染组件**（CustomNode / BaseNode / BaseToolbar / DynamicSettingsPanel / CanvasMenu / NodeToolbar）消费并把"每条注册项"循环渲染成 UI。所谓"插槽"目前是两层混着用：

1. **节点内部的 Vue 具名插槽**（BaseNode 暴露 `#top-toolbar/#title/#content/#bottom-toolbar` 等），**只对节点类型内部分段有效**，不对第三方插件开放。
2. **registry 数据槽位**（按 `id/area/position/group` 筛选），由 registry → 渲染组件消费，这是**插件实际注入 UI 的唯一通道**。

v2 要做的"命名插槽（registry → provider → slot）"，本质是把第 2 层的筛选规则抽象成**稳定命名的 slot 名字空间**，让"往哪注册"和"注册了什么"一一对应，避免散落的 `position: 'top'` / `areas: ['pane']` / `group` 隐式约定。

---

## 1. UI 挂载/渲染点清单（每处：谁提供、谁注册、渲染原理、位置）

### 1.1 设置面板（右侧 Settings）
- **渲染组件**：`components/Panel/DynamicSettingsPanel.vue`（折叠胶囊面板）。
- **数据来源**：`PanelRegistry`（见 §2.6）。
- **挂载**：`Canvas.vue:703-709` — 包在 `<Teleport to="body">` 里，外层再套一个 **具名 slot `#settings-panel`**（带 `settings/grouped-settings/get-value` props），**默认内容才是 DynamicSettingsPanel** → 外部宿主可整体替换/重写面板。
- **遍历/渲染原理**：Canvas.vue:55-63 先把 `panelRegistry.getAll()` 按 `group` 分组 `groupedSettings`；DynamicSettingsPanel.vue:29-39 双重 `v-for` 遍历分组→条目，每条丢给 `DynamicSettingField`。
- **双向绑定原理**：DynamicSettingsPanel.vue:36 `v-model="getValue(setting.id).value"`；`getValue` 在 Canvas.vue:66-69 调 `panelRegistry.useValue(id, canvas.state, defaultValue)`（PanelRegistry.ts:86-194）返回一个 **computed Ref，读写 `canvas.state.core|plugins.<ns>.<path>`**。`DynamicSettingField.vue:19-29` 把 v-model 桥到具体 `Ax` 控件（text/number→AxInput、boolean→AxSwitch、select→AxSelect、color→原生 input、slider→AxSlider，第 48-72 行）。
- **谁往里面注册**：core 自己在 Canvas.vue:486-563 批量 `registerCore(...)`；插件在 install 里调 `context.panels.registerSetting(source, setting)`（见 context-menu 插件 ContextMenuPlugin.ts:132-140 示例）。

### 1.2 画布 VueFlow（Canvas）
- **渲染组件**：`Canvas.vue` 的 `<VueFlow>`（666-700 行），组装 node-types/edge-types、事件转发。
- **数据来源**：节点类型来自 Pinia `canvas.nodeTypes` + 插件 `registerCustomNodeType`（context 代理 PluginContext.ts:288-295）+ NodeRegistry 的 `node` 组件字段（CustomNode 里读取）。
- **挂载**：Canvas.vue:664 `<CanvasRuntimeProvider>` 包住整个 `.canvas-container` → 提供 `runtime`（所有 registry 实例）给子树 inject（useCanvasRuntime.ts:5-8）。
- **外层还有一个具名 slot 体系**：Canvas.vue 模板里只有一个 `#settings-panel` slot（703）。**VueFlow 区域本身没有对外 slot** —— 插件想要在画布上叠东西用 §1.6 的 `mountOverlay`。
- **渲染原理**：`mergedNodeTypes`（Canvas.vue:195-209）把所有类型 markRaw 后传给 `<VueFlow :node-types>`；节点实例统一是 `type:'custom'`，data.nodeType 区分业务类型。

### 1.3 节点内部分段（title / top-toolbar / content / bottom-toolbar）
两条渲染路径，都由 `CustomNode.vue` 决定走哪条：

- **组装路径（非 selfRender）**：`CustomNode.vue:54-74` 包 `<BaseNode>`，按 `nodeDef` 的 `topToolbar/bottomToolbar` 字段决定：
  - 有自定义组件 → `<NodeToolbar :position><component :is="topToolbar"/></NodeToolbar>`；
  - 没有 → 渲染 registry 驱动的默认 `<BaseToolbar toolbar-position="top|bottom">`（CustomNode.vue:57-72）。
  - 内容组件 `nodeDef.node` 被塞进 `<template #content>`（63-65）。
- **自渲染路径（selfRender:true，如图片/视频）**：CustomNode.vue:53 直接 `<component :is="ContentComponent">`，节点组件（ImageNode.vue:332-421）自己包 `<BaseNode>` 自己填各 slot，**registry 的 node 定义里 `topToolbar/bottomToolbar/titleIcon` 字段被忽略**（NodeRegistry.ts:36-38 注释）。
- **BaseNode 提供的具名插槽**（BaseNode.vue 模板 527/538/540-565/556/561/592/619）：
  `#top-toolbar`、`#title`(内含 `#title-icon`/`#title-label`/`#title-extra` 透传给 BaseTitle)、`#content`、`#bottom-toolbar`。
- **数据来源**：组装路径里默认工具栏按钮来自 `ToolbarRegistry`（BaseToolbar.vue:37 `runtime.toolbarRegistry.getByPosition`）；`titleIcon` 来自 `NodeRegistry.get(type).titleIcon`（BaseNode.vue:539 传给 BaseTitle）。

### 1.4 节点工具栏（NodeToolbar / BaseToolbar）
- **NodeToolbar.vue**：定位浮层原语，`<Teleport to=viewportRef>`（106 行）+ `isActive`（选中才显示，46-52）+ 按 position/offset 算 transform（58-102）。它是"把任意内容挂在节点旁"的通用容器。
- **BaseToolbar.vue**：真正消费 `ToolbarRegistry` 的渲染组件。
  - `visibleButtons`（35-51）：`toolbarRegistry.getByPosition(top|bottom)` → 过滤 `source==='multi-select'`、`nodeTypes` 匹配当前 nodeType、`group` 匹配 `_overlay._toolbarGroup`（用于裁剪/扩展/蒙版切组）。
  - 渲染（120-144）：每按钮 → `<ToolbarButton>`，`icon` 支持字符串 SVG 或组件（ToolbarButton 内部），`customRender` 可整体换按钮；点击执行 `commandId`。
- **谁注册**：节点插件 `context.toolbars.register(source, button)`（image 示例 ImageNodePlugin.ts:665-686，按 `group:default/crop/mask/expand` + `position:top|bottom` + `nodeTypes`）。
- **`_overlay._toolbarGroup` 切组机制**：节点进入裁剪/扩展/蒙版等模式时，命令把 `_overlay._toolbarGroup='crop'|'expand'|'mask'` 写进 node.data（ImageNodePlugin.ts:240-252、342-354、448-458），BaseToolbar 据此只显示匹配 group 的按钮；同一节点在不同编辑模式下展示不同工具栏按钮。**这是"动态换 UI"的雏形，v2 应升级为显式 overlay-slot**。

### 1.5 右键菜单（ContextMenu）
- **数据来源**：`MenuRegistry` + `NodeRegistry.getMenuItems()`（两类合并，见 §2.3）。
- **渲染组件**：`CanvasMenu.vue`（纯展示，接收 `CanvasMenuState` props + select/close 事件）。
- **谁提供挂载**：右键菜单**不在 Canvas.vue 模板里**，由 **context-menu 插件自己动态 createApp 挂载**：ContextMenuPlugin.ts:389-392 `document.body.appendChild(containerEl)` + `createApp(... h(CanvasMenu,...))`。这也是"root 层浮层"的另一种实现（区别于 mountOverlay）。
- **注册**：`context.menus.register(source, item)`（见 image 插件 ImageNodePlugin.ts:661）；内置项在 `builtinMenuItems.ts`（`registerBuiltinMenuItems`，ContextMenuPlugin.ts:126 调用）。
- **筛选/渲染原理**：ContextMenuPlugin.ts 的 `resolveItems`（19-90）按 mode（pane/node/edge/connection）取 `menus.getAll()` 过滤 `areas`/`nodeTypes`，拼上 NodeRegistry 的"创建节点"项；`onMenuSelect`（249-306）有 `commandId` 就执行命令、否则 `createNode` 建节点。菜单显示由各事件驱动：paneContextMenu/nodeContextMenu/edgeContextMenu/paneDoubleClick/connectionContextMenu/connectionRelease（308-376）。

### 1.6 浮层挂载原语（mountOverlay）
- **谁提供**：PluginContext.ts:404-435 `context.mountOverlay(el, target)` / `unmountOverlay`。目标层映射（407-410）：
  - `viewport` → `document.querySelector('.vue-flow__viewport')`
  - `canvas` → `.vue-flow__renderer`
  - `root` → `#app`
- **限制**：**只支持 `HTMLElement`，组件（Component）只打 warn 不支持**（416-417 行注释"not yet implemented"）。
- **DOM 服务**：`CanvasDomService`（runtime/CanvasDomService.ts:4-10）额外提供 `getPane()`=`.vue-flow`、`getViewport()`=`.vue-flow__viewport` 查询 + document/window 事件订阅。
- **谁注册**：目前**实际没人用 `mountOverlay`**（codegraph 搜无调用方）；浮层类 UI 都走各自私有方案（context-menu 自建 app、节点 Teleport to body 如 ImageNode.vue:424、全屏 Dialog 等）。**这是个"设计了但空置"的 API，v2 正好接管**。

### 1.7 performance / 小地图等杂项浮层
- **Performance**：`CanvasPerformancePanel.vue`（渲染）+ `useCanvasPerformance` 采集 + `Canvas.vue:711-721` **直接硬编码挂载**（不是 registry、没有 slot）。开关/显示项来自 core 设置（performancePanelEnabled 等，Canvas.vue:557-559）。
- **SelectionFrame（多选框）**：Canvas.vue:726-728 硬编码 `v-if>1` 挂载；`plugins/multi-select/SelectionFrame.vue`。
- **No minimap 内置**（VueFlow 自带可加，未见注册）。
- **DialogRegistry**：`registry/DialogRegistry.ts` 已定义（id + component），但 **codegraph 全库仅自身文件出现、无人实例化/消费**（见 §2.7）——死代码，v2 可删或激活成 dialog-slot。

---

## 2. registry 数据结构与注册项形状

统一底层：**类持有 `reactive(Map)`，key 是注册项 id；注册=set、同 id 覆盖（打 warn）；注销按 id 或按 source 批量；查询 getAll/getByXxx 排序返回**。命名空间/值隔离规则见 §3。

统一差异：`id`+`source` 是公共底子（BaseRegistryItem, types.ts:23-30），另带 `order`/`group`/`visible?`/`disabled?`。

### 2.1 NodeRegistry（节点类型 + 创建菜单）
- 文件：`registry/NodeRegistry.ts`。定义 `Map<string, CanvasNodeDefinition>`。
- 字段（NodeRegistry.ts:12-39）：`type/node/label/defaultSize/menuItem/canReceiveInput/canProduceOutput/acceptsInputs/resizable/topToolbar/bottomToolbar/titleIcon/selfRender/source/order`。
- API：register/unregister/get/getAllTypes/getDefaultSize/getLabel/canReceiveInput/canProduceOutput/getAcceptsInputs/isResizable/getMenuItems。
- **最小例子**（TextNode 思路，非自渲染）：
  ```ts
  context.canvasNodes.register({
    type: 'text', node: markRaw(TextNode), label: '文本',
    defaultSize: { cardWidth: 240, cardHeight: 120 },
    menuItem: { label: '文本', icon: textSvg },
    canReceiveInput: true, canProduceOutput: true,
    // 不写 topToolbar/bottomToolbar → 用 registry 驱动的默认 BaseToolbar
  })
  ```
- **自渲染节点例子**（ImageNodePlugin.ts:630-639）：多加 `topToolbar/bottomToolbar`（此处省略，因其 selfRender:true 会被忽略）与 `selfRender:true`、`acceptsInputs:['image','text']`。

### 2.2 CommandRegistry（命令中枢）
- 文件：`registry/CommandRegistry.ts`。`Map<string, CanvasCommand>`（CanvasCommand=types.ts:32-46，扩展了 run/priority/nodeTypes/areas/dropdown/customRender/keybinding）。
- API：register/unregister/unregisterSource/execute/canExecute/has/get/getPublic/getAll；`setShortcutManager`（注册 keybinding 命令时自动绑快捷键，register 内 42-56）。
- 最小例子：
  ```ts
  context.commands.register({ id: 'image.crop', source: 'node:image',
    title: '裁剪', run: handleImageCrop })
  ```
- 被菜单/toolbar/快捷键**通过 commandId 间接执行**；不是"直接渲染 UI"，是动作槽。

### 2.3 MenuRegistry（右键菜单项）
- 文件：`registry/MenuRegistry.ts`。`reactive Map<string, {source,item}>`，item 带 source 副本。
- 字段：`MenuItemDefinition`（types.ts:48-61）= BaseRegistryItem + `commandId/title/description/icon/areas/nodeTypes/dropdown/customRender/danger/shortcut`。
- API：register(source,item)/unregister/unregisterSource/getAll/getByArea（按 `areas` 过滤 + order 排序，57-65）。
- **注意两份解析器并存**：MenuRegistry.ts 自带 `resolveMenuItems`（154-197，读 NodeRegistry.createNodeItems + MenuRegistry.getByArea）；context-menu 插件里又有**另一份独立 resolveItems**（ContextMenuPlugin.ts:19-90）直接读 `menus.getAll()` 手工过滤。**两套逻辑重复，v2 应收敛到一份**。
- 最小例子：
  ```ts
  context.menus.register('node:image', { id: 'image:download', source: 'node:image',
    commandId: 'image.download', title: '下载', icon: downloadSvg, areas: ['node'], nodeTypes: ['image'], order: 40 })
  ```

### 2.4 ToolbarRegistry（节点工具栏按钮）
- 文件：`registry/ToolbarRegistry.ts`。`reactive Map<string, ToolbarButtonDefinition>`。
- 字段：`ToolbarButtonDefinition`（types.ts:72-82）= BaseRegistryItem + `commandId/title/icon/position:'top'|'bottom'/nodeTypes/tooltip/dropdown/customRender/danger`。
- API：register(source,btn)/unregister/unregisterSource/getByPosition(top|bottom)/getAll（getByPosition 按 order 排，44-50）。
- 最小例子（ImageNodePlugin.ts:665 裁剪按钮）：
  ```ts
  context.toolbars.register('node:image', { id: 'image.crop', source: 'node:image',
    commandId: 'image.crop', position: 'top', title: '裁剪', icon: cropSvg,
    tooltip: '裁剪图片', nodeTypes: ['image'], group: 'default', order: 20 })
  ```

### 2.5 PanelRegistry（全局设置项）
- 文件：`registry/PanelRegistry.ts`。`reactive Map<string, PanelSettingDefinition>`。
- 字段：`PanelSettingDefinition`（types.ts:84-93）= BaseRegistryItem + `title/type('text'|'number'|'boolean'|'select'|'color'|'slider')/defaultValue/options/min/max/step`。
- API：registerSetting(source,setting)/unregisterSetting/unregisterSource/getAll/getBySource/**useValue**（86-194，见 §1.1，dotted-path 双向绑定，`core.*` 走 `state.core`，否则走 `state.plugins.<ns>`）。
- 最小例子（Canvas.vue:494）：
  ```ts
  panelRegistry.registerSetting('canvas-core', { id: 'core.nodesDraggable',
    title: '可拖拽', type: 'boolean', group: '交互', order: 10, defaultValue: true })
  ```

### 2.6 挂到哪 / 值存哪（命名空间规则 —— registry 唯一的"源"隔离）
- 所有 register API 第一参都叫 `source`（插件名或 'canvas-core'），用于 `unregisterSource` 批量卸载（插件 uninstall 时调用）。
- 面板值隔离规则（PanelRegistry.ts:97-104）：id 第一段 `core` → `canvas.state.core`；否则 → `canvas.state.plugins.<第一段>`（即插件命名空间）。
- 其它 registry 的注册项虽带 source，但**只用来卸载，不做渲染隔离**——渲染全量混在一起靠 `position/group/nodeTypes/areas` 筛。

### 2.7 DialogRegistry（未被接线）
- 文件：`registry/DialogRegistry.ts`，`DialogDefinition={id, component, title?}`（3-7）。API：register(source,def)/unregisterSource/getAll。
- **codegraph 全库检索：仅 DialogRegistry.ts:9 一处，无实例化、无 Consumer、未进 CanvasRuntime / Canvas.vue / PluginContext**（对比其它 registry 都在 CanvasRuntime 构造 + createPluginContext 暴露）。**当前是悬空代码**。

---

## 3. "谁注册 → 谁渲染" 对照速查

| UI 槽位 | 注册通道 | 渲染组件/位置 | 筛选键 | 值/状态挂载点 |
|---|---|---|---|---|
| 全局设置 | `context.panels.registerSetting` | DynamicSettingsPanel | `group` | `state.core.*` / `state.plugins.<ns>.*` |
| 创建节点(右键) | NodeRegistry `menuItem` | MenuRegistry.resolveMenuItems / ContextMenu resolveItems | — | — |
| 右键菜单操作项 | `context.menus.register` | CanvasMenu | `areas`+`nodeTypes` | commandId 执行 |
| 节点上/下工具栏按钮 | `context.toolbars.register` | BaseToolbar | `position`+`nodeTypes`+`group(_toolbarGroup)` | commandId 执行 |
| 节点自定义工具栏组件 | NodeRegistry `topToolbar/bottomToolbar` | CustomNode → NodeToolbar | nodeType | 组件自带 props/data |
| 节点内容组件 | NodeRegistry `node` | CustomNode #content / BaseNode | nodeType | data.* |
| 节点标题 | NodeRegistry `titleIcon` + data.label | BaseTitle(#title-icon/#title-label/#title-extra) | nodeType | data.label |
| 自定义命令 | `context.commands.register` | 被 menu/toolbar/shortcut 间接执行 | — | — |
| 画布浮层 | `context.mountOverlay` | 自建元素(空置) | target: viewport/canvas/root | — |
| 右键菜单浮层 | 自建 createApp | CanvasMenu | — | — |
| 性能面板 | —(硬编码) | Canvas.vue | core 开关 | state.core |
| 多选框 | —(硬编码) | SelectionFrame | 选中数>1 | selectionState |
| Dialog | (无) | DialogRegistry(死) | — | — |

---

## 4. v2 建议：固化为命名插槽（registry → provider → slot）

### 4.1 原则
现有注册项已经"带筛选语义"，v2 不改数据本质，只把**隐式的筛选约定（position/group/areas/nodeTypes）**显式化为**slot 名字 + provider 接口**，并让 provider 生成 slot 给渲染组件/外部宿主使用。一个 slot 应能回答：**注册时填哪个 slot 名 → 渲染层如何找到 provider → 默认渲染组件是什么**。

### 4.2 建议 slot 名集合

**画布级（Canvas 提供）**
- `settings:`（默认渲染 DynamicSettingsPanel）— 已具名 `#settings-panel`(Canvas.vue:704)，v2 固化为规范接口。
- `canvas:statusbar` / `canvas:toolbox` / `canvas:minimap`（现无，可选新增）。
- `canvas:perf`（现 Canvas.vue:711 硬编码，改 registry 驱动）。

**浮层级**
- `overlay:viewport` / `overlay:canvas` / `overlay:root`（对应 mountOverlay 三 target，PluginContext.ts:404-435）——**接管现有的空置 API**，并补上"Component 也可挂"。

**右键菜单级**
- `context-menu:create`（NodeRegistry 创建项）
- `context-menu:{mode}` mode ∈ pane/node/edge/connection（替代散落的 `areas`）

**节点级（按 nodeType 命名空间）**
- `node:{type}:title`（含 title-icon/label/extra）
- `node:{type}:top-toolbar`
- `node:{type}:content`
- `node:{type}:bottom-toolbar`
- `node:{type}:overlay:{mode}`（如 `node:image:overlay:crop|expand|mask` —— 把现有 `_overlay._toolbarGroup` 切组机制固化为显式 overlay-slot，ImageNodePlugin.ts:240 起）

**通用工具栏/面板级**
- `toolbar:{position}` position∈top/bottom（对应 ToolbarRegistry）
- `command:{id}`（动作槽，现有命令机制即可视为已固化）

### 4.3 provider 形状（示意，供设计参考）
```
uiSlotProvider.render('node:image:top-toolbar', ctx)   // → 由 ToolbarRegistry 拿按钮 vnode
  ├─ resolve('node:image:top-toolbar')
  │    = { source:'node:image', position:'top', nodeType:'image' }
  └─ 匹配 ToolbarButtonDefinition，缺省组件 = BaseToolbar
```
建议**注册时显式携带 slot 名**（新增可选字段 `slot?: string`），渲染层 `resolveSlot(def)` 返回默认组件 + 该 slot 的数据查询器，从而一份注册项既能进默认渲染组件，也能被外部宿主通过具名 slot 替换/增强。

### 4.4 设计注意/坑
1. **两份菜单解析器重复**（MenuRegistry.ts:resolveMenuItems vs ContextMenuPlugin.ts:resolveItems）→ v2 收拢成单一 resolver。
2. **NodeRegistry topToolbar/bottomToolbar 字段只在非 selfRender 路径生效**（NodeRegistry.ts:36-38、CustomNode.vue:57-72），selfRender 节点(图片/视频)完全绕开 registry 组件字段，各自在 .vue 里写死 BaseToolbar —— **v2 应让 selfRender 也走统一 toolbar-provider**，否则插件无法给已有自渲染节点追加工具栏按钮/分段。
3. **Toolbar 用 `source==='multi-select'` 特殊过滤**（BaseToolbar.vue:39-42）判断多选框模式，很脆；应改为显式 `scope`/slot 名。
4. **group 语义是"编辑模式"而非视觉分组**（BaseToolbar 拿 group 匹配 `_toolbarGroup`），与设置面板里 group 是"折叠分组名"含义不同 —— 命名时别混用。
5. **mountOverlay 空置 + 组件不支持**（PluginContext.ts:404-435）；DialogRegistry 是死代码（§2.7）——v2 要么启用要么删除，别留悬空 API。
6. `reactive(Map)` 是现有注册自动触发 Vue 重渲染的关键（各 registry 用 reactive），v2 若换实现须保留"注册即响应式"语义。
