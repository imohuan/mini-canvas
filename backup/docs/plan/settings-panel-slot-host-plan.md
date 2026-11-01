# 可替换设置面板 + 可扩展 UI 槽任意嵌套 + 边下沉内核 —— 计划

日期 2026-09-05 · 分支 feat/cordis-plugin-system · 作者 code-developer · 状态：待审（未开始实现）

## 〇、指导模型（先读这段，理解为什么这么做）

本计划不是几个孤立补丁，而是把画布架构推向"**内核是唯一知识中心、渲染层可整个换掉**"这条主线的一个里程碑。所有改动都应挂在下面这套模型上：

### 核心一句话
> **一切"数据 / 动作 / 快捷键 / UI / 外观"都注册进内核（零 Vue），渲染层只做两件事：(a) 读内核状态画数据，(b) 按内核声明的 UI 描述渲染界面。** 任何写死在渲染层或 demo 里的"决策/逻辑"都是违规，迟早要下沉。

### 统一的 5 类扩展点（全在内核）
| 类 | 内核容器 | 现状 | 本计划 |
|---|---|---|---|
| ① 数据 | `nodeStore` | ✅ 节点在内核 | **边(edge)也进内核** → 阶段 B 新增 `edgeStore` |
| ② 动作/命令 | `command`（带 title） | ✅ 已在内核 | 删除/撤销/建节点… 都归它 |
| ③ UI 语义槽 | `slots` + 各语义槽 | ⚠️ 只预置 overlay | **设置面板槽** + CanvasHost 内可扩 UI 区 → 阶段 A |
| ④ 外观/渲染注册 | `nodes`段 / `theme` | ✅ nodeShell/edge/bg | 换肤点沿用 |
| ⑤ 快捷键 | （待建 registry） | ❌ 渲染层写死 | 本计划不落，见 §六 后续 |

洞察：②③④ 是同一抽象——"插件声明一个动作，以及它出现在哪些菜单/快捷键/按钮"。将来 menu/toolbar/shortcut 应从已注册命令**自动生成/过滤**，而非各自手写一份。

### "内核到底是谁"（认知地基，避免讨论对不上）
- 内核 = 包 `@mini-canvas/canvas-core-v2`，其活体是每次跑画布时 `new Context()` 得到的那个 **`ctx`** 对象（`createMiniCanvasHost` 里创建）。
- `ctx` 身上挂着四样：① 服务表（`services`，宿主 `ctx.inject('nodeStore'...)` 塞的节点/撤销/命令数据）；② **自带的内置物** `ctx.slots`(放 UI 块) 与 `ctx.settings`(放配置项)——**不是宿主塞的，内核自己 new 的**，所以任何插件天生能用；③ 插件生命周期（plugin/start/install/uninstall + 每插件 fiber）；④ 事件总线（ctx:ready / plugin-installed / plugin-uninstalled / lifecycle-change…）。
- 插件 `apply(ctx)` 拿到的 ctx 是**绑它自己 fiber 的 scope 代理**：注册的东西记在插件名下，卸载自动回收；且插件 `export const inject=['nodeStore']` 声明硬依赖，内核按依赖编排（缺→PENDING 等、提供方被卸→自动回退）。
- **渲染层、插件都围着同一个 ctx 读写** → 插件加的东西宿主自动画得出来；也因此**换 canvas 只换画的那层**，插件与 ctx 一个不改。
- ⚠️ 前瞻：slots/theme 里存的 occupant 现在是 Vue 组件句柄(opaque)。**别把结构焊死成"必须是 Vue 组件"**，将来存成渲染后端无关的"UI 描述"，canvas 适配器才能渲染。

### 渲染层应有的姿态（纯适配器）
渲染层(canvas-render)只做三件事，VueFlow 与未来 canvas 各自实现一份：
1. 读内核 store（节点/边/选中）→ 画出图形；
2. 把用户交互（点击/拖/连/键）→ 调内核命令（不改状态）；
3. 渲染内核声明的那批 UI（槽/面板）= 各 SlotHost/SettingsHost。

因此 CanvasHost 应被越削越薄：把"边数据、快捷键、菜单、外观"这些它现在代管的决策逐个下沉内核（本计划做边 + 设置面板两件），最终只剩一层 VueFlow 装配。

### 本计划在这条线上的位置
- **阶段 A**：把"设置面板"这一个 UI 语义槽做对（可替换 + 喂 settings + 宿主 UI 区），示范"③UI 语义槽"这一类的正确做法。
- **阶段 B**：补"①数据"的最大缺口——边下沉内核，否则任何后端都没边可画。
- 做完后，`CanvasHost` 从"画布宿主 + 一堆写死决策"瘦成"边/设置走内核的纯 VueFlow 适配器"，离"第二套 canvas 适配器"更近一步。

