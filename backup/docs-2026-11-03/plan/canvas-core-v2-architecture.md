# canvas-core-v2 架构设计文档（正式版）

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 状态：**待审批**（需用户拍板后才能开工）
依据：三路子代理侦察 `docs/tmp/canvas-core-v2-survey/{host-runtime,ui-slots,persist-inventory}.md` + 本人 v1 草稿整合。

---

## 一、定位与目标

在**新项目 `packages/canvas-core-v2`** 从零自研一个 **Cordis 风格的画布引擎内核**（不用现成 Cordis 库，理由见 survey/cordis-research.md：其 API 未稳定、无 Vue/pinia/UI 绑定、文档在建）。

要解决 v1 的四大病（来自 persist 侦察）：
1. **保存挂错时机**：shortcut 只在 Canvas.vue `onUnmounted` 落盘、后端只有手动 `/save` 落盘 → 刷新/后台重启即丢。
2. **同一数据写多处且不一致**：StoragePlugin FS 先写 localStorage 再写 FS；AutoSave beforeunload 直写键绕过抽象；MCP 视图本地/后端双 authority。
3. **一锅端整写、无字段 key**：`useStorage('canvas-state')` 一个键装 core 设置 + 各插件 config + shortcutKeymap，改任一开关整串 JSON 重写、无防抖。
4. **Canvas.vue 是 741 行上帝组件**：装配/事件桥/状态同步/UI 接线/生命周期全手写，多个死 composable 与之重复。

v2 承诺：**所有持久化走 `save(key,value,type)` 一个入口**；画布核心逻辑收敛进可独立测试的内核；UI 开放命名插槽；canvas-core 从 180 文件乱摊子收敛成清晰分层。

---

## 二、分层结构（由内到外）

```
┌─────────────────────────────────────────────────────────┐
│ 5. Host 适配层（薄）—— 对接真实宿主/视图，提供根插槽容器     │
│    （VueFlow 挂载 + SlotRenderer 根 + 生命周期桥）          │
├─────────────────────────────────────────────────────────┤
│ 4. Registry + UI Slots 层 —— 命名插槽化 UI 注入点          │
│    （settings/canvas/overlay/context-menu/node/toolbar）   │
├─────────────────────────────────────────────────────────┤
│ 3. Save 层（统一 key-value 持久化）                       │
│    save(key,value,type) / get / remove；可插拔后端适配器   │
├─────────────────────────────────────────────────────────┤
│ 2. State 层（pinia 响应式）—— 全局 store + 插件命名空间     │
├─────────────────────────────────────────────────────────┤
│ 1. Core 内核（Cordis 概念，无 Vue 依赖或薄依赖）            │
│    Context / ctx.plugin / ctx.inject / ctx.on / 作用域回收  │
└─────────────────────────────────────────────────────────┘
```

### 第 1 层 Core 内核（最小 Cordis 概念自研）

职责：插件生命周期 + 依赖注入 + 事件总线 + 副作用作用域回收。**可脱离 Vue/pinia 独立单测**。

核心 API 草案：
```
const ctx = createContext('canvas')            // 根上下文
ctx.plugin(pluginModule, config)               // 注册并启动插件（内部给每个插件建子作用域）
ctx.inject<Service>(name, impl)                // 提供服务（可被依赖插件消费）
ctx.get<Service>(name)                         // 取服务（依赖插件的导出函数 / 其它能力）
ctx.on(event, handler) / ctx.emit(event, payload)  // 类型化事件总线
ctx.start() / ctx.stop()                       // 内核启停
ctx.scope                                        // 每个插件一个子作用域，卸载自动 dispose
```

要点：
- **作用域回收**：插件卸载（或 ctx.stop）时，其注册的 `on`/`inject`/timer/watch/DOM 监听全部自动解除。这一条直接治 v1 里 ShortcutManager 单例累积、onUnmounted 忘注销的坑。
- **插件互调**：靠 `ctx.inject/get`（等价 Cordis service），替代 v1 的 `getPluginAPI/getPlugin` 隐式耦合。
- **可移植资产**：v1 的 `EventBus`、`PluginManager`（Kahn 拓扑/循环依赖/生命周期状态机/回滚）已很完善，直接吸收为内核实现，不推倒重写。

### 第 2 层 State 层（pinia）

职责：响应式状态统一由 pinia 管。分两类：
- **运行时响应式 state**（不落盘）：选中态/拖线态/viewport 等。
- **可持久化 state**：经 Save 层落盘。

