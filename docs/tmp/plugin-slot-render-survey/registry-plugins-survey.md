# plugin 系统现状侦察：注册表 + 插件装配（registry & plugins survey）

> 目的：为"nodeRegistry/themeRegistry 接入多 occupant 槽语义 + 散装注册函数收口挂 ctx.nodes/ctx.theme"提供现状事实。
> 覆盖：canvas-core-v2 的 registry 目录、四个存量插件包、core 类型、消费方。
> 侦察方式：codegraph MCP（文件树/符号/调用点）+ 精确 Read + 局部 grep 兜底（codegraph 索引对 nodeRenderer.ts/nodeRegistry.ts 过期未收）。
> 范围：**canvas-core-v2 与其消费者 canvas-render / demo-web**。仓库根 `src/` 走的是旧 v1 `@mini-canvas/canvas-core`，与 v2 无耦合（见 §5）。

---

## §1 canvas-core-v2 registry 目录现状

路径前缀均为 `packages/canvas-core-v2/src/core/registry/`。

### 1.1 slotRegistry.ts —— 已存在的"多 occupant 槽"容器（纯逻辑零 Vue）
- 导出 `SlotRegistry`(class)、`SlotEntry`、`SlotAddRequest`、`SlotName`。
- 语义（行 44-131）：每槽一个 `Map<string, SlotEntry>`，occupant 带 `{id, order, value}`。
  - `add(slot, req)`：有 id 且槽内已存在→**替换**；无 id→自动分配 `{slot}#{n}` 并**追加**；order 默认取槽内 size。
  - `remove(slot, id)`：删单 occupant，槽空则回收整槽。
  - `list(slot)`：全部 occupant 按 order 稳定排序。
  - `first(slot)`：single 语义（order 最小，即"单赢家"槽当前项）。
  - `get/has/slots/clear/ids`。
- 文档头（行 1-18）**明言目标 1**：要把 themeRegistry/nodeRegistry 从"单格 map、一槽一组件、重复抛错"升级成这套多 occupant 语义。
- 已在 core `index.ts`（行 14-15）导出，但**尚未被 nodeRegistry/themeRegistry 采用**。

### 1.2 nodeRegistry.ts —— 节点"展示"注册表（现仍是单格 map，未用 SlotRegistry）
- 导出 `NodeSegment`（'content'|'title'|'top-toolbar'|'bottom-toolbar'，行 16）、`NodePresentation`（`{type, segments}`，行 19）、`NodeRegistry`(class)。
- 内部结构：`private byType = Map<string, NodePresentation>`（单 type → 一整份 segments，行 28）——**按 type 一格，不是按"段"建槽**。
- `register(type, segments)`：type 重复**抛错**（行 31-36）；`unregister/delete`、`set`（覆盖式）、`get/has/types`。
- 定位注释（行 4-13）：只做"type → 各段用什么组件"，数据形状归 nodeStore.registerType。
- **未 import 未使用 SlotRegistry**。注册/移除都是整 type 粒度，无 per-segment occupant/order/id。

### 1.3 themeRegistry.ts —— 主题/外观注册表（现仍是单格 map，未用 SlotRegistry）
- 导出 `ThemeSlot`（'nodeShell'|'edge'|'edgeDefaultType'|'background'|'connectionLine'，行 19）、`ThemePresentation`、`ThemeRegistry`(class)。
- 内部结构：`private bySlot = Map<ThemeSlot, unknown>`（行 34）——**一槽一个值**。
- `register(slot,value)`：槽重复**抛错**（行 37-42）；`unregister/delete`、`set`（覆盖）、`get/has/slots`。
- **未使用 SlotRegistry**。单格 + 防覆盖抛错，正是文档想改掉的老语义。

### 1.4 registerNodeType.ts —— 散装节点注册函数（现状挂在 ctx 外部、不在 ctx.nodes 上）
- 导出 `NodeTypeDef`(interface，行 25-34：type/label/defaultSize/segments/inputs/outputs)、`registerNodeType(ctx, def): revoke`（行 45）。
- 行为：`ctx.get('nodeStore')` 落数据注册表（registerType），`safeGet(ctx,'nodeRegistry')` 落展示段（register）；两层 revoke 经 `ctx.effect(() => revoke)` 挂进当前插件 scope（行 70），scope.dispose 时自动双注销。
- 形参是 `ctx: PluginScope`，**函数独立导出、不是 ctx.nodes.xxx 方法**。收口目标是把它并成 `ctx.nodes.registerType(...)` 之类。
- 用 `safeGet` 吞异常，nodeRegistry 未注入时静默只落数据（行 60-64, 74-81）。

### 1.5 registerThemeSlot.ts —— 散装主题槽注册函数
- 导出 `registerThemeSlot(ctx, slot: ThemeSlot, value): revoke`（行 22-28）。
- 行为：`safeGet(ctx,'themeRegistry')` → `theme.register(slot,value)`，revoke 经 ctx.effect 挂 scope。
- 独立函数、`ctx: PluginScope`，非 ctx.theme 方法。收口目标是并成 `ctx.theme.registerSlot(...)`。

