# mini-canvas v2 持久化侦察清单 —— 统一 key-value 保存(key,value,type) 前置摸底

> 侦察范围：`packages/canvas-core/src`（画布核心）、`src/views` + `src/composables/useMcpClient.ts`（app 宿主）、`packages/mcp-server`（Node 后端）。产出：穷举现存所有"持久化保存/读取"代码点，按 v2 四类 type（`config`/`canvas`/`resource`/`shortcut`）分类。行号为 grep/read 实测，随代码演进会漂移，请以符号名为准复核。

---

## 0. 一句话总览

- **配置类（config）** 几乎全部挤进一个 localStorage 键 `canvas-state`（`useCanvasStore` + VueUse `useStorage`，deep 响应式，改即整写）。
- **画布类（canvas）** 有 **两套并存**：本地的 `canvas-ai:project:*`（StoragePlugin + AutoSave，键按项目 id）+ 一条遗留 `canvas-data`（useCanvasFlow，貌似无人调用）；后端流程是"内存 GraphModel + 手动 `/save` 落盘"。
- **资源类（resource）** 字节经 `AssetManager` → 三选一 AssetStore（IndexedDB `canvas-ai-assets` / FileSystem `assets/` / 后端 `project-{id}/assets/`）；节点只存 `assetId`（内容 SHA-256），URL 每次刷新按 assetId 重建。
- **快捷键类（shortcut）** 内存单例 `ShortcutManager` 是权威，持久化走 `canvas-state` 里 `core.shortcutKeymap`；**只在 Canvas.vue `onUnmounted` 回写**（即"卸载才落盘"的丢失坑）。

---

## 1. type = config（设置 / 通用配置）

### 1.1 表

| 文件:行 | 存什么(key/value) | 存到哪 | 何时触发 | 读取入口 |
|---|---|---|---|---|
| `packages/canvas-core/src/composables/useCanvasStore.ts:223` | 整个 `state`（`core` 视图/连线/端口/交互/性能 + `plugins` 插件命名空间）→ localStorage 键 **`canvas-state`** | localStorage | VueUse `useStorage` 默认 deep watch，**改即写整串**（无防抖） | store 初始化即 `useStorage` read（同 223 行）；序列化器 `read` 在 32-99 |
| `packages/canvas-core/src/composables/useCanvasStore.ts:32-111` | 自定义 serializer：把 `Set↔数组`、`ConnectionMode/SelectionMode↔字符串`、插件命名空间缺省补 `{}` | 同上 `canvas-state` | read（32）/ write（100）时 | read 32，write 100 |
| `packages/canvas-core/src/composables/useCanvasStore.ts:396-412` | `usePluginStore(pluginName).get/set` → `state.plugins[pluginName]`（每个插件一个 key，key 名 = 插件 name） | 同 `canvas-state` | 插件 get/set 即写 | 各插件经 `context.store.toRef/get/set` |
| `packages/canvas-core/src/Canvas.vue:66-69`（`getSettingValue`→`panelRegistry.useValue`） | 面板项（core.* 或 plugins.*）双向绑定写回 `canvas.state` | 同 `canvas-state` | 面板 UI v-model 改动即写 | `getSettingValue` 供 DynamicSettingsPanel v-model |
| `packages/canvas-core/src/registry/PanelRegistry.ts:86-186` | `useValue(id, store)` dotted-path 读写：`core.x` → `state.core.x`；`theme.accent` → `state.plugins.theme.accent`（第一段非 core 即当插件名） | 同 `canvas-state` | computed.set 即写 | 同上 |
| `packages/canvas-core/src/plugins/theme/ThemePlugin.ts:47,59,112` | 主题配置（`activePreset`/`accent`/`surface`）→ `store.get/set('activePreset')`（`canvas.state.plugins.theme`） | 同 `canvas-state` | 主题切换/面板改即写（store.set） | install 时 `store.get('activePreset')` 读默认 47 |
| `packages/canvas-core/src/plugins/auto-layout/AutoLayoutPlugin.ts:53-58` | 布局配置（direction/intraSpacing/interSpacing/focusHeightRatio）→ `context.store.toRef(...)`（`plugins.auto-layout`） | 同 `canvas-state` | ref 变更即写 | `context.panels.registerSetting` 默认值来自 config 53-58 |

