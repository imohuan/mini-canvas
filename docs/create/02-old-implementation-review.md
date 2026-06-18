# 旧实现回顾：问题与教训

> 本文总结 `src/modules/canvas` 旧实现中的架构问题和具体技术债务。这些问题驱动了新插件架构的设计。

---

## 一、架构问题

### 1.1 上帝编排器 (God Orchestrator)

旧代码的核心是 `CanvasPage.vue`——一个 500+ 行的巨型组件。所有 composable 在此实例化，所有状态在此中转，所有事件在此桥接。

```
CanvasPage.vue (真相：是个调度中心，不是页面组件)
├── 17 个 composable 实例化
├── 所有 props 分发
├── 所有 emit 处理
├── 所有生命周期钩子
├── 全局状态初始化
└── 快捷键注册
```

**问题：**
- 添加新功能 = 修改 CanvasPage.vue + 新 composable + 可能需要新组件
- 删除功能 = 无法删除（功能深度耦合）
- 测试 = 几乎不可能单独测试某个功能
- 代码审查 = 修改一个功能要审查整个系统

### 1.2 组件注册臃肿

```typescript
// CanvasPage.vue 中的硬编码注册
const nodeTypes = {
  'temp-target': markRaw(TempTargetNode),
  'image-input': markRaw(ImageInputNode),
  'video-generation': markRaw(VideoGenerationNode),
}
```

添加新节点类型必须修改 CanvasPage。如果没有对应 composable，节点甚至无法正常工作。

### 1.3 Composable 间隐式依赖

```typescript
// useAutoSave.ts 隐式依赖 useHistory.ts 的 isRestoring/initialize
// useSelectionBox.ts 隐式依赖全局变量 isSelectingBox（被其他组件引用）
// useCanvasConnection.ts 创建 TempTargetNode，但 TempTargetNode 定义在别处
```

没有正式的导入/导出依赖声明，全凭"知道代码在哪"。重构风险极大。

---

## 二、具体功能问题

### 2.1 框选系统——事件时序灾难

框选是最复杂的交互之一。旧实现经历了 7 个问题的迭代修复，根本原因是对 VueFlow 的事件时序缺乏理解。

**核心问题：框选结束后选中状态被清除**

```
用户松开鼠标 (mouseup)
  → 自定义 handleMouseUp: 执行 addSelectedNodes()
  → VueFlow pane-click 事件: 执行 removeSelectedElements()  // 清空！
  → 结果: 节点全部取消选中
```

旧实现的解决方案是"双重保险"：

```typescript
// 方案演进: 
// v1: stopPropagation → 不够
// v2: justFinishedSelecting 标志 + 100ms setTimeout 保护
// 最终: stopPropagation + preventDefault + 标志 + setTimeout 重选
```

这种"补丁策略"导致代码里充满 `isSelectingBox`、`justFinishedSelecting` 等全局标志，互相引用，难以理解。

**关键教训：** 在 VueFlow 的世界里，"自己做一套选择系统"比"接管 VueFlow 的选择系统"更容易。插件架构中应该让选择插件完全接管选中逻辑，而不是和 VueFlow 共用选中状态。

### 2.2 历史记录——全量快照的代价

旧实现用全量快照（整个 `toObject()` 的 JSON）做 undo/redo。每 50 个快照，每个可能包含几百 KB 的数据。

**问题：**
- 内存占用：50 个快照 × 完整的节点/边/viewport 数据
- 恢复耗时：`setNodes()` + `setEdges()` + `setViewport()` 然后等 `nextTick()`
- 视口抖动：恢复 viewport 会产生视觉跳动
- 无法细粒度：不能只撤销一个节点的位置变化
- 冲突：自动保存在创建快照，用户在撤销，两个操作可能互相干扰

**关键教训：** 全量快照适用于简单场景，但不适用于高频操作（如拖拽）。插件架构中应该支持"增量快照"——只记录变更，而非全量。

### 2.3 复制粘贴——缺乏上下文

旧实现支持多节点复制粘贴和 ID 映射，但存在局限：

- 粘贴位置计算基于"光标所在位置"——但如果光标在画布外？
- 没有跨画布复制（无法从一个项目复制到另一个）
- 没有剪贴板预览
- 粘贴后无法区分原始节点和粘贴节点（没有视觉反馈）

