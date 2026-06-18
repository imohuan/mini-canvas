# 多选批量连接问题排查记录

> 记录本次围绕 `Canvas.vue`、`SelectionFrame.vue`、`useCanvasStore.ts` 的修改逻辑、报错现象、根因判断与处理结果。

## 1. 背景现象

画布可视区域只有少量节点，但 store 中节点数量明显更多；同时出现以下交互问题：

- 选中节点后按 `Delete`，VueFlow 可视层删除了节点，但 store 中节点没有真正删除。
- 多选节点后从 `SelectionFrame` 的连接按钮拖线，可以看到临时连线，但松手后正式连接线不稳定或不显示。
- store 中存在边数据，但 VueFlow 画布不显示对应连接线。
- 多选批量连接时，目标节点没有普通连接时的 3D / blur / glow 反馈。
- 批量连接结束时出现临时 target 节点被当作正式 target 的情况。

## 2. 关键报错与日志

### 2.1 删除只影响 VueFlow，不影响 store

现象：

```text
画布节点被删除，但 Pinia / localStorage 中 canvas.nodes 数量不变。
```

含义：

```text
VueFlow 内部状态和业务 store 分裂。
```

### 2.2 store 有边，但画布不显示

现象：

```text
store.edges 中已有连接线数据，但 VueFlow 当前渲染层没有显示。
```

后续重复拖拽时出现：

```text
[连线拦截] 连接已存在
```

含义：

```text
重复判断读的是 store，但渲染读的是 VueFlow 当前边集合。
store 有边 ≠ VueFlow 当前帧一定有边。
```

### 2.3 批量连接误连到临时 target

报错 / 日志：

```text
Canvas.vue:230 [连线拦截] 连接已存在: {
  source: 'node-text-1781557909820',
  target: 'selection-batch-target-1781559072094',
  sourceHandle: 'source',
  targetHandle: 'target'
}
```

含义：

```text
selection-batch-target-* 是批量连接预览阶段创建的临时节点，不是真实业务节点。
它被目标查找逻辑当成了正式 target。
```

### 2.4 VueFlow 临时边 target 缺失警告

报错：

```text
[Vue Flow]: Edge target is missing
Edge: selection-batch-edge-node-text-1781585566836-1781586236102
Target: selection-batch-target-1781586236102
```

含义：

```text
某一帧里 VueFlow 看到了临时边还在，但临时 target 节点已经被删除。
这是临时节点和临时边清理顺序不一致导致的中间态。
```

## 3. 根因拆解

### 3.1 数据源分裂

当前画布存在两套状态：

```text
VueFlow 内部状态
  ├─ 当前可视节点
  ├─ 当前可视边
  └─ selected / dimensions / computedPosition

Pinia store
  ├─ canvas.nodes
  ├─ canvas.edges
  └─ selectedNodeIds / selectedEdgeIds
```

问题不是单个函数写错，而是不同操作写入了不同数据源：

- 删除操作主要影响 VueFlow 内部状态。
- store 没有同步删除，所以 localStorage 中残留历史节点。
- 连接创建时写入 store，但 VueFlow 当前渲染层不一定同步显示。
- 重复连接判断读取 store，导致“store 里已有但画布没显示”的边被拦截。

### 3.2 批量连接使用了临时节点

多选批量连接为了显示多条预览线，会创建：

```text
selection-batch-target-*
selection-batch-edge-*
```

这些只应该存在于拖拽预览阶段。

但目标识别逻辑之前没有排除临时节点，导致：

```text
鼠标附近最近的节点 = selection-batch-target-*
正式连接 target = selection-batch-target-*
```

这会让正式连接错误地连向临时节点。

### 3.3 多选连接绕过普通连接反馈链路

普通连接时的数据流：

```text
拖线移动
→ 计算目标节点反馈区
→ 写入 connectionState.hoverFeedbackNodeId
→ 写入 connectionState.hoverFeedbackPoint
→ CustomNode 显示 3D / blur / glow
→ 松手时按同一套目标识别创建连接
```

多选批量连接之前的数据流：

```text
拖线移动
→ 移动 selection-batch-target-* 临时节点
```

缺失：

```text
hoverFeedbackNodeId / hoverFeedbackPoint 更新
```

所以目标节点没有 3D 模糊反馈，也让“是否已经拖到节点上”的交互判断不直观。

## 4. 本次修改逻辑

### 4.1 store 增加统一节点/边操作入口

在 `useCanvasStore.ts` 中补充：

```text
getNodeById
getEdgeById
addNode / addNodes
addEdge / addEdges
removeNodeById
removeNodesByIds
removeEdgeById
removeEdgesByIds
removeEdgesByNodeIds
updateNodePosition
```

目的：

```text
所有节点/边新增、删除、位置同步都从 store 统一入口进入。
```

### 4.2 节点删除同步 store