### 1.2 是否多套并存 / key 命名

- **同一份"设置/配置"只有一套落盘点**：`canvas-state`（config 名义上 = `canvas.state.core`；插件个性化配置也塞在**同一个键**的 `plugins` 子命名空间，不是独立 localStorage 键）。
- 项目级 vs 全局级混放：`canvas-state` 是**浏览器全局**（不随项目切换）；而 StoragePlugin 的 `canvas-ai:project:*` 是**每项目**。同一个"配置"既没区分项目作用域，也没有持久层抽象——`canvas-state` 一个键同时装了 core 交互设置 + 各插件设置（theme/auto-layout/剪贴板等），无 type/value 区分，写一次就是整个 JSON 串整写（含大 Set/字符串化）。

### 1.3 坑

- **无独立 key、整键整写**：任意一个面板开关改动就 `localStorage.setItem('canvas-state', JSON.stringify(整个 state))`，无防抖、无字段级 key（正好是 v2 想拆成 `save(key,value,type)` 的理由）。
- **插件命名空间不 schema 化**：`plugins` 是 `Record<string,Record<string,unknown>>`，插件名即命名空间、字段即 key，全靠约定，无类型/迁移/校验（v2 config 应给 key 加 schema）。
- 未发现"config 双写/写多处"。

---

## 2. type = canvas（nodes + edges）

### 2.1 表 —— A. 本地持久化（localStorage / FileSystem，浏览器 authority）

| 文件:行 | 存什么(key/value) | 存到哪 | 何时触发 | 读取入口 |
|---|---|---|---|---|
| `packages/canvas-core/src/plugins/storage/StoragePlugin.ts:75-76,112-114,490` | 项目画布 `{nodes,edges}`（`sanitizeForSave` 清洗后）→ localStorage 键 **`canvas-ai:project:<projectId>`** | localStorage | `api.saveCanvas` 手动/被 AutoSave 定时调 | `loadCanvasFromLocalStorage` 116-123、`loadCanvas` 514-545（缓存优先） |
| `packages/canvas-core/src/plugins/storage/StoragePlugin.ts:75,108-109,501` | 项目索引 `ProjectMeta[]` → localStorage 键 **`canvas-ai:project-index`** | localStorage | createProject/deleteProject/saveCanvas(更新 updatedAt) 即写 | `loadProjectsFromLocalStorage` 99-106、ensureDefaultProject 188-217 |
| `packages/canvas-core/src/plugins/storage/StoragePlugin.ts:500,73-94`(writeProjectJSON 在 FileSystemAdapter:73) | 同一份画布 `project.json` + 根索引 `canvas-ai-project-index.json`（文件系统模式） | FileSystem（用户选的目录，`project-<id>/project.json`） | saveCanvas 在 fsAdapter 存在时**与 localStorage 同时写** | connect/tryRestore 读根索引 + `loadCanvas` |
| `packages/canvas-core/src/plugins/auto-save/AutoSavePlugin.ts:25-63,87` | 监听 nodesChange/edgesChange/nodeDragStop/connect → 1s 防抖调 `storage.saveCanvas`；**beforeunload 直写 localStorage 键 `canvas-ai:project:<currentProjectId>`** | localStorage（beforeunload 那一支绕过 StoragePlugin，纯本地键） | 改动 1s 防抖；`visibilitychange hidden`/`beforeunload` 强制落 | 无显式读（读取走 storage.loadCanvas） |
| `packages/canvas-core/src/composables/useCanvasFlow.ts:15,42,62` | 整个 VueFlow `toObject()`（nodes+edges+viewport）→ localStorage 键 **`canvas-data`** | localStorage | 手工 `persistCanvasData`（未发现调用者） | `initCanvasData` 42-56（同样未发现调用者，疑似遗留） |
| `packages/canvas-core/src/composables/useCanvasBootstrap.ts:20-44` | 从 `storage.loadCanvas(currentProjectId)` 载入 nodes/edges 到 VueFlow（`fromObject`），空则用默认 | 读 storage 层 | onMounted 初始加载 | Canvas.vue:480-482 `bootstrap.loadInitialCanvas()` |

