# render-host 调研报告 —— 开放插槽渲染改造前置侦察

> 侦察对象：`packages/canvas-render/src`（渲染宿主）+ 它引用的 `@mini-canvas/canvas-core-v2` 注册表。
> 用途：为"插件往 themeRegistry / nodeRegistry / slotRegistry 塞多 occupant（带 order/id），渲染层按 order 渲染全部 occupant"的改造摸清现状。
> 说明：本次只做代码侦察，未改任何代码。行号基于本次读取时的 on-disk 源码。

---

## 0. 一句话总览（结论先行）

当前渲染层对"节点 type 渲染成哪个组件""主题某槽渲染哪个组件"的决策**全部是 single（单格 / 单赢家）语义**：

- 节点壳（nodeShell）＝ themeRegistry 里**一个**槽值；宿主把它复制给所有 nodeTypes[t]。
- 节点每个段（content/title/…）＝ nodeRegistry 里**每个 type 一份 segments**，`resolveSegment` 返回单值。
- themeRegistry / nodeRegistry（v2）至今**仍是普通单格 Map**，并非 SlotRegistry 实现。
- `SlotRegistry`（多 occupant 容器，commit `e23542e` 引入）**已存在且已 export，但零生产消费方** —— 它只是"地基"，还没被 themeRegistry/nodeRegistry/渲染层接上。

---

## a. 一个节点 type 渲染成哪个组件？（结论：两层决策，皆 single）

节点渲染被拆成 **外壳(壳) + 内容(段)** 两层，两层各自读不同注册表：

### 层 1：VueFlow 的 node-types —— type → 壳组件（nodeShell）
- `CanvasHost.vue` 维护 `nodeTypes = shallowRef<Record<string, any>>({})`（`CanvasHost.vue:146`）。
- `applyTheme()`（`CanvasHost.vue:160-173`）调 `assembleTheme(h.themeRegistry, h.nodeStore.types.keys())`，把 themeRegistry 的 **`nodeShell` 这一个槽值**铺给每个已注册业务 type：
  ```ts
  if (asm.nodeShell) {
    const shell = markRaw(asm.nodeShell)
    nodeTypes.value = {}
    for (const t of asm.nodeTypes) nodeTypes.value[t] = shell   // 所有 type 同一个壳
  }
  ```
  （`CanvasHost.vue:165-169`）
- nodeTypes 键集合来自 `h.nodeStore.types.keys()`，即 nodeStore 数据侧注册的 type（非 nodeRegistry、非 themeRegistry）。
- 模板把 `:node-types="nodeTypes"` 传给 `<VueFlow>`（`CanvasHost.vue:371`）。

**取的是 single**：`assembleTheme` 里 `theme.get('nodeShell')`（`canvasHostCore.ts:71`），themeRegistry.get 是单格 Map get（见下）。

### 层 2：BaseNode 壳内部 → type 各段组件（content/title/top-toolbar/bottom-toolbar）
- VueFlow 的 `node-types[t]` 全指向同一个壳组件 **BaseNode.vue**（`node-types[t] = shell`）。壳组件是 `BaseNode`（默认主题插件 `packages/plugins/plugin-theme-default/src/BaseNode.vue`）。
- BaseNode 对每个节点：`const content = computed(() => resolveSegment(registry, props.type, 'content'))`，同样解析 `title` / `top-toolbar` / `bottom-toolbar`（`BaseNode.vue:105-108`）。
- `resolveSegment`（`packages/canvas-core-v2/src/core/registry/nodeRenderer.ts:16-18`）：
  ```ts
  return registry.get(type)?.segments[segment]
  ```
  **每个 type/segment 只返回一个组件句柄（undefined = 该段不渲染）。取的是 single（type 维度单份 segments）。**

### 段组件怎么注册进去
- `registerNodeType(ctx, def)`（`canvas-core-v2/src/core/registry/registerNodeType.ts:45-72`）：插件一次注册，同时写 ①nodeStore 数据（type/label/尺寸/连接约束）②nodeRegistry 展示（`def.segments`）。注册的 segments 是单格写入。
- `nodeRegistry.register(type, segments)`（`canvas-core-v2/src/core/registry/nodeRegistry.ts:31-36`）：**type 重复注册直接抛错**（防覆盖，无"多 occupant"概念）；`get(type)` 返回单份 `{ type, segments }`。

> 小结：要"一个 type 渲染多个 content 组件"，改点在层 2 —— `nodeRegistry`/`resolveSegment` 目前是 type→单份 segments；壳只解析出一个 content 组件。想让一个节点渲染多份，得让 nodeRegistry 的段支持多 occupant（SlotRegistry 化），并让 BaseNode 按 order 渲染 content 列表。

