# 实施计划（完整版 v3）

> **统一版本** — 合并 `06-review-and-supplements.md` 补充功能 + `07-connection-system-analysis.md` 连接分析。原 4 Phase → 扩为 5 Phase，共 **18 个插件**。

---

## Phase 1: 基础设施 (Core Framework)

**目标：** 建好插件系统的骨架，能加载/卸载插件，不涉及业务功能。

### Task 1.1: 创建插件核心类型

**文件：** `src/plugins/types.ts`

定义 `CanvasPlugin`、`PluginContext`、`CanvasConfig`、`PluginManifest` 等核心接口。

验收标准：
- TypeScript 类型编译无错误
- 所有接口有完整的 JSDoc 注释

### Task 1.2: 实现 PluginManager

**文件：** `src/plugins/PluginManager.ts`

实现：
- 插件注册 (`install`)
- 插件卸载 (`uninstall`)
- 依赖解析（构建依赖图 → 拓扑排序 → 检测循环依赖）
- 生命周期管理（install → activate → deactivate → uninstall）
- 安装失败回滚

验收标准：
- 能加载一个空插件
- 能加载有依赖关系的两个插件（顺序正确）
- 循环依赖时抛出明确错误
- 卸载插件时其他插件不受影响

### Task 1.3: 实现 PluginContext

**文件：** `src/plugins/PluginContext.ts`

封装 VueFlow API，提供插件运行所需的全部能力：

| 模块 | 方法 | 说明 |
|------|------|------|
| `store` | `get/set` | Pinia store 命名空间隔离 |
| `actions` | `addNodes/removeNodes/addEdges/removeEdges` | VueFlow 操作封装 |
| `viewport` | `setViewport/fitView/screenToFlowCoordinate` | 视口控制 |
| `events` | `on/off/emit` | 插件间事件总线 |
| `components` | `registerNodeType/registerEdgeType` | 动态组件注册 |
| `overlay` | `mountOverlay/unmountOverlay` | DOM 层渲染（viewport/canvas/root） |
| `shortcuts` | `registerShortcut/unregisterShortcut` | 快捷键 |
| `plugin` | `getPlugin<T>(name)` | 获取其他插件引用 |

验收标准：
- 插件通过 context 能操作节点/边
- 插件通过 context 能注册自定义节点类型
- 插件通过 context 能监听/发送事件
- 覆盖三种 overlay 渲染目标 (viewport/canvas/root)

### Task 1.4: 重构 Canvas.vue 为薄容器

**文件：** `src/canvas/Canvas.vue`

改造为插件架构的宿主：
- 接收 `plugins` 配置数组
- 初始化 PluginManager
- 只做 VueFlow 的 props 绑定（从 Pinia store 读取）
- 不包含任何业务逻辑 composable
- VueFlow 关键 props 配置：
  - `connectionMode="Strict"`（source→target 单向，参考 07-connection-system-analysis）
  - `isValidConnection` 回调（端口方向 + 节点类型验证）
  - `autoConnect="false"`（自建控制以支持空白区域菜单）

验收标准：
- 现有功能不受影响（初始状态下无插件时画布正常渲染）
- 添加一个空插件不影响画布行为
- 页面配置可从外部传入（启动页、快捷键等）

### Task 1.5: Pinia Store 命名空间重构 + 默认值修正

**文件：** `src/canvas/useCanvasStore.ts`

**Part A: 命名空间改造**
- 使用嵌套结构：`store.plugins.{pluginName}.{field}`
- 保留顶层字段作为核心状态（`nodes`, `edges`, `viewport` 等）
- 提供 `usePluginStore(pluginName)` 辅助函数

**Part B: 默认值修正**（对照 vue-flow state.ts 源码核实）

| 字段 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `snapGrid` | `[20, 20]` | `[15, 15]` | 与 VueFlow 默认一致 |
| `selectionMode` | `'partial'` | `'full'` | 与 VueFlow 默认一致 |
| `connectionMode` | `Strict` | `Strict` | 产品选择，保持不变 |