### 2.2 表 —— B. 后端（mcp-server 为 authority；仅 cloud/mcp 路由用）

| 文件:行 | 存什么(key/value) | 存到哪 | 何时触发 | 读取入口 |
|---|---|---|---|---|
| `packages/mcp-server/src/storage/NodeStorage.ts:107-116` | 画布 `{nodes,edges}`（sanitize 后）→ 磁盘 `./workspace/project-<id>/canvas.json` | Node fs 磁盘 | 仅当 HTTP `/save` 被调 | `loadCanvas` 119-127 |
| `packages/mcp-server/src/http/CanvasHttpServer.ts:187-200` | `POST /api/canvases/:id/save`：先把 body 里前端 nodes/edges `model.fromJSON` 盖进内存，再 `storage.saveCanvas` 落盘 | 磁盘 canvas.json | **手动**（前端显式调 save） | 见 2.4 |
| `packages/mcp-server/src/graph/GraphModel.ts:263,321,399-415` | `applyBatchNodes/applyBatchEdges/toJSON/fromJSON` —— **纯内存**，batch CRUD **不落盘** | 内存 | batch/create/update 改内存、SSE 广播 | `GET /api/canvases/:id` |
| `packages/canvas-core/src/plugins/backend-sync/BackendSyncPlugin.ts:255-320`（上行），363-389（定时全量） | 本地增删/位移/数据增量 → `batchNodes/batchEdges` 到后端（防抖 400ms；另 3s 定时整推 data diff） | 后端内存 GraphModel | 事件收集 + `debounceMs=400`；`fullSyncMs=3000` 定时 tick；visibilitychange flush | 下行 via `GET canvas` / SSE |
| `packages/canvas-core/src/plugins/backend-sync/BackendSyncPlugin.ts:49,68,462` | 记住上次画布 id → localStorage 键 **`backend-sync:canvas-id`** | localStorage | connect/切画布（remember） | install 68 |

### 2.3 表 —— C. app 宿主装配（决定上面哪套生效）

| 文件:行 | 用什么 | 说明 |
|---|---|---|
| `src/views/CanvasView.vue:104,139,146` | AutoSavePlugin + **StoragePlugin**(默认 localStorage) + ShortcutManagerPlugin | 根页默认本地流程 |
| `src/views/CloudCanvasView.vue:53-56` | **BackendSyncPlugin** + **BackendStoragePlugin**（取代 storage/auto-save） | `skip-default-load`；保存归后台（节点 3s 全量 + 400ms 增量，**但见 2.5 坑**） |
| `src/views/McpCanvasView.vue:55-61,83-85` | AutoSavePlugin + **StoragePlugin** + ShortcutManagerPlugin，另用 `useMcpClient` | `useMcpClient.save()` 手动把 `vf.toObject()` POST 到 `/api/canvases/:id/save` |

### 2.4 表 —— D. app useMcpClient（后端 authority 的 REST/SSE）

| 文件:行 | 存什么 | 存到哪 | 何时触发 | 读取入口 |
|---|---|---|---|---|
| `src/composables/useMcpClient.ts:117-131` | `save()`：`vf.toObject()` nodes/edges → `POST /api/canvases/:id/save` | 后端磁盘 | **手动**（McpCanvasView 工具栏"保存"按钮 83-85 / 84） | `loadIntoFlow` 69-80（GET 全量）+ SSE 55-62 |
| `src/composables/useMcpClient.ts:85,27` | 记住上次画布 id → localStorage 键 **`mcp-canvas-current-id`** | localStorage | switchCanvas 即写 | `restoreLastCanvas` 109-114 |
| `src/composables/useMcpClient.ts:134-141` | `createNode` → `POST /api/canvases/:id/nodes` | 后端内存 | 手动 | — |
| `src/composables/useMcpClient.ts:144-151` | `createTask` → `POST /api/tasks` | 后端 | 手动 | — |

### 2.5 坑 / 观察（canvas 类）

