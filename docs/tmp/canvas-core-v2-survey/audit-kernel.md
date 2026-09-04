# canvas-core v1「插件内核三件套 + 装配根」深审 —— 为 v2 自研 Cordis 内核取经

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 审查对象（live 路径）：
- `packages/canvas-core/src/plugins/PluginManager.ts`（live，Canvas.vue 在用）
- `packages/canvas-core/src/plugins/PluginContext.ts`（含 EventBus / createPluginContext）
- `packages/canvas-core/src/plugins/PluginRegistry.ts` + `PluginInstaller.ts` + `PluginDependencyGraph.ts`（**无人引用的第二套并行实现**）
- `packages/canvas-core/src/plugins/types.ts`
- `packages/canvas-core/src/Canvas.vue`（741 行上帝组件，装配根）

审查方法：codegraph MCP 全量核对引用关系 + 逐文件精读 + 全库 grep 实证（每个结论都有调用点/行号佐证）。
对齐文档：`docs/plan/canvas-core-v2-architecture.md`（第 1 层 Core 待实现）+ 同目录 `cordis-research.md`/`v2-design-draft.md`。
本份定位：给 v2 内核的"哪段吸收 / 哪段重写 / ctx 方法签名 / 作用域回收怎么做"提供可直接照抄的依据，并与兄弟侦察（host-runtime / ui-slots / persist-inventory / audit-storage）互补。

---

## 0. 一句话总纲（先看这个）

**v2 架构文档说"v1 PluginManager 很完善、直接吸收"——方向对，但要打两个补丁**：
1. v1 里根本没有"作用域自动回收"，所有清理全靠每个插件手写 `uninstall()` + 每个 off-handle 一个个 off；这是 v2 与 v1 分水岭，必须新造。
2. v1 存在**两套并列的插件系统**（`PluginManager` 与无人引用的 `PluginInstaller/PluginRegistry/PluginDependencyGraph` 三件套），且**双份拓扑/生命周期代码**；v2 只能留一份，且要明确谁是死代码、谁是活代码。
3. v1 的 `PluginContext` 是**手工逐字段拼装的面条工厂**（32 个符号、被 30+ 个闭包小函数填满），不是 Cordis 式"scope 自洽对象"；v2 要反过来：让 context 自己持有 scope、自己回收。

---

## 1. 现状逐文件解剖

### 1.1 `PluginManager.ts`（644 行，活代码）—— 职责：装配/生命周期/依赖/回滚

Canvas.vue 装配用的就是它（`new PluginManager()`）。它自己包了四件事，本质是**一颗能跑的引擎但功能边界很杂**：

| 成员 | 职责 | 佐证 |
|---|---|---|
| `plugins/contexts/installResults/lifecycles/loadOrder` 五张 Map | name→插件/ctx/install返回/状态/加载序 | PluginManager.ts:19-31 |
| `eventBus: EventBus`（public readonly） | 唯一"能响"的事件总线，全体 PluginContext 共用同一实例，Canvas.vue 也直接拿它 `manager.eventBus.emit(...)` | :43,:80,:459 |
| `_registries`（command/toolbar/panel 各一个 `unregisterSource`） | 卸载时按 source 清注册表 | :46-58,:194-196 |
| Kahn 拓扑 + 循环依赖检测 + 可读环路径 | 依赖解析 | :327-465 |
| 生命周期状态机 `setLifecycle`（含合法转换表） | INSTALLING→…→UNINSTALLED/ERROR | :522-551 |
| 安装失败反向回滚 `rollback` | 异常时把已装插件逆序 uninstall | :593-618 |
| 私有的 `eventHandlers` + `emit` | **死通道**（无任何公开 on/off 喂它） | :37,:631-642 |

**关键状态机**：状态是 `INSTALLING→INSTALLED→ACTIVATING→ACTIVE→UNINSTALLING→(删除记录)`，非法跳转会 throw。实测 `activate` 正常走，`deactivate/deactivating/inactive` 三态**只是声明和转换表里有、没有任何调用路径真正触发**（无代码调用 `plugin.deactivate`），属于半截状态机。

**install 流程**（:96-165）：验证重名 → `resolveOrder` 拓扑 → 逐个 `install(ctx,options)` → 成功才入 `contexts/plugins/installResults` → 失败反向 `rollback` → 全部装完再逐个 `activate` → `manager.emit('plugins:ready', …)`。

**卸载流程**（:176-229）：查被依赖方（有依赖者则 throw 拒卸）→ `unregisterSource` 清 command/toolbar/panel → 优先调 install 返回的 `uninstall`，否则 `plugin.uninstall` → 删 maps/loadOrder。**这里完全没有：ctx.on 监听、store.watch、dom 监听、ShortcutManager 注册、timer 的自动回收**。

### 1.2 `PluginContext.ts`（661 行）—— 职责：`EventBus` + `createPluginContext` 巨型工厂 + 一堆 create* 闭包

文件里其实塞了**三个互不相干的东西**：

