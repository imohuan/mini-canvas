# 后台服务

**一句话定位**：cloud-server 是 mini-canvas 的**自托管后台** —— 一个 Node 进程，
同时做四件事：托管画布界面、存画布数据、跑 MCP 接口（给 AI 用）、**跑后台插件**。

它最像什么？像一台**家用路由器**：机器本身只管转发和存转发规则，功能（翻墙、去广告、加速）
靠装插件扩展。cloud-server 本体只提供「路由 / 存储 / 定时 / MCP / Agent」五个插座，
你写的后台插件往插座上插，就多出一块能力。

## 它管什么、不管什么

| 它管的 | 它不管的 |
| --- | --- |
| 画布数据存取（节点/边/视口/资源） | 画布**怎么画**（那是前端 canvas-render 的事） |
| 生成任务下单 / 查单 / 撤单 | 生成任务**怎么执行**（那是 providers 平台提供方的事） |
| Agent 对话轮次、会话、目标 | 对话 UI（前端 plugin-agent 的事） |
| MCP 接口（AI 读写画布的唯一通道） | 前端插件（浏览器里那套 `ctx` 与本包无关） |
| **后台插件**的装载与运行 | |

> 前后端是两套插件系统：前端插件跑在浏览器（用 `@mini-canvas/canvas-base` 的 `ctx`），
> 后台插件跑在这个 Node 进程（用同一套内核，但 `ctx` 上多出 routes/store/jobs/mcp/agent 五个段）。
> 内核是同一颗 —— 这就是「写法一致、两边通用」的原因。

## 怎么跑起来

```bash
# 仓库里开发态
pnpm -C packages/cloud-server serve        # 起服务（等价 npx mini-canvas-cloud serve）

# 或装成 npm 包用
npx mini-canvas-cloud serve --port 8865    # 起在 8865
npx mini-canvas-cloud list-tools           # 列出 MCP 暴露的工具
```

启动后：

```
http://127.0.0.1:8865/        画布界面（托管 ui 产物）
http://127.0.0.1:8865/mcp     MCP 接口（配置给 AI 客户端）
```

常用 CLI 选项（完整见 `mini-canvas-cloud --help`）：

| 选项 | 缺省 | 干什么 |
| --- | --- | --- |
| `-p, --port` | 8865 | 端口；被占用自动往后找 |
| `-d, --dir` | `./.mini-canvas/` | 数据根目录（画布/资源/插件数据都落这） |
| `--server-plugins <目录>` | `<数据根>/server-plugins` | **后台插件目录：丢 .js 进去即多一个后台插件** |
| `--no-mcp` | （默认开 MCP） | 不提供 MCP 接口 |
| `--no-open` | （默认开浏览器） | 不自动开浏览器 |

## 本组文档怎么读

| 想干什么 | 看哪篇 |
| --- | --- |
| 跑起来、发第一个请求 | [快速上手](/cloud-server/quickstart) |
| 写一个后台插件（五种能力段总览） | [后台插件系统](/cloud-server/server-plugins) |
| 给后台加一个 HTTP 接口 | [routes](/cloud-server/capabilities-routes) |
| 插件存自己的数据 | [store](/cloud-server/capabilities-store) |
| 每隔几分钟做点什么 | [jobs](/cloud-server/capabilities-jobs) |
| 给 AI 加一个可调用工具 | [mcp](/cloud-server/capabilities-mcp) |
| 拦截/改写 AI 对话轮次 | [agent](/cloud-server/capabilities-agent) |
| 不重启就装/卸插件、从 NPM 装 | [热装热卸](/cloud-server/hot-load) |
| 内置服务与磁盘上存了什么 | [内置服务与存储布局](/cloud-server/builtin-services) |
| 看一个用到全部五种能力的完整插件 | [showcase 精读](/cloud-server/showcase-walkthrough) |

## 两个核心事实（先记住，后面每篇都在用）

1. **后台新增一个接口 = 装一个插件。** 插件在 `apply` 里写
   `ctx.routes.get('/api/x', handler)`，卸载时这条路由自动消失。
2. **插件注册的一切随卸载自动回收** —— 路由、中间件、私有存储、定时器、MCP 工具，
   全挂在插件自己的作用域上。你写插件时不用手写任何清理代码（和前端同一颗内核保证的）。

源码位置：`packages/cloud-server/src/`。插件系统实现在 `src/serverFramework/`，
五种能力段各一个文件（routes.ts / store.ts / jobs.ts / mcp.ts / agent.ts）。
