# canvas-core 侦察：host 运行时（Canvas.vue + runtime/ + composables/）

> 目标：为 canvas-core-v2（Cordis 式插件内核 + UI 插槽 + pinia + 统一 key-value 保存）摸清现状。
> 范围：`packages/canvas-core/src/Canvas.vue`、`runtime/`、`composables/` 及它们依赖的插件/registry 相关源码。
> 结论先行，代码 `file:line` 见行号。

---

## 0. 一句话现状

`Canvas.vue` 是一个 **真正的“上帝组件 / 聚合根”**：它把 VueFlow 实例创建、插件事务（PluginManager + createPluginContext + install）、多个 registry 实例化与 setRegistries、VueFlow 事件→eventBus 转发、pinia store 状态同步、设置面板注册、性能监控、快捷键管理、数据加载、DOM 尺寸监听 **全部手写在 `<script setup>` 一个 741 行文件里**。`runtime/` 只提供“装这些 registry 的袋子 + provide/inject”；绝大多数 `useCanvas*` composable 是**死代码**（半截重构没接上）。这正是 v2 想拆的对象。

---

## 1. Canvas.vue 到底承担了多少责任（逐条）

代码位置：`packages/canvas-core/src/Canvas.vue`

### 1.1 编排/装配层
1. **创建 VueFlow 实例**：`useVueFlow('main-canvas')`（L86），并解出 `getNodes/getEdges`（L87）、viewport 等。
2. **实例化所有注册中心**：`PluginManager`（L97）、`NodeRegistry`（L102）、`MenuRegistry`（L361）、`CommandRegistry`（L363）、`ToolbarRegistry`（L365）、`PanelRegistry`（L367）——全是 `new`，在组件里裸建。
3. **创建 runtime 袋子**：`new CanvasRuntime(manager, eventBus, nodeRegistry, menuRegistry, commandRegistry, toolbarRegistry, panelRegistry, vueFlowInstance)`（L369），再 `commandRegistry.setShortcutManager(...)`、`manager.setRegistries(...)`（L370-371）。全局 `CanvasRuntimeProvider` 包住整棵组件树（模板 L664）。
4. **装配 useCanvasConnection**：把 vueFlow 的 CRUD + viewport + eventBus + nodeRegistry.get 以 options 注入 `useCanvasConnection`（L107-118）。
5. **装配 useCanvasBootstrap / useCanvasPerformance**：前者注入 storage API getter + makeEdgeData（L378-382）；后者注入 `performancePanelEnabled` computed（L120-122）。
6. **装配设置面板 slot props**：`panelRegistry.getAll()` 派生成 `allSettings`/`groupedSettings`/`getSettingValue`（L52-69），经 `settings-panel` 具名插槽暴露（模板 L704）。

### 1.2 插件系统接线层
7. **调用 `manager.install(...)`**，在 `createContext` 闭包内为每个插件名调用 `createPluginContext(pluginName, {...})`，手工把 canvasStore/registries/连接态 ref 塞进 context（L445-466）。
8. **合并插件 options**：`{...plugin.options, ...pluginConfigs[p.name]}`（L447-450）——props 里的 `pluginConfigs` 覆盖插件自带 options。
9. **失败降级**：install 抛错时清空 `installedPluginNames`，console.error（L470-476）。
10. **反向卸载**：onUnmounted 按 `getLoadOrder().reverse()` 逐个 `manager.uninstall`（L646-655）。

### 1.3 VueFlow 事件 → eventBus 桥接层（模板 L681-695）
11. 把 `connect / connect-start / connect-end / nodes-change / edges-change / node-drag / node-drag-start / node-drag-stop / node-click / pane-click / pane-mouse-down / pane-mouse-up / pane-mouse-move` 逐个转发进 `manager.eventBus.emit(...)`。
12. 上下文菜单/双击类事件在 JS 侧封装后再 emit：`nodeDoubleClick`（L291-296）、`nodeContextMenu`（L298-303）、`paneContextMenu`（L305-310）、`edgeContextMenu`（L312-316）、`paneDoubleClick`（L318-324）。
13. 同时向 **window 派发 DOM 级 `CustomEvent('canvas:nodeDoubleClick')`**（L295）——双通道广播。