---

## b. 主题（nodeShell/edge/background）怎么决定渲染哪个组件？（结论：single 单格 map）

- 主题组件/值的唯一来源是 `ThemeRegistry`（`canvas-core-v2/src/core/registry/themeRegistry.ts`），内部是**单格 Map**：
  ```ts
  private bySlot = new Map<ThemeSlot, unknown>()
  register(slot, value){ if (this.bySlot.has(slot)) throw ...; this.bySlot.set(slot,value) }  // 重复抛错
  get(slot){ return this.bySlot.get(slot) }                                                   // 单值
  ```
  （`themeRegistry.ts:34,37-42,45-47`）—— **无 order / id / 多 occupant**。
- 装配逻辑集中在 `assembleTheme`（`packages/canvas-render/src/host/canvasHostCore.ts:67-83`）：
  ```ts
  const shell = theme?.get('nodeShell')
  const edge = theme?.get('edge')
  const background = theme?.get('background')
  const edgeDefaultType = theme?.get('edgeDefaultType') ?? 'custom'
  nodeTypes: [...storeTypes]
  ```
  每个槽各取**一个**值。ThemeAssembly 接口（`canvasHostCore.ts:50-61`）：nodeShell / edge / background / edgeDefaultType / nodeTypes。
- `CanvasHost.vue:applyTheme()`（160-173）消费 ThemeAssembly：
  - `nodeTypes.value[t] = shell`（同上）
  - `edgeTypes.value = { custom: markRaw(asm.edge) }`（边只挂 custom 一种，单值）
  - `backgroundComp.value = asm.background`（一个背景组件，模板 `<component :is="backgroundComp">` 渲染单实例，`CanvasHost.vue:384`）
  - `edgeDefaultType.value = asm.edgeDefaultType`（`CanvasHost.vue:171`）
- 主题槽位注册入口 `registerThemeSlot(ctx, slot, value)`（`registerThemeSlot.ts:22-28`）：内部 `theme.register(slot, value)`（单格），revoke = `theme.unregister(slot)`。

> 小结：主题决策是"一槽一组件、重复注册抛错"，**不是 single 赢家语义，是严格单格 map**。宿主 get 一次就用，无候选列表可排序。改造方向（slotRegistry 注释也指出）是把 nodeShell/edge/background 这类槽从单格升级成多 occupant，宿主按 order 决定渲染哪个（或叠加）。edge/background 即便将来多 occupant，VueFlow 侧 edge-types/背景也是"一选一"（single 赢家）；只有能并列叠加的（如 content 段、装饰层）才适合全量渲染。

---

## c. 渲染节点/边的数据结构 & 如何让"同槽第二 occupant"被渲染层看到

### 数据结构
- **节点**：`nodes = ref<ReturnType<typeof nodesFromStore>>([])`（`CanvasHost.vue:140`）。`nodesFromStore(store)`（`canvasHostCore.ts:28-35`）把 nodeStore 每个 `CanvasNode` map 成 `FlowNode{ id, type, position, data }`（data 浅拷贝）。`type` 字段驱动 VueFlow 查 nodeTypes 选壳。
- **边**：`edges = ref<Array<{id,type,source,target}>>([])`（`CanvasHost.vue:141`）。`onConnect`（226-233）建边 `{ id: edgeId(...), type: edgeDefaultType.value, source, target }`；`edgeDefaultType` 默认 'custom'，边渲染组件 = `edgeTypes.custom`。边目前是**纯 VueFlow 视觉态，未落内核**（注释 232）。
- 订阅刷新：`host.nodeStore.subscribe(syncFromStore)`（`CanvasHost.vue:287`），`syncFromStore`（178-186）重灌 `nodes`/`edges`，trim 悬挂边。

### 新增"同槽第二 occupant"渲染层要看的改动点（按目前架构推导，不是已实现）
要让渲染层看到第二个 occupant，必须让"渲染层取值的入口"从**单值 get** 变成**多值 list**：

1. **主题侧（nodeShell/edge/background）**：把 `ThemeRegistry` 内部由 `Map<ThemeSlot,unknown>` 换成持有 `SlotRegistry`（槽→多 occupant），宿主从 `theme.get(slot)` 改成读 `slot.list(slot)` 按 order 取。目前入口是 `assembleTheme`（canvasHostCore.ts:67）→ 需改成产出一组候选。
   - nodeShell：目前复制给所有 type。若只留单赢家，`first(slot)`；若要叠壳（罕见），全铺。
   - edge/background：VueFlow 的 edge-types/背景只能一个，语义应取 `first()`/`single` 赢家。
