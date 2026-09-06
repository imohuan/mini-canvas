# canvas-render + 4 插件 —— 只读差距审计报告

- 分支：`feat/cordis-plugin-system`（只读审计，未改任何代码 / git）
- 审计面：`packages/canvas-render/src/**`、`packages/plugins/{plugin-node-text,plugin-node-image,plugin-canvas-commands,plugin-theme-default}/src/**`
- 只读参照：`packages/canvas-core-v2/src/core/**`、`docs/plan/canvas-core-v2-dsh-gap-plan.md`、`packages/canvas-core-v2/demo-web/**`（仅用于对照“能力是谁消费”）
- 约定：渲染层 Vue provide/inject 令牌（HOST/NODE_WRITE/CANVAS_PARAMS/EDGE_VISUAL/EDGE_SELECTION/NODE_REGISTRY）是刻意“双注入系统”设计，不作为问题。

行号以审计当下文件为准。严重度：高 / 中 / 低 / 信息。

---

## 1. Config schema：模块级 Config 声明，渲染层/插件完整消费吗？（重点）

### 1.1 【信息】事实：只有 theme-default 一个插件导出了模块级 `Config`，且只有标量字段
- 证据：`packages/plugins/plugin-theme-default/src/index.ts:48-67`（Config: select/color/number/boolean 共 7 键）；而 `plugin-node-text/src/nodeTextPlugin.ts`、`plugin-node-image/src/nodeImagePlugin.ts`、`plugin-canvas-commands/src/canvasCommandsPlugin.ts` **均无 `export const Config`**。
- 现状：背景所述“4 插件均用模块级 Config schema”不成立——实际仅 theme-default 用上了 P4/P3 Config 通道。
- 建议改法：text/image/commands 目前没有任何“可配置项”，本无可再声明；若要支持装配层覆盖（如 commands 是否注册撤销/重做、image 默认尺寸），再补 Config。**不改也行**，纯信息澄清。
- 风险：无。只纠正认知偏差。

### 1.2 【中】B3 的 array/object 字段被内核主动丢弃，不进 SettingsStore / 面板 —— 属“设计决策”，但渲染层没有替代可视化
- 证据：`packages/canvas-core-v2/src/core/Context.ts:277` `if (!isScalarField(field)) continue`（array/object 跳过登记）；`packages/canvas-core-v2/src/core/configSchema.ts:152-155` `isScalarField`（array/object 非标量）。
- 证据：`packages/canvas-render/src/components/settingsPanelTypes.ts:7` `set(key, value: string|number|boolean)` 与 `valueOf` 只收标量；`PluginSettingsPanel.vue:41-49` 值类型仅标量。
- 现状：B3 的能力落在 configSchema（array/object 可供 `apply(ctx,config)` 用、逐元素/键校验补默认），但 SettingsStore / PluginSettingsPanel **完全看不到** array/object 字段——两者类型与循环都只认标量 5 型。因此“array/object 字段被丢”判定为**真**，且是内核与面板一致的设计（configSchema.ts:31 注释“不登记进 settings 单一数据源”）——不是 bug，是**刻意不展示**。
- 建议改法（真正可落地，选做其一）：
  1. 若目标“结构化配置也要面板可视化/编辑”，需同时扩内核 SettingsStore 的 value 模型 + `PluginSettingsPanel` 模板加 array/object 递归控件 + `settingsPanelTypes.set` 放宽签名 —— 改动面大（跨内核+渲染层），**建议先不碰**，B3 本来就是“给 apply 的结构化 config”用途。
  2. 最小优化：给 `PluginSettingsPanel` 加一个“未渲染的复杂字段”提示位（遍历到 array/object 时显示 `[复杂字段，仅脚本可配]` 占位），避免作者以为字段丢了。改动面=仅面板一个组件，低风险，需补快照/单测。
- 风险：当前设计下无运行时错误；风险只在“作者以为 config 能进面板却静默不可见”。