- **本地模式双写一数据**：StoragePlugin `saveCanvas`（StoragePlugin.ts:490）在文件系统连接后**仍先写 localStorage** 再写 FS 的 `project.json`（498-509）——同一画布 `{nodes,edges}` 在 localStorage 与用户目录里各存一份，两份可能不一致（FS 失败回退，见 504-507）。这正是"同一数据写多处"的样板。
- **AutoSave 绕过抽象直写键**：`AutoSavePlugin.ts:87` 的 beforeunload 分支直接用 `localStorage.setItem('canvas-ai:project:'+id)`，不走 `storage.saveCanvas`，因此**文件系统模式下会漏掉 FS 那半份**，只更新 localStorage —— 卸载前最后一次改动只在 localStorage、FS 落后。
- **canvas-data 遗留键**（useCanvasFlow.ts:15）与 `canvas-ai:project:*` 语义重复，但 useCanvasFlow 的 init/persist 未发现调用者（只 export + usePluginSystem import 类型），疑似死代码/旧路径，统一抽象时应剔除或合并。
- **后端 batch 不落盘 = 静默丢**：BackendSyncPlugin 只发 `batch-nodes/batch-edges`，后端只改内存 GraphModel（CanvasHttpServer.ts:142-171），**没有触发 `/save`**；CloudCanvasView 注释声称"保存归后台"，但只有 `/save` 才写盘。后台重启/进程退出即丢——前端 cloud 流程并没有定期/退出调 `/save` 的兜底（对比 useMcpClient 还需用户手点"保存"）。
- **MCP 视图双 authority 并存**：McpCanvasView 同时装了本地 StoragePlugin+AutoSave（AutoSave 会把内容写进本地 `canvas-ai:project:*`，因为 `getPluginAPI('storage')` 命中本地插件），又靠 useMcpClient 把数据 POST 后端 —— 同一次编辑会被写进"浏览器本地键"和"后端"两处，且 AutoSave 的 currentProjectId 是本地 storage 的，和真正显示的后端画布不是一回事，易写错/写漏。
- **key 命名不统一**：本地 `canvas-ai:project:*`、遗留 `canvas-data`、后端记忆 `backend-sync:canvas-id`、MCP 记忆 `mcp-canvas-current-id`、项目索引 `canvas-ai:project-index` —— 五套不同命名，作用域（每项目/全局/每画布）也没有抽象。

---

## 3. type = resource（图片/视频/音频字节）

### 3.1 表 —— 前端字节存取（浏览器 authority 模式）

| 文件:行 | 存什么(key/value) | 存到哪 | 何时触发 | 读取入口 |
|---|---|---|---|---|
| `.../storage/adapters/AssetManager.ts:32-45` | `saveAsset(blob)`：按内容 SHA-256 算 `assetId`，去重后交底层 store | 由 setStore 决定（见下） | 节点上传/拖拽/粘贴等手动调 | `getObjectURL` 59-71、`getBlob` 48 |
| `.../storage/adapters/AssetManager.ts:59-71` | `getObjectURL(assetId)`：store 取 Blob → `URL.createObjectURL` 缓存 | object URL 内存缓存（assetId→url） | 节点加载/刷新恢复 | 见 3.2 读取入口 |
| `.../storage/adapters/IndexedDBAssetStore.ts:7-8,39-61` | 字节 + 元数据 → IndexedDB DB **`canvas-ai-assets`** / store `assets`，key=`assetId` | 浏览器 IndexedDB | saveAsset | `get` 63-75 等 |
| `.../storage/adapters/FileSystemAssetStore.ts:76-103` | 字节写入用户目录 `project-<id>/assets/<assetId>.<ext>`，`_manifest.json` 记元数据 | FileSystem | saveAsset（fs 模式） | `get` 105-118 |
| `.../storage/adapters/FileSystemAssetStore.ts:47-58` | `_manifest.json`（assetId→文件名/mime/size/磁盘名） | 同目录 | 每次 save/delete 后 | `#loadManifest` 33-45 |
| `.../storage/StoragePlugin.ts:95-96` | localStorage 模式把 store 定为 `IndexedDBAssetStore` | IndexedDB | install/回退 | — |
| `.../storage/StoragePlugin.ts:289-293,451-453` | filesystem 模式切到 `FileSystemAssetStore(project-<id>目录)` | FileSystem | connect/switchProject | — |
| `.../storage/StoragePlugin.ts:139-185,296,395` | `scheduleRestoreAssetURLs`：巡检节点 data.assetId → `getObjectURL` 重建 imageUrl/videoUrl | 前端节点 data | 刷新后 300ms / 连 FS / 切项目后 | loadCanvas 529-540 也有同款恢复 |
| `packages/canvas-core/src/storage/AssetRuntimeService.ts:7-24` | `restoreNodeAssetUrls(nodes)`：按 assetId 逐节点补 object URL | 前端节点 data | 手动调用 | 同上 |

