# cloud-server 安全方案的实测脚本（2026-10-19）

配合 `docs/plan/2026-10-19-cloud-server-admin-security-plan.md` 使用。每个脚本只做只读或写到临时目录的事，不需要联网。

| 脚本 | 验证什么 | 结论（已写进文档） |
|---|---|---|
| `run2.mjs` | 同源 / 沙箱 srcdoc / 第三方三种请求的 `Origin`、`Sec-Fetch-*` | 不透明源永远是 `cross-site`，不存在 doc 里原先假设的 `same-origin` |
| `run3.mjs` | 恶意页面自己造 sandbox iframe 能不能打后台 | 能，请求头与视觉节点完全一致 |
| `run5-pna.mjs` | 公网域名页面打 `127.0.0.1` | 简单请求能送达，JSON 请求被预检拦住 |
| `run6-wildcard.mjs` | 后台用 `cors()` 默认 `origin: '*'` 时 | 公网页面能读写，连响应体都拿得到 |
| `run7-svg.mjs` | 匿名上传 SVG 再打开 | 脚本执行，能读同源 localStorage（mock 服务） |
| `real-browser-svg.mjs` | 同上，但打**真实 cloud-server** | 真实服务同样复现 |
| `run8-rebind.mjs` | DNS 重绑定 | `Host` 变成恶意域名，请求成功；只比 Origin==Host 不够 |
| `run9-csp.mjs` | CSP 各写法能否挡住 SVG 脚本、会不会弄坏 `<img>` | `sandbox` / `default-src 'none'` / `script-src 'none'` 都能挡，且不影响 `<img>` |
| `run10-simple.mjs` | 哪些写方法能在无 CORS 时直达 | 简单请求（`text/plain`、form、FormData）直达；PUT 走预检 |
| `run11-real-simple.mjs` | 对着真实 cloud-server 用简单请求改画布 | `POST /api/canvases/:id/nodes` 成功写入节点 |
| `run12-real-put.mjs` | 跨源 `PUT /api/canvases/:id` | 预检通过，整张画布被覆盖成只有 `hacked` |
| `run13-b-rebase.mjs` | 公网域名页面打 `127.0.0.1` | PNA 没拦；GET 读到、POST 写进去 |
| `run14-real-others.mjs` | 真实服务上资产/项目/历史/KV 的写接口 | 项目、资产、KV 都能被简单请求写入 |
| `run15-mcp.mjs` | `/mcp` 的跨源与简单请求边界 | 跨源 JSON 可调（200）；`text/plain` 被 415 拒 |
| `run16-upload-limit.mjs` | 上传有没有大小上限 | 200MB 被完整接收（200） |
| `tar-probe2.mjs` | NPM 包解压的路径穿越 | 手写 `../` 条目的 tar；bsdtar 剥一层后落在目标目录内，未越界 |
| `tar-probe.mjs` | 同上，第一版（对照用） | 用 `tar -T` 打包时 bsdtar 自己拒绝 `../` 条目，造不出恶意包；结论以 `tar-probe2.mjs` 为准 |
| `check-plan-coverage.mjs` | 文档自检 | 第十三节逐条清单与「方法+前缀」表是否互相覆盖（只读文档） |
| `run17-ssrf.mjs` | SSRF 端到端 | 写模型配置后触发补全，假端点收到 3 次带 Bearer 的请求 |
| `framework-guard.mjs` | 真实 `createServerFramework` 上的中间件顺序 | start 前挂 `/api/*` 能拦住插件路由；start 后挂拦不住；`'*'` 能约束直挂的 `/mcp` |
| `run18-postmessage-bytes.mjs` | 沙箱 iframe → 宿主传字节 | `Uint8Array`、`ArrayBuffer`、`Blob` 都能过 |
| `run19-port-fallback.mjs` | CLI 端口顺延 | 占住 8865 后服务起在 8866，日志有「自动改用」；说明白名单要用实际端口 |
| `guard-probe.mjs` | 令牌中间件 + cors 的顺序、预检、403 是否带 CORS 头 | 先挂 cors 再挂中间件可行；OPTIONS 必须放行 |
| `host-probe.mjs` | `@hono/node-server` 下 Host 头怎么读 | `c.req.header('host')` 与 URL 同值；原生 http 能伪造 |
| `path-probe.mjs` | 前缀白名单能不能用路径写法绕过 | 大小写不归一（会 404）；编码段与`.`段会被归一；双斜杠不折叠，但前缀仍命中。未发现绕过 |
| `path-probe2.mjs` | 前缀判定的边界（`/api/task` vs `/api/tasks`）与归一化 | `%63all` 被解码、`/api/./task` 被折叠、双斜杠不折叠但前缀仍匹配 |
| `real-probe.mjs` | 真实服务的 CORS、安装接口、SVG 回读、`/mcp` | 安装接口有可信哈希把关；`/mcp` 无鉴权 |

## 怎么跑

```bash
# 需要 chrome 的：脚本里写死了本机路径，可用 CHROME_EXE 覆盖
node .scratch/header-probe/run2.mjs

# 需要真实服务的：先起一个临时实例
node packages/cloud-server/dist/cli.js serve -p 8934 -d ./.scratch/real-data2 --no-open
node .scratch/header-probe/run11-real-simple.mjs
# run14 用另一个端口（脚本默认 8938），起服务时 -p 改一下即可

# 用真实框架源码跑（dist 可能落后）；需要 tsx
node_modules/.bin/tsx .scratch/header-probe/framework-guard.mjs
```

`run.mjs` 是最早的一版探针（srcdoc 拼接方式不严谨），保留作对照，结论以 `run2.mjs` 为准。