### 1.3 【中】渲染层没有“注册表→面板”的规范装配；PluginSettingsPanel 只是导出件，接线全在外部 demo
- 证据：`packages/canvas-render/src/index.ts:26` 导出 PluginSettingsPanel；全仓 `PluginSettingsPanel` 唯一使用处在 `packages/canvas-core-v2/demo-web/CanvasDemo.vue:196`；`canvas-render` 包内无任何 settings source / 面板接线。
- 证据：CanvasHost.vue 不 provide 面板、不暴露默认 settings 面板槽；调用方要自己 `onReady` 里 `ctx.get('settings')`（demo CanvasDemo.vue:121）。
- 现状：Panel 是纯可复用展示件，宿主自装。这符合“面板归宿主 UI”边界（与“不越权内置工具栏”设计一致），不算 gap；但**没有任何示范/复用入口把 ctx.settings 变成一个可用面板源**，导致每个宿主都要手写 `bindThemeSettings` 那段同步。
- 建议改法：给 `canvas-render` 加一个薄导出，如 `settingsSourceFrom(ctx)`（内部 `ctx.get<SettingsStore>('settings')` 返回满足 SettingsPanelSource 的对象）或一个 `CanvasSettingsSlot` 默认渲染槽（order 语义同 overlay），让宿主一行接面板。改动面=render 包 + 可选 demo，低风险。
- 风险：不改功能不影响；只是复用性差。

---

## 2. ctx 事件分发（on/emit…）：插件/渲染组件是否仍走私有通信，本可走类型化事件？

### 2.1 【信息】事件分发“用上了”，但只有内核/宿主内部在监听系统事件，业务侧未使用类型化事件
- 证据：`CanvasHost.vue:323-333` `host.ctx.on('ctx:plugin-installed'/'ctx:plugin-uninstalled', ...)`（宿主监听内核系统事件做重装配）；`createMiniCanvasHost`/`Context` 端 `bus.emit('ctx:ready'/'ctx:plugin-installed')`（core Context.ts:163,260）。
- 现状：宿主已消费内核系统事件；业务（插件⇄插件、content⇄宿主、边⇄选中）**仍用 Vue provide/inject 令牌 + host 字段直传**（见 §6/§7），没有一处走业务自定义 `ctx.emit/on`。
- 结论：render/插件内的通信场景几乎都能被“双注入系统”+服务调用覆盖（选择高亮走 EDGE_SELECTION、编辑走 service、命令走 host.command），**并不存在“本可用类型化事件却被私有化绕过”的明显反例**。唯一可议处：text/image 的 content 都通过 `HOST_KEY → host.ctx.get('xxx')` 直连 service 做写回，这是“组件点对点调服务”，属正常依赖调用而非应转事件的广播语义。
- 建议改法：可不在本期引入业务事件；若未来做“节点增删/选中变化的跨插件广播”（如自动布局、联动插件），再用 `ctx.on('node:changed')` 之类，并配 declare Events 类型。当前非 gap。
- 风险：无。

---

## 3. B1 async 副作用：渲染/插件里是否有裸 setTimeout/promise 未走 fiber.effect（卸载不被收编）？

### 3.1 【低】发现 1 处 `setTimeout`（MovingHandle 的 hover 归位计时器），但已被 Vue 生命周期回收，不是漏网副作用
- 证据：`packages/plugins/plugin-theme-default/src/MovingHandle.vue:198-203`（`hideTimer = setTimeout(...)`）+ `onBeforeUnmount(() => clearTimeout(hideTimer))`（MovingHandle.vue:213-216）。
- 现状：这是 DOM 级 UI hover 计时器，归 Vue 组件生命周期管（卸载即 clear），**不属于需要 fiber.effect 收编的插件副作用**。不构成 B1 违规。
- 建议改法：无。保持现状即可。
- 风险：无。

### 3.2 【中】插件层自身**没有**主动使用 fiber.effect 来登记任何异步/一次性副作用；长驻“无状态副作用”全靠 Vue 组件 onBeforeUnmount
- 证据：render/plugins 生产代码里 `ctx.effect(` 零出现（仅 `host/__tests__` 有）；插件所有 UI 清理都靠 `.vue` 的 `onBeforeUnmount`（TextContent.vue:54、CustomEdge.vue:151、BaseNode.vue:102、DefaultBackground.vue:99 等）。
- 现状：B1（fiber async settle）是内核已具备的能力；当前插件恰好没有跨 Vue 的常驻副作用，所以没有“该收编却没收编”的实例。但**一旦某个纯逻辑插件（无 Vue）想跑定时器/长异步，仓库里没有任何示范**教它走 fiber.effect，作者极易裸写 setTimeout 造成卸载泄漏（这正是 B1 想防的）。
- 建议改法：给某纯逻辑插件（如 canvas-commands）加一段“用 ctx.effect 登记并依赖其返回的 disposer”的注释/用法锚点，或在 plan 里写明“fiber.async/effect 是插件收编异步副作用的入口”。改动面=文档+可选一行注释，低风险。
- 风险：不修则 B1 能力对插件作者“存在但不可见”，将来新增常驻副作用的插件易走老路（裸 setTimeout）重新引入泄漏。

