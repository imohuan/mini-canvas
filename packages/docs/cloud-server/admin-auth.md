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

**本机浏览器直连时不用手填**：后台发托管页（index.html）时会把令牌写进页面
（`window.__MC_ADMIN_TOKEN__`），前端启动时读它存进 localStorage，然后立刻删掉那个全局变量。

注入的条件很严，**三个都满足**才给：

1. TCP 对端是回环地址（`127.0.0.1` / `::1`，由连接本身决定，客户端改不了）；
2. 请求的 `Host` 也是回环写法；
3. **没有任何转发头**（`X-Forwarded-For` / `X-Real-IP` / `Forwarded` / `X-Forwarded-Host` /
   `X-Forwarded-Proto` 一个都不能有）。

三条缺一不可，每一道挡的是一种真实攻击：

- 只看 `Host`：`--host 0.0.0.0` 时，局域网里任何一台机器发个 `Host: 127.0.0.1`
  就能拿到令牌（审查时真机复现过）；
- 只看对端：**同机反代**（nginx 与服务在同一台机器）对端也是 `127.0.0.1`，
  远程访客都能拿到；
- 只看前两条还不够：nginx 默认 `proxy_set_header Host $proxy_host` 会把 `Host`
  改写成本服务的回环地址，于是前两条同时成立——但请求其实来自公网（审查用真实代理复现过）。
  反代一定会留下转发头，本机浏览器直连不会带，所以「有任意转发头就不注入」是可靠的分界。

代价：用自定义本机域名（如 `mycanvas.local`）访问、或通过任何反代访问，都不会自动注入，
需要在面板里手填一次。远程访问（局域网 IP / 域名 / 反代）一律不注入 —— 那是把令牌发给别人。

另外几条要知道的：

- **手填优先**：本地已有、且不是上一轮注入写进去的令牌时，注入**不会覆盖**它
  （`localStorage` 的 `mc_admin_token_injected` 记着上一轮注入的值）。
  所以你给另一套后台手填的令牌不会被悄悄换掉；只有「本地为空」或「与上一轮注入相同」时才写。
- **反代被配成透传 Host / 删转发头时**，三个判定会被同时满足。部署者知道自己要挂反代，
  设 `MINI_CANVAS_NO_TOKEN_INJECTION=1` 一刀切关掉注入，所有用户去面板手填。
- `MINI_CANVAS_ADMIN_TOKEN` **不校验格式**（只有读文件那条路校验 hex），但空串/全空白会**拒绝启动**
  —— 否则等于 verify('') 永远 missing，鉴权被悄悄关掉。注入时会转义 `<`，
  所以含 `</script>` 也不会变成脚本；但令牌本身仍建议只用十六进制。

令牌文件在 Linux / macOS 上会被改成 `0600`；**Windows 上不收紧 ACL**，同一个 Windows
账户下的其它程序能读到它。多用户共用一台机器时，用环境变量 `MINI_CANVAS_ADMIN_TOKEN`
自己管，或把数据目录放到只有你能进的位置。

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

前缀里有两种形态，规则不一样：带**尾斜杠**的按「目录」算（`/api/task/` 命中
`/api/task/call`）；以 **`-`** 结尾的是「名字前缀」（`/api/node-ui/debug-` 命中
`debug-accept`、`debug-result`）。其余不带斜杠的必须整段相等或后面接 `/` ——
所以 `/api/jobs` 不会连累 `/api/jobsfoo`。

## 二、请求边界（Host / Origin）

`/api/*` 与 `/mcp` 都要过这一关：

- `Host` 必须等于启动时的 `hostname:port`（默认 `127.0.0.1:8865` 与 `localhost:8865`）；
  `--host 0.0.0.0`（或 `::`）时会自动把 `127.0.0.1:<端口>` 与 `[::1]:<端口>` 也加进来 ——
  监听所有网卡之后，本机浏览器打开 `127.0.0.1` 是最常见的写法，漏了它会只回一句
  「请求来源不受信任」，看不出是白名单少了本机回环；
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
而是一枚**只允许写本画布本节点**的短时令牌（10 分钟，进程重启即失效）：

- `POST /api/canvases/<本画布>/resources?slot=<本节点>` —— 放行；
- `POST /api/canvases/<本画布>/nodes`，body **只能**是
  `{ update: [{ id: <本节点>, data: {…} }] }`，而 `data` 里的键只能是产物字段：
  `uiOutputUrl` / `imageUrl` / `videoUrl` / `audioUrl` / `text`；
- 写别的槽位、别的画布、改 `uiHtml` / `uiScripts`、`add` / `delete` 节点、
  调用其它受保护接口 —— 全部 403。

为什么连字段也要限：脚本是**用户代码**。只校验节点 id 的话，它可以用 `update` 给自己那个
节点塞一段新的 `uiHtml` —— 跑完一次脚本就换了一套界面，那不是「交产物」。

脚本作者不需要自己拼它：`ctx.save(...)` 已经带上。

## 四·补 可视化节点的「调试」页（跑在独立源上）

画布上的「调试」按钮打开的不是画布页里的副本，而是后台另开一个端口提供的**独立页面**。