### 1.4 选中/删除状态同步层（VueFlow ↔ pinia）
14. `onNodesChange`/`onEdgesChange`：从 change 数组里拆 `remove`/`select`，写进 `canvas.selectionState.selectedNodeIds/Edges`（L220-283）。
15. `onSelectionChange`（来自 eventBus `selection:change`）回写 store（L153-158）。
16. `onCanvasSetFlag`：把插件发的 `canvas:setFlag` 事件写到 `canvas.state` 任意 key 或 `selectedNodeIds/Edges`（L160-179）——**这是“插件直接改全局 state 的可疑后门”**。
17. `onPaneClick`：清空 VueFlow 节点 `_overlay` 临时模式 + `canvas.clearSelection()` + emit `selection:clear`（L248-263）。

### 1.5 设置面板 / 性能 / 快捷键
18. **注册整批 core 设置项**到 panelRegistry（L485-563）：交互/视口/连线/端口/工具栏/节点/选框/性能/调试 九大类几十个 `registerCore(...)`。
19. **性能监控**：`useCanvasPerformance` + `<CanvasPerformancePanel>`（模板 L711-721）。
20. **快捷键双系统同步**（最硬编码处）：
    - 把 VueFlow 内置键位注册进 `ShortcutManager`（L585-606）；
    - `ShortcutManager.loadKeymap(keymap)`（L609-610）；
    - `syncVueFlowKeymap()` 把 store 的 shortcutKeymap 映射回 VueFlow 内部 refs `deleteKeyCode/selectionKeyCode/...`（L340-354, 612-613, watch L628-632）；
    - onUnmounted `ShortcutManager.exportKeymap()` 存回 `canvas.state.core.shortcutKeymap`（L643-644）。
21. **auto-layout zoom 联动**：`pushLayoutConfig()` 把 `core.minZoom/maxZoom` 推到 auto-layout 插件 API + watch（L615-625）。
22. **storage 状态刷新**：监听 6 个 `storage:*` 事件刷新 `storageState` ref（L570-577），并把 storage API 塞进 `canvasStorageApi` ref 后 provide（L580-583, L414-415）。
23. **数据加载**：`if (!skipDefaultLoad) await bootstrap.loadInitialCanvas()`（L480-482）。
24. **DOM/尺寸**：ResizeObserver + window.resize 更新 `canvasContainerSize`（L417-423, L185-191）。

### 1.6 总结：聚合了至少 5 个系统
| 系统 | Canvas.vue 里做的 |
|---|---|
| VueFlow | 实例化、refs 解构、props 全量透传、事件捕获 |
| 插件 | PluginManager 装配、context 工厂、install/uninstall/options 合并/降级 |
| Registry | 6 个 registry 的 new + setRegistries + 注册整批 core 设置项 |
| pinia store | VueFlow→store 选中/删除同步、canvas:setFlag 写 store、shortcutKeymap 持久化读写 |
| UI 侧 | 性能面板接线、SelectionFrame、右键拖拽 pan 开关、settings slot、storage/主题/布局状态 |

---

## 2. createPluginContext：context 是怎么造的、塞了什么

### 2.1 创建方式
- **工厂**：`packages/canvas-core/src/plugins/PluginContext.ts` 顶层导出 `createPluginContext(pluginName, options)`（L139）。
- **谁调用**：只有 `Canvas.vue`（L451）和死代码 `usePluginSystem.ts`（L24）在调。`PluginManager.install` 里经 `config.createContext ?? manager.contextFactory` 回调工厂（PluginManager.ts L97-98, L477-487）→ 由 **Canvas.vue 提供 contextFactory**（`createPluginContext` 闭包在 `manager.install({createContext})` 时传的）。
- 每次 `manager.install` 遍历拓扑序，对每个插件名各创建 **一个独立 context 实例**（PluginManager L123）。
- 注：context 内部模块级工厂 `createPluginStore/createActions/createViewport/createDomService` 是**每 context 新建**的（闭包捕获该插件名的 vueFlow/store），非单例。

