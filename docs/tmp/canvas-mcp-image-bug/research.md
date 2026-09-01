# MCP 创建图片节点无法显示图片 — 分析报告

## 现象
通过 MCP `canvas.create_node` 创建图片节点并传入本地图片路径后，前端画布页面 http://localhost:5174/#/mcp 上图片不显示（显示灰色占位图标）。

## 根因（两层）

### 根因 1：data 字段名与前端契约不匹配（主因）
- MCP 创建节点时传的字段是 `data.src`（例如 `{ src: "F:\其他\xxx.jpg" }`）。
- 前端图片节点组件 `packages/canvas-core/src/nodes/image/ImageNode.vue` 渲染图片用的是 **`data.imageUrl`**：
  ```vue
  <img v-if="data?.imageUrl && !error" :src="data.imageUrl" />
  ```
- 前端正常上传图片时（`ImageNodePlugin.ts` 的 `handleImageUpload`）写入的字段是 `imageUrl`、`imageName`、`imageType`、`imageSize`、`imageWidth`、`imageHeight`、`cardWidth`、`cardHeight`。
- 所以 `data.src` 不生效，`data.imageUrl` 为 undefined → 走了 else 分支显示灰色占位图。

**验证**：用 PATCH 给节点 data 补上 `imageUrl`（picsum.photos 的 URL）后，页面立即渲染出 `<img>` 且图片成功加载（300x200）。

### 根因 2：浏览器无法加载本地绝对路径文件
- 即使字段名改成 `imageUrl`，直接传本地绝对路径 `F:\其他\xxx.jpg` 也会失败。
- 浏览器 `<img src="file:///F:/...">` 受安全策略（同源/CORS）限制，无法从 `http://localhost:5174` 页面加载本地文件。
- **验证**：在页面里 `new Image()` 加载 file:// 路径触发 onerror，`loaded:false`。
- 结论：必须由后端提供静态文件服务（HTTP 端点）或转成可访问的 URL（blob / base64 / 后端托管）。

## 数据流（确认正常的部分）
- MCP `canvas.create_node` → `GraphModel.createNode`：把语义类型 `image` 转成 `type:'custom'` + `data.nodeType:'image'`，data 原样保留。✅ 正确。
- 前端 `useMcpClient.switchCanvas` → `loadIntoFlow` → `vf.fromObject({nodes, edges})` → VueFlow 加载节点。✅ 正常（节点能进 store 并渲染 CustomNode）。
- 前端 `CustomNode.vue` 根据 `data.nodeType` 从 nodeRegistry 找到 `ImageNode` 组件渲染。✅ 正常。
- SSE `/events` 推送 + 前端自动重载。✅ 正常（更新节点后页面自动刷新图片）。

## 修复建议
1. **MCP 端**：创建/更新图片节点时，data 用前端期望的字段 `imageUrl`（而非 `src`），并尽量补全 `imageName/imageType/imageWidth/imageHeight`。
2. **后端加静态资源服务**：在 CanvasHttpServer 增加 `GET /api/files/:id` 之类的端点托管图片，MCP 传该 URL 作为 imageUrl；或支持 base64 data URL。
3. 若只是临时验证，可用公网图片 URL 或 blob。

---

## 后续：刷新后数据丢失 + 刷新后空白缩放才出现（已修复）

### 现象
1. 页面/服务刷新后画布数据不见（图片视频显示不出来）。
2. 刷新后页面空白，缩放后才出现内容。

### 根因
**A. `sanitizeForSave` 一刀切删除 mediaUrl**
- `packages/mcp-server/src/storage/sanitize.ts` 把 `imageUrl/videoUrl` 等当运行时字段，保存时一律从 data 删除。
- 前端本地 blob:/data: 临时 URL 不该保存（正确），但 MCP 设置的 `http://localhost:8765/api/proxy-media?...` 持久 URL 也被删了 → 落盘后 mediaUrl 丢失 → 刷新后图片视频显示不出。
- **修复**：`removeRuntimeData` 对 media URL 字段仅删除 `blob:`/`data:` 临时值，保留 `http(s)` 持久 URL。

**B. 后端服务重启后内存画布清空**
- `GraphModel` 是纯内存态，服务重启后画布丢失（即使磁盘有数据）。
- **修复**：`server.ts` 启动时遍历 `storage.listProjects()`，`loadCanvas` + `createCanvas` + `fromJSON` 自动恢复所有画布。