**字节读入口（谁触发重建 URL）**：`StoragePlugin.loadCanvas`(529-540)、`scheduleRestoreAssetURLs`(169)、各节点组件（`VideoNode.vue:281-291` 用 `saveAsset` 落 `assetId` 后建节点）。节点 `data.assetId` 是画布 JSON（canvas 类）里唯一的资源引用，字节本体不入 canvas JSON。

### 3.2 表 —— 后端 authority 资源（Cloud 路由 + mcp-server）

| 文件:行 | 存什么 | 存到哪 | 何时触发 | 读取入口 |
|---|---|---|---|---|
| `.../storage/adapters/BackendAssetStore.ts:49-64` | 上传字节 → `POST /api/canvases/:id/resources`（multipart） | 后端 `project-<id>/assets/` | 节点 saveAsset 上传 | `get` 66-72（GET 同 URL） |
| `.../storage/adapters/BackendAssetStore.ts:40-43` | 会话内元数据 `meta` Map（无后端 list 端点） | 内存 | save/get 记录 | list 87-89、has 74-78 |
| `packages/canvas-core/src/plugins/storage/BackendStoragePlugin.ts:41-43` | 用 BackendAssetStore 替换默认 IndexedDB 存到后端 | 后端 | 安装即换 store | `assets` API |
| `packages/mcp-server/src/storage/NodeStorage.ts:177-191` | `saveResource`：字节 SHA-256 命名存 `assets/<sha>.<ext>`，去重 | 磁盘 | POST /resources | `readResource` 211-219 |
| `packages/mcp-server/src/http/CanvasHttpServer.ts:232-256` | `POST /api/canvases/:id/resources` 处理上传落盘 | 磁盘 assets/ | HTTP 上传 | — |
| `packages/mcp-server/src/http/CanvasHttpServer.ts:259-270` | `GET /api/canvases/:id/resources/:assetId` 取字节（永久缓存 immutable） | — | HTTP 读 | 前端 BackendAssetStore.get / 节点 URL |
| `packages/mcp-server/src/http/CanvasHttpServer.ts:205-218` | `POST /api/upload`（通用文件，非按画布）→ `uploads/` 目录 | 磁盘 uploads/ | HTTP | `GET /api/files/:name` 221-226 |
| `src/composables/useMcpClient.ts` | **不负责**资源字节（只做节点；资源走前端节点插件的 `getPluginAPI('storage').assets` → 本视图是本地 StoragePlugin 的 IndexedDB） | — | — | — |

### 3.3 坑 / 观察（resource 类）

- **同一"字节资源"有 3 种不同后端**：IndexedDB（DB `canvas-ai-assets`）、FileSystem（`assets/*.sha.ext` + `_manifest.json`）、后端磁盘（`project-<id>/assets/`），靠 `AssetManager.setStore` 在运行时切换，抽象接口（`AssetStore`）已统一，但**没有统一键名/寻址**：IndexedDB 用裸 sha 当 key，FileSystem/后端用 `sha.ext` 文件名且可带扩展寻址（NodeStorage.resolveResourceName 195-208 兼容两种）。
- **节点只存 assetId、URL 每会话重建** → 同一资源存在"三种存储 + 内存 object URL"四处引用同一 assetId，换 store（StoragePlugin 230 / BackendStoragePlugin 43 / handleFSInvalidated 229-230）时先 `revokeAllURLs` 再换，任何节点上残留的 blob URL 会失效 → 靠 `scheduleRestoreAssetURLs`/`loadCanvas` 重建。切 store 之间可能闪断/漏恢复。
- **MCP 视图资源与画布不同源**：见 2.5 —— `useMcpClient` 把画布数据 POST 后端，但资源字节走本地 StoragePlugin→IndexedDB，两者 authority 分裂；而 Cloud 视图用 BackendStoragePlugin 时字节才真正落后端。抽象时 resource 的落点应跟随"画布 authority"而非各自为政。
- **BackendAssetStore.list/has 无后端端点**，只靠会话内 `meta` Map 兜底（BackendAssetStore.ts:21-22,74-78）——刷新/换浏览器 `list()` 会空。

