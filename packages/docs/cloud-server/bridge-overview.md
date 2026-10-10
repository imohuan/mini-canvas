# 前后端对接总览：两个桥接插件

后台的画布不是自己会动的 —— 需要有**前端插件**把它接进画布。这一对桥接插件就是干这个的：

| 插件 | 一句话 | 它把什么接进画布 |
| --- | --- | --- |
| [plugin-agent](/cloud-server/bridge-agent) | 画布内的 AI 对话助手 | 后台 `/api/agent/*` 的对话能力 → 面板 UI、会话、队列、目标、审批 |
| [plugin-cloud-client](/cloud-server/bridge-cloud-client) | 画布与后台的存档/生成对接 | 后台的存档同步、动作清单、任务下单、生成历史 → 底栏按钮与画布实时跟随 |

两个都是**前端插件**（跑在浏览器、用前端那套 `ctx`），只是它们唯一关心的事就是和后台说话。

## 一张图看懂对接关系

```
┌─────────────────── 浏览器（画布界面）───────────────────┐
│                                                        │
│  plugin-agent            plugin-cloud-client           │
│  （对话/会话/队列/目标）    （存档同步/动作/任务/历史）     │
│       │                        │                       │
└───────┼────────────────────────┼───────────────────────┘
        │ HTTP + SSE              │ HTTP + SSE
        ▼                        ▼
┌─────────────────── cloud-server ───────────────────────┐
│  /api/agent/*            /api/canvases  /api/jobs     │
│  （对话轮次/会话/模型/技能）  /api/actions  /api/history │
│                                                        │
│  AgentRuntime（跑对话）     TaskManager（跑生成任务）      │
└────────────────────────────────────────────────────────┘
```

## 它们怎么分工（不会抢活）

两个插件都连后台，但**碰的接口完全不同**（从源码枚举过的真实清单）：

| | plugin-agent 调的 | plugin-cloud-client 调的 |
| --- | --- | --- |
| 对话 | `/api/agent/*`（会话、发送、模型、技能、MCP、审批、提示词） | — |
| 画布存档 | — | `/api/canvases/:id`（读/写/资源上传） |
| 生成任务 | — | `/api/jobs`（下单/查单/取消/active） |
| 动作清单 | — | `/api/actions`（带版本号增量拉） |
| 生成历史 | — | `/api/history`（分页 + 汇总） |
| 实时事件 | — | `/api/kv/events`（SSE，画布变更跟随） |

Agent 对话由 AgentRuntime 在后台跑（它可以操作画布，经 MCP）；生成任务由 TaskManager 跑
（providers 平台提供方真正调外部平台）。前端这两个插件只是这两台引擎的**遥控器和显示屏**。

## 它们和后台插件系统是什么关系

后台插件（前几篇讲的 routes/store/jobs/mcp/agent 五段）**可以**扩展这两个通道：

- 后台插件经 `ctx.agent.use` 注册的中间件，正好插在 **plugin-agent 发来的每一轮对话**之前 ——
  这是前后端插件系统的握手点之一（见 [agent 能力详解](/cloud-server/capabilities-agent)）。
- 后台插件经 `ctx.routes` 加的接口，两个前端插件都不直接调 —— 但你自己的前端插件可以照
  [cloud-client 的做法](/cloud-server/bridge-cloud-client)把 `CloudApi` 收口模式抄去调它们。

## 装配关系（谁装谁）

两个插件都在成品应用的装配清单里（`packages/ui/src/assembly.ts`）：

- `agentPlugin` —— 自带，冷启动装配；配套的后台半（`/api/agent/*` 路由）由 cloud-server 内置跑着，
  所以插件的 `miniCanvas.serverBuiltin: true`。
- `pluginCloudClient` —— 自带，冷启动装配；`inject: ['doc']`，宿主服务全部 `tryGet` 软探测
  （底栏没装就不注册按钮，画布同步退化成纯本地）。
- `pluginManagerPlugin`（也在这个包里，`plugin-cloud-client/manager`）—— 设置面板的「插件」页，
  从 `/plugin-catalog.json` 拉清单装第三方插件，见 [热装热卸](/cloud-server/hot-load)。

## 读法

- 只想**用**：两个都自带，起 cloud-server 就有，不用配。
- 想**改对话行为**：看 [Agent 插件详解](/cloud-server/bridge-agent)，或写后台插件经 `ctx.agent.use` 插中间件。
- 想**换掉/扩展画布同步**：看 [Cloud Client 插件详解](/cloud-server/bridge-cloud-client) —— 它把 HTTP+SSE 全部收口在一个 `CloudApi` 类里，是最好的模仿对象。
