# canvas-core v2 第一批 API：选中双集 + 节点写能力 + 点选语义

> 日期：2026-09-07 · 状态：已实现（用户拍板 1A+2A+3A）
> 背景：为后续复刻老版 C 档插件（group/multi-select/clipboard/align-arrange 等）提供地基。
> 分层不变：canvas-core-v2/canvas-render 只出数据与能力 API，UI 由插件消费。

## 一、决策记录

- 1A：CanvasNode 增加可选 parentId + size，支持 group 嵌套；老数据无字段不落盘，向后兼容。
- 2A：Selection 的 ids 保持节点集语义不动，新增 edgeIds 边集 + 边专属增删；现有命令/删除零改动。
- 3A：节点动态实测宽高不入存储：渲染层 ResizeObserver 量测后放只读 nodeLayout 服务（后续批次）。

## 二、内核 Selection v2

文件：packages/canvas-core-v2/src/services/selection.ts

- ids: ReadonlySet<string> —— 节点 id 集（语义不变）
- edgeIds: ReadonlySet<string> —— 边 id 集（新增）
- has(id) 查节点 / hasEdge(id) 查边
- set(ids) 设节点集 / setEdges(ids) 设边集
- add(id)/remove(id) 节点增删；addEdge(id)/removeEdge(id) 边增删
- clear() 两桶一起清；clearNodes() 只清节点；clearEdges() 只清边
- size = 节点 + 边合计（只选节点时与原值一致）
- onChange(cb) 任一桶变化触发，快照为最新

## 三、内核 NodeStore v2 写 API

文件：packages/canvas-core-v2/src/services/nodeStore.ts

CanvasNode 新增可选字段：parentId（父节点 id，组嵌套）；size（声明尺寸）。

- addNodes(inputs): number —— 批量插（type/position 必填，id/data/parentId/size 可选），广播一次 add
- updateNode(id, patch): void —— position/size/parentId/data 任意子集；显式 undefined 清字段
- updateNodes(entries): void —— 批量原子更新，广播一次 update
- removeNodes(ids): number —— 删父自动清存活子节点 parentId（防悬挂），广播一次 remove
- childNodesOf(parentId): CanvasNode[] —— 直属子节点

兼容性：addNode/updateNodeData/removeNode/replaceAll/subscribe 语义不变。

## 四、渲染层点选语义纯函数

文件：packages/canvas-render/src/host/selectionInteractions.ts（宿主与插件共用）

- clickNode(sel, nodeId, { shiftKey }): 普通=清边+节点单选；Shift=切换该节点（边不动）
- clickEdge(sel, edgeId, { shiftKey }): 普通=清节点+边单选；Shift=切换该边（节点不动）
- clickPane(sel): 清空两桶；返回是否原本有选中

CanvasHost 接线：@node-click→clickNode；@edge-click→clickEdge（新增）；@pane-click→clickPane。
syncSelected 同步边集：edgeSelection.selectedEdgeIds 随内核 edgeIds 更新（CustomEdge 高亮可读）。

## 五、验证

- canvas-core-v2: 237 测试全绿 + tsc 干净
- canvas-render: 101 测试全绿 + vue-tsc 干净

## 六、后续批次（未做）

- nodeLayout：渲染层量测节点尺寸 + 绝对坐标只读服务
- 渲染层事件桥：node-drag / nodes-change / edges-change / move 以 ctx 事件广播
- viewport 服务：读视口 / setCenter / fitView / zoomTo / screen-flow 互转
- 命令/快捷键元数据扩展
- 框选完整闭环（VueFlow 多选视觉 ↔ 内核双集双向同步）

