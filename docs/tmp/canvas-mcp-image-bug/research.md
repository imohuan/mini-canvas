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