1. **`EventBus`（:58-97）**：一个字符串事件表（`Map<string, Set<handler>>`），`on` 返回 off、`off`、`emit`、`clear`。**`emit` 有个大问题**：先 `window.dispatchEvent(new CustomEvent(event, {detail:payload}))` 再把内部 handler 跑一遍（:81）。→ 每一次 `ctx.emit` 都会往 `window` 全局 DOM 抛一个同名 CustomEvent。

2. **`VueFlowInstance` 内部接口**（:32-52）：把 useVueFlow 实例拍平成手写接口，上下文能拿到 nodes/edges/viewport/视角操作。这是 ctx 里所有 `actions`/`viewport` 的后端。

3. **`createPluginContext(pluginName, options)`（:139-483）**：返回一个**逐字段手拼的 PluginContext 字面量**（:280-480）。工厂内部又建了一堆更小的闭包：`createPluginStore`（:489，按 `state.plugins[pluginName]` 命名空间 get/set/watch/toRef）、`createActions`（:565，逐方法 try/catch 包 VueFlow 调用）、`createViewport`（:606）、`createDomService`（:652）、`syncSelectionToVueFlow`（:180，把选中同步回 VueFlow）。里面每个 registry 都是"`xxRegistry?` 可选→空实现返回空/记录日志"的胶水壳。

**`context` 组装散落的实证**：这个 context 对象里每个能力（menus/canvasNodes/commands/toolbars/panels/dom/registerShortcut/getPluginAPI…）都是单独一小段 `{ register(){ reg?.register() }, ... }` 手写壳。Canvas.vue 要一次性把 11 个参数（vueFlowInstance/canvasStore/6 个 registry/eventBus/connectionState 三个 ref…）喂进来（Canvas.vue:451-465），缺一个就静默降级或 throw。**这就是"context 组装散落"的病根**：能力源分散在工厂参数 + 模块级单例（ShortcutManager/CanvasDomService 的 querySelector）+ 一堆闭包，没有"context 自洽持有能力 + 能力按 scope 进出"的一等公民结构。

### 1.3 `types.ts`（314 行）—— 职责：全部契约（数据/事件名/生命周期/context 形状/plugin 形状）

值得注意的三点：
- **事件名全是魔法字符串**：`on: (event: string, …)` / `emit: (event: string, payload: unknown)`（:215-217），没有任何类型映射。虽然文件顶部手工定义了 `CanvasConnectionEvents`/`CanvasGroupEvents` 常量、runtime 里还手写了个 `CanvasEvents` 接口，但**EventBus 根本不接类型**——`CanvasEvents` 接口全库只有自己引用（死规格）。
- **context 字段全是接口里写死的能力**（registerNodeType/registerComponent/canvasNodes/menus/commands/…/on/off/emit/…/getPluginAPI），Vue、Pinia、VueFlow 类型直接 import 进来（types.ts:1-7），**说明 PluginContext 不是纯内核、与视图/框架深度绑定**。
- **`CanvasPlugin.install` 返回 `{api, uninstall}?` 而 `uninstall`/`activate`/`deactivate` 又是可选字段**（:175-187）——两套清理表达并存，语义混乱（见 §2.2）。

### 1.4 `PluginRegistry.ts`（41 行）+ `PluginInstaller.ts` + `PluginDependencyGraph.ts` —— 无人引用的第二套实现（死代码）

codegraph callers 实证：`PluginInstaller`、`PluginDependencyGraph` **无任何调用方**；`PluginRegistry` 只被 `PluginInstaller` 引用（而 PluginInstaller 本身无人用）。三件套自闭环、Canvas.vue 从不 import。它们的功能是 PluginManager 的**瘦身复刻**：`PluginDependencyGraph.sort`（:3）与 PluginManager 内部 `resolveOrder` 是**同一套 Kahn 代码翻写**；`PluginRegistry` 就是把 PluginManager 的 plugins/contexts/installResults 三张 Map 抽出去；`PluginInstaller` 把 installOne/activateOne/uninstallOne 拆成单步。

> **结论**：这是 v2 探路期某次"把 PluginManager 拆成 Registry+Installer+Graph"的半成品，没接线。v2 千万别再抄这三人组——它把职责拆得更碎、且没有回滚/依赖守卫（`uninstallOne` 不查被依赖方、没有 rollback）。

### 1.5 `Canvas.vue`（759 行上帝组件）—— 装配根，几乎所有核心能力都在这儿手写