---

## 4. B4 ctx.registry / manager.list/diagnose：宿主/插件有没有接上诊断枚举？

### 4.1 【中】manager.list/diagnose 只在 demo dock 消费了 list，diagnose 无任何生产/演示调用
- 证据：`packages/canvas-render/src/host/pluginManager.ts:100-104` 定义 list()/diagnose()/applyManifest()；唯一消费在 `canvas-core-v2/demo-web/CanvasDemo.vue:84` `manager?.list()`（dock 展示 state/missingDeps/error 徽标）。
- 证据：全仓无 `diagnose(` 调用（见 grep）；applyManifest 无调用（见 §5）。
- 现状：list 的 fiber-state 诊断链被 demo 用到了（CanvasDemo.vue:96-109 pmStateLabel 读 state/missingDeps/error），但 **manager.diagnose()（专筛非 active）没有出口**；CanvasHost 组件自身不做任何“PENDING/FAILED 提示”。
- 建议改法：CanvasHost 可在 boot 后于 `manager.diagnose()` 有非空时 `emit('boot-warning', diagnose())` 或内置一条状态条，宿主可感知“某插件没起来”。改动面=CanvasHost.vue 少量逻辑，需单测/快照补，中低风险。
- 风险：不改则 FAILED/PENDING 只靠 demo 手动看，真实宿主拿到一个“悄悄没装上的插件”无感知。

### 4.2 【低】CanvasHost 内部读 overlay 走 `h.ctx.get('slots')`，绕过已有的 ctx.slots 能力收口
- 证据：`CanvasHost.vue:190` `h.ctx.get<{list...}>('slots').list('overlay')`；而 Context 已把 `ctx.slots.occupants('overlay')`（capabilities.ts:180-186）作为能力挂上（同 `builtinSlots` 实例）。
- 现状：两种路由指向同一实例，数据一致，但宿主用原始 `.get('slots')` 而插件用 `ctx.slots`，属“能力段双轨”里的小不一致（同 §7）。
- 建议改法：CanvasHost 改用 `h.ctx.slots.occupants('overlay')`（类型更内聚）。改动面=1 行，低风险。
- 风险：无。

---

## 5. B5 applyManifest disabled：demo/宿主真用吗？冷启动走 coldPlugins 还是 applyManifest？

### 5.1 【中】demo/宿主冷启动走 coldPlugins；applyManifest（含 disabled）只存在于 pluginManager 与未消费的 baseManifest
- 证据：CanvasHost.vue:299-304 把 `props.plugins` 传入 `createMiniCanvasHost({ coldPlugins: ... })`；createMiniCanvasHost.ts:131 `for (const p of opts.coldPlugins ?? []) ctx.plugin(p)`。demo（CanvasDemo.vue:33-40）也传 plugins 数组。
- 证据：`applyManifest` 无任何调用；`baseManifest.ts`（含 `disabled` 能力）定义在 demo 目录却未被 import（main.ts 只 mount CanvasDemo）。B5 的 `disabled`（pluginManager.ts:177-190）是“能力就位但无入口被启用”。
- 现状：canvas-render 冷启动只吃 coldPlugins，**完全不经过 manager / manifest**。想要 B5 disabled、per-plugin config 覆盖、同 id 换版本等目标 D 语义，宿主必须自己拿 `manager`（expose）再 applyManifest——组件/工厂不提供“manifest 模式”的冷启动开关。
- 建议改法（小而可落地）：给 `createMiniCanvasHost`/`CanvasHost` 加可选 `manifest?: PluginManifest`（给则冷启动 `manager.applyManifest(manifest)`，缺省仍走 coldPlugins 保兼容），并在 CanvasDemo 用 baseManifest 顶上，验证 disabled。改动面=factory+CanvasHost 少量 + demo 装配，需补单测，中风险（动到冷启动装配路径，回归要跑 fullchain/pluginManager 测试）。
- 风险：不改则 B5/disabled/config-override 只能靠二次 applyManifest 手动补，属“实现了但没人用”的隐藏能力。

