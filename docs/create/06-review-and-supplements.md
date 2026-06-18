# 文档审查报告 & 补充功能方案

> 本文是对之前 5 份设计文档的自我审查。对照 vue-flow 源码和旧 canvas 实现逐一核实，发现的错误已纠正，遗漏的功能已补充。

---

## 一、自审结果

### 总评：整体框架正确，细节有几处不准

5 份文档的核心设计思路（插件分层、PluginContext 隔离、命令模式做历史记录、完全接管选中逻辑）是站得住脚的。但有几处需要修正。

---

### 错误 1：`connectOnClick` 默认值写反了

**文档中的错误说法（01-vue-flow-architecture-analysis.md）：**
> `connectOnClick: false` — 点击连线（禁用状态）

**实际情况（vue-flow state.ts 第 74 行）：**
```typescript
connectOnClick: true,  // 默认是 true！
```

**影响：** 不会导致 bug（mini-canvas 的 Pannel 中显式控制了此值），但文档描述不准确。

---

### 错误 2：`snapGrid` 默认值

**文档中的错误说法（mini-canvas 的 useCanvasStore.ts 中）：**
```typescript
snapGrid: [20, 20]
```

**实际情况（vue-flow state.ts 第 78 行）：**
```typescript
snapGrid: [15, 15]
```

**影响：** 极轻微。20 和 15 的差别在使用中几乎感知不到。但应该统一到 15 以和 vue-flow 保持一致。

---

### 错误 3：`selectionMode` 默认值

**文档中的错误说法（mini-canvas 的 useCanvasStore.ts 中）：**
```typescript
selectionMode: 'partial'
```

**实际情况（vue-flow state.ts 第 41 行）：**
```typescript
selectionMode: SelectionMode.Full
```

**含义差异：**
- `Full`：节点必须完全在选框内才算被选中
- `Partial`：节点有任何部分在选框内就算被选中

**影响：** 这是行为级别的差异。Full 模式更精确，Partial 模式更容易框到。应该默认 `Full`。

---

### 错误 4：`connectionMode` 默认值

**实际情况：** VueFlow 默认是 `Loose`，但 mini-canvas 设为 `Strict`。

**这个不算错**——mini-canvas 有自己的产品选择。只是在文档中应该说明"我们选择 Strict 而非 VueFlow 默认的 Loose，原因是为了强制 source→target 的单向连接"。

---

### 评审：方案本身的质量

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构合理性 | ★★★★★ | PluginContext 隔离、事件通信、依赖管理，设计完整 |
| VueFlow 兼容性 | ★★★★★ | 基于 EventHook 系统，充分利用已有机制 |
| 可实现性 | ★★★★☆ | Phase 1-3 可行，Phase 4 部分功能复杂度高 |
| 文档完整性 | ★★★★☆ | 5 份文档覆盖了架构、回顾、设计、计划、指南 |
| 覆盖度 | ★★★☆☆ | **缺少 5-6 个重要功能**（见下文） |

---

## 二、遗漏功能分析

对照旧 canvas 实现（49 个文件、17 个 composable、30 个组件）和目标功能文档，发现以下功能在插件计划中被遗漏：

### 严重遗漏

#### 1. 自动保存 / 数据持久化 (AutoSave)

**旧实现：** `useAutoSave.ts` 177 行，包含：
- 防抖自动保存（默认 1000ms 间隔）
- 脏标记追踪
- beforeunload 页面卸载保护
- 与历史记录的锁协同（isRestoring 期间暂停）
- 深度监听 nodes/edges 变化

**为什么必须做：** 没有自动保存，用户关了浏览器就全没了。这是画布应用的基础功能。

#### 2. 存储系统 (Storage)

**旧实现：** `useStorage.ts` 991 行，三层存储：
- localStorage（设置持久化）
- IndexedDB（目录句柄缓存）
- File System Access API（项目数据读写）

**为什么必须做：** 保存/加载项目是"能不能用"的问题，不是"好不好用"的问题。

#### 3. 右键菜单系统 (ContextMenu)

**旧实现：** 4 种菜单类型（双击空白、节点右键、画布右键、连接菜单），通用 ContextMenu 组件支持边界检测、分组、快捷键显示。

**为什么必须做：** 右键菜单是用户主要操作入口之一（删除、复制、添加节点）。

---

### 重要遗漏

#### 4. 自动布局 (AutoLayout)

**旧实现：** `useAutoLayout.ts` 147 行，拓扑排序算法，支持选中/全部布局，可配置间距。

**为什么需要：** 节点多了以后手动排列是噩梦。自动布局显著提升效率。这是"有没有"质变的 feature。

#### 5. 小地图 (MiniMap)