在 `Canvas.vue` 的 `onNodesChange` 中处理 VueFlow 的 `remove` 事件：

```text
VueFlow 删除节点
→ Canvas.vue 接收 nodes-change remove
→ store.removeNodesByIds
→ 同步删除节点
→ 级联删除相关边
→ 清理 selectedNodeIds / selectedEdgeIds
```

效果：

```text
按 Delete 后，VueFlow 可视层和 store 持久化层都会删除。
```

### 4.3 创建连接时同步 store 和 VueFlow

新建正式连接时：

```text
canvas.addEdge(edge)
vueFlowInstance.addEdges([edge])
```

目的：

```text
避免只写 store，不进入 VueFlow 当前渲染层。
```

### 4.4 已存在边但未渲染时恢复 VueFlow 渲染

当 `findSameConnection` 在 store 中找到已有边时，不再立即当成重复连接拦截。

现在逻辑：

```text
store 有边
→ 检查 VueFlow 当前 getEdges 是否也有
→ 如果 VueFlow 没有，则 addEdges 补回渲染层
→ 如果 VueFlow 也有，才提示连接已存在
```

解决：

```text
store.edges 有数据但画布不显示时，重新拖拽会恢复显示，而不是被误拦截。
```

### 4.5 临时节点/临时边不参与正式连接

增加临时对象判断：

```text
isTempNode
isTempEdge
```

并在以下流程排除临时对象：

```text
findNearestValidTarget
findNearestValidSource
findSameConnection
```

目的：

```text
selection-batch-target-* 和 selection-batch-edge-* 只用于预览，不参与正式连接目标识别和重复判断。
```

### 4.6 多选批量连接接入普通连接反馈链路

批量连接拖拽移动时新增反馈更新：

```text
onBatchConnectMove
→ updateBatchTempTarget
→ updateBatchConnectFeedback
→ findNearestValidTarget / findNearestValidSource
→ 写入 connectionState.hoverFeedbackNodeId
→ 写入 connectionState.hoverFeedbackPoint
```

效果：

```text
多选连接拖到目标节点时，目标节点应和普通连接一样出现 3D / blur / glow 反馈。
```

### 4.7 临时边/临时节点清理顺序调整

之前清理可能产生中间态：

```text
临时 target 节点先没了
临时 edge 还在某一帧里被 VueFlow 看到
→ Edge target is missing
```

现在处理：

```text
vueFlowInstance.removeEdges(tempEdgeIds)
vueFlowInstance.removeNodes([tempNodeId])
canvas.removeEdgesByIds(tempEdgeIds)
canvas.removeNodeById(tempNodeId)
```

并且在 `onBatchConnectEnd` 中避免重复清理同一批临时对象。

## 5. 当前连接链路

### 5.1 普通单节点连接

```text
从 source handle 拖出
→ VueFlow connection line 渲染
→ buildConnectionEdgeProps 更新目标节点反馈
→ onConnect / onConnectEnd 创建正式边
→ store + VueFlow 同步写入
```

### 5.2 多选批量连接

```text
从 SelectionFrame 连接按钮拖出
→ 创建 selection-batch-target-* 临时节点
→ 创建 selection-batch-edge-* 临时预览边
→ 拖动时移动临时 target
→ 同步更新目标节点 3D / blur / glow 反馈
→ 松手时排除临时节点，查找真实目标节点
→ 清理临时节点/边
→ 为每个选中源节点创建正式边
→ store + VueFlow 同步写入
```

## 6. 仍需重点观察的点

### 6.1 localStorage 历史脏数据

历史上已经写入 `canvas-nodes` / `canvas-edges` 的脏数据不会自动消失。

如果 DevTools 里仍看到比可视区域更多的节点，可能是历史数据残留。

处理方式：

```text
清理 localStorage 中 canvas-nodes / canvas-edges
或增加“重置画布”入口
```

### 6.2 临时连接是否仍有 warning

如果再次出现：

```text
[Vue Flow]: Edge target is missing
```

优先检查：

```text
临时 edge 是否在临时 node 删除前已经从 VueFlow 渲染层删除
是否有其他地方直接 splice store.edges / store.nodes
```

### 6.3 目标反馈是否和正式连接一致

多选连接拖到目标节点时应满足：

```text
目标节点出现 3D / blur / glow
松手后正式边连接到真实目标节点
控制台不再出现 selection-batch-target-* 被当成正式 target
```

## 7. 结论

本次问题本质是：

```text
VueFlow 内部状态、Pinia store、临时预览对象、正式业务对象的边界不清晰。
```

修复方向是：

```text
1. store 和 VueFlow 当前渲染层同步写入 / 同步删除
2. 临时节点和临时边只用于预览，不能进入正式连接判断
3. 多选批量连接复用普通连接的目标反馈状态
4. 删除临时对象时避免 VueFlow 中出现边引用缺失节点的中间帧
```