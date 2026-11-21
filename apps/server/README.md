# plume-canvas 自托管服务

> `@plume-canvas/server`

一条命令启动完整的画布服务：界面、插件、Agent、MCP 接口全都有。

## 特性

- npx plume-canvas serve 即可启动（首次自动从 npm 下载内置插件与界面，缓存到 ~/.plume/）
- 启动初始化：读 builtin-manifest 自动装缺失插件；UI 缺失自动下载；网络失败不拦启动
- 更新检查：启动一次 + 每 30 分钟定时，只提示不自动装（GET /api/updates）
- 插件系统：前后端半同包、provides/dependencies 依赖解析、卸载反向拦截
- API：kv / canvases / resources / jobs / plugin-catalog / updates / mcp

## 安装

```bash
npm i @plume-canvas/server
```

## 发布（维护者）

```bash
# 必须用 pnpm publish，不能用 npm publish
# 原因：package.json 里有 "@plume-canvas/plugin-agent": "workspace:*"，
# npm 会原样保留这个写法，导致别人 npm install 报 EUNSUPPORTEDPROTOCOL；
# pnpm 会把它替换成真实版本号。
pnpm publish --no-git-checks
```

发完记得把仓库根 Dockerfile 的 `ARG PLUME_VERSION` 改成同一个版本号，
否则容器构建会命中 Docker 层缓存，线上还是旧版本。
完整部署与发版流程见 `apps/docs/cloud-server/deploy-railway.md`。