验收标准：
- 现有控制面板功能正常
- 能通过 `usePluginStore('clipboard')` 读写剪贴板插件的私有状态
- 不同插件的状态不会互相覆盖

---

**Phase 1 里程碑：** 插件系统核心就绪，Canvas.vue 变为薄容器，默认值已修正。

---

## Phase 2: 基础插件（必须）

**目标：** 存储 + 交互基础插件，这些都是"缺了就不完整"的核心功能。

### 依赖关系

```
StoragePlugin ───────────────────── (无依赖，最先安装)
  ↓
AutoSavePlugin  ←────────────────── StoragePlugin
HistoryPlugin ──────────────────── (无依赖)
ClipboardPlugin ────────────────── (无依赖)
MultiSelectPlugin ──────────────── (无依赖)
AlignGuidePlugin ───────────────── (无依赖)
```

---

### Task 2.1: StoragePlugin（存储底座）🔴 必须

**文件：** `src/plugins/storage/`

从旧 `useStorage.ts`（991行）重构拆分。只负责纯存储，不负责图片管理或提示词模板。

**三层存储架构：**

| 层级 | 存储介质 | 用途 |
|------|---------|------|
| 1 | localStorage | 应用设置持久化 |
| 2 | IndexedDB | 目录句柄缓存 |
| 3 | File System Access API | 项目数据读写（旗舰功能） |

**统一 API：** `saveProject` / `loadProject` / `deleteProject` / `listProjects` / `createProject` / `switchProject`

**与旧实现的拆分：**
- StoragePlugin → 纯数据存/取/切换（约 200 行）
- AssetPlugin（未来可选） → 图片资源管理
- PromptPlugin（未来可选） → 提示词模板管理

验收标准：
- 支持三层存储（localStorage + IndexedDB + FSA）
- 支持项目创建/切换/删除
- panel 改由插件提供"项目切换"UI（不写在 Canvas.vue 里）

### Task 2.2: HistoryPlugin（历史记录）🔴 必须

**文件：** `src/plugins/history/`

采用 **Command Pattern（命令模式）** 替代旧的"全量快照"。

```typescript
interface HistoryRecord {
  type: 'addNodes' | 'removeNodes' | 'moveNodes' | 'addEdges' | 'removeEdges' | 'batch'
  undo: () => void
  redo: () => void
  timestamp: number
  description: string
}
```

**操作合并：** 拖拽节点只产生一条记录（beginBatch/endBatch 包围）。

**跨插件协作：** History 插件暴露事件接口，其他插件通过 `emit` 注册记录。

**旧代码参考：** `useHistory.ts`（160行）→ 全量快照部分弃用，`isRestoring` 锁机制保留。

验收标准：
- Ctrl+Z / Ctrl+Shift+Z 撤销/重做
- 最多保留 100 条历史记录
- 拖拽多次移动只产生一条记录
- 撤销操作不影响自动保存（isRestoring 锁协同）

### Task 2.3: MultiSelectPlugin（多选/框选）🔴 必须

**文件：** `src/plugins/multi-select/`

**核心决策：完全接管选中逻辑，禁用 VueFlow 原生选中。**

| 决策 | 原因 |
|------|------|
| 禁用 `elements-selectable` | 避免和 VueFlow 选中状态争抢（旧实现最大痛点） |
| 自管 `selectedNodeIds: Set<string>` | Pinia 插件命名空间，不依赖 `node.selected` |
| 自定义 CSS class 控制高亮 | 不依赖 VueFlow 的选中样式 |

**实现步骤：**
1. 监听 VueFlow 的 `paneMouseDown/Move/Up` 实现自定义框选
2. 渲染 SelectionFrame（虚线边框包裹选中节点）
3. SelectionFrame 上实现批量拖拽、滚轮转发
4. Shift + 点击追加/移除选中
5. `activate/deactivate` 方法切换接管/释放

