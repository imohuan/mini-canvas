# @mini-canvas/mcp-server

Mini Canvas 的 headless 无头画布引擎 + MCP 后台服务 + CLI。

数据权威在后台，前端 `mini-canvas` 作为展示/操作入口，**保存全部交给后台**。
一个任务 = 一个画布（taskId 即画布 id）。

## 能力

- **headless GraphModel**：纯数据层，无 DOM，支持节点/连线/定位的增删改查。
- **MCP 出口**（`@modelcontextprotocol/sdk`）：AI / MCP 客户端通过 stdio 发命令。
- **HTTP REST**：前端通过 HTTP 读写画布。
- **SSE 实时推送**：单向推送图变化，前端实时刷新。
- **异步任务后台**：MCP 只创建任务返回 task_id，后台自动处理并回写节点数据。

## 安装

```bash
pnpm install
```

## 启动服务

```bash
# stdio 模式（默认，供 MCP 客户端连接）
pnpm --filter @mini-canvas/mcp-server start -- --transport stdio --dir ./workspace

# sse 模式（HTTP REST + SSE，供前端画布接入）
pnpm --filter @mini-canvas/mcp-server start -- --transport sse --port 8765 --dir ./workspace
```

或用 tsx 直接跑：

```bash
node node_modules/tsx/dist/cli.mjs packages/mcp-server/src/cli.ts mcp start --transport sse --port 8765
```

### CLI 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--transport` | `stdio` 或 `sse` | `stdio` |
| `--port` | HTTP 端口（sse 模式） | `8765` |
| `--dir` | 工作目录（画布 JSON 落盘） | `./workspace` |

### 查看工具

```bash
node node_modules/tsx/dist/cli.mjs packages/mcp-server/src/cli.ts mcp list-tools
```

## MCP 工具

MCP 工具保持精简（共 9 个），节点/连线的单点增删改都收敛到批量工具，一次合并执行：

**画布**：`canvas.create_canvas` `canvas.list_canvases` `canvas.delete_canvas` `canvas.get`（读整张画布全量）
**节点批量**：`canvas.batch_nodes` `{add:[...], delete:[...], update:[...]}`
**连线批量**：`canvas.batch_edges` `{add:[...], delete:[...], update:[...]}`
**语义化创建 + 后台任务**：`create_node`（预览/生成双模式，自动建预览节点并连线并提交任务）→ 返回 nodeId，用 `node.status` 查进度
**模型**：`models.list`

## HTTP API（前端用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/canvases` | 列出画布 |
| POST | `/api/canvases` | 创建画布 `{taskId, name}` |
| DELETE | `/api/canvases/:id` | 删除画布 |
| GET | `/api/canvases/:id` | 获取画布完整数据 |
| POST | `/api/canvases/:id/nodes` | 创建节点 |
| PATCH | `/api/canvases/:id/nodes/:nodeId` | 更新节点 |
| DELETE | `/api/canvases/:id/nodes/:nodeId` | 删除节点 |
| POST | `/api/canvases/:id/edges` | 创建连线 |
| POST | `/api/canvases/:id/save` | 保存画布（后台落盘） |
| POST | `/api/tasks` | 创建任务 `{kind, canvasId, targetNodeId, payload}` |
| GET | `/api/tasks/:taskId` | 查询任务状态 |
| GET | `/events?canvasId=xxx` | SSE 实时推送 |

## 前端接入

`/mcp` 路由（`McpCanvasView`）：
- 顶部工具条：连接后台、画布下拉切换、保存。
- 通过 HTTP 读写后台，SSE 实时刷新。

## 测试

```bash
pnpm --filter @mini-canvas/mcp-server test        # 单元测试
pnpm --filter @mini-canvas/mcp-server test:e2e    # MCP stdio 全链路
pnpm --filter @mini-canvas/mcp-server test:sse    # HTTP + SSE
pnpm --filter @mini-canvas/mcp-server test:task   # 异步任务后台
```

## 落盘格式

```
./workspace/
  canvas-ai-project-index.json   # 项目索引
  project-{taskId}/canvas.json   # 画布数据 { nodes, edges }
```

数据格式与前端 `canvas-core` 的 `CanvasData` + `sanitizeForSave` 同构，前后端互读。