---

## 4. type = shortcut（快捷键 keymap）

### 4.1 表

| 文件:行 | 存什么(key/value) | 存到哪 | 何时触发 | 读取入口 |
|---|---|---|---|---|
| `packages/canvas-core/src/plugins/ShortcutManager.ts:88-370` | 内存单例：注册表（id→keys）、`defaultKeys`、`reverseKeyMap`；`loadKeymap/exportKeymap` | **内存（无自身持久化）** | register/remap/reset/import 改内存 | — |
| `packages/canvas-core/src/plugins/ShortcutManager.ts:347-351` | `loadKeymap(map)`：对每个 id `remap`（冲突静默跳过） | 内存 | 加载持久化映射时 | — |
| `packages/canvas-core/src/plugins/ShortcutManager.ts:361-370` | `exportKeymap()`：**只导出与默认不同的"脏"项** | 返回对象 | 手动（Canvas 卸载时） | — |
| `packages/canvas-core/src/Canvas.vue:609-610` | mount 从 `canvas.state.core.shortcutKeymap` **loadKeymap** 进单例 | 读 `canvas-state` | 组件挂载 | Canvas.vue:609 |
| `packages/canvas-core/src/Canvas.vue:642-644` | onUnmounted：`canvas.state.core.shortcutKeymap = mgr.exportKeymap()`（写穿进 `useStorage('canvas-state')`） | localStorage `canvas-state` | **组件卸载时** | 下次 mount 609 读回 |
| `packages/canvas-core/src/plugins/shortcut-manager/ShortcutHelpPanel.vue:197-207` | `exportKeymap()`：`ShortcutManager.exportKeymap()` → **下载 JSON 文件**（`shortcut-keymap.json`） | 用户本地文件 | 手动点"导出" | — |
| `packages/canvas-core/src/plugins/shortcut-manager/ShortcutHelpPanel.vue:209-230` | `importKeymap()`：读上传 JSON → `manager.loadKeymap` | 内存（改单例） | 手动点"导入" | — |
| `packages/canvas-core/src/plugins/shortcut-manager/ShortcutManagerPlugin.ts:41-48` | 注册 `ctrl+/` 帮助面板（自身不存 keymap） | — | — | — |

**key 命名**：持久化没有独立 localStorage 键 —— keymap 是 `canvas-state`（config 共用键）里 `core.shortcutKeymap` 一个字段，序列化进同一串。文件导入导出则是 `{ shortcutId: keys }`（`KeymapData`，ShortcutManager.ts:60-62）格式的 JSON，无独立存储键。

### 4.2 多套并存 / 命名一致性

- 持久化只有"一种"（`canvas-state` 内字段），但**权威在内存单例**（ShortcutManager），`canvas-state.core.shortcutKeymap` 只是它的"旁路镜像"，只在 mount（读入）与 unmount（写回）同步 —— 这是全仓最典型的"**卸载才落盘**"。

### 4.3 坑（重点，用户点名"丢失 bug"）

- **只脏导出 + 只在卸载写**：`exportKeymap`（ShortcutManager.ts:361-370）只返回与默认键不同的项，且写回 `canvas-state` 唯一时机是 Canvas.vue `onUnmounted`（642-644）。会话中任何一次 remap/import（经 ShortcutHelpPanel/RemapPanel 直接改内存单例，见 4.1），**都不写 store**；若组件卸载没走（整页/浏览器关闭、路由被替换、异常），最新键位**不会落盘 → 刷新丢失**。
- **`canvas-state` 整键写**：即便 onUnmounted 执行，写的还是整个 config 串（含 plugins 大对象），且 shortcut 只是其中一小段，单改快捷键也牵连重写全部配置。
- **导入不改 store**：HelpPanel `importKeymap`(209-230) 只 `manager.loadKeymap` 改内存，不写 `canvas.state.core.shortcutKeymap`；导入后同样要等 Canvas unmount 才落盘，期间若刷新即丢。
- **单例跨画布串扰**：ShortcutManager 是进程级单例（`getInstance`，96-101），但 VueFlow 系统键（vueflow.*，Canvas.vue:587-606）只在 onMounted 注册、onUnmounted 不注销；多画布/热切换时单例累积条目，`exportKeymap` 的"脏"判断基于 defaultKeys，可能把上一画布残留的键也导出。