**旧代码参考：** `useSelectionBox.ts`（299行）→ 核心逻辑迁移，去掉全局标志污染。

验收标准：
- 框选多个节点，SelectionFrame 正确包裹
- Shift + 点击追加选中
- 点击空白取消选中
- SelectionFrame 滚轮事件正确转发到画布
- 禁用插件后 VueFlow 恢复默认行为

### Task 2.4: ClipboardPlugin（复制粘贴）🔴 必须

**文件：** `src/plugins/clipboard/`

迁移旧 `useClipboard` 的 ID 映射和边重建逻辑。新增：
- 跨项目复制（剪贴板存在 Memory）
- 粘贴预览（半透明节点跟随鼠标）
- 多次粘贴自动偏移

**旧代码参考：** `useClipboard.ts`（93行）→ 核心逻辑 80% 可直接迁移。

验收标准：
- Ctrl+C 复制选中节点（含样式、连接关系）
- Ctrl+V 在鼠标位置粘贴（无鼠标时默认偏移 50px）
- 多次粘贴自动偏移
- 撤销可回退粘贴操作

### Task 2.5: AutoSavePlugin（自动保存）🔴 必须

**文件：** `src/plugins/auto-save/`

**依赖：** StoragePlugin

迁移旧 `useAutoSave.ts`（177行）：防抖保存 + 脏标记 + beforeunload 保护 + History 锁协同。

**关键协作：** 与 HistoryPlugin 通过 `history:isRestoring` 事件协调——撤销/重做期间不触发自动保存。

验收标准：
- 节点/边变化后 1 秒自动保存
- 页面关闭前强制保存
- 撤销/重做操作不触发自动保存

### Task 2.6: AlignGuidePlugin（辅助线）🔴 必须

**文件：** `src/plugins/align-guide/`

迁移旧 `useHelperLines`（201行）的 11 种对齐模式算法。渲染对齐线到 viewport 层。

**旧代码可复用率：** ~90%，对齐算法设计合理。

验收标准：
- 拖拽时显示水平和垂直参考线
- 8px 阈值内自动吸附
- 支持 11 种对齐模式

---

**Phase 2 里程碑：** 存储底座、历史、选中、剪贴板、自动保存、辅助线 —— 6 个"必须"插件全部可用。

---

## Phase 3: 交互增强插件（重要）

**目标：** 端口、菜单、布局 —— 这些是日常高频操作的核心体验。

---

### Task 3.1: ContextMenuPlugin（右键菜单）🟡 重要

**文件：** `src/plugins/context-menu/`

**依赖：** MultiSelectPlugin（判断多选状态）

不自己写菜单项 — 提供菜单注册机制，其他插件注册自己的菜单项：

```typescript
// MultiSelectPlugin 注册菜单项
context.emit('context-menu:register', {
  target: 'node',
  label: '打组',
  visible: (nodes) => nodes.length >= 2,
  action: (nodeIds) => { /* 打组 */ },
})
```

**ContextMenuPlugin 只负责：** 监听右键事件 → 收集菜单项 → 渲染浮层菜单框 → 处理边界检测。

**旧代码参考：** `useCanvasMenu.ts`（173行）+ `menus/` 组件（4个）

验收标准：
- 右键节点弹出菜单（含复制/删除/打组等注册项）
- 右键画布弹出菜单（含粘贴/添加节点）
- 右键连线弹出菜单（含删除/切换线型）
- 菜单项支持 `disabled` 条件和 `shortcut` 显示
- 菜单不超出屏幕边界

### Task 3.2: CustomHandlePlugin（自定义端口 + 连接控制）🟡 重要

**文件：** `src/plugins/custom-handle/`

合并以下职责：
- 端口偏移（旧 FloatingHandle 的功能，去掉 DOM hack）
- 连接方向验证（`isValidConnection` 注册：sourceHandle='source' 且 targetHandle='target'）
- 拖入节点的 3D+模糊视觉反馈（`useConnectFeedback` composable）
- **拖到空白区域松手 → 弹连接菜单**（`handleConnectEnd` fallback 逻辑）

