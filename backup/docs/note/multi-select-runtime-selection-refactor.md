# 多选运行时选中态重构记录

> 记录本次围绕“`useCanvasStore` 需要维护当前多选，但不能把多选持久化”的实现调整。

## 1. 背景

之前的状态边界存在问题：

```text
VueFlow 内部 selected
MultiSelectPlugin 内部 selectedNodeIds / selectedEdgeIds
useCanvasStore.state.selectedNodeIds / selectedEdgeIds
localStorage 持久化状态
```

这些状态之间互相同步，但没有明确谁是最终数据源，导致：

- 当前多选需要被其他模块读取。
- 但多选又不应该刷新后恢复。
- `MultiSelectPlugin` 自己维护一份长期选中集合，容易和 store 不一致。
- 剪贴板等插件依赖 `MultiSelectPlugin.api`，形成插件间状态耦合。

本次目标：

```text
useCanvasStore 继续维护当前多选
但 selectedNodeIds / selectedEdgeIds 是运行时状态
不进入 localStorage 持久化
MultiSelectPlugin 不再作为长期选中数据源
其他插件统一读取 store 暴露的运行时选中态
```

## 2. 最终状态分层

当前状态分为两类：

```text
持久化状态
  ├─ nodes
  ├─ edges
  ├─ 连线样式配置
  ├─ 端口配置
  ├─ 多选框 padding 配置
  └─ 插件命名空间配置

运行时状态
  ├─ selectedNodeIds
  ├─ selectedEdgeIds
  ├─ selectionVersion
  └─ connectionState
```

关键边界：

```text
useCanvasStore 可以维护当前多选
但 serializer 不恢复、不写入真实 selected 集合
节点/边序列化时也剥离 selected 字段
```

## 3. `useCanvasStore.ts` 实现

本次新增统一的运行时选中态 action：

```text
setSelectedNodeIds(ids)
setSelectedEdgeIds(ids)
setSelection({ nodeIds, edgeIds })
clearSelection()
applyNodeSelectChanges(changes)
applyEdgeSelectChanges(changes)
```

这些 action 负责：

- 替换外部直接操作 `selectedNodeIds` / `selectedEdgeIds`。
- 统一递增 `selectionVersion`。
- 对 Set 做相等判断，避免无变化时重复触发刷新。
- 保持当前多选可被其他模块读取。

新增辅助规则：

```text
sameStringSet(a, b)
```

作用：

```text
如果本次选中集合没有变化，不重复递增 selectionVersion。
```

这可以减少 `Canvas.vue` 和插件事件双重同步时产生的无意义刷新。

## 4. `Canvas.vue` 实现

`Canvas.vue` 不再直接写：

```text
canvas.state.selectedNodeIds = ...
canvas.state.selectedEdgeIds = ...
canvas.state.selectionVersion++
```

改为统一调用：

```text
canvas.applyNodeSelectChanges(selectChanges)
canvas.applyEdgeSelectChanges(selectChanges)
canvas.clearSelection()
canvas.setSelection(...)
canvas.setSelectedNodeIds(...)
canvas.setSelectedEdgeIds(...)
```

当前链路：

```text
VueFlow nodes-change / edges-change
  → Canvas.vue 接收 select changes
  → useCanvasStore action 合并变化
  → SelectionFrame / Clipboard / Edge 高亮等模块读取同一份运行时选中态
```

空白点击链路：

```text
pane click
  → canvas.clearSelection()
  → 通知 selection:clear
  → 插件清理自身交互过程
```

## 5. `PluginContext` 与 `types.ts` 实现

为了让插件不直接依赖 `useCanvasStore` 实例，也不通过事件总线绕路修改选中态，本次在插件上下文中新增：

```text
context.selection
```

对外 API：

```text
getSelectedNodeIds()
getSelectedEdgeIds()
setSelectedNodeIds(ids)
setSelectedEdgeIds(ids)
setSelection(payload)
clearSelection()
```

设计意图：

```text
插件只知道“运行时选中态 API”
不关心它是否由 Pinia、VueFlow 或其他状态容器实现
```