VueFlow 内置 `MiniMap` 组件。作为插件，只需要配置它的样式、位置、是否显示。实现成本极低但用户感知强。

---

### 锦上添花

#### 6. 节点搜索/过滤

在大画布中快速找到特定节点。输入节点 ID 或名称 → 高亮或聚焦到目标节点。旧实现有 `focusNode()` 但没用上。

#### 7. 画布导出 (Export)

导出为 PNG 图片或 JSON 数据，方便分享和备份。`html2canvas` 或 VueFlow 的 `toObject()` 均可实现。

#### 8. 连线标签 (Edge Labels)

在连接线上显示文字，例如"生成"、"输入"等描述。类似 VueFlow 的 EdgeLabel 机制。

#### 9. 批量操作增强

- 批量替换节点类型
- 批量修改节点属性
- 对齐/分布操作（左对齐、水平居中分布、垂直等距分布等）

---

## 三、补充功能实现方案（大白话）

### 补充 1：自动保存插件 (AutoSavePlugin)

#### 要做什么
任何节点/边的变化，在指定时间间隔后自动保存到本地。不能太频繁（影响性能），不能太久（怕丢数据）。

#### 实现思路

```
数据变化了 → 等 1 秒 → 没新的变化了 → 保存
           (防抖窗口)
```

**核心流程：**

1. 监听画布数据变化：在 `onNodesChange`、`onEdgesChange`、`onConnect` 等事件中标记"脏数据"
2. 防抖：用 debounce（默认 1000ms），等用户停止操作了再保存
3. 保存内容：不是全量 JSON（太重），而是调用 StoragePlugin 的 `save()` 方法
4. 页面关闭保护：在 `beforeunload` 事件中检查——如果有未保存的数据，强制保存
5. 和历史记录的协作：撤销/重做操作不算"用户主动改数据"，不触发自动保存（否则撤销后马上又被存回去了）

**和历史记录的协作方式：**

```
用户拖拽节点 A
  → HistoryPlugin: beginBatch('移动') 
  → onNodeDrag → 多次位置更新
  → HistoryPlugin: endBatch()
  → AutoSavePlugin: markDirty()  ← 这时候才标记脏
  → 1秒后保存
```

AutoSavePlugin 不关心具体的操作是什么，它只需要知道"数据变了，需要存"。

**和旧实现的区别：**
- 旧实现是"全量快照式保存"（整个 `toObject()` 存），新方案是"按需保存"（只存变化的字段）
- 旧实现和 History 紧耦合（useAutoSave 直接调 useHistory.saveSnapshot），新方案通过事件通信

**存在哪里？**
- 本地文件系统（File System Access API，旧方案已验证可行）
- IndexedDB（兜底方案，兼容不支持 FSA 的浏览器）
- 云端同步（未来可扩展）

---

### 补充 2：存储插件 (StoragePlugin)

#### 要做什么

提供统一的"保存/加载/切换项目"能力。这是整个应用的持久化底座，所有需要持久化的插件（AutoSave、Clipboard 跨项目、Settings）都依赖它。

#### 实现思路

**分层存储架构：**

```
┌──────────────────────────────┐
│         应用层                 │
│   AutoSave / Settings / ...   │
├──────────────────────────────┤
│        StoragePlugin          │   ← 对外的统一 API
│   save/load/delete/list       │
├──────────────────────────────┤
│     存储适配层                 │
│   FSA 适配器 / IndexedDB 适配  │
├──────────────────────────────┤
│        物理层                  │
│   文件系统 / 浏览器存储         │
└──────────────────────────────┘
```

**统一 API：**

```typescript
StoragePlugin API:
  saveProject(id, data)  → 保存项目数据
  loadProject(id)        → 读取项目数据
  deleteProject(id)      → 删除项目
  listProjects()         → 列出所有项目
  createProject(name)    → 创建新项目
  getCurrentProject()    → 当前项目 ID
  switchProject(id)      → 切换项目
  exportProject(id)      → 导出为 JSON
  importProject(json)    → 导入 JSON
```

**为什么不沿用旧的 `useStorage.ts`？**

旧的 `useStorage.ts` 991 行，和项目管理、图片处理、提示词模板等深度耦合。新方案拆分：
- StoragePlugin 只负责数据的存/取/切换（约 200 行）
- 图片管理独立为 AssetPlugin
- 提示词管理独立为 PromptPlugin

**存储格式：**

```
项目文件夹/
  project.json       # 画布数据 { nodes, edges, viewport }
  settings.json      # 项目级设置
  assets/            # 图片等资源文件
    hash1.png
    hash2.png
```

**图片资源管理（AssetPlugin，可选）：**
- 文件哈希去重（避免同一张图片存多份）
- assetId → blob URL 的映射管理
- 节点引用 `node.data.assetId` 而不是直接存 blob URL