### 2.2 context 字段完整清单（类型见 plugins/types.ts `PluginContext` L189-226）
| 字段 | 类型 | 内容 / 来源 |
|---|---|---|
| `canvasId` | string | 固定 `'main-canvas'`（Canvas.vue L452） |
| `store` | CanvasStoreAPI | `createPluginStore(pluginName, store,…)`：读写 `canvas.state.plugins[pluginName]` 命名空间（PluginContext L489-563） |
| `actions` | CanvasActions | `createActions(vueFlowInstance,…)`：addNodes/removeNodes/addEdges/removeEdges/updateNode/updateEdge/getNodes/getEdges/选中操作（L565-604） |
| `selection` | CanvasSelectionAPI | 封装 store 选中 state + 回写 VueFlow 选中（`syncSelectionToVueFlow` L180-256） |
| `viewport` | ViewportAPI | `createViewport(vf,…)`：zoom/setCenter/setViewport/screenToFlowCoordinate/getViewport（L606-650） |
| `logger` | Logger | 每插件前缀 `[pluginName]` 的 console 包装（L170-175） |
| `registerNodeType` | fn | 转发到 `store.registerCustomNodeType(name, component)`（L288-295）→ 写 pinia `customNodeTypes` |
| `registerEdgeType` | fn | 同上去 `registerCustomEdgeType`（L297-304） |
| `registerComponent` | fn | 存入 **context 内部** `registeredComponents` Map（L306-313，未暴露读取） |
| `canvasNodes` | CanvasNodeRegistryAPI | 转发到 NodeRegistry（L353-368） |
| `menus` | MenuRegistryAPI | 转发到 MenuRegistry（L323-339） |
| `commands` | CommandRegistryAPI | 转发到 CommandRegistry（L370-382） |
| `toolbars` | ToolbarRegistryAPI | 转发到 ToolbarRegistry（L384-390） |
| `panels` | PanelRegistryAPI | 转发到 PanelRegistry（L392-398） |
| `dom` | CanvasDomServiceAPI | `createDomService()` 每次 new 一个 CanvasDomService（L652-660） |
| `connectionState` | Ref | 来自 pinia `storeToRefs(canvas).connectionState`（Canvas.vue L47,L456） |
| `isConnecting` | ComputedRef | 同上，pinia 派生 computed（L457） |
| `canShowConnectionMenu` | ComputedRef | 同上（L458） |
| `registerHandleConfig` | fn | **直接写** `canvas.state.handleRadius/…` 8 个 core 字段（L341-351） |
| `on / off / emit` | fn | 事件总线接口，共享 `manager.eventBus` 单例（L261-272, L400-402） |
| `mountOverlay / unmountOverlay` | fn | DOM 级把元素 append 到 `.vue-flow__viewport/.vue-flow__renderer/#app`（L404-435） |
| `registerShortcut / unregisterShortcut` | fn | 注册到 **全局单例** `ShortcutManager.getInstance()`（L437-458） |
| `getPluginAPI<T>` | fn | `pluginManager.getPluginAPI(name)`（L460-467） |
| `getPlugin<T>` | fn | `pluginManager.getPlugin(name)`（deprecated，L469-479） |

> 关键：`on/emit/eventBus`、`ShortcutManager`、以及 `store.state`（pinia 单例）都是**跨插件共享的全局**，因此 context 之间通过这三者隐式耦合；`dom` 每次 new 不共享清理。

### 2.3 与 v2 相关的结构问题
- context 由“外部”Canvas.vue 闭包手工拼，字段来源分散（registries 来自 Canvas.vue，refs 来自 storeToRefs，eventBus 来自 manager）。**没有单一“内核/主机”可注入点**。
- `registerComponent` 存进 context 私有 Map，别的 context/UI 拿不到——注册通道断头。
- `mountOverlay` 用硬编码 CSS 选择器 `#app`、`.vue-flow__viewport`，且组件形态只打 warning 不实现——UI 插槽缺失。

---

## 3. runtime/ 各文件职责与依赖

`runtime/` 目前只是个“瘦包装”，真正逻辑都不在这。

| 文件 | 职责 | 依赖 |
|---|---|---|
| `CanvasRuntime.ts` | 只**持有** 7 个 registry/manager/vueFlow 的只读引用 + 转发 `getPluginAPI`。无任何业务逻辑（L16-53） | PluginManager/各 Registry/ShortcutManager（仅 import type + getInstance 未用） |
| `CanvasDomService.ts` | DOM 工具：`getPane/.vue-flow`、`getViewport/.vue-flow__viewport`、`onDocument/onWindow` 带清理栈 `cleanup()` | 全局 DOM，无依赖 |
| `CanvasEvents.ts` | 仅**类型**：事件名+payload 契约（NodeChange/EdgeChange/StorageStatus 等），供 `manager.eventBus.emit` 与 Canvas.vue 的 `.on` 类型化 | @vue-flow/core type、storage type |
| `CanvasRuntimeProvider.vue` | provide/scope：`provide(CanvasRuntimeKey, props.runtime)` + `<slot/>` | vue |
| `CanvasRuntimeKey.ts` | `InjectionKey<CanvasRuntime> = Symbol('canvasRuntime')` | vue |
| `useCanvasRuntime.ts` | `inject(CanvasRuntimeKey)`，找不到就 throw（要求必须在 Provider 内） | vue |
| `usePluginApi.ts` | `useCanvasRuntime().getPluginAPI<T>(name)` 便捷封装 | useCanvasRuntime |
| `index.ts` | barrel 导出 | — |