2. **节点段侧（content 等）**：nodeRegistry 的 `register(type, segments)` 目前整段覆盖单 type。改成 type 的每段也走 SlotRegistry 后，`resolveSegment`（nodeRenderer.ts:16）从 `segments[segment]` 单值，变成 `slot.list(segment)` 一组；BaseNode 按 order 渲染多个 content。
3. **容器层要不要动**：`SlotRegistry` 已能多存多读（`list/first/get/add/remove`，slotRegistry.ts）。关键在于让 **themeRegistry/nodeRegistry 真正基于/暴露 SlotRegistry**（现在是它俩没用上 SlotRegistry）。宿主目前也**没订阅 slotRegistry** —— 热装/热卸仅靠 `ctx:plugin-installed/uninstalled` 事件触发 `applyTheme`+`nodeEpoch++`（CanvasHost.vue:297-306），所以新 occupant 靠同一事件链触发重装配即可。

---

## d. createMiniCanvasHost / CanvasHost expose 的 API 面 & CanvasHost 怎么装配 host

### createMiniCanvasHost 返回（`createMiniCanvasHost.ts:85-168`）
`Promise<{ host: CanvasHostHandle; api: MiniCanvasApi; exposeToWindow(key?) }>`

- **host** `CanvasHostHandle`（48-62）：`ctx / save / nodeStore / nodeRegistry / themeRegistry / selection / command / history / nodeFactory / stop()`。
- **api** `MiniCanvasApi`（65-78）暴露给 window.MiniCanvas 的插件门面：
  - `installPlugin(mod: PluginModule): string`（148-149 → `ctx.installPlugin`）
  - `uninstallPlugin(name: string): boolean`（150 → `ctx.uninstallPlugin`）
  - `reloadPlugin(name, nextMod?)`（151-154 → 先 uninstall 旧、再 install 新）
  - `listPlugins(): string[]`（155 → `ctx.listPlugins`）
  - `getContext() / getRegistry()(=nodeRegistry) / getNodeStore() / getHost()`（156-159）
- 服务装配（90-119）：建 `Context` → `ctx.inject` save / nodeStore / nodeRegistry / themeRegistry / selection / history / command / nodeFactory。冷启动：`for p of coldPlugins ctx.plugin(p)` → `await ctx.start()` → 恢复画布或跑 seed。
- `exposeToWindow(key='MiniCanvas')`（162-165）把 api 挂到 `globalThis[key]`。

### CanvasHost.vue 怎么装配 host（onMounted 内，274-323）
1. `createMiniCanvasHost({ adapter, coldPlugins: props.plugins, nodeRegistry: registry, seedDefault: props.seed })`（276-281）——**传入宿主自己建的 `registry = new NodeRegistry()`**（102 行，用来同步 provide NODE_REGISTRY_KEY），themeRegistry 走内部默认新建并注入 ctx。
2. 拿 `{host, api, exposeToWindow}` 填 `hostRef`/`apiRef`（282-283）。
3. `host.nodeStore.subscribe(syncFromStore)`（287）。
4. `applyTheme()` 装配（290）；`syncFromStore()` 首灌（294）。
5. 订阅 `ctx:plugin-installed/uninstalled` → `applyTheme()` + `nodeEpoch++`（297-306）。
6. `defineExpose`（335-348）：`host` / `api` / `ready` / `bootErrorText`。
7. 卸载（350-358）：unsub store、dispose subs、flush save、`hostRef.value?.stop()`。

> 注意：CanvasHost.vue 的 `registry`（自建 NodeRegistry，102）只用于 provide 给 BaseNode 读 + 传给 createMiniCanvasHost 注入 ctx。themeRegistry 未在 CanvasHost.vue 里自建，是 createMiniCanvasHost 内部新建。改造时若要把 themeRegistry 换成 SlotRegistry 版，宿主装配点就是 createMiniCanvasHost（103 行 `new ThemeRegistry()`）与 CanvasHost 的 applyTheme 消费处。

---

## e. 有没有现成的"把 registry 读取包装成响应式列表"工具？