Canvas.vue 是"把内核 + 视图 + 状态 + 桥接 + UI 全焊一起"的装配根，耦合点逐条数（都在 script 段）：
1. **创建单例内核**：`new PluginManager()`（:97）、`new NodeRegistry/CommandRegistry/ToolbarRegistry/PanelRegistry/MenuRegistry`（:361-367）、`new CanvasRuntime(manager, manager.eventBus, …8 参)`（:369）。Runtime 只是个把所有实例攒一起、多了个 `getPluginAPI` 委托的载体（runtime/CanvasRuntime.ts）。
2. **用 useVueFlow(CANVAS_ID) 拿 VueFlow 实例**（:86），`CANVAS_ID='main-canvas'` 写死。
3. **连接核心 composable 与内核共享 eventBus**：`useCanvasConnection({ …, eventBus: manager.eventBus })`（:107-118）。
4. **模板上几十处手动转发事件**：`@connect/@nodes-change/@node-click/@pane-*` 等每个都写 `manager.eventBus.emit('xxx', $event)`（:681-695），把 VueFlow 事件逐条手动桥进内核。
5. **内核创建时把 11 个对象塞进 context**：`manager.install({ createContext: name => createPluginContext(name, { vueFlowInstance, canvasStore, pluginManager, eventBus, nodeRegistry, menuRegistry, commandRegistry, toolbarRegistry, panelRegistry, connectionState, isConnecting, canShowConnectionMenu }) })`（:445-466）。
6. **setup 顶层读 Pinia store + storeToRefs** 拿 `connectionState/isConnecting/canShowConnectionMenu`（:47）。
7. **手工合并节点/边类型**：`watch` 里合并硬编码类型 + store 自定义类型，markRaw 后喂 VueFlow（:195-209）。
8. **N 个事件处理函数手工注册 + `cleanupFns[]` 手写收集、onUnmounted 逐个释放**（:184,:436-442,:570-575,:657-659）。
9. **快捷键系统三条线全在这**：注册 VueFlow 系统键、loadKeymap、syncVueFlowKeymap 到 VueFlow refs（:586-613）+ watch 监听重映射同步（:628-632）+ onUnmounted 才 `exportKeymap()` 写回 store（:644）。
10. **设置面板开关注册一大坨**：`registerCore(...)` 手写 50+ 行把 core 配置项逐个注册进 PanelRegistry（:494-563）。
11. **storage 状态桥**：监听 6 个 storage 事件刷新 `storageState`、把 `manager.getPluginAPI('storage')` 塞进 provide 的 `canvasStorageApi`（:570-583, 414-415）。
12. **onMounted 顺序编排 + onUnmounted 反向卸载插件 + 清 ResizeObserver/DOM 监听**（:417-660）。

> 上帝组件病根：**内核不该知道 VueFlow/Pinia/UI/快捷键，却全在这里被手动接上**。scope.md 里已经列出 `useCanvasFlow/usePluginSystem/useCanvasPanelState` 这批"想拆出去但 Canvas.vue 没用"的 composable（Canvas.vue 只用了 `useCanvasConnection`）——说明有人尝试把装配下沉成可测试 composable，但没并进主路径。

---

## 2. "Cordis 雏形"到底成没成形？（名字像 vs 真像）

| Cordis 概念 | v1 现状 | 判定 |
|---|---|---|
| **每个插件一个子作用域(scope)** | ❌ 没有。所有插件共享同一个 `PluginContext` 形态对象、同一个 EventBus、同一个 Pinia、同一个 ShortcutManager | **纯命令式，名字都不像** |
| **作用域自动回收**（卸载时 on/inject/timer/watch/DOM 全清） | ❌ 无。靠每个插件手写 `uninstall()` 一个个 off；`store.watch`/`dom.on*`/ShortcutManager 注册/原始 window/document 监听几乎全靠插件自觉 | **Cordis 分水岭缺失** |
| **ctx.inject / ctx.get（服务注入）** | ⚠️ 半像。有 `dependencies[]` + 拓扑排序 + `getPluginAPI(name)`（安装返回的 `{api}`）+ `getPlugin(name)`（已 @deprecated）。但**注入发生在 install 闭包内、非按名服务**；`auto-save` 里 `context.getPluginAPI('storage')` 每次调用都走 manager 查表，**无编译期类型、无服务注册/回收、无依赖声明即注入**（它靠 `dependencies:['storage']` 保证顺序但不强绑定） | 命令式查表，非 DI |
| **ctx.on / ctx.emit（事件）** | ⚠️ 有 EventBus，但**全字符串、不类型化**；且 emit 会**额外往 window 抛 DOM CustomEvent**；且 PluginManager 自己还有一套**死掉的私有 emit** | 名字像，双通道且漏 |
| **类型化事件** | ❌ `on/emit` 都是 string；手写 `CanvasEvents` 接口无人接线 | 未成形 |
| **卸载自动清理** | ❌ 见上，"自动"不存在，全靠手写 | 未成形 |
| **插件互调导出函数** | ⚠️ 靠 `getPluginAPI`（仅 storage 真返回 api）或事件广播；其余插件大多**不导出函数、只靠事件解耦**，跨插件函数调用被挤到"要 storage 才 getPluginAPI"的窄路径 | 半命令式 |
| **生命周期状态机 / Kahn 拓扑 / 循环依赖 / 回滚** | ✅ **这套是真完善的**：转换表完整、非法跳转 throw、依赖缺失/自依赖/环都可读报错、安装失败逆序回滚、卸载拒带依赖方 | **唯一可直接吸收的硬资产** |