沿用并强化 v1 的"插件名=命名空间"思路（`state.plugins[pluginName][key]`），但**把 core 设置 + 各插件 config + shortcut 拆开各自归属 type 与 key**，不再挤一个键。

### 第 3 层 Save 层（用户核心诉求）—— 统一 key-value

对外入口：
```
ctx.save.set(key, value, type?)        // 默认 type 可省略
ctx.save.get(key, type?)
ctx.save.remove(key, type?)
ctx.save.flush()                        // 可靠 flush 点（可挂 beforeunload/visibilitychange/定时）
```

**四类内置 type**（可扩展）：
| type | 存什么 | 默认落点（可插拔替换） | 治 v1 的什么坑 |
|---|---|---|---|
| `config` | 全局/插件设置项，字段级 key | localStorage（分键，不再一锅端） | 整串整写、无字段 key、config+shortcut 同键 |
| `canvas` | nodes+edges+项目元数据 | 本地 StoragePlugin **或** 云端 BackendStorage | 双 authority 分裂、batch 不落盘静默丢 |
| `resource` | 字节资产（内容 SHA-256 assetId） | IndexedDB / FS / 后端 | 三种落点寻址不统一 |
| `shortcut` | 快捷键 keymap | config 分离独立 type 持久化 | 卸载才落盘、只脏导出、导入不改 store |

**设计要点**：
1. **key 命名规范**：`save(namespace, key, value, type)`，治 v1 五套五花八门命名。示例 `save.set('canvas:project:<id>', {nodes,edges}, 'canvas')`、`save.set('plugins:theme.accent', color, 'config')`、`save.set('shortcut:keymap', map, 'shortcut')`。
2. **一个 (key,type) 单一权威落点 + 可选多副本但原子一致**：治"同一数据写多处"。cloud/local 由**接入层按"当前画布 authority"选定**存储后端（默认本地 / 云端同步插件可插拔、各管一套互不干扰）。
3. **字段级落盘 + 统一防抖/批量**：不再改一个开关就整写全串。
4. **落盘时机改"改即入队 + 可靠 flush"**：禁止把持久化挂在组件卸载或用户手点。shortcut remap/import 即写；canvas 有 lifecycle flush（beforeunload/visibilitychange/timer）兜底。
5. **shortcut 存全量或带 schema 版本**，不"只脏导出"。
6. **后端按 type 分发**：`ctx.save` 的云端 adapter 把 config/canvas/resource/shortcut 各自路由到对应后端端点（复用 mcp-server 现有 /save、/resources 接口思路），本地 adapter 则全落浏览器。

### 第 4 层 Registry + UI Slots 层

把 v1 隐式的筛选约定（position/group/areas/nodeTypes）**显式化为命名 slot + provider**，一份注册项既能进默认渲染组件、也能被宿主经具名 slot 替换/增强。**注册即响应式**（沿用 v1 `reactive(Map)` 语义）必须保留。

**建议 slot 名集合**（来自 ui-slots 侦察）：
- 画布级：`settings:`（DynamicSettingsPanel）、`canvas:perf`（把硬编码改 registry 驱动，可选新增 `canvas:toolbox`/`canvas:minimap`）
- 浮层级：`overlay:viewport` / `overlay:canvas` / `overlay:root`（**接管空置的 mountOverlay**，补上 Component 可挂）
- 右键菜单级：`context-menu:{mode}`（pane/node/edge/connection，替代散落 areas）、`context-menu:create`
- 节点级（按 nodeType 命名空间）：`node:{type}:title/top-toolbar/content/bottom-toolbar`、`node:{type}:overlay:{mode}`
- 通用：`toolbar:{position}`、`command:{id}`
- 对话框：**启用 DialogRegistry 或删除**（别留悬空）

**必须收敛的重复**：
- 两份右键菜单解析器（MenuRegistry.resolveMenuItems vs ContextMenuPlugin.resolveItems）→ 合成一份。
- selfRender 节点（图片/视频）写死 BaseToolbar 绕开 registry → **v2 一律走 toolbar-provider**。
- Toolbar 用 `source==='multi-select'` 特殊过滤的脆判断 → 改显式 scope/slot。
- group 语义（编辑模式 vs 折叠分组）别混用。

### 第 5 层 Host 适配层（薄）