---

## 5. 附：其余候选（语义接近但非四类）

- `FileSystemAdapter`（`plugins/storage/adapters/FileSystemAdapter.ts:30-46,73-115`）：文件系统下的 `readRootJSON/writeRootJSON/writeProjectJSON/deleteProjectFolder` —— 是 canvas 类落盘的底层搬运工，不单独算一类，统一抽象时应作为 canvas 的"后端适配"。
- `IndexedDBAdapter`（`plugins/storage/adapters/IndexedDBAdapter.ts:31-71`）：只存 **FileSystem handle**（DB `canvas-ai-db`/store `handles`，见 StoragePlugin 84-86），非业务数据，是"记住用户选的文件夹"的凭证。

---

## 6. 统一 key-value 设计可吸收 / 需规避清单

**可吸收（好设计，保留思路）**
1. `AssetStore` 接口已把 resource 抽象成 `save/get/has/list/delete/clear(assetId)` —— v2 resource 类型可照搬这层。
2. `AssetManager.contentHash`（SHA-256 assetId）+ 去重 + object URL 生命周期，是"内容寻址资源"的正确姿势，v2 应继承。
3. `usePluginStore/plugin 命名空间` 的"插件名=命名空间"思路，v2 config 可扩展成 `save(pluginPrefix.key, value, 'config')`。
4. `panelRegistry.useValue` 的 dotted-path 双向绑定，统一了"面板改→store 写"的入口，v2 config 层可保留此读写面。
5. 内容寻址 + "节点只存 id、URL 每次按 id 重建"的模型，天然抗跨会话/跨浏览器资源漂移。

**需规避的坑（v2 应一并解决）**
1. **卸载才落盘 / 手动才落盘**：shortcut（Canvas.vue onUnmounted 642-644）与 canvas 后端（只有 `/save` 写盘）——应改为"改即入队、生命周期点可靠 flush"，禁止把持久化挂在组件卸载或用户手点。
2. **同一数据写多处且不一致**：StoragePlugin 一存（FS 模式先 localStorage 再 FS 490+498）；AutoSave beforeunload 直写 localStorage 键绕过 StoragePlugin；MCP 视图本地 AutoSave 与后端 `/save` 双写。统一 key-value 应保证"一个 (key,type) 只有一个权威落点 + 可选多副本，但要原子一致"。
3. **无防抖/整串整写**：`useStorage('canvas-state')` 改即整写无防抖；面板每改一个开关都重写全串。v2 `save(key,value,type)` 应字段级落盘 + 统一防抖/批量。
4. **配置与 shortcut 共用一个键**：`canvas-state` 同时装 core 设置、各插件 config、shortcutKeymap，key 语义混一。v2 至少 split 成 config 与 shortcut 两个 type，各管各的键。
5. **key 命名五花八门**：`canvas-ai:project:*`、`canvas-data`、`backend-sync:canvas-id`、`mcp-canvas-current-id`、`canvas-ai:project-index` —— 建议 v2 统一为 `save(namespace, key, value, type)` 的规范键。
6. **"只脏导出"丢默认语义**：shortcut 只存 diff（exportKeymap），一旦默认值变化旧存档对不上；v2 建议存全量 keymap 或带 schema 版本。
7. **角色/作用域分裂**：resource/canvas 的落点应跟随"当前画布 authority"（本地 vs 后端），MCP/Cloud 两条路由当前 authority 不统一，v2 应在接入层收敛为同一存储抽象，避免画布在 A 后端、资源在 B 本地。
8. **遗留死键** `canvas-data`（useCanvasFlow）与 `canvas-state` 并存，建议迁移期统一清理，避免新旧两套同时落盘。
