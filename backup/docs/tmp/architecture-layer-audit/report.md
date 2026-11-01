# 分层与耦合调查 —— packages/kernel · canvas-data · canvas-render · ui · cloud-server · plugins

日期：2026-09-17 · 类型：**只读调查**（未改任何生产代码）
问的人：项目作者
证据来源：codegraph 索引 + 逐文件实读（行号以本次调查时为准）

---

## 〇、一句话结论

你的直觉是对的，但**问题不在"render 里注册了服务"这一件事**，而在三处更根本的地方：

1. **缺"画布基础"这一层** —— 它该做的事被劈成两半：一半留在了 `canvas-data`（菜单/主题/节点注册表/能力层/Context），
   一半落在 `canvas-render` 的 `createMiniCanvasHost`（装配根）。
2. **15 个服务由渲染层的构造函数手写 `new` 出来**（`createMiniCanvasHost.ts:127-243` 的 15 处 `ctx.inject`），
   而内核只认 1 个（`tools`）、能力层只造 2 个（`slots`/`settings`）—— 共 18 个服务里只有 3 个有归属地。
   换一个宿主（无界面/MCP/云端）就得把这 200 行抄一遍 —— 这就是 `mcp-server` 和 `cloud-server`
   各自重写一份 `GraphModel`/`CanvasDocument` 的原因。
3. **`menu` 服务是最典型的一例** —— 它是**数据层里的服务**（`canvas-data/src/canvas/menuService.ts`），
   由**渲染宿主注入**（`createMiniCanvasHost.ts:196`），**只有一个消费者**（`plugin-context-menu`），
   而且它的排序/分组逻辑与插件里那份**逐字重复**。

这正是你担心的那个形状：**每来一个新的 "右键菜单式" 功能，就要在 render 里再加一个服务**。

---

## 一、你要的分层 vs 代码里的分层

| 包 | 你要的职责 | 实际在做什么 | 偏差 |
|---|---|---|---|
| `kernel` | 只做插件相关 API | 装载/依赖/事件/作用域回收/开槽 + **自带 `tools`** + 能力层接缝 | 基本达标；`tools` 是画布味（见 §3.1） |
| `canvas-data` | 只做数据保存 | 数据（nodeStore/edgeStore/graph/save/history/selection）+ **画布语义**（菜单/节点注册表/主题注册表/能力段/连接校验/建节点/画布命令）+ **能力层** + **画布版 Context** | ⚠️ **一个包干了两件事**：数据 + 画布语义 |
| `canvas-render` | 只做 UI 可视化 | 渲染宿主 + 令牌 + **15 个服务的装配根** + 设置持久化接线 + 注册画布命令 + 装配清单 | ⚠️ **组合根坐落在渲染层** |
| `ui` | UI 最终出口 | 成品应用 + **硬编码 22 个插件清单** + 主题配置绑定 + 外部插件清单拉取 | ⚠️ 装配清单写死在应用里 |
| `cloud-server` | 云端版 + MCP 控制画布 | KV + 资源 + 静态托管 + MCP + **自写一份画布文档模型** | 与 `mcp-server` 功能重叠（见 §3.5） |
| `plugins/*`（24 个） | 针对 canvas-render 的扩展 | 消费数据服务 + 渲染令牌 + 注册节点/主题/命令/槽 | 依赖面偏宽（见 §2） |

**缺的那一层，就是你这次会议里说的第 3 条"canvas-data 作为数据保存"与第 4 条"canvas-render 做 UI"之间的夹层：
画布语义/基础能力层。** 它在 2026-09-14 的改造里被拆散了（`canvas-core-v2` 删除），
实现进了 `canvas-data`，装配留在了 `canvas-render`。

---

## 二、实测数据

### 2.1 包规模（不含测试）

