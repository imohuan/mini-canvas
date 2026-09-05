# vite 8.0.16 dev HMR —— 跨端口监听插件文件变更 可行性调研

> 调研对象：monorepo `D:/Code/Git/mini-canvas`，插件 `packages/plugins/plugin-node-text`
> vite 版本：**8.0.16**（`.pnpm/vite@8.0.16_*/node_modules/vite`）
> 调研方式：实读 `dist/node/chunks/node.js`（服务端）、`dist/client/client.mjs`（客户端）+ vite 官方 `server-options` / `api-hmr` 文档
> 日期：2026-09-04

## 一句话结论（先看这个）

- **通道是 WebSocket（`ws`），不是 SSE**。vite 8.0.16 服务端/客户端源码里**没有任何 SSE/EventSource 实现**（`grep -i "EventSource\|event-stream\|sse"` 在 node chunks 与 client.mjs 均无命中）。
- **vite 的 HMR 广播不是"只要文件变了就推给所有 ws 客户端"，而是有前提的**：文件必须已经进入了当前 dev server 的**模块图（module graph）**——也就是必须有一个客户端**真正 import/加载过**这个文件。没进模块图的文件改了，服务端只打 debug 日志 `[no modules matched]`，**什么都不发**。
- 所以"必须把插件入口设成 html 才有效"这个直觉**方向对了一半，但机制不是 html 本身**：真正需要的是**让宿主真的去 import 插件模块、并让它进插件 dev server 的模块图**。有 html（vite 会自动预取依赖/宿主 import）只是最容易让模块进图的手段，不是必要条件。
- **只要该模块进了模块图，HMR ws 消息是对所有已连接 ws 客户端全局广播的**（`wss.clients.forEach(...send)`），**不存在"客户端订阅了某模块路径才会收到"的过滤**。跨端口的外部页面只要能成功连上这个 ws，就能收到消息。
- **唯一硬门槛是跨源 token**：vite 对浏览器发来的 ws 升级请求（带 `Origin` 头）做 token 校验（`?token=<webSocketToken>`），token 是每次 dev server 启动随机生成的。宿主(5199)手写 `new WebSocket('ws://插件host:530x')` **不带上正确的 token 会被拒绝**；而 token 不在 `/@vite/client` 注入之外公开，需要插件侧想办法把它暴露给宿主。

---

## 五个问题的速答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 通道是 ws 还是 SSE？默认路径？谁建连接？ | **ws**。默认**复用 dev server 的 http server** 的 `upgrade`，路径 = `config.base`（默认 `/`），握手协议头 `sec-websocket-protocol: vite-hmr`，URL 形如 `ws://host:port/?token=<token>`。**只有真正加载了 `/@vite/client` 模块的页面才会建这条连接**；普通 `<script>`/无 client 的页面不会自动连。 |
| 2 | 无 html 的 lib 模式 dev server，HMR ws 会广播吗？ | HMR server **照常启动**（只要 `server.hmr !== false`），ws 也接受连接。但**广播与否取决于模块是否在模块图里**。没人加载过插件模块 → 模块图空 → 改了 src 只 `[no modules matched]`，客户端收不到任何东西。**只要模块进了图**，广播就是无差别全客户端。 |
| 3 | 外部页面(5199)自己 new WebSocket 连插件(530x)能收到吗？ | **能，但有 token 门槛**（见上）。同源(插件自己页面)只要带 token 也照发。**没有"校验订阅模块路径"**——广播对所有连接者一视同仁。跨域限制只有 token 校验 + `server.allowedHosts` 白名单（默认 localhost 及 IP 放行）。 |
| 4 | 设不设 html 的差别 / 有没有更直接路径 | 见下"机制详解"。差异**只在"让文件进模块图"这环**。vite 没有现成的"文件变更 SSE 端点"；`update` 消息里的模块路径是 dev URL 形态（root 内=`/src/x.ts`，root 外=`/@fs/绝对路径`），`full-reload` 的 `path` 是 `*`。 |
| 5 | 最小可行方案 | vite 现成能力**基本够，但缺一环**：需要"让插件模块先被宿主 import 进模块图"+"把 token 和 full-reload 事件透传给宿主"。最省事的实现是**在插件 dev server 里加一个自定义 vite 插件中间件/ws 订阅**，见 `02-minimal-solution.md`。 |

---

## 佐证：源码文件路径

vite 根：`node_modules/.pnpm/vite@8.0.16_@types+node@24._b4fcbe9df77a868bce3868b03dde58b8/node_modules/vite`
（等价 `packages/canvas-core-v2/node_modules/vite`）

- 服务端：`dist/node/chunks/node.js`
  - `createWebSocketServer` → 行 ~16261
  - 默认 server/hmr/webSocketToken 初始化 → 行 ~26213、~34719
  - watcher→`onHMRUpdate`→`handleHMRUpdate` → 行 ~26390、~26792
  - `updateModules`（真正发 update/full-reload）→ 行 ~26990+
  - 模块图 `getModulesByFile` → 行 ~23721
- 客户端：`dist/client/client.mjs`
  - ws 连接 URL 构造 → 行 ~854-875
  - `handleMessage`（update/full-reload/custom/error）→ 行 ~963+

官方文档（抓自 vite.dev）：
- `/config/server-options`：`server.ws` 取代旧 `server.hmr` WebSocket 配置；`server.ws: false` 可整体关闭。
- `/guide/api-hmr`：`import.meta.hot` 客户端手动 HMR API。

详细源码解读见 `01-mechanism.md`，可行方案见 `02-minimal-solution.md`。