### 1.6 nodeRenderer.ts —— NodeRenderer 解析器（消费 NodeRegistry，纯函数）
- 导出 `resolveSegment(registry, type, segment)`（行 16）：`registry.get(type)?.segments[segment]` → 组件句柄或 undefined。
- `hasContent`（行 21）、`activeSegments`（行 28）：type 有组件句柄的段列表。
- 说明：nodeRenderer 只依赖 NodeRegistry 当前的单格结构；若 nodeRegistry 改成"段为槽 + 多 occupant"，此解析器是**主要需改造/或换用 SlotRegistry.list/first 的消费点**。
- 已从 core `index.ts` 导出（行 8）。**当前唯一真消费方是插件包 plugin-theme-default 的 BaseNode.vue**（见 §4）；测试 `registry/__tests__/registerNodeType.test.ts` 也 import 它。

---

## §2 core 类型：PluginModule / PluginScope 精确形态

文件 `packages/canvas-core-v2/src/core/types.ts`。

- `PluginModule<TConfig>`（行 76-88）：字段只有 `name: string`、`deps?: string[]`、`setup(ctx): void|(()=>void)|Disposable`、`config?: TConfig`。
  **没有 `apply`**——入口统一是 `setup(ctx)`。所谓"apply(ctx) 里调一次 registerNodeType"是 registerNodeType.ts 头注释的提法，实际实现都在各插件 `setup(ctx)` 里调用。
- `PluginScope`（行 56-70）：`on/once/emit/effect/inject/get/plugin`。副作用（on/effect/inject 的 revoke）自动登记进本插件 scope；卸载 scope.dispose 自动清。
  **没有 `ctx.nodes` / `ctx.theme` 属性**——目前访问注册表全靠 `ctx.get('nodeRegistry')` / `ctx.get('themeRegistry')`（字符串键，服务表方式）。收口 = 给 PluginScope/Context 加 nodes/theme 门面。
- `Context`（`Context.ts`）：`plugin/start/stop/installPlugin/uninstallPlugin/listPlugins/inject/get/on/once/emit/effect`；`deriveScope`（行 229）给每个插件造 PluginScope。服务注册表是根 `Map<string,unknown>`（services），插件 scope 只是登记 revoke。

---

## §3 四个存量插件模块形态与它们注册的 type/slot

所有插件形态一致：**`{ name, setup(ctx) }` 一段式，无 apply/inject 顶层字段**；"inject"是通过 setup 内 `ctx.inject('svcName', impl)` 上架服务，不是插件对象上的字段。

### 3.1 plugin-node-text（`packages/plugins/plugin-node-text/src/nodeTextPlugin.ts`）
- 导出 `nodeTextPlugin: PluginModule = { name:'text', deps:[], setup(ctx) }`。
- setup 内调 `registerNodeType(ctx, { type:'text', label:'文本', defaultSize:{300,200}, segments:{ content: TextContent } })` → 注册 **type='text'**（nodeStore 数据 + nodeRegistry content 段）。
- 另 `ctx.inject('text', {...addTextNode/editText})` 暴露服务；`factory.register('text', createText)` + effect 回收。
- index.ts 有 dev HMR accept（自 accept 形态）。

### 3.2 plugin-node-image（`packages/plugins/plugin-node-image/src/nodeImagePlugin.ts`）
- 导出 `nodeImagePlugin: PluginModule = { name:'image', setup(ctx) }`。
- setup 调 `registerNodeType(ctx, { type:'image', ... defaultSize:{320,240}, segments:{ content: ImageContent } })` → 注册 **type='image'**。
- `ctx.inject('image-meta',{v:1})`、`ctx.inject('image',{addImageNode,removeNode})`、`factory.register('image', ...)`。
- index.ts HMR accept(['./nodeImagePlugin'])。

### 3.3 plugin-theme-default（`packages/plugins/plugin-theme-default/src/index.ts`）
- 导出 `themeDefaultPlugin: PluginModule = { name:'theme-default', setup(ctx) }`。
- setup 调 4 次 `registerThemeSlot(ctx, slot, value)` 注册**槽位**：
  - `'nodeShell'` ← BaseNode.vue（完整节点壳）
  - `'edge'` ← CustomEdge.vue
  - `'background'` ← DefaultBackground.vue
  - `'edgeDefaultType'` ← `'custom'`（字面值）
- 无额外 inject/命令。

### 3.4 plugin-canvas-commands（`packages/plugins/plugin-canvas-commands/src/canvasCommandsPlugin.ts`）
- 导出 `canvasCommandsPlugin: PluginModule = { name:'commands', deps:[], setup(ctx) }`，纯逻辑无 Vue。
- **不调 registerNodeType/registerThemeSlot**；命令走 `ctx.get('command')`（CommandRegistry 服务，createMiniCanvasHost 注入）→ `command.register({...})` 注册 4 个命令：
  - `command:delete`（删选中）
  - `command:create-node`（经 nodeFactory.create）
  - `command:undo` / `command:redo`