---

### 补充 3：右键菜单插件 (ContextMenuPlugin)

#### 要做什么

用户右键点击时，在鼠标位置弹出上下文菜单。不同的右键目标显示不同的菜单项：
- 右键节点：复制、删除、复制 ID、打组（如果多选）
- 右键画布空白：粘贴、添加节点、全选
- 右键连线：删除、切换线型

#### 实现思路

**不自己写菜单组件——让其他插件注册菜单项。**

ContextMenuPlugin 只管"弹出菜单框"，它不管"菜单里有什么"。

**注册机制：**

```typescript
// 在 NodeToolbarPlugin 中
context.emit('context-menu:register', {
  target: 'node',           // 这个菜单项出现在"节点右键菜单"中
  label: '复制',
  shortcut: 'Ctrl+C',
  action: (nodeIds) => { ... },
})

context.emit('context-menu:register', {
  target: 'pane',           // 这个菜单项出现在"画布右键菜单"中
  label: '粘贴',
  shortcut: 'Ctrl+V',
  disabled: () => clipboard.isEmpty(),
  action: () => { ... },
})
```

**ContextMenuPlugin 的职责：**
1. 监听 `nodeContextMenu`、`paneContextMenu`、`edgeContextMenu` 等事件
2. 在鼠标位置渲染一个浮层菜单
3. 菜单项来自其他插件注册的条目，按 target 过滤
4. 自动管理菜单的打开/关闭/边界检测（不超出屏幕）

**分栏菜单支持：**

VueFlow 的 `edgeContextMenu` 和 `nodeContextMenu` 事件提供的是画布坐标，需要转换到屏幕坐标。ContextMenuPlugin 内部会自动处理这个转换。

---

### 补充 4：MiniMapPlugin（小地图）

#### 要做什么

画布右下角显示一个小地图，鸟瞰整个画布的所有节点布局。在小地图上点击可以直接跳转到对应位置。

#### 实现思路

这个实现最简单，因为 VueFlow 自带了 `<MiniMap>` 组件：

```html
<MiniMap
  position="bottom-right"
  :width="200"
  :height="150"
  :mask-color="'rgba(0,0,0,0.1)'"
/>
```

**MiniMapPlugin 只需要：**
1. 通过 `mountOverlay('canvas')` 把 `<MiniMap>` 渲染到画布层
2. 提供开关（显示/隐藏）和位置选项（4 个角）
3. 可选：自定义 MiniMap 的节点渲染样式

**为什么做成插件而不是直接写在 Canvas.vue 里？**
- 按需加载：不需要 MiniMap 的用户不加载这个插件
- 可配置：位置、大小、遮罩颜色等可以通过插件选项传入
- 一致性：所有扩展都用同样的方式管理

---

### 补充 5：AutoLayoutPlugin（自动布局）

#### 要做什么

一键把杂乱的节点排列成整齐的布局。选中节点时"布局选中"，没选中时"布局全部"。

#### 实现思路

**算法选择：用 VueFlow 自带的布局钩子 + 简单拓扑排序。**

VueFlow 的节点支持 `computedPosition`（实际渲染位置 = position + parentNode.position）。我们可以：

1. 构建节点连接图（谁连谁）
2. 找到输出节点（没有 source 连线的节点）作为起点
3. 从输出节点开始，按拓扑序排列：
   - 同一层级的节点放在同一列
   - 列的间距根据节点最大宽度 + rankSep 计算
   - 行的间距根据 nodeSep 计算
4. 更新所有节点的 position

**拓扑排序步骤：**

```
1. 遍历所有节点，计算每个节点的出度（连向多少个其他节点）和入度
2. 把入度为 0 的节点放入队列（这些节点只输出，不接收输入）
3. BFS 遍历：弹出节点 → 排列 → 把它的目标节点的入度减 1 → 入度为 0 则入队
4. 同一 BFS 层级放同一列
```

**布局方向支持：** 从左到右（TB）、从右到左、从上到下（LR）、从下到上。

---

### 补充 6：NodeFindPlugin（节点搜索）

#### 要做什么

按 Ctrl+F 或点击搜索框，输入节点名称/ID，高亮并聚焦到匹配的节点。支持多结果时按 Enter 跳转下一个。

#### 实现思路

1. 注册全局快捷键 Ctrl+F
2. 弹出搜索框（通过 `mountOverlay('root')` 渲染在顶部）
3. 用户输入时，模糊搜索所有节点的 label/data.label
4. 匹配到节点时，高亮该节点（临时加 CSS class），调用 `fitView` 或 `setCenter` 聚焦
5. 多个匹配结果时，按 Enter 循环切换

