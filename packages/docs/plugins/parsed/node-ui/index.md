# 可视化节点 node-ui

> 插件解析 · `@mini-canvas/plugin-node-ui` · 自带件

**一句话**：画布上一种"**交给 Agent 画的**"节点 —— 它自己没有界面，内容是一段 HTML，由 AI 写进去就地渲染；
生成的界面还能反过来调画布接口、跑后台脚本 —— 所以它不只是"画给你看"，而是能**干活**。

> 用户口径（2026-10-12）：「没必要给他画 UI 了……如果要给他画 UI，可以直接交给那个 Agent，那个 AI 做得更完善一些。」
> 所以本插件**刻意没有**底栏动作、没有设置面板 —— 空态只说一句话：让 Agent 帮你画。

## 🔰 先读这一页

**它是一条前后端打通的链路**，不看主线就会看得云里雾里：

**[核心流程：它到底怎么工作](/plugins/parsed/node-ui/flow)** ← 从 0 到 1 讲清它是什么、四步流程、一条真实链路。

## 全部落点

| 种类 | 键 / 名字 | 放的是什么 | 详情 |
| --- | --- | --- | --- |
| **前端** 服务 | `uiNode` | `UiNodeService_`：建节点 / 写 HTML / 读内容 / 读参数 / 清空 | [服务](/plugins/parsed/node-ui/service) |
| **前端** 节点类型 | `ui` | 一块放 HTML 的面板（内容组件 `UiContent.vue`） | [节点类型](/plugins/parsed/node-ui/node-type) |
| **前端** 命令 | `ui.getContext` / `ui.setHtml` / `ui.clear` | 给 Agent / MCP / 快捷键的外部入口 | [命令](/plugins/parsed/node-ui/commands) |
| **前端** 事件 | `ui/context` | 把"该画什么"的上下文回给调用方 | [事件](/plugins/parsed/node-ui/events) |
| **前端** 设置项 | `uiNodeAllowNetwork` 等 3 条 | 是否允许界面调后台 + 默认尺寸 | [设置项](/plugins/parsed/node-ui/config) |
| **沙箱** 注入与助手 | `__CANVAS_*__` / `CanvasUI` | 界面能读什么、能调什么 | [界面与沙箱](/plugins/parsed/node-ui/ui-sandbox) |
| **后台** MCP 工具 | 11 个 `canvas_ui_*` / `canvas_fn_*` | 让 AI 读约定、写界面、打包、调函数 | [后台半与 MCP 工具](/plugins/parsed/node-ui/server-mcp) |
| **后台** 任务脚本 | `task-scripts/*.mjs` | 后台活怎么干（转码/抽帧/批处理） | [任务脚本](/plugins/parsed/node-ui/task-scripts) |
| **后台** 依赖声明 | `data.uiScripts` | 界面调脚本的授权（不声明 → 403） | [依赖声明与 403](/plugins/parsed/node-ui/declare) |
| **后台** 路由 | `/api/task/*` 等 12 条 | 界面调后台走的 HTTP 口 | [后台路由](/plugins/parsed/node-ui/routes) |
| **后台** 节点包 | `.mcnode` | 导出 / 导入 / 版本化 | [节点包](/plugins/parsed/node-ui/node-package) |
| 复盘 | — | AI 写界面最容易踩的坑 | [常见坑](/plugins/parsed/node-ui/pitfalls) |

## 身份与依赖

| 项 | 值 | 来源 |
| --- | --- | --- |
| 插件名（`name`） | `'node-ui'` | `src/nodeUiPlugin.ts` |
| 包名 | `@mini-canvas/plugin-node-ui` | `package.json` |
| 硬依赖（`inject`） | `['doc']` | 同上 |
| 自带件 | `miniCanvas.builtin: true` | `package.json` |
| 节点类型名 | `'ui'`（`UI_NODE_TYPE`） | `src/nodeUiPlugin.ts` |
| 产物出口 | `nodeUiPlugin`（前端） + `dist/server.js`（后台半，单文件自包含） | `src/index.ts` · `scripts/build-server.mjs` |

> 依赖方向：前端半只依赖内核 + 渲染层；**不 import 底栏、不 import Agent** ——
> 与 Agent 的协作走「服务 + 命令 + MCP 工具」这几条公开缝。

## 数据字段（写在节点 `data` 里的键）

`UI_DATA_KEYS`（改这里就是改契约）：

| 键 | 含义 |
| --- | --- |
| `uiHtml` | 节点里渲染的 HTML（内容本体，由 Agent 写入） |
| `uiGeneratedAt` | 写入时间（展示"什么时候画的"） |
| `uiBy` | 是谁写的（`'agent'` / `'mcp'` / `'user'`，排查用） |
| `uiBackendOrigin` | 后台自己的地址（生成的页面直连它） |
| `uiInputs` | 这个节点的参数（键 → 值） |
| `uiUpstream` | 上一次用到的上游素材 |
| `uiScripts` | **依赖声明**：这界面调了哪几个后台脚本 |
| `uiNodeDoc` | 功能说明书（做什么 / 输入 / 输出） |

## 注意事项

1. **它是一块画布，不是一个控件**：想改外观/加按钮，改的是 **Agent 写进去的 HTML**，不是本插件代码。
2. **前后端是两半**：前端半管节点与沙箱，后台半（`dist/server.js`）管 MCP 工具、任务脚本、路由 —— 两半都要装才完整。
3. **`create(position, extra)` 必须带 `extra`**：不带的后果是"带数据建节点"静默丢字段（踩过，已修）。