---

## 6. 服务消费一致性：.ts / .vue 里还有 `ctx.get('x')` 本可 declare module 直访 ctx.x 的？

### 6.1 【低】node-text / node-image 的 Service 方法用 `this.ctx.get('nodeStore'/'save')`，而 commands 插件同场景用直访 `ctx.nodeStore/...` —— 两套风格并存
- 证据（用 get）：`plugin-node-text/src/nodeTextPlugin.ts:48,55,56`、`plugin-node-image/src/nodeImagePlugin.ts:41,49,50`。
- 证据（直访）：`plugin-canvas-commands/src/canvasCommandsPlugin.ts:43` `const { nodeStore, save, nodeFactory, selection, history } = ctx`，且它在 declare module 里补了 `interface Context { nodeStore... }`（canvasCommandsPlugin.ts:28-36）。
- 现状：commands 靠 `declare module Context { nodeStore/save/... }` 直访并通过 tsc；text/image **没有**把 nodeStore/save 声明进 Context，所以方法里只能 `.get('nodeStore')`。两者都正确工作、都不缓存（惰性取），区别只在“是否有直访类型增强”。风格不统一、契约重复（text/image 也重复声明了 `TextNodeService`/`ImageNodeService` 接口）。
- 建议改法：让 text/image 各自也把 `nodeStore`/`save`（它们是宿主恒在服务）declare 进 Context 并直访，与 commands 统一；或反之全部回退 `.get`。属收尾一致性整理，低风险（纯类型层+方法体内取引用方式等价）。
- 风险：无功能影响。

### 6.2 【低】TextContent 的 content 组件经 `HOST_KEY.value.ctx.get<TextNodeService>('text')`，未用 ctx.text 直访增强
- 证据：`plugin-node-text/src/TextContent.vue:17` `h.ctx.get<TextNodeService>('text')`；而 nodeTextPlugin.ts:31-35 已 `declare module interface Context { text: TextService }`。
- 现状：因为已声明增强，这里本可 `h.ctx.text`（类型直访）而不是手动 `.get<TextNodeService>` 再自己维护接口形状。功能对，风格未用上“declare module 直访”的新写法——正是 memory 里 v2 统一走 ctx.x 的意图未被 .vue 消费。
- 建议改法：把 content 组件内改成 `h.ctx.text.addTextNode/editText`，省掉手动 `TextNodeService` 桥类型。低风险，需 text 插件相关单测/快照回归。
- 风险：无。

---

## 7. 能力段双轨：CanvasHost 把 selection/history/command/nodeFactory/save 存成 host 字段供 Vue，同时 ctx 也提供 —— 是否双轨不一致？

### 7.1 【中】host 字段与 ctx 服务指向**同一实例**（数据一致），真正双轨的是“选中态”：Vue ref（selectedIds）与内核 Selection service 需手工同步
- 证据（同实例）：createMiniCanvasHost.ts:102-128 各自 `new` 后 `ctx.inject('save'/'nodeStore'/...)` 并同时塞进 host 对象（:144-160），即 host.command===ctx.get('command')、host.nodeStore===ctx.get('nodeStore')。所以 CanvasHost.vue 里 `h.command.execute`、`h.save.set`、`h.history.canUndo()` 与插件 `ctx.nodeStore`/`ctx.commands` 操作的是同一对象——**非数据不一致**。
- 证据（选中态双源，重点）：CanvasHost.vue:137 `selectedIds = ref<ReadonlySet>`（给 CustomEdge 高亮用）+ CanvasHost.vue:229/234 `h.selection.set/clear`（给 command:delete 用）。两处都要在 `onNodeClick`/`onPaneClick`/键盘删除（:264-277）里**手动成对更新**，一漏即错位。
- 证据：onKeydown 删选中时 `h.selection.set(ids); h.command.execute('command:delete'); selectedIds.value = new Set()`（CanvasHost.vue:266-271）——重复写同一“选中集”两遍。
- 现状判断：host 的 selection/history/command/nodeFactory/save 字段是“Vue 侧拿到服务的便捷别名”，**与 ctx 服务同一引用，可安全精简但非 bug**；真正值得警惕的是 `selectedIds`（Vue）与 `Selection`（内核）两套“当前选中”互为镜像、靠事件手工同步——这才是潜在漂移点（例如未来有第二个入口改 selection，Vue ref 不更新，CustomEdge 高亮就错）。
- 建议改法（可选，勿轻易动）：选中集方向应“单源”——内核 Selection 已是单源，Vue 侧只留一个订阅 `selection.ids` 变化更新 `selectedIds` ref（读内核做高亮），删除/点击统一只写内核 Selection，让 CustomEdge 高亮与 command 同源。改动面=CanvasHost 交互段+CustomEdge 读取源（现读注入 ref 集合），属架构级微调，需连带补交互测试，**建议纳入后续重构而非本期**，风险中等。
- 风险：当前手工同步在现有入口下够用（点击/清空/键盘三处都已成对），暂无已见 bug；但扩展面小，属可接受的“已知双轨”。