### 2.1 真脏的地方：registerComponent 断头、事件双通道、单例跨画布

逐条实证见 §3 问题清单。先给总判断：**v1 离 Cordis 只差两件事**——(a) 把"手工卸载"换成"scope 自动 dispose"；(b) 把"字符串事件 + 全局单例 + 手拼 context"换成"类型化总线 + 注入服务 + context 自洽持有能力"。

---

## 3. 问题清单（按严重度 ⚠️高/🟠中/🟡低，每条带 v2 改法）

### ⚠️ 高

**P1. 作用域回收完全缺失 —— 卸载/停用必漏副作用（全库最重）**
实证：PluginManager.uninstall（:176-229）只做三件清理：registry 的 `unregisterSource`、调 install 返回的 `uninstall` 或 `plugin.uninstall`、删 maps。它**不知道**插件注册了哪些 ctx.on、哪些 store.watch、哪些 dom 监听、哪些 ShortcutManager 快捷键、哪些 timer。
后果：AutoSavePlugin 手写 8 个 off + 2 个原始 addEventListener + timer 清除 + externalListeners（AutoSavePlugin.ts:129-144）；ContextMenuPlugin 的 `context.dom.onWindow`（ContextMenuPlugin.ts:143）只在它自己 uninstall 里清；任何插件没写 uninstall，就永久泄漏（多画布/热更新场景爆炸）。
**v2 改法**：见 §5 作用域回收具体实现——`ctx.on/inject/watch(store)/effect/setTimeout` 全部返回 disposable 并自动登记进当前 scope，`scope.dispose()` 逆序执行；插件不写 uninstall 也安全。

**P2. 事件双通道 + 双份 emit 逻辑**
三处叠加：
- (a) `EventBus.emit` 先 `window.dispatchEvent(CustomEvent)`（PluginContext.ts:81）——**每次 ctx.emit 都往 window 全局 DOM 抛一遍**，污染全局、跨画布串扰、外部可偷听。既然 ctx 有内部 handler 表，就没必要再往 window 抛。
- (b) PluginManager 自带 `private eventHandlers` + `private emit`（:37,:631），但**没有任何公开 on/off 喂它** → `manager.emit('plugins:ready')`（:163）打进空表，**这事件实际上谁也收不到**（死通道/死事件）。这是"双通道"里最坑的：一个能响的 EventBus + 一个永不响的私有表。
- (c) 同一事件被多处重复 emit：`useCanvasConnection` 自己 `eventBus?.emit('connect', …)`（:655,:691），Canvas.vue 模板 `@connect` 又 `manager.eventBus.emit('connect', …)`（:681）→ **一次真实 connect 在同一条总线发两次**。`AutoSavePlugin.performSave` 既 `context.emit('auto-save:saved')` 又 `window.dispatchEvent('auto-save:saved')`（:53-54），EventBus.emit 内部本来就要抛 window——**同一 save 在 window 上抛两遍同名 CustomEvent**。
**v2 改法**：(a) 砍掉 EventBus 的 `window.dispatchEvent`，事件只在总线内流动；(b) 删 PluginManager 私有 eventHandlers/emit，事件所有权收归单一类型化总线；(c) 事件源头唯一化——connect 只在 composable 一处 emit，模板不再转发；(d) 引入事件去重或单源约定。

**P3. 两套并列插件系统 + 双份拓扑/生命周期代码**
`PluginManager`（活）+ `PluginInstaller/PluginRegistry/PluginDependencyGraph`（死，无人引用）。后者的 `sort` 是 PluginManager `resolveOrder` 的翻写（PluginDependencyGraph.ts:4 vs PluginManager.ts:327）。维护者极易改错一份。
**v2 改法**：物理删除三件套（`PluginInstaller/PluginRegistry/PluginDependencyGraph` 及其引用）；只保留一份内核实现（吸收 PluginManager 的拓扑/状态机/回滚，见 §5）。

**P4. Canvas.vue 是 741 行上帝组件，内核与 VueFlow/Pinia/快捷键/UI 全焊死，无法单测**
装配点 12 处（§1.5）。这直接导致 v2 架构文档里"内核可脱离 Vue/pinia 独立单测"落空——现在的"内核"（PluginManager+createPluginContext）根本离不开 VueFlow store / Pinia / querySelector。
**v2 改法**：把 Canvas.vue 的装配下沉成"宿主薄层"。v1 已有尝试但没接线的 `useCanvasFlow/usePluginSystem/useCanvasPanelState`（§1.5.12）思路正确——v2 直接以"可测试内核 + 宿主薄装配"为纲重写，内核零 Vue 依赖（见 §4.4、§5-C）。