**关键设计：** 不再用旧 FloatingHandle 的"功能端口+外观端口"hack。基于 VueFlow Handle API 做 CSS translate 偏移。

**连接流程（参考 07-connection-system-analysis）：**

```
拖线 → 进入目标节点 → 3D透视+模糊模糊 → 松手 → 建立连接
                                    ↘ 空白区域松手 → 临时节点+临时线 → 弹菜单
```

**端口方向 + 去重（参考 07-connection-system-analysis）：**
- 方向：`isValidConnection` 回调集中验证（一处定义，全局生效）
- 去重：依赖 VueFlow 内置 `connectionExists()`（在 `addEdgeToStore` 中自动调用）
- 兜底：`createConnection()` 函数内做手动快检（防灾）

**旧代码参考：**
- `FloatingHandle.vue`（256行）→ 偏移逻辑迁移，移除 DOM hack
- `useCanvasConnection.ts`（292行）→ 提取 `findNearestValidTarget` + 临时节点机制
- `VideoGenerationNode/index.vue` → 提取 `useConnectFeedback` composable

验收标准：
- 端口在节点边缘外偏移显示
- 悬停/选中节点时显示端口
- 拖线进入目标节点时显示 3D 倾斜 + 模糊效果
- 空白区域松手 → 创建临时线 + 弹出连接菜单 → 选择节点类型后替换
- 连接方向强制（左收右发）
- 同一对端口不允许重复连线
- 通过插件选项可配端口偏移量/颜色/大小

### Task 3.3: AutoLayoutPlugin（自动布局）🟡 重要

**文件：** `src/plugins/auto-layout/`

**依赖：** MultiSelectPlugin（判断选中节点）

迁移旧 `useAutoLayout.ts`（147行）：拓扑排序 + BFS 层级排列。

**算法：**
1. 构建节点连接图，计算入度/出度
2. 入度为 0 的节点入队
3. BFS 层级排列：同层同列，间距可配
4. 支持 TB/LR/RL/BT 四种布局方向

验收标准：
- 选中节点时只布局选中
- 未选中时布局全部
- 支持四种布局方向
- 布局后可配置间距（nodeSep + rankSep）

---

**Phase 3 里程碑：** 端口连接（含吸附+菜单）、右键菜单、自动布局 —— 日常操作全覆盖。

---

## Phase 4: 节点增强插件

**目标：** 编组、工具栏、连线标签 —— 让节点更强大。

---

### Task 4.1: GroupPlugin（节点编组）🟡 重要

**文件：** `src/plugins/group/`

**依赖：** MultiSelectPlugin

利用 VueFlow `parentNode` 机制实现编组。框选 2+ 节点 → 打组 → 整体拖拽/删除。

验收标准：
- 选中 2+ 节点后，工具栏出现"打组"按钮
- GroupNode 拖拽时子节点自动跟随
- 折叠/展开 GroupNode
- 支持嵌套编组（限制最大深度 3 层）

### Task 4.2: NodeToolbarPlugin（节点工具栏）🟡 重要

**文件：** `src/plugins/node-toolbar/`

**依赖：** MultiSelectPlugin

工具栏通过 `mountOverlay('viewport')` 渲染到视口层。提供插槽注册机制，让其他插件在工具栏中加按钮。

**旧代码参考：** `NodeToolbar.vue`（移植版）、`TopToolbar.vue`、`BottomToolbar.vue`

验收标准：
- 单选节点时显示工具栏（编辑/复制/删除）
- 多选时显示多选工具栏（打组/复制/删除）
- 工具栏位置随节点实时更新
- 其他插件可通过 `context.emit('toolbar:register', ...)` 添加按钮

### Task 4.3: EdgeLabelsPlugin（连线标签）🟢 锦上添花

**文件：** `src/plugins/edge-labels/`

在连接线上显示文字标签。利用 VueFlow 的 EdgeLabel 机制：
- 双击连线 → 出现可编辑标签
- 标签显示在连线中点
- 支持拖拽标签调整位置