**搜索字符串匹配算法：**
- 简单方案：`node.label.includes(query)`（不区分大小写）
- 稍好方案：Levenshtein 距离模糊匹配（允许用户打错字）

---

### 补充 7：ExportPlugin（画布导出）

#### 要做什么

导出当前画布为 PNG 图片或 JSON 数据文件。

#### 实现思路

**PNG 导出：**
1. 获取 VueFlow 的 DOM 容器
2. 使用 `html2canvas` 库截图（或直接用 canvas API）
3. 生成 Blob → 触发浏览器下载

**JSON 导出：**
1. 调用 `toObject()` 获取完整画布状态
2. 调用 `JSON.stringify()` 序列化
3. 触发浏览器下载 .json 文件

**注意事项：**
- PNG 导出只截可视区域还是整个画布？应该让用户选择。
- 导出时需要先把选中框、参考线等 UI 元素隐藏，截完再恢复。

---

## 四、新增插件加入 Phase 规划

原来的 4 个 Phase 调整为 **5 个 Phase**：

| Phase | 插件 | 原因 |
|-------|------|------|
| Phase 1 | 基础设施（不变） | |
| Phase 2 | MultiSelect + Clipboard + History + **AutoSave** | AutoSave 是基础能力，没它等于白做 |
| Phase 2 | **StoragePlugin** | 保存/加载是"能不能用"的问题 |
| Phase 3 | AlignGuide + **ContextMenu** + **AutoLayout** | |
| Phase 4 | Group + CustomHandle + NodeToolbar | |
| Phase 5 | **MiniMap** + **NodeFind** + **Export** + EdgeLabels | 锦上添花，单独做 |

---

## 五、插件依赖关系图（更新后）

```
StoragePlugin ───────────────────── (无依赖)
  ↓
AutoSavePlugin  ←───────────────── StoragePlugin
HistoryPlugin ──────────────────── (无依赖)
ClipboardPlugin ────────────────── (无依赖)
MultiSelectPlugin ──────────────── (无依赖)
  ↓
GroupPlugin  ←──────────────────── MultiSelectPlugin
NodeToolbarPlugin  ←────────────── MultiSelectPlugin
AutoLayoutPlugin  ←─────────────── MultiSelectPlugin (可选)
ContextMenuPlugin ──────────────── (无依赖，但依赖其他插件注册菜单项)
AlignGuidePlugin ───────────────── (无依赖)
CustomHandlePlugin ─────────────── (无依赖)
MiniMapPlugin ──────────────────── (无依赖)
NodeFindPlugin ─────────────────── (无依赖)
ExportPlugin ───────────────────── (无依赖)
```

---

## 六、最终的插件清单

| # | 插件名 | 优先级 | 复杂度 | 旧实现可复用 |
|---|--------|--------|--------|-------------|
| 1 | MultiSelectPlugin | 🔴 必须 | 高 | useSelectionBox (~60%) |
| 2 | HistoryPlugin | 🔴 必须 | 中 | useHistory (命令模式重写) |
| 3 | ClipboardPlugin | 🔴 必须 | 低 | useClipboard (~80%) |
| 4 | AutoSavePlugin | 🔴 必须 | 中 | useAutoSave (~50%) |
| 5 | StoragePlugin | 🔴 必须 | 高 | useStorage (重构拆分) |
| 6 | AlignGuidePlugin | 🟡 重要 | 中 | useHelperLines (~90%) |
| 7 | ContextMenuPlugin | 🟡 重要 | 低 | useCanvasMenu (~60%) |
| 8 | AutoLayoutPlugin | 🟡 重要 | 中 | useAutoLayout (~80%) |
| 9 | GroupPlugin | 🟡 重要 | 中 | 新写 |
| 10 | CustomHandlePlugin | 🟡 重要 | 高 | FloatingHandle (重构) |
| 11 | NodeToolbarPlugin | 🟡 重要 | 低 | NodeToolbar (~80%) |
| 12 | ShortcutManagerPlugin | 🟢 锦上添花 | 低 | 新写 |
| 13 | MiniMapPlugin | 🟢 锦上添花 | 极低 | VueFlow 内置 |
| 14 | NodeFindPlugin | 🟢 锦上添花 | 低 | 新写 |
| 15 | ExportPlugin | 🟢 锦上添花 | 低 | 新写 |

---

## 七、修正后的 mini-canvas 默认值

根据本次审查，`useCanvasStore.ts` 中应修正的默认值：

| 字段 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `snapGrid` | `[20, 20]` | `[15, 15]` | 与 VueFlow 一致 |
| `selectionMode` | `'partial'` | `'full'` | 与 VueFlow 一致 |
| (无需改 connectionMode，产品选择 Strict 是合理的) |
