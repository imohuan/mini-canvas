# mini-canvas MCP 后台服务 — 设计 & 实施计划（v3 统一版）

> 目标：把 `@mini-canvas/canvas-core` 扩展成「headless 无头画布引擎 + MCP 服务 + CLI」，
> 前端 `mini-canvas` 作为展示/操作入口，**数据唯一权威在后台，保存全部交给后台**。
> CLI 一键启动，支持对图片/视频/音频/文本节点增删改查、连线、定位，布局 JSON 落盘，实时状态监听。

---

## 目录
1. [已确认架构决策](#一已确认架构决策用户拍板)
2. [现状盘点](#二现状盘点基于-codegraph-实读)
3. [总体架构](#三总体架构保存归后台)
4. [职责边界](#四职责边界保存归后台的具体化)
5. [GraphModel 设计](#五graphmodel-无头画布引擎设计)
6. [实时通道机制](#六实时通道机制重点)
7. [技术选型](#七技术选型)
8. [复用盘点](#八现有代码复用盘点基于-codegraph-实读)
9. [文件清单](#九需新建修改文件)
10. [MCP Tool 清单](#十mcp-tool-清单草案)
11. [实施步骤](#十一实施步骤每步独立可验证--commit)
12. [测试方案](#十二测试方案)
13. [默认假设](#十三默认假设无异议即生效)
14. [风险](#十四风险)
15. [附录：来龙去脉](#附录来龙去脉)

---

## 一、已确认架构决策（用户拍板）

| 项 | 决定 |
|---|---|
| 服务形态 | **headless 纯数据层**，不渲染 DOM |
| 实时通道 | **SSE 单向**（命令走 MCP/HTTP；双向以后单独用 HTTP） |
| 画布模型 | **任务 ID = 画布 ID**，一个任务即一个画布，靠它区分多画布 |
| 前端角色 | 纯展示 + 操作入口：下拉选 taskId → 从后台 load → 实时看进度 → 画布上操作 |
| **保存** | **全部交给后台**；前后端**共用同一份 canvas.json**，前端不自己持久化 |
| 数据权威 | **后台 GraphModel 唯一**，前端经后台读写 |
| 异步任务 | 后台接管：MCP 只创建返回 task_id，后台轮询/请求结果，完成自动回写数据 + SSE |
| 客户端 | 只提供 MCP 出口 |
| 技术栈 | TS + `@modelcontextprotocol/sdk` + Hono(SSE) + commander + Vitest |
| 不用 | Next.js / Express（headless 服务无页面渲染需求） |

---

## 二、现状盘点（基于 codegraph 实读）

### 已有家底（全是可复用的）
| 能力 | 位置 | 说明 |
|---|---|---|
| 插件体系 | `plugins/PluginManager` + `PluginContext.EventBus` | 插件可装可卸，事件总线派发 |
| **CanvasRuntime 中枢** | `runtime/CanvasRuntime.ts` | 集中暴露 `eventBus / commandRegistry / nodeRegistry / pluginManager / vueFlowInstance` |
| 命令中枢 | `registry/CommandRegistry` | 适合做 MCP 工具映射层 |
| 节点类型 | `nodes/{text,image,Video,panorama,image-compare}/*Plugin` | 5 种节点，都有 Plugin |
| 序列化 | `vueFlowInstance.toObject()/fromObject()` | VueFlow 原生，布局即 `{nodes, edges}` JSON |
| 存储 | `plugins/storage` → `StorageAPI.saveCanvas/loadCanvas/currentProjectId` + `FileSystemAdapter`/`AssetManager` | **已经支持项目化 + 落盘** |
| 自动保存 | `plugins/auto-save` → `AutoSaveAPI.saveNow/isDirty` | 监听 + 手动触发 |
| 历史/撤销 | `plugins/history` | 可批量操作后回滚 |
| 自动布局 | `runAutoLayout` | 定位辅助 |
| 事件类型 | `runtime/CanvasEvents.ts` | nodesChange/edgesChange/connect/storage:*/history:* 已定义 |

### 核心难点（MCP 化的真正障碍）
1. **VueFlow 是 DOM 组件**：`useVueFlow()`、`<VueFlow>`、`vueFlowInstance.addNodes` 都强依赖浏览器 DOM。
   → 服务端 Node 环境**不能直接跑 `<Canvas/>`**，需要无头（headless）方案。
2. nodes/edges 不在 Pinia 里，而在 VueFlow 实例里 → 无头后要自己维护一个「可被 MCP 读写」的图数据层。
3. 节点组件（`CustomNode.vue` 等）是 Vue 组件，无法在纯 Node 里渲染 → MCP 只操作**数据**，不操作 DOM。

---

## 三、总体架构（保存归后台）

```
┌─────────────────────────────────────────────────────────────────────┐
│                       后台 mcp-server（唯一数据权威）                  │
│                                                                     │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ GraphModel │  │  MCP SDK     │  │ TaskManager│  │ NodeStorage   │  │
│  │ 纯数据层    │  │ (命令出口)    │  │ 异步任务后台│  │ (fs 落盘)      │  │
│  └─────┬─────┘  └──────┬───────┘  └─────┬─────┘  └──────┬────────┘  │
│        │               │                │               │           │
│  ┌─────▼───────────────▼────────────────▼───────────────▼─────────┐ │
│  │ 共享核心：CanvasData 结构 + sanitizeForSave + 多项目(ProjectMeta) │ │
│  │ SSE 推送通道（Hono /events）                                     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────────┘
      ┌─────────────────────────┴──────────────────────────┐
      │  HTTP: get_canvas / save / 命令                    │ SSE: 实时推送
      ▼                                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  前端 mini-canvas（Vue3 + VueFlow，展示 + 操作入口）                   │
│  - 下拉框选 taskId → HTTP load → fromObject 渲染                      │
│  - SSE 订阅 → 实时刷新进度/状态                                        │
│  - 画布操作（拖拽/连线）→ 发命令给后台                                  │
│  - 【改造】不再自己持久化；保存/加载都经后台                            │
└─────────────────────────────────────────────────────────────────────┘
```

### 三层分离原则（关键设计）
1. **GraphModel（纯数据层，无 DOM）**：把 VueFlow 的 nodes/edges 用一套纯 TS 数据模型接管，实现 `addNode/removeNode/updateNodePosition/connect/...`。**不碰 DOM**。
2. **MCP 协议层**：把 GraphModel 的操作包成 MCP Tool（增删改查、连线、定位、保存、加载、订阅）。用官方 `@modelcontextprotocol/sdk`。
3. **CLI 层**：`mini-canvas mcp start` 一键起服务。

> **为什么能这么做**：canvas-core 的插件/registry/eventBus/storage 都是**纯 TS、不依赖 DOM** 的（storage 有 FileSystemAdapter）。真正依赖 DOM 的只有 `<Canvas/>` 和节点组件。所以可以**只复用纯逻辑部分**，图数据改用无头 GraphModel。浏览器端画布和 MCP 服务之间通过 `toObject()/fromObject()` 的 JSON 双向同步。

---

## 四、职责边界（保存归后台的具体化）

1. **后台 = 唯一数据权威**：GraphModel 持有所有画布（taskId 区分），NodeStorage 落盘 `./workspace/project-{taskId}/canvas.json`。
2. **前端不持久化**：前端 StoragePlugin 的本地 localStorage 保存角色弱化，改成"通过后台保存"。加载时从后台拿数据渲染，改动经后台写回。
3. **共用同一份 JSON**：数据格式沿用现有 `CanvasData`（`{nodes, edges}`）+ `ProjectMeta`（多项目）+ `sanitizeForSave`（清洗临时节点/运行时字段）。前端存的格式后台可读，后台存的格式前端可读。
4. **保存动作触发**：前端用户点保存 / 定时自动保存 / MCP 调 `canvas.save`，最终都由后台写盘。

---

## 五、GraphModel（无头画布引擎）设计

新包内部一个 `graph/` 目录，纯 TS、零依赖 DOM：

```ts
interface CanvasNode {
  id: string
  type: 'image' | 'video' | 'audio' | 'text' | 'panorama' | 'image-compare'
  position: { x: number; y: number }
  data: { label: string; status?: 'idle'|'rendering'|'done'|'error'; progress?: number; src?: string; url?: string }
  [k: string]: any
}
interface CanvasEdge {
  id: string
  source: string; target: string
  sourceHandle?: string; targetHandle?: string
  data?: any
}
```

方法（**MCP Tool 直接映射**）：
- `createNode(taskId, type, position?, data?)` → 生成 id
- `deleteNode(taskId, id)`
- `updateNode(taskId, id, patch)`（改 label/src/视频地址/状态等）
- `listNodes(taskId, filter?)` / `getNode(taskId, id)`
- `createEdge(taskId, source, target, handles?)`
- `deleteEdge(taskId, id)` / `updateEdge(taskId, id, patch)` / `listEdges(taskId)`
- `setPosition(taskId, id, {x,y})`
- `setViewport(taskId, {zoom, x, y})`（视口定位）
- `autoLayout(taskId)`（复用 `runAutoLayout`）
- `toJSON(taskId)` / `fromJSON(taskId, json)`

### 数据同步（实时监听）
GraphModel 内置一个**轻量事件总线**（可复用 canvas-core 的 `EventBus`）：
- 每次 mutation 后 emit：`node:added` `node:removed` `node:updated` `edge:added` `edge:removed` `graph:changed` `graph:saved`。
- MCP **subscribe 工具**：客户端订阅某个事件/图版本，服务端通过 **SSE 推送**（stdio 只做请求/响应，实时用 HTTP 通道）。

---

## 六、实时通道机制（重点）

| 通道 | 用途 | 协议 |
|---|---|---|
| **stdio** | CLI 本地、MCP 标准 tool call / response | `@modelcontextprotocol/sdk` 的 stdio transport |
| **SSE** | 推送实时变化（节点新增/删除/更新、进度） | Hono `streamSSE`，`/events` 端点 |

> **为何单向 SSE 够用**：命令走 MCP 标准协议（stdio/HTTP），实时变化由服务器单向推给订阅者。WebSocket 的"双向"优势（客户端推命令）用不上，且要额外处理连接管理/消息路由/并发序。若未来要双向，单独开 HTTP 通道，不并入 MCP。

**进度上报怎么实现**：把「生成图片/视频的进度」设计成**节点状态字段**（`data.progress`、`data.status: 'rendering'|'done'|'error'`），GraphModel 收到外部写入就 emit `node:updated`，客户端通过订阅实时刷新。CLI 服务可另开一个「资源/进度 Webhook 端点」，供生成任务回调。

**任务 ID = 画布 ID 的落点**：后台 GraphModel 按 taskId 分画布；NodeStorage 落盘 `project-{taskId}/canvas.json`；前端下拉框列出所有 taskId，选中即切换当前画布并实时订阅。

---

## 七、技术选型

| 部分 | 选型 | 为什么 |
|---|---|---|
| 语言 | TypeScript | 项目已是 TS |
| MCP 服务 | `@modelcontextprotocol/sdk` | 官方，MCP 协议必须用它 |
| HTTP/SSE | **Hono** | 极轻、TS 友好、原生 `streamSSE`，跑 Node 快；只需 `/events` 等少数端点 |
| 图数据 | 自写纯 TS GraphModel | 零框架依赖，可复用 |
| CLI | commander | 轻量参数解析 |
| 测试 | Vitest | 项目 devDeps 已含 |
| 构建/运行 | tsx（开发）/ tsc（产物） | 项目 devDeps 已含 tsx |

**排除项**：Next.js（网页应用框架，本需求无页面渲染）；Express（完整 web 框架，回调式 API 对 SSE/流式不顺手，这里只需要极轻端点）。若未来要加网页版画布管理界面，可单独开一个独立包/项目，不影响 mcp-server 本身。

---

## 八、现有代码复用盘点（基于 codegraph 实读）

| 能力 | 位置 | 前端 | 后台 | 说明 |
|---|---|---|---|---|
| 多项目体系(ProjectMeta/listProjects) | `StoragePlugin` | ✅ | ✅(复用结构) | taskId = project.id |
| `saveCanvas/loadCanvas` | `StoragePlugin` | ✅ | ❌ | 底层靠 localStorage，Node 无 |
| `sanitizeForSave` 清洗逻辑 | `plugins/storage/sanitizeForSave.ts` | ✅ | ✅ | **纯函数可复用** |
| `CanvasData` 数据结构 | `StoragePlugin` | ✅ | ✅ | **共享核心** |
| 文件系统适配器 | `FileSystemAdapter` | ✅ | ❌ | 依赖 `FileSystemDirectoryHandle`(浏览器) |
| 资产/资源管理 | `AssetManager` + stores | ✅ | ⚠️ | 图片/视频二进制，后台需 Node 版 |
| 事件总线 | `PluginContext.EventBus` | ✅ | ✅ | 纯 TS |
| 命令中枢 | `CommandRegistry` | ✅ | ✅ | 可映射为 MCP Tool |
| 自动布局 | `runAutoLayout` | ✅ | ⚠️ | 需验证是否纯 TS |
| 节点类型 | `nodes/{text,image,Video,...}/*Plugin` | ✅ | ❌ | 是 Vue 组件，后台只管数据 |
| `<Canvas/>`/节点组件 | `Canvas.vue` 等 | ✅ | ❌ | 不渲染 |

**保存插件复用结论**：StoragePlugin 底层靠浏览器 API（localStorage/`FileSystemDirectoryHandle`）Node 用不了；但**共享核心可复用**（`CanvasData` 结构 + `sanitizeForSave` 清洗 + `ProjectMeta` 多项目）。后台自写 `NodeStorage`（接口照抄 StorageAPI），保证前后端同构 JSON 互读。

---

## 九、需新建/修改文件

```
packages/mcp-server/            # 新包（含 graph-model + mcp + sse + tasks + storage + cli）
  package.json  tsconfig.json
  src/
    cli.ts                      # mini-canvas mcp start --transport stdio|sse --port --dir
    server.ts                   # 组装 GraphModel + MCP + SSE + TaskManager + NodeStorage
    graph/
      GraphModel.ts             # 图数据 + CRUD/连线/定位 + 事件总线 + graphVersion
      types.ts                  # CanvasNode/CanvasEdge/GraphEvent
      id.ts                     # crypto.randomUUID
    mcp/
      index.ts  tools.ts        # MCP server + Tool 注册
    sse/
      SseServer.ts              # Hono /events SSE 推送 + 订阅管理
    tasks/
      TaskManager.ts  runner.ts # 异步任务：创建→留底→轮询→回写
    storage/
      NodeStorage.ts            # Node 版（fs/promises），接口照抄 StorageAPI
      NodeAssetManager.ts       # Node 版资源管理（图片/视频文件落盘）
      shared.ts                 # 复用 CanvasData/sanitizeForSave（从 canvas-core 引入或复制）
packages/canvas-core/           # 小改（前端侧）
  src/plugins/storage/           # 改造：保存改走后台（可选 adapter 注入）
前端 src/views/                  # 加：画布下拉切换 + 状态面板 + 保存按钮（后续）
根 package.json                  # 加 mcp script
```

可选独立包：`packages/graph-model`（纯数据层，独立于 MCP 协议，供前后端复用）。

包依赖方向：`mcp-server → graph-model → canvas-core`（复用 storage/registry/eventBus/runAutoLayout/CommandRegistry）。

---

## 十、MCP Tool 清单（草案）

**画布/任务**：`canvas.create_canvas(taskId,name?)`、`canvas.list_canvases()`、`canvas.get_canvas(taskId)`、`canvas.delete_canvas(taskId)`
**节点**：`canvas.create_node`、`canvas.list_nodes`、`canvas.get_node`、`canvas.update_node`、`canvas.delete_node`
**连线**：`canvas.create_edge`、`canvas.list_edges`、`canvas.delete_edge`
**定位/布局**：`canvas.set_node_position`、`canvas.set_viewport`、`canvas.auto_layout`
**持久化(归后台)**：`canvas.save(taskId)`、`canvas.load(taskId)`、`canvas.export_json(taskId)`
**资源**：`canvas.add_asset(nodeId, filePath)`（走 `AssetManager`，文件拷入项目管理目录）、`canvas.get_asset(nodeId)`
**异步任务**：`task.create(kind,payload)`→返回 task_id、`task.status(task_id)`
**订阅**：`canvas.subscribe(events)`→返回订阅 id（走 SSE）
**高级命令**：复用 `CommandRegistry`（对齐/组合/撤销等）暴露成 tool。

---

## 十一、实施步骤（每步独立可验证 + commit）

### Phase 0 — 脚手架（1 commit）
- 初始化 `packages/mcp-server`，接 workspace，CLI 骨架（参数解析）。
- 验证：`tsx cli.ts --help`。

### Phase 1 — 共享核心抽取 + GraphModel（TDD，2~3 commits）
- 从 canvas-core 抽出/引入共享：`CanvasData`、`ProjectMeta`、`sanitizeForSave`（确认纯 TS，必要时复制到 mcp-server）。
- `graph/types.ts` + `GraphModel.ts`：taskId 即画布，CRUD/连线/定位/事件/版本号。
- 验证：单测全绿（CRUD、连线合法性、taskId 隔离、事件、版本）。

### Phase 2 — NodeStorage 落盘（Node 版，1~2 commits）
- `NodeStorage.ts`：`fs/promises` 实现 `createProject/switchProject/saveCanvas/loadCanvas/listProjects`，写 `./workspace/project-{taskId}/canvas.json`，复用 `sanitizeForSave`。
- 验证：创建画布→写→save→重开 load 恢复。

### Phase 3 — MCP 服务层（1~2 commits）
- `mcp/tools.ts` + `mcp/index.ts`：GraphModel + NodeStorage 包成 Tool，stdio transport。
- 验证：stdio 收到 tool list / 调用 create_node / save / load 返回结果。

### Phase 4 — SSE 实时推送（1 commit）
- `SseServer.ts`（Hono `/events`）：GraphModel 事件桥接 SSE，按 graphVersion 增量推。
- 验证：curl 订阅 + 另端 create_node 收到事件。

### Phase 5 — 异步任务后台（2 commits）
- `TaskManager`：`createTask` 返回 task_id；`getTaskStatus`；后台轮询。
- `runner.ts`：可插拔任务处理器，完成自动回写节点数据（`data.status/progress`）+ SSE。
- 验证：create_task 立即返回；模拟 runner 完成回写 + `task:done` 推送。

### Phase 6 — 前端接入（2~3 commits）
- 前端加"连接后台"：选 taskId → HTTP load → fromObject 渲染；SSE 订阅刷新。
- 前端操作 → 发命令给后台；保存按钮/自动保存 → 后台 save。
- 【改造】前端 StoragePlugin 本地保存弱化，改经后台（可注入 adapter）。
- 验证：浏览器开前端，选画布显示，操作后后台落盘，MCP 端能看到。

### Phase 7 — 收尾（1 commit）
- 根 package.json 加 mcp script；写 README（CLI/MCP Tool/SSE/前后端连接示例）；清理调试。

---

## 十二、测试方案

- **单元（Vitest）**：GraphModel CRUD/事件/版本/taskId 隔离；NodeStorage 读写；sanitizeForSave 复用。
- **集成**：stdio 全链路（create_canvas→create_node→save→load）。
- **端到端**：前端连后台，选画布渲染、操作、保存，后台文件更新，MCP 端同步可见。

---

## 十三、默认假设（无异议即生效）

1. 后台落盘 `./workspace/project-{taskId}/canvas.json`（Node fs/promises）。
2. 共享核心（CanvasData/sanitizeForSave/ProjectMeta）从 canvas-core 引入；若引入有依赖阻塞则复制到 mcp-server 并保持格式一致。
3. `runAutoLayout` 若纯 TS 则复用，否则后台换纯算法实现。
4. CLI 默认 `--transport stdio --dir ./workspace --port 8765`。
5. 异步 runner 先做可插拔占位，真实生成服务后续接入。
6. NodeAssetManager 先做基础文件落盘，图片/视频编解码等生成能力后续接。
7. id 生成用 `crypto.randomUUID()`，避免与浏览器/Node 冲突。

---

## 十四、风险

- **前后端数据格式一致性**：NodeStorage 与前端 StoragePlugin 必须产出同构 JSON，避免互读失败。
- **前端改造范围**：StoragePlugin 本地保存弱化需谨慎，别破坏现有浏览器内单机使用。
- **runAutoLayout 依赖面**：需验证是否纯 TS。
- **并发**：GraphModel 单实例串行 + graphVersion，SSE 增量推避免漏/乱。

---

## 附录：来龙去脉

本文档由两次对话合成：
1. **头脑风暴**（`docs/tmp/mcp-brainstorm/`）：初始需求探索、SSE vs WebSocket 分析、GraphModel 设计草案、技术选型。
2. **拍板迭代**：确认 headless、SSE 单向、taskId=画布、前端展示入口、**保存全归后台**、后台唯一数据权威、异步任务后台回写。

**已解决/关闭的讨论**：
- SSE vs WebSocket → 定 SSE 单向，双向以后单独 HTTP。
- 保存插件 → 复用共享核心（CanvasData/sanitizeForSave/ProjectMeta），后台自写 NodeStorage（浏览器底层 API 在 Node 用不了）。
- 技术选型 → 不用 Next.js/Express，用 Hono + @modelcontextprotocol/sdk + commander + Vitest。