**C. 前端刷新后不自动恢复画布 + 加载时序竞争**
- `McpCanvasView` 刷新后只 `connect()`，不自动加载上次画布。
- Canvas 组件 `onMounted` 里 `loadInitialCanvas()` 会从前端 StoragePlugin 加载默认节点，与 `useMcpClient.setNodes`（后端数据）竞争，导致后端数据被默认节点覆盖（mediaUrl 丢失的假象）。
- 刷新后没有 `fitView`，节点在视口外 → "空白，缩放才出现"。
- **修复**：
  - `useMcpClient`：记住上次画布 id 到 localStorage（`mcp-canvas-current-id`），新增 `restoreLastCanvas()`，`connect()` 后自动恢复；`loadIntoFlow` 改用 `setNodes/setEdges` + `fitView`。
  - `Canvas.vue` 新增 `skipDefaultLoad` prop，MCP 模式跳过默认节点加载，避免覆盖后端数据。
  - `McpCanvasView` 传 `:skip-default-load="true"`，onMounted 后 `restoreLastCanvas()`。

### 验证（实测通过）
- 后端重启自动恢复画布，节点 data 完整保留 `imageUrl/videoUrl`。
- 前端刷新自动选中上次画布，图片（1184×880）与视频（readyState=4, 10.08s）直接显示，无需缩放。

---

## 后续：节点无输入输出端口 + 页面编辑画布无法保存（已修复）

### 问题 1：创建的节点没有输入输出端口
**根因**：`BaseNode.vue` 用 `props.targetPosition` / `props.sourcePosition`（VueFlow 节点数据）决定是否渲染端口。MCP 创建节点时 data 没带这两个字段 → 端口不显示。
**正确语义**：端口应根据**节点类型定义**（`canReceiveInput` / `canProduceOutput`）动态决定。
**修复**（`BaseNode.vue`）：
- 新增 `showTargetHandle` / `showSourceHandle` computed：优先用节点数据显式设置的 `targetPosition`/`sourcePosition`；未设置时按 `nodeDef.canReceiveInput/canProduceOutput` 决定。
- 模板 `v-if` 及 `showTargetZones`/`shouldShowTargetZones` 改用这两个 computed。

### 问题 2：页面编辑画布（如移动节点）保存后刷新回到原位
**根因**：前端拖拽移动节点后，最新位置只存在前端 VueFlow 里，后端 `GraphModel` 内存仍是最旧数据。后端 `POST /api/canvases/:id/save` 只用 `model.toJSON()`（内存旧位置）落盘，前端位置没同步进来。
**修复**：
- `useMcpClient.save()`：把前端当前节点/边（含最新位置）用 `vf.toObject()` POST 给后端。
- 后端 `/save`：解析 body 的 nodes/edges，`model.fromJSON()` 覆盖内存后再 `saveCanvas()` 落盘。

### 验证（实测通过）
- 端口：图片/视频节点各显示 target+source 2 个端口（共 4 个）。
- 保存：把图片节点移到 (300,400) → 点保存 → 刷新页面 → 位置保持 (300,400)。

---

## 功能：图片节点持久化配置 options + 运行任务 id（已实现）

### 需求
- `ImageBottomToolbar.vue` 里的可持久化内容（promptText 文本、selectedStyle/selectedModel/selectedSize 下拉等）统一作为 `options` 保存到节点配置。
- 节点的运行任务 id 放节点属性（`taskId`），用于后续通过任务 id 获取最新状态。
- 这些配置在**创建节点的 MCP** 中即可设置。

### 实现
**前端（`ImageNode.vue`）**
- `toolbarConfig` 初始值从 `props.data.options` 载入（合并默认值，字段齐全）。
- 本地编辑 → deep watch 回写 `data.options`（完整配置，不丢字段）。
- 外部（MCP）设置 `data.options` → 监听引用变化同步到本地。
- 之前双向 watch 会互相覆盖导致字段丢失，已改为「外部引用变化同步 + 回写完整配置」。

**MCP（`mcp/server.ts`）**
- `canvas.create_node` 新增可选 `options` 参数，自动合并进 `data.options`。
- `canvas.update_node` 说明支持 data 内更新 `options`/`taskId`。

### 数据约定
- 节点 `data.options`：`{ promptText, promptDoc, selectedStyle, selectedModel, selectedSize }`
- 节点 `data.taskId`：运行任务 id

### 验证（实测通过）
- MCP 创建节点带 `data.options` + `taskId`，节点 data 正确携带。
- 磁盘 canvas.json 完整保存 options（含 selectedModel/selectedSize，不丢字段）。
- 后端重启后 options/taskId 完整恢复。
- 前端 store 从 options 正确初始化 toolbarConfig。