---

## 一、这次到底做什么（两大阶段）

围绕"设置面板能被以后新写的组件替换"这个目标，连带把"核心逻辑独立渲染层、未来可整个换掉 VueFlow"这条主线一起推进。分两个阶段做，各独立提交、独立验证：

**阶段 A（UI 可扩展，先做，改动小）：**
1. 设置面板做成**可替换"皮"（theme 单赢家槽 `settingsPanel`）**：以后你写个新设置组件，装个插件就能顶掉默认面板，卸载自动回退，不碰宿主 demo 一行代码。
2. 面板要能拿到配置数据（`ctx.settings`）——默认面板与替换面板都能读到同一份分组配置数据渲染控件。
3. **SlotHost / 设置面板在"CanvasHost 内部"可用**，宿主 app 层 UI（toolbar/设置 dock/右键菜单这些画布之外的组件）放在 CanvasHost 内部预留的 UI 区，嵌套多层也照常工作。

**阶段 B（边下沉内核，紧随其后，改动大）：**
4. **边（edge）从"VueFlow 内存视觉态"下沉内核成 EdgeStore**（你现在点名要的）。这是"换 canvas 渲染"最大的隐性坑——现在边只在 CanvasHost 本地 `edges` ref，不落盘、不进历史、无法撤销。边进内核后，DOM / canvas 任意后端都有统一边数据源可画。

> 本次计划范围 = 阶段 A 全部 + 阶段 B（边下沉内核）。审计报告里其余大项（右键菜单 Registry、快捷键注册表、全局 ToolbarRegistry）仍不在本计划（见 §六），避免改动爆炸。

---

## 二、背景与现状（为什么现在"换不掉"）

审计结论（`docs/tmp/architecture-extensibility-audit/report.md`）已确认内核机制是好的，缺的是**渲染层消费与"接线"**：

| 能力 | 内核机制 | 现状断点 |
|---|---|---|
| 设置面板 | `ctx.settings`（分组 schema）+ `theme` 单赢家槽 均✅ | 面板组件 `PluginSettingsPanel` 是渲染层导出的**普通组件**，**demo 里硬写一行 `<PluginSettingsPanel :settings="settingsStore"/>`**，从没注册成槽 → 运行时无法替换 |
| 画布内换肤(nodeshell/edge/bg) | ✅ 已用 theme 槽 | CanvasHost `applyTheme()` 读 `winner()` 装配 —— 这是**画布必然要画的**，CanvasHost 消费合理 |
| 通用 UI 槽(SlotHost) | ✅ `ctx.slots` 多 occupant | SlotHost 靠 `useCanvasRender()`（CanvasSurface provide 的 RENDER_CONTEXT_KEY），**只在 CanvasHost 渲染子树内有效**；画布之外的宿主 app UI 用不了 |

两个核心判断：
- **设置面板属于宿主 app 全局 UI，不是画布内在内容** → CanvasHost（画布容器）不该内置渲染它；应由**宿主自己**在根 UI 布局放一个"槽位"去渲染，面板本体走 theme 单赢家槽可替换。
- SlotHost 要"任意地方可用"，本质是把 **ctx 的 provide 作用域从"画布子树"扩大到"宿主业务 UI 层"**。

---

## 三、设计定稿

### A. 可替换设置面板 = theme 槽 `settingsPanel`（单赢家）

- 槽名直接取 `settingsPanel`（ThemeSlot 已允许任意字符串，不必改枚举）。
- 注册 / 消费复用现成 theme 机制：
  - 插件侧 `ctx.theme.register('settingsPanel', 组件, { order })`；卸载自动回退（`ctx.effect` 已处理）。
  - 宿主侧读赢家：渲染层新增薄组件 `SettingsHost`，内部取 `themeRegistry.winner('settingsPanel')` 渲染，**订阅插件装卸重读**（同 SlotHost 事件源）。
- **数据喂法定稿（方案 i：渲染时现取，不注册快照）**：
  - `SettingsHost` 渲染赢家时固定 v-bind `{ settings: ctx.get('settings') }`。
  - 理由：`ctx.settings` 是"画布级恒在数据"，注册时存快照会过期；渲染时现取保证实时。默认 `PluginSettingsPanel` 本就声明 `props.settings`，替换组件只要声明同名 prop 即可。
  - 这是**对 `settingsPanel` 槽特化**的宿主（不是纯通用 winner-host），因为不同 UI 槽要喂的数据不同。通用 winner-host 留给"无数据槽"用（见 C）。

