# 管理鉴权与请求边界（2026-10-20 起）

后台默认只监听 `127.0.0.1`，但这**不等于**只有你能访问它：浏览器里任何一个网页都能向它发请求。
2026-10-19 的实测里，跨源页面能直接改画布、上传文件、调 `/mcp`，甚至能匿名传一个带脚本的 SVG 然后读到页面里的令牌。
所以从这一版起，后台有三道边界。

## 一、管理令牌（写入口）

「能执行代码 / 改画布 / 花钱」的接口需要请求头：

```
x-admin-token: <64 位 hex>
```

令牌从哪来（按优先级）：

1. 环境变量 `MINI_CANVAS_ADMIN_TOKEN`（设了就不读也不写文件）；
2. `<数据目录>/admin-token`（第一次启动自动生成，64 位 hex）；
3. 启动日志里会打印一份，并写明用的是哪一种来源。

前端在「设置 → 插件 → 管理令牌」里填一次，存在本机浏览器；删掉令牌文件重启即轮换，
所有前端都要重填。

### 哪些接口要令牌

只拦**写方法**（POST / PUT / PATCH / DELETE），并且只拦这些前缀：

```
/api/server-plugins/   /api/npm-plugins/      /api/agent/mcp      /api/agent/skills
/api/agent/system-prompt  /api/agent/template/  /api/agent/prompts  /api/agent/policy
/api/agent/title-model  /api/agent/models  /api/agent/chat/completion
/api/task/  /api/node-packages/  /api/node-ui/debug-
/api/style-library/  /api/effect-library/  /api/showcase/
/api/agent/canvases/
/api/jobs
```

另外这两条**只拦 POST**（`PUT /api/canvases/:id` 是整画布保存，靠下面的来源边界保护）：

```
/api/canvases/   /api/canvas/
```

读接口（GET / HEAD）不要令牌；**资产、项目、历史、KV 的写接口这一版也还没有令牌**，
它们靠来源边界兜底 —— 这是已知的取舍，不要以为它们已经安全了。

## 二、请求边界（Host / Origin）

`/api/*` 与 `/mcp` 都要过这一关：

- `Host` 必须等于启动时的 `hostname:port`（默认 `127.0.0.1:8865` 与 `localhost:8865`）；
- 带 `Origin` 时必须同源，或在 `--trusted-origin` / `MINI_CANVAS_TRUSTED_ORIGINS` 里；
- `Sec-Fetch-Site: cross-site` 一律拒绝；
- `Origin: null`（沙箱 iframe）一律拒绝。

为什么 `Origin: null` 不能放行：不透明源永远报 `cross-site`，而且任何网页都能自己造一个
同样的 sandbox iframe。给它开例外等于对所有网页开例外。

dev 模式（`pnpm -C packages/ui dev`）要显式放行：

```bash
pnpm -C packages/cloud-server serve \
  --trusted-host localhost:8865 \
  --trusted-origin http://localhost:5288
```

## 三、沙箱页面（可视化节点）怎么调后台

**不要**在生成页面的 HTML 里直接 `fetch` 后台：它住在不透明源 iframe 里，会被上面的边界拒绝，
而管理令牌也不该交给它。用宿主提供的桥：

```js
// 读画布
const r = await CanvasUI.api('/api/canvases/' + __CANVAS_UI__.canvasId)
const { nodes } = await r.json()

// 改节点（POST 也要令牌，桥会带）
await CanvasUI.api('/api/canvas/nodes', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ update: [{ id: '3', data: { title: '新标题' } }] }),
})
```

`CanvasUI.api(path, init)` 只接受 `/api/` 开头的同源路径，而且只放行**画布相关**的那几类：

- 读：`/api/canvases`、`/api/canvases/:id`、`/api/actions`、`/api/assets`、`/api/asset-folders`；
- 写：`/api/canvases/:id`（含 `/nodes` `/edges` `/view` `/resources`）、`/api/canvas/(nodes|edges)`、
  `/api/jobs`、`/api/assets`、`/api/asset-folders`。

`/api/task/*`、`/api/server-plugins/*`、`/api/npm-plugins/*`、`/api/agent/*`、
`/api/node-packages/*`、`/api/node-ui/debug-*`、`/api/style-library/*`、`/api/kv/*`、`/api/history/*`
一律拒绝 —— 这个代理是给「界面画布操作」用的，不能变成沙箱页的万能开关。
回包形状接近 `fetch`：`{ ok, status, headers.get(), text(), json(), arrayBuffer() }`。

保存产物仍用 `CanvasUI.save(bytes, name)`，调任务脚本仍用 `CanvasUI.task(...)` —— 它们也走宿主代发。

## 四、任务脚本的令牌

任务脚本跑在**独立子进程**里，`ctx.save` 要把产物 POST 回后台。它拿到的不是管理令牌，
而是一枚**只允许写本画布本节点槽位**的短时令牌（10 分钟，进程重启即失效）：

- `POST /api/canvases/<本画布>/resources?slot=<本节点>` —— 放行；
- 写别的槽位、别的画布、调用其它受保护接口 —— 403。

脚本作者不需要自己拼它：`ctx.save(...)` 已经带上。

## 五、审计日志

每次尝试、成功、拒绝都会往 `<数据目录>/audit.log` 追加一行 JSON，带 hash 链。
同一目录下还有一个 `audit.log.head`，只记两件事：**应该有多少行**、**末行 hash**。
它是用来抓「删掉最后几行」的 —— 只靠链内核对，删掉末尾的记录后剩下的链仍然自洽，
发现不了；有了头文件，行数少了或末行对不上都会直接报出来。

```bash
node packages/cloud-server/dist/cli.js audit-verify -d .mini-canvas
```

链断了会打印第一处断裂的行号与原因（被删、被改、首行有 prev、末行被截断、行数与头文件不符）。
头文件缺失但有日志时，会报「缺少头文件（日志可能被整体替换）」。
头文件会在每次成功追加后一起更新；如果进程正好崩在「日志写了、头文件没写」之间，
下次写入会按日志末行把行数补回来，并把补上的那一条作为普通记录对待，不会接出断链。
日志不提供 HTTP 读取接口 —— 那等于把它暴露给网页。

## 六、关闭鉴权

```bash
MINI_CANVAS_ALLOW_INSECURE=1 pnpm -C packages/cloud-server serve --no-admin-auth
```

必须同时给这个环境变量，单写 `--no-admin-auth` 会直接报错退出。关掉之后任何网页都能装插件、
跑脚本、改画布，只用于本机临时调试。

## 七、这一版没有解决的

| 问题 | 现状 |
|---|---|
| 装进来的插件能干什么 | 完整 fs、可再起进程（没有权限沙箱） |
| `/mcp` 独立鉴权 | 只靠 Host/Origin，没有令牌 |
| 资产 / 项目 / 历史 / KV 写接口 | 没有令牌，靠来源边界 |
| 同源 XSS | 回读资源已加 CSP，但其它同源注入点仍需逐个排查 |
| 网络与子进程限制 | 任务脚本可随意出网、可 spawn |

完整分析与实测证据见 `docs/plan/2026-10-19-cloud-server-admin-security-plan.md`。