- 命令注册入口是 CommandRegistry（`ctx.get('command')`），不在本次"收口"两函数之列。

---

## §4 消费方（谁读注册表 / 谁装配插件）

### canvas-render 宿主（v2 唯一真消费方）
- `packages/canvas-render/src/host/createMiniCanvasHost.ts`：`new NodeRegistry()`/`new ThemeRegistry()`（未传 opts 时自建）并 `ctx.inject('nodeRegistry',...)`/`ctx.inject('themeRegistry',...)`（行 100-104）；还 inject save/nodeStore/selection/history/command/nodeFactory。冷启动 `ctx.plugin(p)`×N → `ctx.start()`（行 122-123）。**不 import 任何具体插件**。`getRegistry()` 只回 nodeRegistry。
- `packages/canvas-render/src/host/canvasHostCore.ts`：`assembleTheme(theme: ThemeRegistry, storeTypes)`（行 67-83）读 `theme.get('nodeShell'/'edge'/'background'/'edgeDefaultType')`——**单格 get 读**，多 occupant 后此装配点是改造点；nodeTypes 键来自 nodeStore.types 而非 nodeRegistry。
- `packages/canvas-render/src/host/CanvasHost.vue`：调 `assembleTheme`；`provide(NODE_REGISTRY_KEY, nodeRegistry)`（行 103）、`provide(HOST_KEY)`；coldPlugins 来自 props.plugins（行 278）。
- 令牌：`src/contracts/nodeRegistryKey.ts` 的 `NODE_REGISTRY_KEY`（节点注册表跨 Vue 层），`contentBridge.ts` 的 `HOST_KEY`。
- 测试 `src/host/__tests__/fullchain.test.ts` 把 text/image/commands 经 coldPlugins 显式传入复测。

### 壳组件消费 nodeRenderer
- `packages/plugins/plugin-theme-default/src/BaseNode.vue`（nodeShell 组件）：`inject(NODE_REGISTRY_KEY)`（行 26），`computed` 里 `resolveSegment(registry, props.type, 'content'|'title'|'top-toolbar'|'bottom-toolbar')`（行 105-108）取各段组件渲染——nodeRenderer 当前唯一运行时消费方。改造多 occupant 时此处语义需对齐。

### 命令消费方
- `packages/canvas-render/src/host/createMiniCanvasHost.ts` 注入 CommandRegistry 于 'command'；`plugin-canvas-commands` 经 ctx.get('command') 注册；宿主 UI 再执行 command。

---

## §5 仓库根 `src/`（业务层）与 v2 的关系 —— 关键澄清

- 根 `src/`（CanvasView/CloudCanvasView/McpCanvasView 等）**只 import `@mini-canvas/canvas-core`（旧 v1）**，全仓库根 src **无任何 `canvas-core-v2` / `canvas-render` 引用**（grep 0 命中）。
- 因此根 src 不直接调 v2 的 registerNodeType/registerThemeSlot/NodeRegistry/ThemeRegistry/command.register；它通过自己的 `CanvasPlugin`/`TextNodePlugin` 等（来自 canvas-core v1）组装，注释里的"NodeRegistry"指 v1 概念，**不在本次收口范围内**。
- v2 的注册/装配闭环完全在 **canvas-render 宿主 + 四个插件包 + demo-web** 内。

---

## §6 现状小结（供收口改造参照）

| 项 | 现状 | 文件 |
|---|---|---|
| SlotRegistry 多 occupant 槽容器 | 已实现并导出，**未被 registry 采用** | registry/slotRegistry.ts |
| nodeRegistry | 单格 map：type→整份 segments；重复抛错 | registry/nodeRegistry.ts |
| themeRegistry | 单格 map：slot→单值；重复抛错 | registry/themeRegistry.ts |
| registerNodeType / registerThemeSlot | 独立函数，形参 `ctx: PluginScope`，非 ctx 门面方法 | registry/registerNodeType.ts / registerThemeSlot.ts |
| PluginModule | `{name, deps?, setup, config?}`，**无 apply** | core/types.ts:76 |
| PluginScope | on/once/emit/effect/inject/get/plugin，**无 ctx.nodes/ctx.theme** | core/types.ts:56 |
| 注册表访问方式 | 一律 `ctx.get('nodeRegistry'/'themeRegistry')` 字符串键 | createMiniCanvasHost.ts:100-104 |
| nodeRenderer 消费 | resolveSegment 读单格；唯一运行时消费者=BaseNode.vue | registry/nodeRenderer.ts + theme-default/BaseNode.vue:105 |
| 插件注册 type | text、image（node-text/node-image 各一） | 见 §3 |
| 插件注册 theme slot | nodeShell/edge/background/edgeDefaultType（theme-default） | 见 §3 |
| 命令注册 | ctx.get('command')→CommandRegistry（commands 插件 4 命令） | canvasCommandsPlugin.ts |