| 包 | 文件 | 行数 | 备注 |
|---|---|---|---|
| kernel | — | Context.ts 678 行 | 纯逻辑，零依赖 |
| canvas-data | 53 | 6987 | 数据 + 画布语义 + 能力层 |
| canvas-render | — | createMiniCanvasHost 300 行 / CanvasHost.vue 1184 行 | 渲染 + 装配 |
| ui | 3 | — | App.vue 347 行 |
| plugins/* | 24 包 | — | 消费方 |

### 2.2 服务清单：谁 new、谁消费

| 服务 | 谁提供 | 消费方数 |
|---|---|---|
| `tools` | kernel（`Context.builtinTools`） | 2 个工具插件 |
| `slots` / `settings` | 能力层（`canvas-data/src/canvas/capabilityLayer.ts`） | 5 / 多 |
| `save`/`nodeStore`/`edgeStore`/`graph`/`selection`/`history`/`command`/`nodeFactory`/`menu`/`resources`/`nodeRegistry`/`themeRegistry`/`nodeLayout`/`viewport`/`settingsPersist` | **`canvas-render/src/host/createMiniCanvasHost.ts:127-243`**（15 处 `ctx.inject`；其中 `settingsPersist` 条件注入） | 见下 |

插件硬依赖声明（`export const inject`）的消费热度：
`graph` 12 处 · `selection` 8 · `nodeStore` 7 · `viewport`/`settings` 各 6 · `edgeStore`/`nodeLayout` 各 5 · `command`/`nodeFactory`/`save` 各 3。

**结论：没有任何插件"提供"这些基础服务，全是消费；提供方是渲染宿主的构造函数。**

### 2.3 插件对两层的同时依赖

24 个插件里，18 包 import `@mini-canvas/kernel`，31 包 import `@mini-canvas/canvas-data`，55 处 import `@mini-canvas/canvas-render`。
插件作者至少要认**三个包**（kernel 类型 / canvas-data 类型与 Context / canvas-render 令牌与组件）。

---

## 三、逐条核对你的三个判断

### 3.1 「kernel 应当只针对插件相关 API」—— ✅ 基本达标，一处画布味

`kernel` 依赖为零，只做装载/依赖/事件/作用域回收/开槽/配置 schema。干净。

唯一瑕疵：`ToolRegistry` 的 `ToolRunContext` 里有 `nodeId` / `canvasId` 字段
（`packages/kernel/src/toolRegistry.ts:172,174`），文件头自述"画布场景会放 nodeId/canvasId，别的宿主放自己的键"。
属注释级瑕疵，不影响结构判断。

### 3.2 「canvas-data 作为数据保存」—— ⚠️ 它同时是画布语义层

`canvas-data/src/canvas/` 里有 10 个与"保存"无关的模块：
`menuService`（菜单聚合）· `nodeRegistry` / `nodeRenderer` / `registerNodeType`（节点展示）·
`themeRegistry` / `registerThemeSlot`（主题槽）· `capabilities` / `capabilityTypes` / `capabilityLayer`（能力段）·
`connection`（连接规则）· `nodeFactory`（建节点）· `canvasCommands`（建/删/撤销命令）· `context`（画布版 Context）。

其中 `capabilityLayer` / `capabilities` / `context` 是**插件框架侧的东西**（装配能力段、造 Context），
住在"数据包"里在语义上是错位的。

### 3.3 「canvas-render 作为 UI 可视化」—— ⚠️ 它还兼任了组合根

`createMiniCanvasHost.ts` 干的事（300 行）：
`new Context` → 15 处 `new Xxx()` + `ctx.inject` → 建 `PluginManager` → 冷启动插件 → 注册画布命令 →
声明"常规/画布"配置 → 装配置持久化桥 → 从存储恢复图 → 挂 window。

这里面**只有 `nodeLayout` / `viewport` 两个服务真正属于渲染**（依赖 DOM/ResizeObserver/VueFlow 实例）。
其余 13 个（含 `menu`）都是零 Vue、零 DOM 的画布数据与行为。

**这是本次调查里最具体的一个"放错位置"。** 代价已经能观察到：
`cloud-server/src/mcp/canvasDoc.ts` 开头写明"类型定义就地写（不 import @mini-canvas/canvas-data）"，
因为 `canvas-data` 是 private 工作区包、又绑着渲染层；`mcp-server` 更是自己写了一份 `graph/GraphModel.ts`。
**两个后端各抄一份画布模型，是分层失败的直接账单。**

### 3.4 「menu 服务」—— 你的直觉最准的一处，我把账算清

`menu` 的完整链路：

```
定义   canvas-data/src/canvas/menuService.ts        （数据层）
       MenuService.menuFor(area, creatableTypes) → MenuItem[]
注入   canvas-render/src/host/createMiniCanvasHost.ts:196
       const menu = createMenuService(() => command.list()); ctx.inject('menu', menu)
消费   plugins/plugin-context-menu/src/contextMenuPlugin.ts:165
       ctx.get<MenuService>('menu').menuFor(mode, nodeTypes)   ← 全仓唯一消费者
```

三个问题：

1. **唯一的生产消费者**：24 个插件里只有 `plugin-context-menu` 读它（另有 `canvas-render/src/host/__tests__/nodeTypeIcon.test.ts` 在测试里读）。
   为 1 个消费者在数据层立一个服务、在渲染层加一行注入。
2. **逻辑重复，且旧的那份已成死代码**：`menuService.ts` 的 `GROUP_PRIORITY` / `groupRank` / `DEFAULT_ORDER` / `danger: /delete|remove/i`
   与 `plugin-context-menu/src/menuBuilder.ts:64-92,133-137` **逐字重复**（两份都是 `create:0, '操作':1, '节点':1, '连线':2, …`）。
   而 `menuBuilder.buildMenuItems` 现在**全仓无人调用**（`contextMenuPlugin.ts:165` 已改走 `ctx.get('menu').menuFor`），
   只剩它自己的 `__tests__/menuBuilder.test.ts` 和 `index.ts` 的再导出在引用它 ——
   即：G 项搬迁时**新写了一份、旧的没删**，留下一份带测试的死代码和一个多出来的服务。
3. **位置错**：`GROUP_PRIORITY` 是硬编码的**中文菜单分组名**（`'操作'`/`'节点'`/`'连线'`），
   这是**界面设计**的取值，却写死在数据层里。菜单长什么样、分几组，本该由提供菜单 UI 的插件决定。

**这正是你说的"我这这么多插件其实是最基础的，但你不能单独注册一个服务"的准确形态。**

### 3.5 顺带发现的三处耦合/重复（你没提，但同一个根因）

1. **插件包循环依赖**：`plugin-theme-default` 与 `plugin-node-text` 互相依赖 ——
   双方 `package.json` 互相声明（theme-default:29、node-text:27），
   且 theme-default 的 `inject = ['text']`（`index.ts:38`）依赖 text 插件提供的服务，
   而 text 插件又 import theme-default 的 `MovingHandle`/`ConnectionLine` 组件。
   同理 `plugin-node-image`、`plugin-multi-select` 也依赖 theme-default。
   → 结果是"默认主题"这个插件成了所有节点插件的隐形地基，但它自己又依赖节点插件。
2. **两个 MCP 后端工具名重叠**：`cloud-server` 提供 `canvas.get` / `canvas.batch_nodes` / `canvas.batch_edges`，
   `mcp-server` 提供 `canvas.get` / `canvas.batch_nodes` / `canvas.batch_edges` / `create_node` 等。
   两套同名工具、两套语义化节点模型、两套存储 —— 互不依赖（`cloud-server/src/index.ts:7` 明说），
   但对外是"两个 MCP 服务都能画布"。
3. **`ui` 无入口文件**：`packages/ui/package.json` 声明 `main: ./src/index.ts`，但该文件不存在（实测 `Test-Path` = False），
   同时它的 `dependencies` 里硬编码了 22 个插件包 —— "成品出口"的装配清单写死在应用源码里，
   换一套插件组合要改 `App.vue`。

---

## 四、根因：缺"画布基础层"，也缺"插件自定义扩展点"的通用做法

综合上面，两个根因：

**根因 A —— "画布基础"没有归属地。**
服务定义、能力段、装配三样东西被劈到三个包：
定义在 `canvas-data`（含画布语义）、装配在 `canvas-render`（组合根）、
介于两者之间的"谁提供这些服务"没有物理位置。
于是第二个宿主（无界面/MCP/云端）无法复用，只能抄。

**根因 B —— 扩展点靠"加一个服务"来长，而不是靠"加一种注册"来长。**
内核其实已经有三个通用的注册容器风格：`SlotRegistry`（任意槽 + occupant + order + subscribe）、
`ToolRegistry`、`CommandRegistry`。但画布层没把它们用成套：
`nodes` / `theme` / `commands` 是各自手写的专用能力段，`menu` 又是第四个专用服务。
所以每出现一类新的可扩展物（菜单、工具栏、状态栏、右键项、面板…），**只能再加一个服务**。

> 你问的"你是否可以实现一个注册数据的功能"，方向对：
> 缺的不是某一个服务，而是**一条通用的"注册某类东西"的公开 API**，
> 让插件自己声明新的可扩展种类（"我这一类叫 X，谁都能往 X 里注册"），宿主按种类渲染，
> 宿主不认识具体种类。`SlotRegistry` 已经是这条 API 的内核雏形（`subscribe` 都做好了），
> 只是没把它当成"公开注册场"开放出来。

---

## 五、可选方案（按改动大小排，未拍板不动手）

| 方案 | 做法 | 收益 | 代价 |
|---|---|---|---|
| **A · 最小纠偏** | 把 `menu` 从数据层搬回 `plugin-context-menu`（删掉重复的 `menuService`），宿主注入点 15 → 14 | 立刻消掉"为 1 个消费者建服务 + 逻辑两份" | 低（一个插件内改动 + 删一个文件） |
| **B · 立契约** | 写死服务归属表：哪些归数据、哪些归渲染、哪些归插件；补"插件提供基础服务"的规则 | 有据可依 | 低，但不解决装配散落 |
| **C · 建"画布基础插件"** | 把 `createMiniCanvasHost` 里那 15 行 `new + inject` 收成一个 `canvasBasePlugin`（`apply(ctx)` 内建服务），宿主变一行 | 换宿主零成本；headless/MCP/云端可复用；服务归属唯一 | 中（服务生命周期语义要定：基础插件不可热卸） |
| **D · 开放通用注册场** | 把 `SlotRegistry` 提升为公开 `ctx.registry(kind)` 能力，`nodes`/`theme`/`menus`/未来新种类都建立在它上面 | 新扩展点不再需要新服务 | 高（要动能力段与所有注册调用点） |

建议顺序：**A（先止血）→ C（解决"谁能提供"）→ B/D（长期）**。
C 与早先 `docs/tmp/core-v2-service-ownership/research.md` §四方案 C 是同一件事，当时只做到"实现搬走、装配仍连着"，
装配这一步一直没落。

---

## 六、本次调查用到的命令（可复现）

```powershell
codegraph status                                    # 索引状态（926 文件 / 10940 节点，已最新）
rg -n 'ctx\.inject\(' packages/canvas-render/src/host/createMiniCanvasHost.ts     # 15 个注入点
rg -n 'export const inject' packages/plugins          # 20 个插件的硬依赖声明
rg -n 'ctx\.get\(.menu.)' packages                  # menu 服务唯一消费者
rg -n 'GROUP_PRIORITY' packages                       # 菜单排序逻辑两份
```

## 七、未做 / 待定

- 本次**零生产代码改动**，未跑测试（无需）。索引查询用 `codegraph`，代码检索用 `rg`。
- 未核实 `deepseek-harness` 与本仓的对应关系（用户此前提到过对齐它，本报告未依赖）。
- `docs/STATUS.md` 记录的测试基线（kernel 125 / canvas-data 257 / canvas-render 246 / ui 26 / 插件 872）本次未复跑。
