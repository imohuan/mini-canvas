# 快速上手：起服务到第一个请求

**一句话定位**：这篇带你把后台跑起来，并亲手发出去第一个请求 —— 看着 JSON 从命令行弹回来，你就知道「后台真的在干活」了。它属于 cloud-server 组，读懂它再去看别的篇。

## 这篇能让你做什么

按下面的步骤走完，你会得到：

- 一个正在运行的后台服务（网页画布 + HTTP 接口都在里面）；
- 用 curl 发出去的第一个请求，收到 JSON 回答；
- 一张「常用接口速查表」，后面写插件时随手翻。

## 具体做法

### 第 1 步 · 起服务

在仓库根目录执行（PowerShell）：

```bash
pnpm -C packages/cloud-server serve        # ① 仓库里开发用这条
```

如果你不是在仓库里，而是把工具装成了 npm 包，等价命令是：

```bash
npx mini-canvas-cloud serve                # ② npm 包形态，一样的效果
```

服务启动后会打印类似这样的一段（真实输出里的端口、路径以你机器为准）：

```text
  mini-canvas-cloud 已启动

  画布   http://127.0.0.1:8865/
  数据   <数据根目录>
  MCP    http://127.0.0.1:8865/mcp
```

- ① `serve` 脚本跑的是 `node ./dist/cli.js serve`（见 `packages/cloud-server/package.json` 的 scripts 段），先把仓库跑起来。
- ② `mini-canvas-cloud` 是这个包对外发布的命令名（package.json 的 bin 段），两种形态行为完全一致。

### 第 2 步 · 认识启动日志里的三行

| 日志里写的 | 是什么 | 你现在要做的 |
| --- | --- | --- |
| `画布   http://127.0.0.1:8865/` | 托管好的网页画布 | 浏览器打开就能用 |
| `数据   <数据根目录>` | 画布、资源、插件数据落盘的地方 | 看一眼位置，以后排查数据问题用 |
| `MCP    http://127.0.0.1:8865/mcp` | 给 AI 客户端用的 MCP 接口 | 不用 AI 时可以先不管 |

两个最常用的启动参数（完整表见总览页）：

| 参数 | 缺省值 | 干什么 |
| --- | --- | --- |
| `-p, --port` | `8865` | 监听端口；被占用时自动往后找（你显式写了 `-p` 就不找，直接报错） |
| `-d, --dir` | `./.mini-canvas/` | 数据根目录，画布 / 资源 / 插件数据都落在它下面 |

比如想换个数据目录：

```bash
npx mini-canvas-cloud serve -d D:/my-canvas-data --no-open
```

### 第 3 步 · 发出第一个请求

```bash
curl http://127.0.0.1:8865/api/actions
```

你会收到一段 JSON（节选，真实内容取决于你装了哪些平台提供方）：

```json
{
  "ok": true,
  "version": 123456789,
  "changed": true,
  "actions": [ ... ]
}
```

- `ok: true` 表示请求成功；`actions` 是当前所有可用「动作」的清单（前端菜单的数据源就是它）。请求走的是内置路由 `GET /api/actions`，实现在 `packages/cloud-server/src/routes/actions.ts`。

再试一条需要先装插件的（见第 4 步，如果你已经装了 showcase 插件）：

```bash
curl http://127.0.0.1:8865/api/showcase/hello
```

### 第 4 步（可选）· 让第一个「插件路由」跑起来

仓库自带的样板插件 plugin-showcase 装上后，会多出一条 `GET /api/showcase/hello`。装法二选一：

1. **浏览器里点**：打开画布网页 → 插件管理 → 找到「插件展示」→ 安装（后台半需要你确认一次「以服务端权限运行」——这是安全设计，不是卡你）；
2. **NPM 装**：同样在插件管理里，搜 `mini-canvas-plugin-showcase` 装上。

装完立刻再发一次 curl（不用重启服务，路由热装即时生效）：