### B. 默认面板落点：写进 theme-default（已定，用户拍板）

- 就在 `plugin-theme-default` 里注册默认设置面板，**不新建独立插件包**。theme-default 本来就是"画布默认皮"插件，把设置面板这层"渲染 UI 皮"一并提供，职责仍一致（只渲染，不带业务）。
- 因 `plugin-theme-default/src/index.ts` 有他人未提交改动，**用独立新文件承载**（如 `src/settingsPanel.ts` 导出模块级 `settingsPanelTheme` / 或在 `apply()` 里注册），避免改动其已改行；注册 = `ctx.theme.register('settingsPanel', PluginSettingsPanel, { id:'default', order:0 })`。

### C. SlotHost / 设置面板任意嵌套 = CanvasHost 内部扩一个"宿主业务 UI 区"（已定，方案①）

- **在 CanvasHost 内部**（不是外层包装）：CanvasHost 提供 ctx（CanvasSurface 已 provide RENDER_CONTEXT_KEY）。把 CanvasSurface 的 ctx 提供点从"仅画布子树"上移/扩展到一个能盖住业务 UI 的作用域，让宿主把 toolbar / 设置 dock / 右键菜单等业务 UI 放进 CanvasHost 预留的 UI 区。
- 具体结构：CanvasHost 现有 `.chost`（画布占满）。加一个**与画布同级的宿主浮层/业务区插槽**，位于 ctx provide 作用域内、画布之上；`pointer-events` 由该区容器统一管理（业务 UI 才可点，不挡画布交互），CanvasHost **不内置任何业务 UI、只给 ctx 能力**。
- SlotHost / SettingsHost 内部 ctx 来源：统一改造为"CanvasSurface 渲染子树用 useCanvasRender、宿主业务 UI 区用同一份 ctx"，两路到同一内核 ctx（不重复 provide）。子组件嵌套任意深都可用。
- 顺带：`settingsPanel` 可作为一个通用可替换 UI 槽 `ThemeUIHost`（读 winner 渲染，给"无数据"的换肤 UI 用）的**第一个特化实例**——SettingsHost = 特化版（喂 settings），通用版见阶段 A 备注，暂不另做以免扩散。

### D. 边下沉内核 EdgeStore（阶段 B 设计）

现状：`createMiniCanvasHost` 只注入 `nodeStore`；history 快照 = `nodeStore.getNodes()`（**不含边**）；`CanvasHost.vue:243-247` 在本地 `edges` ref 上建/删边，落盘只存 graph(节点)。**边无内核数据源、无历史、无持久化**——换 canvas 后端没边可画。

落地方式（新增一个内核服务 `EdgeStore`，与 nodeStore 同构、纯逻辑、零 Vue）：

- **数据结构**：`CanvasEdge { id, type, source, sourceHandle?, target, targetHandle? }`。id = `edgeId(source,target)`（现成函数），源/目标句柄保留（多端口节点将来用）。
- **EdgeStore 接口**（仿 NodeStoreService）：`getEdges() / addEdge / removeEdge / removeEdgesOfNode(nodeId)（删节点连带清边）/ replaceAll(edges) / subscribe(listener)`，纯逻辑可单测。
- **注入**：`createMiniCanvasHost` 里 `const edgeStore = new EdgeStore(); ctx.inject('edgeStore', edgeStore)`，挂到 `host`。
- **历史覆盖边**：history 快照从 `getNodes()` 扩成 **图快照含边**（`{ nodes, edges }` 一起 snapshot/restore）——否则 undo/redo 只回节点不回边。边增删/删节点清边都包进 `withRecord`。改后 `command:delete`（删节点连带删边）、undo、redo 对边全部生效。
- **持久化**：落盘 key 仍 `graph`，值从 `CanvasNode[]` 升级为 `{ nodes, edges }`（restore 时两边一起回填）。**旧数据兼容**：读到纯数组(nodes)就按 nodes、空 edges 处理。
- **CanvasHost 消费**：建边 / 删边 / 删节点清边 / 撤销重做都写 `edgeStore`；`edgeStore.subscribe` → 自动重灌 VueFlow `edges` 渲染态（同 nodeStore 的 subscribe→syncFromStore 模式）；删掉 `CanvasHost` 里本地 `edges.value` 手拼逻辑与 `pruneDanglingEdges` 调用。
- **connection 校验**：`isValidConnection` 里读 `edgeStore.getEdges()` 而非本地 `edges.value`。

