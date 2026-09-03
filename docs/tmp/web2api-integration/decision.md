# web2api × mini-canvas 对接架构决策

日期：2026-08-31
状态：待用户确认

## 现状侦察（已验证，非猜测）

**web2api**（D:\Code\Git\web2api，端口 8033，正在运行）：
- 后端是 Hono，**已经内置完整 MCP server**（`server/src/mcp/`）：
  - `transport.ts` 手写 Streamable HTTP：`POST/GET/DELETE /mcp`
  - `tool-registry.ts`：平台操作 → MCP 工具，命名 `{platformId}/{opName}`
  - `tool-executor.ts`：所有操作统一走 TaskManager 队列（同步/异步）
  - `tool-registry` + `tool-executor` + `session` + `resources` 模块齐全
- 实测用 MCP SDK 客户端连 `http://localhost:8033/mcp` 成功，**10 个工具**：
  - system/list-tasks, system/get-task, system/get-accounts
  - seedance/generate-video
  - doubao/generate-image, generate-video, generate-image-chat, generate-music
  - chatgpt/generate-image
  - apimart/generate-image
  - 每个工具都有完整 `inputSchema`（cookieId/prompt/ratio/duration/model/referenceImages…）
- 有 Playwright 真实浏览器自动化能力（真正调平台生成内容）

**mini-canvas**（端口 8765）：
- 有自己 MCP server（画布/节点/连线/任务，18 个工具）
- `task.create` 的 runner 是**占位 mock**（`占位处理完成（接入真实生成服务后替换）`）——**没有真实生成能力**
- 前端节点插件：Video / image / image-compare / panorama / text
- mcp-server 依赖 SDK 1.30，客户端能力已在测试脚本中使用

## 四个方案的取舍

| 方案 | 结论 |
|---|---|
| 1. web2api 作为 mini-canvas 后台 | 不合适。web2api 是"内容生成平台"，mini-canvas 是"画布编排"。web2api 不该当画布后台。 |
| 2. 参考 OpenAI 规则重构 web2api 接口 | **完全没必要**。web2api 已经是 MCP，接口有规范。重构是重复造轮子、白费工。 |
| 3. mini-canvas 直接对接 web2api 接口 | 可行但劣于 MCP：硬编码耦合，web2api 改接口就得改 mini-canvas。 |
| 4. **用 MCP 对接（推荐）** | web2api 已是 MCP server，mini-canvas 前端/后端作为 MCP **客户端**连它。规范、解耦、可动态发现。 |

## 推荐架构

两个独立 MCP server 并行，各司其职，前端连两边：

```
mini-canvas 前端 (/mcp)
   ├─ 连 mini-canvas MCP  (http://localhost:8765/mcp)  ← 画布编排（建节点/连线/保存）
   └─ 连 web2api MCP       (http://localhost:8033/mcp)  ← 内容生成（生成图/视频/音乐）
```

具体落地（推荐最小改动路径）：
1. **mini-canvas 后端 `task.create` 的真实 runner**：在 mcp-server 里启动一个 `StreamableHTTPClientTransport` 连接 web2api `/mcp`，把 `task.create`（kind=image/video 等）转发成 web2api 的 `doubao/generate-image` / `seedance/generate-video` 等工具调用。画布节点创建后触发真实生成。**这就是"web2api 作为 mini-canvas 的生成后台"。**
2. **前端可视化渲染**：前端连 web2api `/mcp`，调 `tools/list` 拿每个工具的 `inputSchema`（JSON Schema），据此**自动生成参数表单**（有 prompt/ratio/duration 就渲染对应输入框/下拉）。这正是用户说的"UI 根据 MCP 工具参数配置渲染"。可用现有 `vue-flow` + 通用 JSON Schema 表单组件实现。

## 关于"通用规则"的澄清

用户提到"参考 OpenAI 那套规则"。这其实和 MCP 不冲突：MCP 工具的参数 schema 本身就是 JSON Schema（OpenAI function calling 也用同一套 schema）。所以不需要另造规则，MCP 已经给了规范。前端只要实现一个"读 `inputSchema` → 渲染表单"的通用渲染器，就能适配任何 MCP server / 任何工具，web2api 换接口也不影响。

## 下一步（待确认）

- [ ] A. mini-canvas 后端桥接 web2api（task.create 转发）—— 让画布节点真实生成内容
- [ ] B. 前端通用 MCP 工具表单渲染器 —— 根据 inputSchema 动态生成 UI
- [ ] C. 两者都做（A 是数据打通，B 是 UI 打通）