**依赖关系**：Provider/Key/inject 是 Vue DI 最小实现，但 `CanvasRuntime` 本体由 **Canvas.vue 手工 `new`** 并传入所有 registry——runtime 不是内核，只是“引用聚合 + 注入令牌”。真正读 runtime 的下游（组件/插件外）是用 `useCanvasRuntime()`/`usePluginApi()` 拿 registry。

---

## 4. composables：活的 vs 死的（重构时先分清）

### 4.1 活代码（被 Canvas.vue 使用，index 可达）
| composable | 职责 | 与 Canvas.vue 关系 |
|---|---|---|
| `useCanvasStore.ts` | pinia store 定义 + `usePluginStore(pluginName)` 命名空间存取器 | store 本体（见 §5） |
| `useCanvasConnection.ts` | 连接核心：拖线生命周期、吸附、验证（环/重复/类型）、批量连线、connectionState 管理、connection-line props（L247 起，1300 行） | Canvas.vue L107 注入 vueFlow CRUD + eventBus + nodeRegistry.get；读 `useCanvasStore()`、`state.core.handleRadius*` 等 |
| `useCanvasBootstrap.ts` | `loadInitialCanvas()`：从 storage 插件加载或 `createDefaultCanvasData()` 兜底 + fitView（L20-47） | Canvas.vue L378-382、L480-482 |
| `useCanvasPerformance.ts` | FPS/帧时长/longtask/内存采样，`watch(enabled)` 启停，rAF 循环（L25-130） | Canvas.vue L122，`enabled` 来自 store |

### 4.2 死代码（**codegraph_callers 均返回 No callers**；文件头自述“提取 Canvas.vue…需手动集成”）
| composable | 内容 | 判断 |
|---|---|---|
| `useCanvasFlow.ts` | 封装 useVueFlow + 用独立 LS key `canvas-data` 的 toObject/fromObject 持久化（与主数据流冲突） | 死。且其节点类型用 BaseNode、与 Canvas.vue 的 CustomNode 不一致 |
| `usePluginSystem.ts` | PluginManager 工厂 + install + shortcut 三件套（register/load/sync）+ uninstallAll | 死。**与 Canvas.vue L585-632 高度重复** |
| `useCanvasShortcuts.ts` | syncVueFlowKeymap/persistShortcutKeymap | 死。与 Canvas.vue 内联 duplicate |
| `useCanvasPanelState.ts` | storageState/themeState/layoutState 刷新（读 storage/theme/auto-layout API） | 死。storage 部分 Canvas.vue 内联 duplicate，theme/layout 走 panel API |
| `useTheme.ts` | themeState/applyPreset/applyCustom（依赖 usePluginSystem） | 死。因 usePluginSystem 死而无用 |

**重构意义**：v2 可以把 Canvas.vue 内联逻辑“真正”收敛到这些 composable（或直接由内核插件提供），而不是让 Canvas.vue 与死 composable 两套并存、互相 drift。

---

## 5. pinia useCanvasStore

文件：`useCanvasStore.ts`（defineStore `'canvasState'`，setup 风格，L126）。

### 5.1 state 结构
- `state`（ref 对象，**整体持久化**，L127-221）：
  - `state.core`：canvas-core 自己几十个全局设置（连线样式/工具栏偏移/节点标题/LOD/端口/多选框/性能面板/连线模式/节点交互/视口交互/shortcutKeymap），全部带默认值。
  - `state.plugins`：`Record<pluginName, Record<key,unknown>>`，插件命名空间（L220）。`createPluginStore` 读写这里，`usePluginStore(pluginName)`（L396-412）是组件侧同一命名空间的响应式 get/set。