验收标准：
- 双击连线可添加/编辑标签
- 标签文字随连线移动
- 标签在导出/复制时保留

---

**Phase 4 里程碑：** 编组、工具栏、连线标签可用。

---

## Phase 5: 集成与补充插件（锦上添花）

**目标：** 快捷键统一、小地图、搜索、导出、配置持久化。

---

### Task 5.1: ShortcutManagerPlugin（快捷键管理）✅ 已完成 (2026-06-16)

**文件：** `src/canvas/core/plugins/shortcut-manager/`
**实施文档：** `docs/05-shortcut-manager-plan.md`

已实现：
- `ShortcutManager` 单例类 — 集中式快捷键注册/冲突检测/重映射/导入导出
- `PluginContext.registerShortcut` — 委托给 ShortcutManager（签名不变，插件零改动）
- `ShortcutManagerPlugin` — Ctrl+/ 帮助面板 + 搜索 + 重映射 Dialog
- 用户自定义 keymap 持久化到 canvasStore
- VueFlow 5 个内置键位（delete/selection/multiSelection/zoom/pan）统一管理
- HistoryPlugin Delete/Backspace 从 raw document listener 迁移到 ShortcutManager

验收标准：
- ~~新插件注册已存在的快捷键时收到警告~~ → ShortcutManager.register 返回 conflict
- ~~可通过设置修改快捷键映射~~ → RemapDialog + keymap 持久化
- ~~Ctrl+/ 显示快捷键帮助面板~~ → ShortcutHelpPanel.vue

### Task 5.2: MiniMapPlugin（小地图）

**文件：** `src/plugins/minimap/`

包装 VueFlow 内置 `<MiniMap>` 组件。

验收标准：
- 画布角落显示小地图
- Ctrl+M 切换显示/隐藏
- 可配置位置和尺寸

### Task 5.3: NodeFindPlugin（节点搜索）

**文件：** `src/plugins/node-find/`

Ctrl+F 搜索节点名称 → 高亮 + 聚焦。Enter 在多匹配间跳转。

验收标准：
- Ctrl+F 弹出搜索框
- 实时模糊搜索节点 label
- 匹配结果高亮 + 聚焦
- Enter 在多个匹配结果间切换

### Task 5.4: ExportPlugin（画布导出）

**文件：** `src/plugins/export/`

导出为 PNG 图片或 JSON 数据。

验收标准：
- PNG 导出（可视区域/完整画布可选）
- JSON 导出（完整画布状态）
- 导出前自动隐藏 UI 元素

### Task 5.5: 插件配置持久化

**文件：** `src/canvas/useCanvasStore.ts`

在 store 中保存加载的插件列表和配置，刷新页面后自动恢复。

### Task 5.6: 性能优化

- 插件 install 时延监控
- 大量节点时框选 requestAnimationFrame 节流
- 历史记录内存监控

---

**Phase 5 里程碑：** 15+2 插件完整可用，快捷键统一，性能通过验收。

---

## 插件依赖关系总图

```
                         ┌─────────────────┐
                         │  StoragePlugin   │  ← 最先安装
                         └────────┬────────┘
                                  ↓
                         ┌─────────────────┐
                         │  AutoSavePlugin  │
                         └─────────────────┘

┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  HistoryPlugin   │   │ ClipboardPlugin  │   │MultiSelectPlugin │
└────────┬────────┘   └─────────────────┘   └────────┬────────┘
         │                                            │
         │              ┌─────────────────────────────┤
         │              ↓                             ↓
         │    ┌─────────────────┐           ┌─────────────────┐
         │    │   GroupPlugin    │           │ AutoLayoutPlugin │
         │    └─────────────────┘           └─────────────────┘
         │              │
         │              ↓
         │    ┌─────────────────┐
         │    │ NodeToolbarPlugin│
         │    └─────────────────┘
         │
┌────────┴────────┐   ┌─────────────────┐   ┌─────────────────┐
│  AlignGuidePlugin│   │CustomHandlePlugin│   │ ContextMenuPlugin│
└─────────────────┘   └─────────────────┘   └─────────────────┘

┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ EdgeLabelsPlugin │   │   MiniMapPlugin  │   │  NodeFindPlugin  │
└─────────────────┘   └─────────────────┘   └─────────────────┘

┌─────────────────┐   ┌─────────────────┐
│  ExportPlugin    │   │ShortcutManagerPlugin│
└─────────────────┘   └─────────────────┘
```

