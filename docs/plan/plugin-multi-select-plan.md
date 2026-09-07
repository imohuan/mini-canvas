# plugin-multi-select 实现计划（多选框选闭环）

> 日期：2026-09-07 · 分支：feat/cordis-plugin-system · 状态：计划
> 目标：做出第一个交互类插件 multi-select 的 v2 复刻，验证交互插件链路（渲染层能力 + 插件包）。
> 分层：canvas-render 提供框选/选中回流能力；插件做命令/快捷键/Service/UI。

## 一、现状断点

- 内核 Selection 已是双集(ids=节点/edgeIds=边)，clickNode/clickEdge 点选手势已闭环。
- 但节点高亮 = VueFlow 内部 node.selected（BaseNode props.selected），宿主 nodesFromStore 不带 selected：
  - nodes 重建(syncFromStore: 拖完/删/undo)后 VueFlow selected 全丢 → 高亮消失；
  - 框选(VueFlow 原生 Shift+拖)批量改 VueFlow selected，宿主无 @selection-end 接线 → 内核不知 → 不一致。
- VueFlow 原生框选已默认可用：selectionMode=Full + selectionKeyCode=Shift，无需自造。

## 二、渲染层能力（A，canvas-render 纯增量）

1. nodesFromStore(store, selectedIds?)：可选把 selected 标记进每个 flow node。
2. CanvasHost 新增 onSelectionEnd：VueFlow @selection-end → 经 surfaceRef 读 getSelectedNodes/getSelectedEdges
   → 写内核 selection（node ids + edge ids 单源）；随后 refresh 渲染态使高亮一致。
3. 渲染态统一派生：store 变化与 selection 变化都走同一 refreshRenderState()
   （nodes = nodesFromStore(store, selection.ids)），消除高亮丢/不一致。
4. CanvasSurface：expose getSelectedNodeIds/getSelectedEdgeIds；@selection-end 绑回调。

## 三、插件包（B，packages/plugins/plugin-multi-select）

包结构同 plugin-canvas-commands（无 .vue 或带一个框选提示层可选）。

- 快捷键：Ctrl+A 全选（内核 set 所有 node id）、Escape 清空（clear）。
- Service（MultiSelectService extends Service，上架 multi-select）：
  selectAll() / clearSelection() / getSelectedNodes() / getSelectedEdgeIds() / hasSelection()。
- 命令：multi-select:select-all / multi-select:clear（元数据含 keys/areas，供菜单）。
- 不重复：删除走 command:delete；打组/改色待 group/theme 插件到位再挂。

## 四、验证

- 内核/render 测试全绿（新增：nodesFromStore selected 标记、onSelectionEnd 语义可单测部分抽纯函数）。
- 插件单测：Ctrl+A/Escape 语义（在 createMiniCanvasHost + 插件装配下）。
- vue-tsc 干净。

## 五、契约红线

- 不碰 src/ 老版；不改 core 已有公开签名（nodesFromStore 加可选参向后兼容）。
- UI 归插件；渲染层只补数据/手势到选中集的能力。