**P5. registerComponent 是断头 API（声明了、实现了、从没被任何地方用过、也没人读）**
全库 grep：`registerComponent` 只出现在 types.ts:198（声明）和 PluginContext.ts:306（实现，写进工厂闭包里的局部 `registeredComponents` Map，**那个 Map 从未被读取/返回**）→ 调用 `ctx.registerComponent` 相当于静默 no-op。
**v2 改法**：从 ctx 接口直接删掉；若 v2 需要"注册任意组件供别处渲染"，走统一的"命名插槽 registry"，而不是 context 上一个没人接的孤儿方法。

**P6. 单例跨画布串扰：Pinia store / ShortcutManager / EventBus 全应用唯一，多画布即打架**
实证：`useCanvasStore` 是 Pinia 单例 store（defineStore 'canvasState'，state 经 `useStorage('canvas-state')` 写穿 localStorage）；`ShortcutManager.getInstance()` 是模块级单例（ShortcutManager.ts:96，且 `_instance=null` 后重建也不清监听）；EventBus.emit 又往 window 抛全局事件。两处 `<Canvas/>` 会共享同一 store/同一快捷键/互相收到对方 window 事件。
**v2 改法**：把"每画布一份"的东西（store 命名空间、ShortcutManager、EventBus/scope 表）收进内核的**画布级 Context**，随 ctx.start/stop 创建与销毁（provide/inject 用 `canvasId` 隔离或 provide 每画布实例），快捷键改为注册到 ctx（`ctx.on('key')` 或 ctx.shortcut）而非模块单例。

### 🟠 中

**P7. 卸载对 registry/能力回收不彻底**
PluginManager.uninstall 只 `unregisterSource` 了 command/toolbar/panel 三个（:194-196），`unregisterNodeType/EdgeType`（store 注册的 nodeTypes/edgeTypes）、`menus`、`canvasNodes`、`panels` 里没按 source 清的、以及 ShortcutManager 注册的快捷键，**全部不会在卸载时自动撤销**。尤其 `registerShortcut` 被 27 处插件调用（全库最热 ctx 能力），却走模块单例、Manager 不清理 → 卸载后快捷键幽灵残留。
**v2 改法**：把"注册即生命周期绑定"做成 ctx 的默认语义——`ctx.register*` 全部返回/登记到 scope，卸载 scope 即清；或 v2 里快捷键直接 = ctx 注册的事件（见 P6）。

**P8. context 组装散落 + createPluginContext 是 30+ 闭包手拼的面条工厂**
11 个参数靠 Canvas.vue 一次性塞满（§1.5.5），每个 registry 都是可选式 `reg?.x` 胶水壳，缺参数静默降级或抛。ctx 能力的生命周期、归属、顺序全在外层裸拼。
**v2 改法**：把 context 重构成"scope 对象自己持有能力引用"，`createPluginContext` 该进垃圾桶——换成 Cordis 式"ctx 是一个有 plugin/on/inject/scope 的类实例，宿主把 registry/vueflow/pinia 作为 service 注册进去，再逐插件 plugin()"。

**P9. 事件不类型化 + 类型映射是死规格**
ctx `on/emit` 全 string（types.ts:215-217）；runtime/CanvasEvents.ts 手写了个 `CanvasEvents` 接口但**全库只有它自己 import**（死）；事件 payload 全靠 `any`。
**v2 改法**：类型化总线见 §5。事件名常量（`CanvasConnectionEvents.Release` 等）保留并并入一个全局 `CanvasEventMap` 类型。

**P10. 单例/`ctx.dom` 用 document.querySelector 拿 DOM，非注入、难测**
`createDomService` 里 `new CanvasDomService()`，`getPane` 返回 `document.querySelector('.vue-flow')`（CanvasDomService.ts:5）——第几个画布？多画布全抓到第一个。PluginContext.ts:404-435 的 `mountOverlay/unmountOverlay` 也直接 `document.querySelector('#app' / '.vue-flow__renderer')` 拼字符串选择器。
**v2 改法**：宿主把"当前画布的 DOM 容器/视口"作为 service 注册进 ctx（`ctx.inject('host', { pane, viewport })`），插件从 ctx 取，而不是自己 querySelector。

**P11. 卸载流程对"install 返回 {uninstall}" 与 "plugin.uninstall" 双表达、且 install 成功才注册——回滚路径不完整**
回滚 `rollback`（:593）只对"已成功 install 且进了 installed[] 的"做 uninstall；若某插件 install 抛错发生在它自己返回 api 之前，它的半成品副作用（已 registerNodeType、已 addEventListener）没人清。且 `install` 返回值类型是 `{api,uninstall}?`，语义上 uninstall 可来自 install 返回也可来自 plugin.uninstall，容易二选一漏一个。
**v2 改法**：统一成"install 只返回服务/配置，副作用全部经 scope 登记"，`plugin.uninstall` 字段删除或降级为兼容 shim；回滚 = scope.dispose（天然覆盖半成品，见 §5）。

### 🟡 低