v1 Canvas.vue（741 行上帝组件）→ 拆成：**宿主只负责"建内核 + 提供根插槽容器 + 生命周期桥"**，其余全走插件/registry。

- VueFlow 事件→eventBus 硬编码转发（模板 L681-695）→ **声明式事件适配器/自动转发**，加新事件不改模板。
- 快捷键三方硬同步（ShortcutManager↔VueFlow refs↔store）→ 交插件/服务（内核 ctx 提供），不再 Canvas.vue 手写。
- 整批 core 设置项硬注册 + store 默认值两处重复定义 → **收敛为"一份声明（key+默认值+面板 schema）"统一驱动 store 初始化+面板+持久化**，正是统一 key-value 的直接受益点。
- `canvas:setFlag` 后门直写 store → 换白名单 setter/服务。
- 硬编码 DOM 常量（CANVAS_ID/`#app`/viewport 选择器）→ 运行时挂载点配置，支持多实例。

---

## 三、依赖关系与边界

| 依赖方向 | 说明 |
|---|---|
| Core ← State ← Save ← Registry/UI ← Host | 内层无外层依赖；Host 是最外层 |
| Core 无 Vue/pinia 依赖 | 可独立单测，是最想保住的价值 |
| State 依赖 pinia + Core | pinia 仅响应式，不负责落盘 |
| Save 依赖 State + Core | 读 pinia 镜像、写后端/本地 |
| 插件依赖 Core（ctx.inject/get）| 插件可相互依赖、调对方导出函数 |

---

## 四、里程碑规划（建议，待用户确认）

> 以下拆分是**建议**，节奏与范围请用户在批准时一并确认；"重写 or 迁移老节点"等旧开放问题也在下面列明。

- **M1 内核骨架**：ctx.createContext/plugin/inject/on/scope 最小实现 + 插件生命周期（吸收 v1 PluginManager）+ 内核单测。产出可在 Node 环境跑的 Cordis 式最小内核。
- **M2 pinia State + Save 层**：全局 store + 插件命名空间 + `save(key,value,type)` + 本地/云端两套可插拔存储 adapter + 落盘时机改造。产出统一 key-value 持久化可跑通。
- **M3 Registry + UI Slots**：命名 slot 化 + SlotRenderer + 收敛重复（菜单 resolver/selfRender/toolbar）。
- **M4 首个 Demo Host**：用新内核 + 一个简单节点跑通"建内核 → 装插件 → 画布渲染 → 编辑 → 保存 → 刷新恢复"闭环。

---

## 五、待用户拍板的决策点

1. **节奏**：上面 M1→M4 按顺序走、每步可验证，是否认可？（建议：是）
2. **首个 Demo 内容**：建议用最简节点（如文本）+ 本地存储跑通闭环，不做完整图片/视频（那些在 M4 之后的迁移期做）——认可吗？
3. **老节点迁入 vs 重写**：180 文件是**逐个移植**进 v2（保功能）还是**以新内核为准重写关键节点**（图干净但费工）？建议：先用 M4 Demo 验证内核可行，再决定迁移策略，避免一上来就背老节点包袱。
4. **Cloud/MCP 两条后端路由**：v2 的"画布 authority"抽象建议先以**本地默认 + 云端可插拔**两套为准，MCP 视图的 authority 分裂问题在接入层收敛（属后期），不阻塞前四里程碑——认可吗？
5. **canvas-core-v2 包骨架**：`package.json` + 占位 `index.ts` 已建，pnpm workspace 已自动纳入；正式动工前我把占位 index 换成 M1 内核占位导出，可否？

---

## 六、风险与注意事项

- **不要推倒重写**：EventBus/PluginManager/createPluginContext/createPluginStore、AssetStore 接口、内容寻址模型、plugin 命名空间等 v1 好设计**直接吸收**，只重构坏的。
- **先 M1 内核 + Demo 验证**，证明"插件生命周期/注入/save"跑得通再铺开，避免空转。
- selfRender 节点、菜单双解析、mountOverlay/DialogRegistry 空置 API 这三处是雷区，逐个处理不遗留。
- `reactive(Map)`"注册即响应式"语义不能丢。

---
说人话：v2 正式设计文档已写好（在 `docs/plan/canvas-core-v2-architecture.md`），把三份侦察整合成五层架构，核心承诺是"所有保存统一成 save(key,value,type)"。等你批 5 个决策点（节奏/首 Demo/老节点迁还是重写/云端范围/开工占位）就能开工。
