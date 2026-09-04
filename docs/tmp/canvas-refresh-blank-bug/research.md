# 画布刷新后空白、滚动才出现节点 —— 定位与修复

## 现象
`http://localhost:5174/#/`（CanvasView，本地模式）刷新后画面空白，节点不显示；用鼠标滚动/平移画布后节点才出现。

## 根因
1. 节点数据存在 localStorage（`canvas-ai:project:default`），刷新后由 `useCanvasBootstrap.loadInitialCanvas()` 从 StoragePlugin 加载。
2. Canvas.vue 的 `<VueFlow>` 开启了 `onlyRenderVisibleElements`（useCanvasStore 默认 `true`），**只渲染落在视口内的节点**。
3. 加载完成后**没有执行 fitView**，viewport 停在初始 `translate(0,0) scale(1)`。
4. 本次保存的节点坐标为 `x=-827, y=267`（上次会话被拖到视口左侧之外），完全在 `scale(1)` 的视口外 → VueFlow 判定不可见 → 节点不渲染 → 空白。
5. 用户滚动/平移画布使视口覆盖到节点后，VueFlow 重新判定可见 → 节点出现。

> 同类问题此前在 **MCP 模式**（`#/mcp`）已修复（commit `bad8699`）：`useMcpClient.loadIntoFlow` 改为 `setNodes/setEdges` 后 `fitView`。但**本地模式** CanvasView 走的 `loadInitialCanvas()` 路径漏了 fitView，故本次补上。

## 修复
`packages/canvas-core/src/composables/useCanvasBootstrap.ts`：
从存储成功加载节点（`fromObject` + `nextTick`）后调用 `vueFlowInstance.fitView({ padding: 0.2, duration: 0 })`，把视口适配到已保存节点，并 try/catch 忽略 fitView 在节点未初始化完成时的异常。

## 验证（Chrome DevTools 实测）
刷新 `#/` 后：
- 修复前：`.vue-flow__nodes` 为空，transform `translate(0,0) scale(1)`，无任何节点。
- 修复后：节点 `fd-1788450604216-1` 直接渲染，transformationpane transform `translate(3203.92px, -938.81px) scale(3.77857)`，fitView 生效，无需滚动即可见，控制台无报错。
