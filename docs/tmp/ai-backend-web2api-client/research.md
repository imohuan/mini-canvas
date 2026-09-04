# mcp-server 出站 MCP 客户端能力 × web2api 可达性 侦察报告

日期：2026-09-04
性质：只读探测，未改任何业务代码、未建任务、未删改。

---

## A. 能否作为 MCP 客户端出站连接另一个 MCP server —— 结论：可以

mini-canvas 的 `packages/mcp-server` 依赖官方的 `@modelcontextprotocol/sdk`，**既当 server 也完全具备 client 能力**，出站连 Streamable HTTP MCP server（如 web2api）所需的所有类和 Transport 都齐。

### A1. 依赖版本
- `packages/mcp-server/package.json` → `dependencies["@modelcontextprotocol/sdk"] = "^1.0.0"`
- 实际 node_modules 安装版本：**`1.30.0`**（`packages/mcp-server/node_modules/@modelcontextprotocol/sdk/package.json`）
- 官方 SDK 同时提供 server + client，客户端能力开箱即用，无需额外装包。

### A2. 已确认可用的 SDK 客户端导出（node_modules 实测）
- `@modelcontextprotocol/sdk/client/index.js` → `export class Client extends Protocol`（`getSupportedElicitationModes` 等辅助）
- `@modelcontextprotocol/sdk/client/streamableHttp.js` → `export class StreamableHTTPClientTransport`（另有 `StreamableHTTPError`）
- `@modelcontextprotocol/sdk/client/stdio.js` → `StdioClientTransport`（本仓库已在用）
- SDK `exports` 含子路径 `"./client"`，TypeScript 可直接 `import ... from '@modelcontextprotocol/sdk/client/...'`。
- 结论：**连接 web2api 用 `Client` + `StreamableHTTPClientTransport`（指向 `http://localhost:8033/mcp`）即可，SDK 1.30 完全支持。**

### A3. 可参考的客户端连接代码（仓库内已有，直接抄）
| 文件 | 内容 | 参考价值 |
|---|---|---|
| `scripts/probe-web2api.ts` | `Client` + `StreamableHTTPClientTransport(new URL('http://localhost:8033/mcp'))` → connect → `listTools()` 打印工具名与 inputSchema 属性 → close | **最贴合的现成模板**，就是连 web2api 只读列工具 |
| `scripts/mcp-http-client.ts` | 同上 Transport 指向本机 8765 `/mcp`，`connect`→`listTools`→`callTool` 全流程 | Streamable HTTP client 调用工具范例 |
| `scripts/mcp-client.ts` | `StdioClientTransport` + `Client` 连本机 stdio，含 `text()` 解析 content、`assert()` 断言、轮询等工程化写法 | 通用 client 封装/测试范式（stdio） |

> 注：`scripts/mcp-client.ts` 用的是 stdio（非 Streamable HTTP），连 web2api 需改用 `StreamableHTTPClientTransport`。

### A4. e2e 测试方式
- `e2e/sse-e2e.ts`：**不是 MCP client 测试**，而是进程内组装 `GraphModel + NodeStorage + TaskManager + CanvasHttpServer`，用原生 `fetch` 走 REST（`/api/canvases`…）+ 手写 `readBody` 读 `/events?canvasId=xxx` 的 SSE 流断言 `node:added` 事件。可作"起真实 server + HTTP 断言"的测试骨架参考，但无 MCP client 连远程的现成 e2e。

### A5. README 记录
- `README.md` 已记录 `@modelcontextprotocol/sdk` 作为本包 MCP 出口、18 个画布工具、REST/SSE、异步 `task.create`/`task.status`，并明确 `task.create` 的 runner 目前是占位 mock——即"web2api 当真实生成后台"是下一步待接线点（详见 `docs/tmp/web2api-integration/decision.md`）。

---

## B. web2api 端到端可达性只读探测 —— 结论：当前未运行（端口不通）

