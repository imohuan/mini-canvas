# Cloud 图片/视频资源真上传后端（复用 saveAsset 抽象，按画布分目录 + hash 去重）执行计划

日期：2026-09-04 · 分支：代码优化 · 目标：`/cloud`（BackendSyncPlugin 页）· 方案已与用户多轮对齐，用户指示"制作 /cloud"。

## 一、目标与设计要点
- 用户记忆的"保存资源函数" = 前端 `AssetManager.saveAsset(blob,fileName,mime)→assetId`：**按 SHA-256 内容 hash 去重**（同图不存两份）、返回 id。所有上传/拖拽/粘贴入口都走它。
- 病根：它把字节存进**浏览器 IndexedDB**，不落后端 → `/cloud` 刷新/换浏览器丢图；且 `/cloud` 没装 StoragePlugin，连这个 AssetManager 都没有。
- 方案：**给 `/cloud` 一个"后端版 AssetManager"**——接口(AssetStore)不变、调用方零改动，只是底层 `AssetStore` 换成走后端：`save/get` 打 `/api/canvases/:id/resources`，字节落 `project-{canvasId}/assets/`（按画布分目录）、服务端同样按 SHA-256 去重。这样 id 能跨会话从服务器取回 → 刷新不丢。

## 二、后端改动（mcp-server）
1. `NodeStorage` 新增**画布资源**存储：
   - `saveResource(canvasId, name, data): Promise<{ assetId, stored }>`：写 `workspace/project-{canvasId}/assets/{sha256}{ext}`；**同 hash 已存在则不重写直接返回**（去重）。
   - `readResource(canvasId, assetId): Buffer|null`。
   - （沿用现有 project-{taskId} 目录体系，每画布一个 assets 子文件夹。）
2. `CanvasHttpServer` 新增 REST：
   - `POST /api/canvases/:id/resources`（multipart `file`）→ `{ ok, assetId, url: '/api/canvases/:id/resources/:assetId', name, type, size }`（服务端算 sha256，前端传不传都以后端为准）。
   - `GET /api/canvases/:id/resources/:assetId` → 返回字节（content-type 按扩展名）。
   - 若画布不存在先 `createCanvas` 兜底？不加，靠前端已连画布。

## 三、前端改动（canvas-core）
1. 新增 `BackendAssetStore implements AssetStore`（`src/plugins/storage/adapters/` 下，构造带 baseUrl+canvasId）：
   - `save(assetId, blob, fileName, mime)` → `FormData` POST 资源接口，返回 stored/assetId。
   - `get(assetId)` → GET 资源接口取回 Blob；`has`/`list`/`delete` 按需（list/delete 先后端加最小实现或跳过）。
   - AssetManager 现管线（saveAsset hash 去重、getObjectURL→blob URL、restoreNodeAssetUrls/StoragePlugin.restore）**可原样复用**——换的只是底层字节存放处。
2. 给 `/cloud` 提供"storage 插件能力"（复用 `StoragePlugin` 的 StorageAPI/assets 契约，但 store=BackendAssetStore，且不落 localStorage 项目）：
   - 更干净做法：**新增一个轻量 `BackendAssetPlugin`**（name='storage'，与 StoragePlugin 同名以让 `getPluginAPI('storage')` 命中），install 时 `assetManager.setStore(new BackendAssetStore(baseUrl, () => canvasId))`，暴露 `assets`。CloudCanvasView 装上它。
   - 这样 image/video 的 upload/拖拽/粘贴经 `context.getPluginAPI('storage')?.assets` 自动走后端，**节点插件代码零改动**。
3. BackendSyncPlugin 加载节点后**还原图片**：仿 StoragePlugin.restoreAssetURLs——对每个有 `assetId` 的节点，`assets.getObjectURL(assetId)` 后把结果 URL 写回 `data.imageUrl`（video→videoUrl）。加在 `loadCanvas`/`replaceAll` 之后（防抖即可）。接入点：CloudCanvasView 或插件内部监听 canvas 加载事件。
4. 数据上行：节点 data 持久化 `assetId`（后端已会存）；imageUrl 是运行时 blob（由还原逻辑重建），保存归一时仍剔除（沿用现状），后端节点留 assetId + 元数据 → 刷新后还原逻辑再按 assetId 从后端取回 → 图片恢复。这样与"后台权威"一致。

## 四、用户拍板结论
1. **每个画布资源单独管理**（`project-{canvasId}/assets/`，一画布一文件夹）——已确认。
2. 旧图（canvas-2026-09-01 现有两张，字节在浏览器 IndexedDB）**先不迁移**；之后用户重新建节点设资源时走新逻辑处理——已确认。
3. **video 一并覆盖**（video 节点上传/拖拽/粘贴也走后端）——已确认；audio 无独立节点暂不管。
4. 目录用 `project-{canvasId}/assets/`——已确认。

## 四之二、关键约束（用户强调，务必遵守）
**该插件只是"替换系统默认的本地保存方式"，必须可插拔**：
- 不启用它时，图片/视频上传等一切照旧走本地（IndexedDB）逻辑，不得破坏。
- 实现上天然满足：上传入口只认 `getPluginAPI('storage')?.assets`（AssetManager 抽象），本地页面装 StoragePlugin（store=IndexedDB）、/cloud 装新后端存储插件（store=BackendAssetStore）。**入口代码不改、按需插拔、互不影响**。
- 验收点：去掉新插件，/cloud（或根页）上传仍走本地 IndexedDB 正常；装上才走后端。

## 五、测试
- 后端：NodeStorage/资源接口单测（同图两次上传只存一份、按画布分目录、GET 可取、404 兜底）。
- 前端 vue-tsc exit 0。
- Chrome `/cloud` 实测：选 canvas-2026-09-01 → 图片节点点上传/拖图进画布/粘贴图 → 抓包见 POST .../resources → 后台 assets 目录多一个文件 → **刷新** → 图仍在（GET resources 还原）。video 同理。结束复原测试污染（清掉测试加的节点/资源）。

## 六、改动文件（预计）
- mcp-server：`src/storage/NodeStorage.ts`(+assets 方法)、`src/http/CanvasHttpServer.ts`(+2 REST)、`src/storage/__tests__/NodeStorage.test.ts`
- canvas-core：`src/plugins/storage/adapters/BackendAssetStore.ts`(新)、`src/plugins/backend-sync/BackendSyncPlugin.ts`(加载后还原)、可能 `CloudCanvasView.vue`/新 `BackendAssetPlugin`(接线 storage API)
- 导出：`src/index.ts`