**关键教训：** 剪贴板应该是全局的（跨画布实例），粘贴位置需要 fallback 逻辑。

### 2.4 端口系统——自定义 Handle 的 DOM hack

旧实现的 `FloatingHandle.vue` 使用了多层技巧：

1. VueFlow 的 `<Handle>` 渲染为不可见的"功能性端口"（负责连接交互）
2. 自定义的 "+" 号圆圈是"可视化端口"（仅负责显示）
3. 点击可视化端口时，通过 `dispatchEvent(new MouseEvent(...))` 转发到功能端口

这种设计导致：
- 端口位置是"偏移"到节点外侧的，但 VueFlow 的 `getHandleBounds` 认为 Handle 在节点边缘
- 端口显示逻辑（何时显示/隐藏）散落在多个组件中
- `isConnecting` 状态通过 props 层层传递

**关键教训：** 应该基于 VueFlow 的 Handle 做扩展，而不是"旁边放一个外观 + 转发事件"。新架构中应该让端口插件直接扩展 Handle 组件，利用 VueFlow 的 `handleBounds` 机制。

### 2.5 节点工具栏——Teleport 陷阱

`NodeToolbar.vue` 使用了 `<Teleport :to="viewportRef">` 将工具栏渲染到 VueFlow viewport 层。但：
- 通过 `inject(NodeIdInjection)` 获取节点 ID——这意味着必须在 NodeWrapper 的子组件树中
- 布局计算依赖 `getRectOfNodes()` 和视口变换矩阵
- 位置用 CSS `translate` 手动计算——容易出 bug

**关键教训：** 插件组件的渲染位置是个核心问题。应该提供"渲染目标注入"机制——插件可以声明自己渲染在 viewport、canvas、还是 root 层。

### 2.6 辅助线——功能可用但耦合

辅助线实现相对干净，但：
- 启用/禁用逻辑和 `useSettings` 耦合
- 拖拽过程中直接 `dragNode.position.x = ...` 修改位置——这是在 `onNodeDrag` 回调中修改，和 d3-drag 的自身位置计算可能冲突
- `helperLines` 数组通过 `ref` 暴露，但没有渲染抽象——使用者需要自己渲染 SVG/div

**关键教训：** 插件应该提供"渲染接口"——不只是数据，还包括如何渲染。

---

## 三、技术债务总结

| 问题 | 严重程度 | 在新架构中的对策 |
|------|----------|------------------|
| God Orchestrator | 🔴 严重 | 插件注册中心 + Canvas 只做容器 |
| 事件时序冲突 | 🔴 严重 | 插件接管完整交互流程，不共用 VueFlow 选择 |
| 全量快照 | 🟡 中等 | 增量快照 + 选择性全量保存 |
| DOM hack 端口 | 🟡 中等 | 基于 Handle API 扩展，不旁路 |
| 全局标志污染 | 🟡 中等 | 每个插件内部状态隔离 |
| 无依赖管理 | 🟡 中等 | 显式依赖声明 + install 校验 |
| 测试不可行 | 🟢 低 | composable 独立 + 模拟 PluginContext |

---

## 四、哪些可以复用

不是全部重写，以下逻辑设计正确，可以直接迁移到插件：

1. **useHelperLines 的对齐算法** — 11 种对齐模式 + 吸附计算设计合理
2. **useClipboard 的 ID 映射逻辑** — `oldId → newId` 映射表 + 边重建逻辑正确
3. **useSelectionBox 的坐标转换** — `project()` / `screenToFlowCoordinate()` 用法正确
4. **FlowingEdge 的流光动画** — requestAnimationFrame + animateMotion 动画引擎可复用
5. **SelectionFrame 的拖拽逻辑** — 记录初始位置 + 批量更新节点位置
6. **连接验证** — `isValidConnection` 的 sourcePosition/targetPosition 检查逻辑
7. **useStorage 的 IndexedDB + File System Access API** — 存储架构可以复用

**复用原则：** 逻辑正确但耦合的代码 → 提取纯函数 → 放入插件。架构问题的代码 → 不迁移，重写。