### B1. 实测结果
- `curl -m 8 http://localhost:8033/` → `curl: (7) Failed to connect to localhost port 8033 after ~2255ms: Could not connect to server`（exit code 7）
- `curl -m 8 http://localhost:8033/health` → 同上失败
- `curl -m 8 http://localhost:8033/mcp` → 同上失败
- `netstat -ano | grep LISTENING`：**无任何进程监听 8033**（也顺带确认 8765 当前未起、3000/8866/7897 等为其它进程占用，与本任务无关）。

**结论：web2api 服务现在没有在跑**，因此无法实测 `/health` 与 `/mcp` 的 `tools/list` POST，也拿不到实时工具 schema。所有 `curl` 均报连接被拒（connect 超时/无监听），不是网关/代理错误，就是"端口没有服务"。

### B2. 参考信息：web2api 的已知形态（来自仓库既有侦察文档，非本次实测）
`docs/tmp/web2api-integration/decision.md`（2026-08-31，当时 web2api 在 D:\Code\Git\web2api、端口 8033、正在运行）记录了：
- 后端 Hono，内置完整 MCP server（`server/src/mcp/`）：`transport.ts` 手写 Streamable HTTP（`POST/GET/DELETE /mcp`）、`tool-registry.ts`（命名 `{platformId}/{opName}`）、`tool-executor.ts`（统一走 TaskManager 队列，同步/异步）。
- 用 MCP SDK client 连 `http://localhost:8033/mcp` 实测成功，**10 个工具**：
  - `system/list-tasks`, `system/get-task`, `system/get-accounts`
  - `seedance/generate-video`
  - `doubao/generate-image`, `doubao/generate-video`, `doubao/generate-image-chat`, `doubao/generate-music`
  - `chatgpt/generate-image`
  - `apimart/generate-image`
  - 每个工具都带完整 `inputSchema`（cookieId/prompt/ratio/duration/model/referenceImages…）

### B3. 关键生成工具的 schema 字段（据既有文档 + 本仓库对齐代码，非本次实测）
本仓库 `packages/canvas-core/src/nodes/image/imageModels.ts` 已按 web2api MCP schema 对齐记录了 model→工具映射与能力字段。生成工具的通用 schema 字段集中在：
- **`prompt`**（文本提示）
- **`ratio`**（比例，如 1:1/3:2/16:9…）
- **`resolution`**（分辨率档，仅 APIMart 暴露：1k/2k/4k）
- **`model`**（如 doubao 的 `Seedream 5.0 Lite / 4.5 / 4.0`）
- **`referenceImages`**（参考图，支持带图输入的模型）

各工具映射（imageModels.ts 实测代码）：
| model id（mini-canvas） | MCP 工具 | 备注 |
|---|---|---|
| `apimart-gpt-image-2` | `apimart/generate-image` | ratio 15 档 + resolution 1k/2k/4k，可带参考图 |
| `chatgpt-gpt-image-2` | `chatgpt/generate-image` | ratio 6 档，无 resolution，可带参考图 |
| `doubao-seedream-5lite` | `doubao/generate-image-chat` | `mcpModel: 'Seedream 5.0 Lite'`，可带参考图 |
| `doubao-seedream-45` | `doubao/generate-image-chat` | `mcpModel: 'Seedream 4.5'` |
| `doubao-seedream-40` | `doubao/generate-image-chat` | `mcpModel: 'Seedream 4.0'` |

> 上面 B2/B3 是仓库既有资料，能佐证"web2api 若启动后连 /mcp 能拿到这些工具的 inputSchema"，但**本次无法在线复核**（服务未运行）。若需拿到权威的最新 inputSchema，请在启动 web2api 后跑 `node packages/mcp-server/node_modules/tsx/dist/cli.mjs packages/mcp-server/scripts/probe-web2api.ts`（该脚本已按 A 结论写好，只读列工具，不触发任何 generate）。

---

## 一句话总结
- **mcp-server 出站当 MCP 客户端连 web2api：能力完全具备**（SDK 1.30 带 `Client` + `StreamableHTTPClientTransport`，且已有现成模板脚本 `scripts/probe-web2api.ts`），只差把 web2api 真正跑起来。
- **web2api 当前未运行**（8033 无监听，curl 全连不上），无法实测 /health 与 /mcp；在线 schema 需待服务启动后重跑只读探测确认。