---

## 完整插件清单（18 个）

| # | 插件 | Phase | 优先级 | 复杂度 | 旧代码复用 |
|---|------|-------|--------|--------|-----------|
| 1 | StoragePlugin | 2 | 🔴 必须 | 高 | useStorage 重构拆分 |
| 2 | HistoryPlugin | 2 | 🔴 必须 | 中 | 命令模式重写 |
| 3 | MultiSelectPlugin | 2 | 🔴 必须 | 高 | useSelectionBox ~60% |
| 4 | ClipboardPlugin | 2 | 🔴 必须 | 低 | useClipboard ~80% |
| 5 | AutoSavePlugin | 2 | 🔴 必须 | 中 | useAutoSave ~50% |
| 6 | AlignGuidePlugin | 2 | 🔴 必须 | 中 | useHelperLines ~90% |
| 7 | ContextMenuPlugin | 3 | 🟡 重要 | 低 | useCanvasMenu ~60% |
| 8 | CustomHandlePlugin | 3 | 🟡 重要 | 高 | FloatingHandle + useCanvasConnection 重构 |
| 9 | AutoLayoutPlugin | 3 | 🟡 重要 | 中 | useAutoLayout ~80% |
| 10 | GroupPlugin | 4 | 🟡 重要 | 中 | 新写 |
| 11 | NodeToolbarPlugin | 4 | 🟡 重要 | 低 | NodeToolbar ~80% |
| 12 | EdgeLabelsPlugin | 4 | 🟢 锦上添花 | 低 | 新写 |
| 13 | ShortcutManagerPlugin | 5 | 🟢 锦上添花 | 低 | 新写 |
| 14 | MiniMapPlugin | 5 | 🟢 锦上添花 | 极低 | VueFlow 内置 |
| 15 | NodeFindPlugin | 5 | 🟢 锦上添花 | 低 | 新写 |
| 16 | ExportPlugin | 5 | 🟢 锦上添花 | 低 | 新写 |
| - | Canvas.vue（薄容器） | 1 | 🔴 基础 | - | - |
| - | useCanvasStore（Pinia） | 1 | 🔴 基础 | - | - |

---

## 文件结构规划