---

## 附带发现（非 7 条主线，但属 render/plugins 面真实残留）

- 【低】`packages/plugins/plugin-node-image/src/nodeImagePlugin.ts:79` `ctx.inject('image-meta', { v: 1 })` 是“开发期 HMR 演示”注入，非业务能力，常驻生产代码且无人读（仅文档自引）。建议移出或加 dev 开关。
- 【低】`packages/plugins/plugin-node-text/src/_p7_sticker_probe.ts` 无人引用（grep 空），疑为早期探针遗留文件，可考虑清理（先确认 git 历史后再删）。

---

## 按价值排序的可执行优化清单

| # | 优化项 | 改动面 | 风险 | 是否动测试 |
|---|--------|--------|------|-----------|
| 1 | **manifest 冷启动开关**（createMiniCanvasHost/CanvasHost 增可选 `manifest`，给则 applyManifest 顶上 coldPlugins），让 B5 disabled/config-override 真正有入口；demo 用 baseManifest 验证 | createMiniCanvasHost.ts + CanvasHost.vue + demo/baseManifest 接上 | 中（动冷启动装配路径） | **是**：补 createMiniCanvasHost/pluginManager 装配用例，跑 fullchain/pluginManager 回归 |
| 2 | **插件卸载/加载失败可视化**：CanvasHost boot 后查 `manager.diagnose()` 非空则 emit 告警/状态条 | CanvasHost.vue | 中低 | **是**：CanvasHost 行为快照/事件测试 |
| 3 | **选中态单源化**（Vue selectedIds 改订阅内核 Selection，而非手工成对同步） | CanvasHost.vue 交互段 + CustomEdge 读取源 | 中 | **是**：交互/高亮测试 |
| 4 | **服务消费/直访统一**：text/image 把 nodeStore/save declare 进 Context 直访（与 commands 对齐）；TextContent 改用 ctx.text | nodeTextPlugin.ts / nodeImagePlugin.ts / TextContent.vue | 低（纯类型+引用取法等价） | 是：插件 tsc + fullchain |
| 5 | **ctx.slots 收口**：CanvasHost 改 `h.ctx.slots.occupants('overlay')` 取代裸 `.get('slots')` | CanvasHost.vue | 低 | 可不动（等价）或加断言 |
| 6 | **PluginSettingsPanel 复杂字段占位**（array/object 不静默消失）+ 可选 `settingsSourceFrom(ctx)` 复用入口 | PluginSettingsPanel.vue + settingsPanelTypes.ts + render index | 低 | 是：面板快照 |
| 7 | **移出/隔离 image-meta 开发注入** 与清理 _p7_sticker_probe | nodeImagePlugin.ts / node-text src | 低 | 是：插件测试引用调整 |
| 8 | 文档标注 B1/B3 对插件作者的正确用法（fiber.effect 收编异步、array/object 仅 apply 不上面板） | docs（plan/注释） | 无 | 否 |

> 说明：#3 因涉架构微调且当前入口已手工同步到位（无已见 bug），放中优先级并建议单独一轮做；#6 若接受“array/object 本就不上面板”的设计，则只需占位提示即可。