- **不持久化**的非 ref 派生区：
  - `connectionState` ref（拖线状态，L251-260）
  - `isBoxSelecting`（L263）
  - `selectionState` ref（selectedNodeIds/Edges Set + selectionVersion，L266-271）
  - `nodeTypes/edgeTypes/customNodeTypes/customEdgeTypes` 均为 **shallowRef** + markRaw（L227-240）
- getters/actions：`setSelectedNodeIds/Edges`、`setSelection`、`clearSelection`、`applyNodeSelectChanges`、`applyEdgeSelectChanges`（Set 换新 + selectionVersion++，空转返回 false）；派生 `isConnecting`/`canShowConnectionMenu`（L346-356）；`registerCustomNodeType/EdgeType`（L242-248）。

### 5.2 持久化
- `useStorage('canvas-state', state, localStorage, { serializer })`（L223）。**整个 `state`（core + plugins）一个 key 存 localStorage**。
- `serializer`（L32-111）：`read` 补默认值（`numberOr` 兜底、ConnectionMode/SelectionMode 枚举映射、plugins 兜空对象）；`write` 把枚举转字符串。**selection/connectionState/nodeTypes 不参与持久化**。
- 由注释（L119-121）：nodes/edges **不走 pinia**，由 VueFlow 内部管 + Canvas.vue `toObject/fromObject`/storage 插件持久化。

### 5.3 读写方
- **Canvas.vue 直写 state.core**：模板里 VueFlow 每个 prop 都绑 `canvas.state.core.xxx`（L668-679），双击/快捷键/auto-layout 联动直接写 `state.core.*`。
- **VueFlow→store 同步**：Canvas.vue 事件处理器写 `selectionState`。
- **插件读 state.plugins**：经 context `store.get/set/watch/getState/toRef`（CanvasStoreAPI）。
- **registerCustomNodeType**：插件经 context `registerNodeType` → 写 `customNodeTypes` → Canvas.vue 的 watch（L198-209）合并进 `mergedNodeTypes` 喂 `<VueFlow :node-types>`。
- **读 storeToRefs**：Canvas.vue L47 `storeToRefs(canvas)` 取 connectionState/isConnecting/canShowConnectionMenu 传进 createPluginContext。

---

## 6. 耦合点清单（v2 里应改成“可注册/可注入/可插槽”的地方，重点）

按严重度从高到低标注 `⚠️高 / 中 / 低`。

### ⚠️高 1 — Canvas.vue = 聚合根，无“内核”可分
Canvas.vue 同时承担装配/事件桥/状态同步/UI 接线/生命周期，741 行 script。v2 需要把这些下沉到一个可独立测试的内核（host/engine），Canvas.vue 退化为“把内核 mount 到 DOM + 放 UI 插槽”。（§1）

### ⚠️高 2 — VueFlow 事件→eventBus 硬编码清单（模板 L681-695 + L291-324）
十几个事件名逐个手写 `@xxx="...emit('xxx', $event)"`。v2 应做成**声明式事件适配器/自动转发**（如事件名映射表或统一 onChange，加入新事件不再改模板）。

### ⚠️高 3 — 快捷键双系统硬同步（L335-354, L585-632, L643-644）
ShortcutManager ↔ VueFlow 内部 refs（deleteKeyCode 等）+ store.shortcutKeymap 三方单向硬编码映射，onUnmounted 手工回写。v2 应交给**插件/服务**做，而非 Canvas.vue。

### ⚠️高 4 — 整批 core 设置项硬注册（L485-563）
几十个 `registerCore('edgeLineWidth',{...})` 手写，设置 schema 与 `state.core` 默认值在 useCanvasStore L135-212 **重复定义**（两处都要改）。v2 应收敛为“一份声明（key+默认值+面板 schema）”统一驱动 store 初始化 + 面板 + 持久化。**这直接对应“统一 key-value 保存”诉求。**

### ⚠️高 5 — `canvas:setFlag` 后门直接写 store（L160-179）
插件用事件把任意 key 写进 `canvas.state` 顶层（含 `plugins` 外的 core 字段），无 schema/白名单校验。v2 应用 context 提供的白名单 setter/服务。

### 中 6 — UI 组件硬编码在模板
`<DynamicSettingsPanel>`（模板 L706）、`<CanvasPerformancePanel>`（L711）、`<SelectionFrame>`（L726）、settings-panel slot 都固定绑死，且 DynamicSettingsPanel 是 Teleport 到 body。v2 应暴露成可替换/可插槽的 UI 点；`mountOverlay` 的 `#app` 硬编码选择器也要改为运行时提供的挂载点。