```
src/canvas/core/                         # 所有 Canvas 代码统一在此
├── plugins/                           # 插件系统核心
│   ├── types.ts                       # 核心类型定义
│   ├── PluginManager.ts               # 插件管理器
│   ├── PluginContext.ts               # 插件上下文
│   │
│   │── Phase 2: 基础插件 ──────────────
│   ├── storage/                       # 存储底座
│   │   ├── index.ts
│   │   ├── StoragePlugin.ts
│   │   └── adapters/                  # FSA/IndexedDB 适配器
│   ├── history/                       # 历史记录（命令模式）
│   │   ├── index.ts
│   │   ├── HistoryPlugin.ts
│   │   └── useHistory.ts
│   ├── multi-select/                  # 多选框选
│   │   ├── index.ts
│   │   ├── MultiSelectPlugin.ts
│   │   ├── useSelectionBox.ts
│   │   └── SelectionFrame.vue
│   ├── clipboard/                     # 复制粘贴
│   │   ├── index.ts
│   │   ├── ClipboardPlugin.ts
│   │   └── useClipboard.ts
│   ├── auto-save/                     # 自动保存
│   │   ├── index.ts
│   │   └── AutoSavePlugin.ts
│   ├── align-guide/                   # 辅助线
│   │   ├── index.ts
│   │   ├── AlignGuidePlugin.ts
│   │   ├── useHelperLines.ts
│   │   └── HelperLines.vue
│   │
│   │── Phase 3: 交互增强 ──────────────
│   ├── context-menu/                  # 右键菜单
│   │   ├── index.ts
│   │   ├── ContextMenuPlugin.ts
│   │   └── ContextMenu.vue
│   ├── custom-handle/                 # 自定义端口 + 连接控制
│   │   ├── index.ts
│   │   ├── CustomHandlePlugin.ts
│   │   ├── CustomHandle.vue
│   │   ├── useHandleOffset.ts
│   │   ├── useConnectFeedback.ts      # 3D+模糊视觉反馈
│   │   └── useConnectionValidator.ts  # isValidConnection 工厂
│   ├── auto-layout/                   # 自动布局
│   │   ├── index.ts
│   │   └── AutoLayoutPlugin.ts
│   │
│   │── Phase 4: 节点增强 ──────────────
│   ├── group/                         # 编组
│   │   ├── index.ts
│   │   ├── GroupPlugin.ts
│   │   ├── GroupNode.vue
│   │   └── useGroup.ts
│   ├── node-toolbar/                  # 节点工具栏
│   │   ├── index.ts
│   │   ├── NodeToolbarPlugin.ts
│   │   └── NodeToolbar.vue
│   ├── edge-labels/                   # 连线标签（新增）
│   │   ├── index.ts
│   │   └── EdgeLabelsPlugin.ts
│   │
│   │── Phase 5: 补充 ──────────────────
│   ├── shortcut-manager/              # 快捷键管理
│   ├── minimap/                       # 小地图
│   ├── node-find/                     # 节点搜索
│   └── export/                        # 画布导出
│
├── Canvas.vue                         # 薄容器（插件宿主）
├── Pannel.vue                         # 控制面板
├── useCanvasStore.ts                  # Pinia Store（核心状态 + 插件命名空间）
└── components/                        # 基础组件（与插件无关）
    ├── CustomNode.vue
    ├── CustomEdge.vue
    └── ...
```

---

## 实施顺序

```
Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
(骨架)     (必须)       (重要)       (增强)       (补充)

Phase 2 内部顺序: Storage → History → MultiSelect → Clipboard → AutoSave → AlignGuide
Phase 3 内部顺序: ContextMenu → CustomHandle → AutoLayout
Phase 4 内部顺序: Group → NodeToolbar → EdgeLabels
Phase 5 可并行: ShortcutManager, MiniMap, NodeFind, Export 无依赖关系
```

---

## 验证策略

### 每 Phase 完成后的回归检查

- [ ] 所有已安装插件正常激活
- [ ] 卸载任一插件不影响其他插件
- [ ] Pinia DevTools 状态干净（无死引用）
- [ ] VueFlow 核心功能正常（节点拖拽、缩放、平移）
- [ ] 控制面板（Pannel.vue）所有配置项正常
- [ ] 浏览器控制台无未捕获错误
- [ ] 页面刷新后状态恢复正确

### Phase 2 完成后额外检查

- [ ] 创建 3 个节点 + 2 条边 → 刷新 → 数据完整恢复
- [ ] 框选 → Ctrl+C → Ctrl+V → 粘贴的正确位置和数量
- [ ] Ctrl+Z 连续撤销 5 次 → 每次正确回退
- [ ] 拖拽节点靠近另一节点 → 辅助线出现

### Phase 3 完成后额外检查

- [ ] 拖线从端口到空白区域松手 → 菜单弹出 → 选择类型 → 节点创建 + 连接建立
- [ ] 拖线进入目标节点 → 3D + 模糊效果出现 → 松手 → 连接建立
- [ ] 同一对端口拖两次 → 第二次拒绝（重复边）
- [ ] 右键节点 → 菜单包含复制/删除项
- [ ] 10 个杂乱节点 → 自动布局 → 整齐排列