**P12. 生命周期状态机半截：deactivate/inactive 三态无调用路径**
`ACTIVE→DEACTIVATING→INACTIVE` 转换表在（:536-538），但全 PluginManager 无任何代码调 `plugin.deactivate`/设 INACTIVE → 属纸面状态，徒增复杂度。
**v2 改法**：若 v2 不需要"停用不停装"，从状态机删掉这三态（或明确它属于 future 能力再实现），只留 installed/active/uninstalling/error。

**P13. `getPlugin`（返回插件定义对象）已 @deprecated 仍暴露在 ctx 与 PluginManager 上**
types.ts:225 标 deprecated，但 PluginManager.getPlugin/ctx.getPlugin 仍在（:237,PluginContext:469），混着 getPluginAPI 让人困惑。
**v2 改法**：删除；v2 只需 `ctx.get<Service>(name)`（拿服务实例），不暴露裸插件定义对象。

**P14. `registerHandleConfig` 通过直写 store.state 若干魔法 key（handleRadius 等）改配置**
PluginContext.ts:341-351 把 config 散写进 `state.handleRadius/handleRestOffset/…/connectionSnap*`，与 useCanvasStore.state.core 里的同名项是**两套 key 名称**（core.handleRadius vs state.handleRadius），存在"写进去的 key 和消费方读的 key 对不上"的风险，且绕过统一配置通道。
**v2 改法**：v2 所有配置走 `ctx.save.set(key, value, 'config')` + pinia 响应式镜像，删掉这些魔法字段直写。

**P15. 大量 try/catch + console 的防御性胶水（logger 每个方法 try/catch）**
createActions/createViewport/各 store 方法把每个操作包 try/catch 再 logger.error，可读性差、错误被吞。
**v2 改法**：内核错误策略单一化——安装/生命周期错误抛给 ctx 统一处理，action 调用错误只在边界兜底，不层层 try/catch。

**P16. store 直写后门**
PluginContext ctx.emit('canvas:setFlag',…) → Canvas.vue `onCanvasSetFlag` 里 `(canvas.state as any)[key]=value`（Canvas.vue:160-179）——plugin 可任意改 state 顶层 key（含 'core' 整块 / selectionState），payload 全 `any` 无类型。另有 usePluginStore/usePluginApi 等直接在 store 上 get/set 命名空间的后门通道。
**v2 改法**：setFlag 收进类型化事件 + ctx.set 统一通道（config 类走 save 层），不允许插件裸改 pinia 顶层对象。

---

## 4. 给 v2 内核的"最佳组合"建议

### 4.1 整段吸收（几乎不用改，直接搬）
| 资产 | 理由 |
|---|---|
| **Kahn 拓扑排序 + 缺失/自依赖/循环检测 + 可读环路径**（PluginManager:327-465 的 resolveOrder/buildCyclePath） | 完善、有报错可读性，v1 已验证。建议抽成纯函数 `topoSort(plugins): string[]`（当前嵌在 PluginManager 私有方法里，v2 提出来并配单测） |
| **生命周期状态机转换表**（PluginManager:522-551）——**去掉 P12 的三态后** | 完整、throw 语义清晰 |
| **安装失败反向回滚的骨架思想**（PluginManager:593 的思路） | 但改造成 scope.dispose 触发，见 P11 |
| **EventBus 的 on/off/emit 内部 handler 表结构**（PluginContext:58-97）——**但砍掉 window.dispatchEvent** | 表结构简单正确；把 emit 的 DOM 副作用删掉即可 |
| **卸载前查被依赖方、拒绝卸载** 的守卫（PluginManager:182-188） | 正确且必要 |
| `CanvasConnectionEvents/CanvasGroupEvents` 这类事件名常量（types.ts:48,57） | 保留并并入类型化事件映射 |

### 4.2 要重写/替换
| 现状 | 重写为 |
|---|---|
| `createPluginContext` 逐字段手拼面条工厂（PluginContext.ts:139-483 + 30 闭包） | Cordis 式 **Context 类**：`ctx = new Context(...)`，ctx 自己持有 scope 表、事件总线、服务表、disposable 队列；宿主把 registry/vueflow/pinia/dom 当 service `ctx.inject` 进去，插件 `ctx.plugin(p,cfg)` |
| 死掉的 `PluginInstaller/PluginRegistry/PluginDependencyGraph` 三件套 | **直接删除**（P3） |
| 插件手写 `uninstall()` + 一堆 off-handle（AutoSavePlugin:129-144 那套） | 删除；改由 scope 自动 dispose |
| ctx 上的 `getPlugin/getPluginAPI` | 换成 `ctx.inject<Service>(name,impl)` / `ctx.get<Service>(name)` |
| EventBus 字符串 on/off/emit + 类型死规格 CanvasEvents | 类型化总线（§4.3） |
| `ShortcutManager` 模块单例 / `CanvasDomService` 裸 querySelector / Pinia 单例 | 全改成 ctx 注册的服务，随 ctx 生命周期创建销毁（P6/P10） |
| registerComponent / registerEdgeType(0 用) 等断头/冷门 ctx 字段 | 从 ctx 接口删；UI 能力走命名插槽 registry |