- **`nodesFromStore(store)`**（`canvasHostCore.ts:28-35`）：确实是"把内核 store 读成渲染层节点数组"的工具，被 CanvasHost 用 `nodes.value = nodesFromStore(h.nodeStore)`（`CanvasHost.vue:183`）响应式重灌。但它只是**一次性生成数组**，本身不注册 subscribe，响应性靠 CanvasHost 在 `onMounted` 里 `nodeStore.subscribe(syncFromStore)`（`CanvasHost.vue:287`）驱动。
- 除 nodesFromStore 外，**没有**现成的"把 themeRegistry/nodeRegistry/slotRegistry 的某槽/某段读取包装成响应式 computed/list"的通用工具。当前渲染层直接同步调用：
  - 主题：`assembleTheme`（canvasHostCore.ts）在 `applyTheme()` 里一次性算好，靠事件/订阅触发重算，非 computed。
  - 节点段：BaseNode 用 `computed(() => resolveSegment(registry, type, segment))`（`BaseNode.vue:105-108`）——是 Vue computed，但它**读的是单格 NodeRegistry（无响应式通知），注册表是普通 class 非 reactive**，所以这个 computed 只在依赖的 props/reactive 变化时重算，注册表自身变化不会自动刷新（插件装/卸靠宿主 bump nodeEpoch 重挂子树强制刷新，`CanvasHost.vue:152,368`）。
- 结论：要做"多 occupant 按 order 渲染"，需要新增/改造一个响应式列表读取工具（类似把 SlotRegistry 的 list 包成可订阅/可 reactive 视图），目前只有节点层的 nodesFromStore 可作范本，主题/段层没有现成的。

---

## 附：关键文件索引（相对仓库根）

| 主题 | 文件 | 关键符号/行号 |
|---|---|---|
| 渲染宿主组件 | `packages/canvas-render/src/host/CanvasHost.vue` | `applyTheme` 160-173；`nodeTypes` 146；`syncFromStore` 178-186；`nodesFromStore` 调用 183；装配 274-323；defineExpose 335-348；订阅热装 297-306；VueFlow 模板 367-387 |
| 纯逻辑核心 | `packages/canvas-render/src/host/canvasHostCore.ts` | `nodesFromStore` 28-35；`assembleTheme` 67-83；`ThemeAssembly` 50-61；`DEFAULT_EDGE/HANDLE_VISUAL` 90-108；`edgeId` 111 |
| 门面工厂 | `packages/canvas-render/src/host/createMiniCanvasHost.ts` | `CanvasHostHandle` 48-62；`MiniCanvasApi` 65-78；服务装配 90-119；coldPlugins 122-125；api 148-160 |
| VueFlow 出口 | `packages/canvas-render/src/vueFlowBridge.ts` | re-export Handle/Position/getBezierPath/useVueFlow/EdgeProps/NodeProps |
| 节点壳 | `packages/plugins/plugin-theme-default/src/BaseNode.vue` | `resolveSegment` 消费 105-108；inject NODE_REGISTRY_KEY 26-27 |
| 主题注册表（单格） | `packages/canvas-core-v2/src/core/registry/themeRegistry.ts` | `Map<ThemeSlot,unknown>` 34；register 37-42；get 45-47 |
| 节点展示注册表（单格/type） | `packages/canvas-core-v2/src/core/registry/nodeRegistry.ts` | `byType: Map<string,NodePresentation>` 28；register 31-36；get 39-41 |
| 段解析 | `packages/canvas-core-v2/src/core/registry/nodeRenderer.ts` | `resolveSegment` 16-18；`hasContent` 21；`activeSegments` 28-34 |
| 多 occupant 容器（未接线） | `packages/canvas-core-v2/src/core/registry/slotRegistry.ts` | `SlotRegistry` 44；`list` 75；`first` 82；`add` 55；`remove` 66 |
| 主题槽注册入口 | `packages/canvas-core-v2/src/core/registry/registerThemeSlot.ts` | `registerThemeSlot` 22-28 |
| 节点注册入口 | `packages/canvas-core-v2/src/core/registry/registerNodeType.ts` | `registerNodeType` 45-72 |
| 内核公共出口 | `packages/canvas-core-v2/src/core/index.ts` | export NodeRegistry/ThemeRegistry/SlotRegistry/… 6-15 |
| 注入令牌 | `packages/canvas-render/src/contracts/nodeRegistryKey.ts` / `contentBridge.ts` | NODE_REGISTRY_KEY 11；HOST_KEY 19 |

## 附：现状对改造的红线提示（本报告结论的推论，非已实现方案）
1. themeRegistry / nodeRegistry（v2）**尚未**用 SlotRegistry 实现——`SlotRegistry` 只有自身测试，无生产消费方。
2. 现有读点全是单值 get（assembleTheme 读 themeRegistry；resolveSegment 读 nodeRegistry），改造后这些入口要改读 list+order。
3. 渲染层对注册表变化没有 reactive 订阅，靠 `nodeEpoch`/事件强制重挂——多 occupant 改动也复用此链路即可，不必引入新响应式机制，除非要"改 occupant 即实时刷"（那种需给 registry 加响应式/订阅）。