> 边下沉后，`CanvasHost` 仍负责"把 edgeStore 画出来"（VueFlow edge-types 装配照旧），但**边的数据/历史/落盘全在内核**——届时换 canvas 后端只需第二个渲染适配器读同一 edgeStore。

---

## 四、落地步骤（阶段 A → 阶段 B，每步独立 commit）

### 阶段 A：UI 可扩展（先做，改动小、可独立验证）
1. **渲染层新增 `SettingsHost.vue`**：读 `themeRegistry.winner('settingsPanel')` + 订阅 `ctx:plugin-installed/uninstalled` 重读 + markRaw + `<component :is :settings="ctx.get('settings')">`。
2. **theme-default 注册默认设置面板**：新文件（不碰 index.ts 他人未提交行）里注册 `PluginSettingsPanel` 到 `settingsPanel(order:0)`，接入包导出。同时渲染层导 `settingsSourceFrom(ctx)`（把 `ctx.get('settings')` 适配成 PluginSettingsPanel 消费的最小接口 `{ groups, groupOf, set, onChange }`），供宿主/面板取数据。
3. **CanvasHost 加"宿主业务 UI 区"**：ctx 作用域扩到业务 UI；SlotHost / SettingsHost 在此区内任意嵌套可用。
4. **改造 CanvasDemo.vue**：把右下 `<PluginSettingsPanel :settings="settingsStore"/>` 的接线删掉，改成在"宿主业务 UI 区"里放 `<SettingsHost slot="settingsPanel"/>`（左上 demo 调试用的 `SettingsPanel :model=cfg` 是 demo 私有、与插件无关，可保留或迁进 UI 区，按需要定）。
5. **验证 A**：vue-tsc 绿 + 渲染层单测（SettingsHost 读 winner 渲染 / 装卸重读 / settings 喂给赢家）+ demo visual（默认面板显示、改配置实时生效、热装 order:-1 假面板即替换、uninstall 回退）。

### 阶段 B：边下沉内核
6. **内核新增 `EdgeStore`** + 单测（add/remove/removeEdgesOfNode/replaceAll/subscribe/clearByNode）。
7. **注入 + history 图快照**：`createMiniCanvasHost` 注入 edgeStore；history snapshot/restore 扩成 `{nodes, edges}`；内核/渲染相关测试更新。
8. **持久化含边**：graph key 值升级 `{nodes,edges}` + 旧数组兼容。
9. **CanvasHost 改读 edgeStore**：建边/删边/删节点清边/undo/redo 走 edgeStore + subscribe 自动刷 VueFlow；删本地 edges ref 手拼逻辑。
10. **验证 B**：内核单测（边增删/删节点清边/undo redo 含边/落盘往返）+ demo visual（连线/删除/撤销/刷新不丢边都正常）。

---

## 五、需你确认（顺序 + 一个取舍）

1. **两阶段顺序**：阶段 A（UI 可扩展）先落地、阶段 B（边下沉内核）紧随其后，对吗？（A、B 几乎不重叠、各自可独立验证，一次全做改动太大不可测，故拆开。）
2. **CanvasDemo 左上那个 demo 私有调试面板（调 cfg.edge/handle 的）**：它跟"插件可替换的设置面板"是两回事（纯 demo 调试业务）。保留还是这次一并收进"宿主业务 UI 区"？

> 其余（theme-default 落点、CanvasHost 内 UI 区、边进内核纳入范围）已按你拍板定稿，无需再确认。

---

## 六、后续方向（记下，本计划不实现）

顺着 §〇 的模型，CanvasHost 要继续下沉的决策，将来按序做：
1. **右键菜单 / 动作走注册表**（MenuRegistry，area/nodeType/visible 约束）——从手写菜单改成"渲染内核声明的菜单"，插件才能给任意宿主加菜单项。
2. **快捷键→命令注册表**（shortcut registry）——把 Delete/Ctrl+Z 从 CanvasHost 写死的 keydown 移出，声明式绑定命令。
3. **全局 ToolbarRegistry / 语义槽落点**——toolbar 等从"demo 手写"变"内核声明"。
4. **端口声明化**——BaseNode 固定单进单出 → 节点声明 ports，壳按声明生成 handle。

这些都属于"把 CanvasHost 收薄成纯 VueFlow 适配器 + 内核标准接口"，换 canvas 时与 VueFlow 适配器配套实现。每步独立可验证、可 commit。