### 4.3 类型化事件怎么做的具体草案
给内核配一张事件类型映射（把 v1 的魔法字符串 + runtime/CanvasEvents + 各插件 emit 名收进来）：
```ts
// 事件名常量 → payload 类型（v2 内核自带，插件可 declare module 扩展）
export interface CanvasEventMap {
  'nodesChange': NodeChange[]; 'edgesChange': EdgeChange[]
  'connect': ConnectionInfo; 'connectionRelease': ConnectionReleasePayload
  'nodeDrag': unknown; 'nodeDragStop': unknown
  'selection:change': { nodeIds: string[]; edgeIds: string[] }
  'canvas:setFlag': { key: string; value: unknown }   // P16 后应改成具体 config key
  'storage:saved': { projectId: string }
  'plugins:ready': { plugins: string[]; activationErrors: { name: string; error: unknown }[] }
  // …更多 plugin 自定义事件用 declare module 合并
}
type EventName = keyof CanvasEventMap & string
```
总线签名（scope 版）：
```ts
ctx.on<K extends EventName>(name: K, handler: (payload: CanvasEventMap[K]) => void): Disposable
ctx.emit<K extends EventName>(name: K, payload: CanvasEventMap[K]): void
```
——这样 `ctx.on('connect', (p) => p.)` 有自动补全和 payload 类型；emit 单源（P2-c）、不碰 window（P2-a）。

### 4.4 ctx 方法签名草案（可直接进 v2 内核代码）
```ts
// —— 内核（无 Vue 依赖 or 薄依赖）——
interface Context {
  // 插件装载/生命周期
  plugin<T extends object>(mod: PluginModule<T>, config?: T): this   // 内部每插件建子 scope
  start(): void | Promise<void>                                       // 启动(激活全部已 plugin 的)
  stop(): void | Promise<void>                                        // 停：逆序 dispose 全部 scope

  // 服务注入（取代 getPluginAPI/getPlugin）—— Cordis service
  inject<Service>(name: string, impl: Service): () => void            // 提供服务，返回撤销
  get<Service = unknown>(name: string): Service | null                // 取服务(被依赖插件导出)

  // 事件（类型化）
  on<K extends keyof EventMap>(name: K, h: (p: EventMap[K]) => void): Disposable
  once<K extends keyof EventMap>(name: K, h: (p: EventMap[K]) => void): Disposable
  emit<K extends keyof EventMap>(name: K, payload: EventMap[K]): void

  // 作用域副作用注册（全部自动回收）—— 见 §5
  effect(fn: (dispose: () => void) => void): Disposable              // 通用副作用
  // timer / store watch / DOM 监听统一用 effect 或专门小助手:
  //   ctx.on, ctx.effect(fn=()=>{cleanup}), ctx.inject 返回 Disposable

  readonly scope: Scope                                                 // 当前插件子作用域(内部暴露)
}
```
> v2 里一个插件 = `{ name, deps?: string[], setup(ctx: PluginScope) }`（没有 install/uninstall 分离），`PluginScope` = 根 Context 的可回收子视图：暴露 `on/inject/effect/emit/get/save`，**scope.dispose() 自动逆序清掉该插件注册的一切**。

**关键取舍**：把 v1 的"install/uninstall/activate/deactivate 四段"收敛成**一段 `setup(ctx)`**——安装=建 scope 跑 setup；停=scope.dispose。activate 只作为 `ctx.start()` 对全体的通知（P12 一次性解决）。

### 4.5 在不大动前提下把 Canvas.vue 装配下沉成可测内核
v1 已有一批"想拆但没接线的 composable"（useCanvasFlow/usePluginSystem/useCanvasPanelState，§1.5.12）。v2 直接以它们为蓝本把 Canvas.vue 拆薄：
```
Canvas.vue（宿主，<100 行）
 ├─ useCanvasFlow()           → canvas/pinia + useVueFlow + 节点/边类型合并（已被 v1 写好思路）
 ├─ usePluginSystem()         → new PluginManager→建内核；install/uninstall/getPluginAPI（v1 已写好，改造成 ctx 内核版）
 ├─ useCanvasPanelState()     → 面板态/存储状态桥
 └─ template 只管 <CanvasCore> 根插槽 + settings/overlay 命名插槽（ui-slots 侦察定插槽名）
```
内核侧不 import VueFlow/Pinia/DOM 类型（types.ts 目前 import vue/@vue-flow/pinia，要拆：纯数据类型 vs 框架 API 分离）。让 `PluginManager.resolveOrder/setLifecycle/rollback + Context.scope` 组成的**内核**可被纯 Node 单测（vitest 跑 Kahn/环/回滚/dispose），不碰 DOM。

---

## 5. 可直接写进 v2 内核的结论清单 + 作用域回收具体实现