`PluginContext.ts` 中优先委托 `useCanvasStore` 的 action：

```text
canvasStore.setSelectedNodeIds?.(...)
canvasStore.setSelectedEdgeIds?.(...)
canvasStore.setSelection?.(...)
canvasStore.clearSelection?.()
```

如果没有真实 store action，则使用 fallback 逻辑。

`PluginManager.ts` 的 stub context 也补充了 `selection`，避免类型缺失。

## 6. `MultiSelectPlugin.ts` 实现

`MultiSelectPlugin` 不再维护长期选中集合：

```text
删除内部 selectedNodeIds
删除内部 selectedEdgeIds
```

现在它只负责：

```text
Shift 框选输入
Ctrl+A 全选输入
Escape 清空输入
把 VueFlow select changes 同步到 context.selection
对外 API 从 context.selection 读取当前选中态
```

新的关系：

```text
MultiSelectPlugin
  ├─ 负责产生选择动作
  ├─ 负责框选过程状态：selectionBox、dragDistance、prevBoxNodeIds
  └─ 不再作为 selectedNodeIds 的长期数据源
```

API 行为也改为读取统一状态：

```text
api.selectedNodeIds → context.selection.getSelectedNodeIds()
api.selectedNodes → 根据 context.selection 过滤当前节点
```

## 7. `ClipboardPlugin.ts` 实现

剪贴板之前会优先读取：

```text
MultiSelectPlugin.api.selectedNodeIds
```

这会让剪贴板依赖多选插件的内部状态。

本次改为：

```text
context.selection.getSelectedNodeIds()
```

回退逻辑仍保留：

```text
如果运行时选中态为空，则读取 VueFlow 节点上的 selected 字段。
```

新的依赖方向：

```text
ClipboardPlugin
  → context.selection
  → useCanvasStore 运行时选中态
```

不再依赖：

```text
ClipboardPlugin
  → MultiSelectPlugin.api
```

## 8. 报错与处理

### 8.1 `PluginContext` 新增字段后 stub 缺失

首次构建时报错：

```text
src/canvas/core/plugins/PluginManager.ts(435,5): error TS2741:
Property 'selection' is missing ... but required in type 'PluginContext'.
```

原因：

```text
types.ts 中 PluginContext 新增了 selection 字段。
真实 createPluginContext 已补充 selection，但 PluginManager 的 stub context 没有补充。
```

处理：

```text
在 PluginManager.createStubContext() 中补齐 selection 空实现。
```

stub 行为：

```text
getSelectedNodeIds() → 空 Set
getSelectedEdgeIds() → 空 Set
setSelectedNodeIds() → stubWarn
setSelectedEdgeIds() → stubWarn
setSelection() → stubWarn
clearSelection() → stubWarn + false
```

### 8.2 依赖警告

最终构建通过，但仍存在依赖包警告：

```text
[INVALID_ANNOTATION] A comment "/* #__PURE__ */" in "@vueuse/core/dist/index.js" contains an annotation that Rolldown cannot interpret due to the position of the comment.
```

结论：

```text
这是 node_modules 中 @vueuse/core 的打包注释警告。
不影响 vue-tsc 和 vite build 结果。
不是本次业务代码引入的错误。
```

## 9. 验证结果

执行命令：

```bash
pnpm build
```

结果：

```text
vue-tsc -b && vite build
✓ built
```

说明：

```text
类型检查通过
生产构建通过
仅保留第三方依赖 annotation 警告
```

## 10. 当前结论

本次重构后的核心原则：

```text
useCanvasStore 是当前多选的统一运行时数据源
MultiSelectPlugin 是选择行为输入层
PluginContext.selection 是插件访问选中态的边界
localStorage 不保存当前选中态
```

新的数据流：

```text
VueFlow / MultiSelectPlugin
  → Canvas.vue 或 context.selection
  → useCanvasStore runtime selection
  → SelectionFrame / Clipboard / Edge highlight / Batch connect
```

这样保留了 `useCanvasStore` 对当前多选的统一维护能力，同时避免刷新后恢复多选框。