为什么要换源：调试页要执行节点里的 HTML，而那份 HTML 可能带着任意脚本。如果它跟后台
同一个源，脚本就能读走 localStorage 里的管理令牌、直接调 /api/* —— 沙箱 iframe 守住的
那条边界等于白守。换到另一个端口就简单了：浏览器的同源策略替你挡住这一切。

流程：

1. 画布点「调试」→ POST /api/canvases/:id/debug-docs（**带管理令牌**），
   后台把 debug-*.html / context-*.js / sdk-*.js 写进 canvases/<id>/resources/debug/；
2. 返回的 urls.html 指向调试源（启动日志里的 127.0.0.1:<另一个端口>），窗口导航过去；
3. 页面里调 CanvasUI.save(...) 时，用的是**绑定本画布本节点、10 分钟**的短令牌（x-task-token），
   只能写自己那个资源槽位。管理令牌从不进这个页面；
4. 参数 / 上游变了，画布那边 300ms 去抖后重发一次；调试页每 5 秒重载 context.js 自动跟上。

调试页里的 `CanvasUI` 与画布里的**同名同形**：`setInputs` / `onChange` / `save` / `api` /
`task` / `cancel`。后三个不自己发请求，而是 `postMessage` 给打开它的画布窗口，由宿主
代发 —— 走的是和沙箱页**同一张权限表**，所以「在画布里能调的，在调试页也能调」。

调试源默认绑 127.0.0.1、端口由系统分配，只认 /<画布id>/<debug|context|sdk>-<节点>[-vN].(html|js)
这一种路径，其它一律 404。它也校验 `Host`（只认 `127.0.0.1:<端口>` 与 `localhost:<端口>`），
免得网页用 DNS 重绑定把调试产物读走。**带任何转发头的请求一律 403** —— 它本该只被本机直连，
挂到反代后面等于把节点 HTML 与 context.js（含那张短令牌）给远程访客。
它**不读环境变量、不列目录、不写文件**。
端口起不来时**不会退回后台同源** —— 直接报错让你知道（宁可没有调试页，也不给一个能读走令牌的页面）。

调试页要跨源把产物 POST 回后台，所以预检必须放行 x-task-token 头（否则表现是
Failed to fetch，而不是 403）。但调试源**不进**受信任来源白名单 —— 那上面的页面是你
自己写的 HTML，不该具备"可信来源"的身份。它只拿到一条窄通道：

```
<调试源> → POST /api/canvases/<任意画布>/resources   （仅此一条，其余路径一律 403）
```

也就是说，调试页即使被注入恶意脚本，它能做的也只有"往画布资源目录里塞一个文件"，
而且还得带那张只绑本画布本节点的短令牌。读 KV、整画布覆盖、装插件、跑脚本仍然全部被拒。

## 五、审计日志

**受管理令牌保护的写入口**每次尝试、成功、拒绝都会往 `<数据目录>/audit.log` 追加一行 JSON，带 hash 链。
整画布覆盖（`PUT /api/canvases/:id`）不要令牌，但也会记 `canvas/overwrite`。
被**来源边界**（Host / Origin）拒掉的**写**请求也记一条 `auth-failed`（带拒绝原因，如
`origin-not-trusted`）—— 这类请求在令牌关之前就断了，不记的话「谁在尝试从网页改我的画布」答不出来。
读请求被来源边界拒掉**不记**（DNS 重绑定探路会很吵）。
两类**不记**：带 `x-task-token` 被中间件快捷放行、随后又被路由拒掉的请求；资产 / 项目 /
历史 / KV 的写接口（它们这一版根本没有令牌保护）。
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
服务开着的时候也可能对正在写的日志跑校验：这时日志可能比头文件多出几行（刚 append、头还没更新），
会提示「服务正在写入时可能短暂出现，请停止服务后重跑」；行数**比头文件少**则一定是被删了。
日志不提供 HTTP 读取接口 —— 那等于把它暴露给网页。

`/mcp` 这一版仍然没有令牌（只靠 Host / Origin），但它**现在有审计**：每次调用记
`attempt` 与结局，`path` 形如 `/mcp#canvas_update_node`（工具名拼在后面），
`token` 记 `disabled`。查「谁在什么时候调了哪个工具」靠这一列。

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
| 同源 XSS | 资源回读已加 CSP、调试页已换独立源，但其它同源注入点仍需逐个排查 |
| 沙箱页能借宿主做什么 | `CanvasUI.api` 仍允许整画布覆盖、下单、写资产（宿主代发） |
| 审计的 head 文件 | 与日志同目录；整目录一起被换掉时发现不了 |
| 调试页能往外发数据 | 独立源页面上是你自己写的 HTML，没有 CSP；它能联网。换源挡住的是"读画布令牌"，不是"把内容发出去" |
| 资源回读的 CORP | `cross-origin-resource-policy: same-site`：同站（含换端口）能嵌，跨站不能。要跨站分享资源得单独放开 |
| 反代的 Host 改写 | 标准反代会带转发头，那种会被拦；被配成「透传 Host + 删所有转发头」的静默代理仍能骗过判定，靠 `MINI_CANVAS_NO_TOKEN_INJECTION=1` 兜底 |
| 网络与子进程限制 | 任务脚本可随意出网、可 spawn |
| 调试页 `CanvasUI.task` 的超时 | 15 分钟（脚本可能跑十分钟，但不能永远挂着）；`api` / `cancel` 仍是 30 秒 |

完整分析与实测证据见 `docs/plan/2026-10-19-cloud-server-admin-security-plan.md`。