### 中 7 — registry 由 Canvas.vue 手工 new + 手工 setRegistries/连线
NodeRegistry/MenuRegistry/CommandRegistry/ToolbarRegistry/PanelRegistry 都在组件里 `new`（L102/L361-367），再由 Canvas.vue 把相互引用手工拼好（L369-371）。v2 应由内核/DI 容器统一创建、注入并管理生命周期（自动 unregisterSource 清理）。

### 中 8 — storage / theme / auto-layout / 数据加载 “直连插件 API”
Canvas.vue 用 `manager.getPluginAPI('storage'|'auto-layout'|'theme')` + 事件监听刷新组件内 ref（L391-409, L570-577），theme/layout 状态在死 composable 里还各存一份。v2 应抽成统一可注入的 “panel/provider 服务”。

### 中 9 — 双份数据引导逻辑
`useCanvasBootstrap`（活）与 `useCanvasFlow.initCanvasData/persistCanvasData`（死，独立 LS key）对“加载/兜底”重复且策略不一。v2 应统一成单一数据加载服务（source 可插：localStorage / backend / MCP）。

### 中 10 — context 组装散落 + 断头通道
`createPluginContext` 字段由 Canvas.vue 闭包逐一手拼；`registerComponent` 只存私有 Map 无消费端；overlay 挂组件未实现。v2 中 context 应由内核装配，UI/组件注册有真正的 render 插槽消费。

### 低 11 — 事件契约散在 CanvasEvents.ts / types.ts / Canvas.vue 字符串
事件名既出现在 CanvasEvents 接口（类型）、又被 Canvas.vue 字符串 emit/on、还有 PluginContext.emit 的 string 签名。v2（Cordis 式）可统一为类型化事件键。

### 低 12 — DOM CustomEvent 双通道（L295）+ console.log 调试残留
nodeDoubleClick 同时走 eventBus 与 window CustomEvent；大量 `console.log`。归一到单一事件总线。

### 低 13 — 硬编码 DOM 常量
`CANVAS_ID='main-canvas'`、`#app`、`.vue-flow__viewport`、容器 100vw/100vh（L736-739）。v2 需支持多实例/挂载点配置。

### 低 14 — 现有可复用资产（别推倒重写）
- `createPluginContext` + `createPluginStore`（命名空间读写/`toRef`）已是 Cordis 式“服务注入 + 命名空间 state”雏形，`EventBus` 也是现成事件内核，可移植为 v2 内核。
- `PluginManager` 的 Kahn 拓扑/循环依赖/生命周期状态机/回滚已相当完善，v2 可保留。
- 死 composable（usePluginSystem/useCanvasFlow/useCanvasShortcuts/useCanvasPanelState/useTheme）里的实现与 Canvas.vue 重复，**可作为 v2 抽走 Canvas.vue 逻辑的起点**而非丢弃。

---

## 附：关键文件:line 索引
| 关注点 | 位置 |
|---|---|
| PluginContext 接口全字段 | `plugins/types.ts:189-226` |
| createPluginContext 实现 | `plugins/PluginContext.ts:139-483` |
| createPluginStore（plugins 命名空间） | `plugins/PluginContext.ts:489-563` |
| createActions/createViewport/createDomService | `plugins/PluginContext.ts:565-660` |
| EventBus | `plugins/PluginContext.ts:58-97` |
| PluginManager install/uninstall/拓扑/生命周期 | `plugins/PluginManager.ts:96-618` |
| CanvasRuntime（registry 袋子） | `runtime/CanvasRuntime.ts:16-53` |
| pinia store + serializer | `composables/useCanvasStore.ts:126-378, 32-111` |
| store 的 core 默认值（与 Canvas.vue 面板重复处） | `composables/useCanvasStore.ts:135-212` |
| Canvas.vue 装配/插件 install | `Canvas.vue:97-130, 445-466` |
| Canvas.vue 事件桥（模板） | `Canvas.vue:681-695` |
| Canvas.vue core 面板硬注册 | `Canvas.vue:485-563` |
| Canvas.vue 快捷键同步 | `Canvas.vue:335-354, 585-632, 643-644` |
| Canvas.vue onUnmounted 清理 | `Canvas.vue:636-660` |