```bash
curl http://127.0.0.1:8865/api/showcase/hello
```

收到 `{ "ok": true, "message": "你好，这是 showcase 插件的第一个路由", ... }` 就说明后台插件系统的全链路你已经打通了。

### 第 5 步（可选）· 看 MCP 暴露了什么工具

```bash
npx mini-canvas-cloud list-tools
```

它会**不启服务**、直接打印 MCP 暴露的工具清单（一条一行）。配置 AI 客户端前，先用它看看后台给 AI 开了哪些能力。

## 常用接口速查

| 接口 | 干什么 |
| --- | --- |
| `GET /health` | 健康检查，永远回 `{ "ok": true }` |
| `GET /api/actions` | 动作清单（前端菜单的数据源） |
| `GET /api/kv/:type/:key` | 设置 / 快捷键这类小数据 |
| `GET /api/canvases/:id` | 画布本体（节点 + 边） |
| `GET /api/jobs/active` | 查某节点当前有没有任务在跑 |
| `GET /api/history` | 生成历史（分页） |
| `GET /api/assets` | 资产目录 |
| `GET /api/agent/config` | Agent 全局配置 |
| `GET /api/server-plugins` | 已装后台插件清单 |
| `GET /plugin-manifest.json` | 外部前端插件清单 |
| `GET /plugin-catalog.json` | 插件管理清单（含后台半的 sha256） |
| `ALL /mcp` | MCP 接口（给 AI 客户端连） |

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| `pnpm serve` 跑 cli.js | `packages/cloud-server/package.json` | `"serve": "node ./dist/cli.js serve"` |
| `npx mini-canvas-cloud serve` | 同上 bin 段 | `"bin": { "mini-canvas-cloud": "./dist/cli.js" }` |
| 端口被占用自动后移 | `packages/cloud-server/src/cli.ts`（`startWithPortFallback`） | 最多往后试 10 个端口；你显式写了 `-p` 就只试那一个 |
| `-d` 数据根、启动日志打印访问地址与数据落点 | `cli.ts` `main()` | 解析参数 → 起 `createCloudServer` → 逐行打印 `info.url` 与 `srv.paths.*` |
| `list-tools` 子命令 | `cli.ts` `parseArgs()` | 不启服务，直接 `listTools()` 打印 MCP 工具名与描述后退出 |
| `GET /api/actions` | `packages/cloud-server/src/routes/actions.ts` | 返回 `{ ok, version, changed, actions }`，`actions` 来自 ProviderRegistry |
| `GET /health` | `packages/cloud-server/src/plugins/builtin/health.ts` | 内置插件注册的最简路由，固定 `{ ok: true }` |
| showcase 的 `/api/showcase/hello` | `packages/plugins/plugin-showcase/src/server.ts` | 插件在 `apply` 里 `ctx.routes.get(...)` 注册，见 showcase 精读篇 |

## 常见坑

1. **端口 8865 被占用**：默认会自动往后找 10 个（8866、8867…），启动日志里有「已自动改用 xxxx」一行；你写了 `-p 8865` 就只试这一个，失败直接报错。想避开自动寻端，就换 `-p`。
2. **页面打不开画布**：cloud-server 托管的是 `packages/ui` 的**构建产物**。没构建过时页面会提示，先跑 `cd packages/ui && pnpm build` 再重启服务。
3. **curl 打 `/api/showcase/hello` 返回 404**：showcase 还没装（或只装了前端半）。它不是内置路由 —— 装上后台半后立刻能用（热装即时生效，不用重启）。
4. **Windows 下 curl 报错**：PowerShell 里用 `curl.exe` 指真实 curl（PowerShell 的 `curl` 是 `Invoke-WebRequest` 的别名，参数不兼容）。
5. **`--no-open` 加不加**：默认启动会自动开浏览器；写脚本 / CI 时加它，避免多开一个窗口。