### 5.1 作用域回收怎么实现（手把手）
```ts
// 核心：每个插件一个 Scope = 一个可回收的 disposable 队列 + 一个事件子集合
class Scope {
  private disposables: Array<() => void> = []   // LIFO 逆序执行
  private children = new Set<Scope>()

  // 登记一个清理函数，返回可二次手动调用的 handle
  onDispose(fn: () => void): () => void {
    this.disposables.push(fn)
    return () => this.off(fn)
  }
  private off(fn: () => void): void {
    const i = this.disposables.indexOf(fn); if (i >= 0) this.disposables.splice(i, 1)
  }

  dispose(): void {
    // 先逆序 dispose 子作用域(依赖方先卸)，再清自己
    for (const c of [...this.children].reverse()) c.dispose()
    this.children.clear()
    for (const fn of this.disposables.reverse()) { try { fn() } catch {} }
    this.disposables = []
  }
}
```
然后让**每一个 ctx 副作用方法**都落到当前 Scope：
- `ctx.on(name, h)` → 底层 `scope.onDispose(() => bus.off(name, h))`（拿到 bus 引用即全自动回收，插件不用存 off-handle）
- `ctx.emit` → `bus.emit`（唯一总线）
- `ctx.effect(fn)` → `fn` 返回的清理函数 `scope.onDispose(it)` —— 统一覆盖 timer（setTimeout 返回 clearTimeout）、`store.watch`（返回 stop）、DOM 监听（addEventListener 返回 remove）、ShortcutManager（register 返回 unregister）
- `ctx.inject(name, impl)` → 服务进 ctx 服务表 + 撤销函数挂进 scope；`ctx.stop()`/插件卸载 → 逆序 dispose 各 scope → **on/effect/inject/timer/watch/DOM/shortcut 一次性全清**，插件不写 uninstall 也安全（治 P1/P7/P11）
- `plugin(name, mod)` 里 `deps` 处理：deps 命中已 `inject` 的服务 → 排序装载；环则报错（吸收 v1 Kahn）

> 这样把 AutoSavePlugin 的 8 个 off + 2 个 addEventListener + externalListeners 手写清理（:129-144）全部归零，插件只需 `ctx.effect(fn)` 一个包裹。

### 5.2 最终"哪些移过去就完事，哪些要改"速查表
**直接搬（完事，几乎零改）**：
- [ ] Kahn 拓扑 + 环检测 + 可读环路径（`PluginManager.resolveOrder/buildCyclePath` 提成纯函数 + 补单测）
- [ ] 生命周期转换表（裁掉 deactivate/inactive 后）
- [ ] EventBus 的 handler 表结构（**删 emit 里的 window.dispatchEvent**）
- [ ] 卸载前"有依赖方则拒卸"守卫
- [ ] 事件名常量（`CanvasConnectionEvents`/`CanvasGroupEvents`）
- [ ] 失败逆序回滚的骨架（改造成走 scope.dispose）
- [ ] `CanvasDomService.onDocument/onWindow` 返回 cleanup 的既有设计（改成 effect 包裹自动回收）

**要改/重写（不能直接搬）**：
- [ ] `createPluginContext` 面条工厂 → Cordis 式 Context 类 + setup(scope)
- [ ] `PluginInstaller/PluginRegistry/PluginDependencyGraph` → **删除**（死代码）
- [ ] 插件手写 `uninstall` + off-handle 堆 → 删除，改 scope 自动 dispose
- [ ] `getPlugin/getPluginAPI` → `ctx.inject/get`（服务注入）
- [ ] 字符串事件 + 死 CanvasEvents 规格 → 类型化 `CanvasEventMap`
- [ ] `ShortcutManager` 单例 / `CanvasDomService` 裸 querySelector / Pinia 单例跨画布 → 收进 ctx 注册服务，随 ctx 创建/销毁
- [ ] `ctx.emit` 不再往 window 抛 DOM；connect 等事件单源 emit（去重/去模板转发）
- [ ] `registerComponent`（断头）→ 从 ctx 删
- [ ] Canvas.vue 741 行 → 拆成宿主薄层 + useCanvas* 内核（采纳 v1 未接线的 usePluginSystem 思路）
- [ ] `registerHandleConfig` 魔法 key 直写 / `canvas:setFlag` 任意改 state → 走 ctx.save + 类型化 config

---

## 附：给架构文档第 1 层的增补意见（一句话每条）
1. 第 1 层"PluginManager 很完善直接吸收"要加注：**只吸收其 Kahn/状态机/回滚/守卫；"作用域自动回收"v1 没有，是 v2 从零造的核心增量**。
2. ctx 事件要定**单源 emit + 类型化 EventMap + 不碰 window**（现在连 window 都抛，双通道是 bug 不是 feature）。
3. scope.dispose 实现要排在 M0 内核第一个验收项——它决定"插件卸载零泄漏"这条 v1 最大痛点能否兑现。
4. 删除死三件套 + 死 CanvasEvents + registerComponent，避免 v2 新包再把历史债务搬进去。
