# 安全改造复查（第二轮，2026-10-20）

审查范围：`c31efb94..HEAD`（35 个提交，HEAD = `60b7d5e3`）。只读审查，除了本报告没有改任何业务代码。

核对目标：上一份报告 `docs/tmp/security-implementation-review.md` 里的每一条，现在到底修没修、修得对不对、有没有引入新问题。

## 结论

**六个严重项全部落地，按「开发自托管」这个口径可以上线。** S1 / S1b / S5 都真的换了源，S2 补了真 socket 用例并且我按真机重量跑了一遍，S3 / S4 都修好了；M1 / M2 / M3b / M4 也修对了。

但有三条新问题建议在宣布完成前补掉，其中两条是安全性的：

1. **调试源起不来时是「静默 fail-open」**：插件会退回后台同源托管调试 HTML（页面里的脚本又能读到管理令牌），而画布上那个「调试」按钮**不显示后台返回的 warnings**，用户完全不知道自己在跑一个会泄露令牌的页面。
2. **`PUT /api/canvases/:id` 既不要令牌、也不记审计**（设计上如此，但 M3 说的「成功写要留 attempt/ok」在这条路上是空的；实测整画布覆盖后审计行数不变）。
3. **独立调试页的 `CanvasUI` 只有 `setInputs / onChange / save`**，没有 `task / cancel / api`。节点代码在画布里能跑，拷到调试页就 TypeError —— 这个页面的价值就是「调同一份代码」。

另外还有 4 条轻微问题（审计 action 名写错、调试源不校验 Host、文档把审计说得比实际全、`docs/STATUS.md` 仍有冲突标记），列在后面。

## 逐条核对表

| # | 清单项 | 结论 | 证据 |
|---|---|---|---|
| S1 | 独立调试页同源执行节点 HTML | ✅ 已修 | 调试产物改由另一个端口的只读静态服务提供（`cloud-server/src/debugOrigin.ts:65-84` 路径白名单、`:97` 只认 GET）。同源回读路由在调试源存在时直接 404（`plugin-node-ui/src/server.ts:1667-1677`）。真机：装了插件后 `GET /api/canvases/c1/resources/debug/debug-7.html` → 404 `application/json`；同一份文件从调试源 `http://127.0.0.1:57251/c1/debug-7.html` → 200 `text/html`。**残留风险见 N1**。 |
| S1b | 调试副本窗口同源（document.write） | ✅ 已修 | `UiContent.vue:845-889` 改成「先 POST /debug-docs，成功后才 `win.location.href = url`」，空白窗口里不执行用户代码；`buildDebugDoc` 降级为离线预览（`uiDebug.ts:11-16`）。回归线 `__tests__/uiContentRender.test.ts:154-170` 断言源码里没有 `document.write`、没有 `buildDebugDoc`。 |
| S2 | 上传上限「先整包读进内存」 | ✅ 已修，这次有真 socket 用例 | `uploads.ts:59` 优先用 `req.stream`，`:73-96` 逐块累计、超限 `reader.cancel()`；两个入口都传了流（`routes/canvases.ts:121`、`routes/assets.ts:35`）。新用例 `__tests__/uploadStreamReal.test.ts` 真起 `node:http`、真发 chunked，断言「413 回来时 25 块还没发完」。真机 80MB 分块传到 50MB 上限：**第 15/20 块、259ms 就回 413**（`{code:413, sent:15, ms:259}`）。 |
| S3 | 风格库写请求没带令牌 | ✅ 已修 | `plugin-style-library/src/data/api.ts:12` 引入 `withAdminToken`，`:121`（settings）、`:132`（reload）都带上。`pnpm -C packages/plugins/plugin-style-library test` → 19 条全绿。产物侧也确认：重新 build 后 UMD 里出现 `n.withAdminToken(...)`，`@mini-canvas/canvas-base` 仍是 external（从宿主 `MiniCanvasBase` 取），没有重复打包宿主模块。 |
| S4 | 调试副本回包标记对不上 | ✅ 已修 | `uiDebug.ts:225` 同时认 `__canvasUiDebug` 与 `__canvasUiDebugResult`；`uiDebug.test.ts:169-260` 用 `new Function` 真跑桥代码，覆盖 task resolve / 失败 reject / task-event / cancel 四条分支。 |
| S5 | 独立调试页 `CanvasUI.save()` 直连后台 403 | ✅ 已修 | `debugDocAssets.ts:62-88` 改成带 `x-task-token`（`:80`），令牌由宿主签发、写进 HTML 和 context.js 两处；403 时回 `token-stale` 让画布重签。真机：调试源页面的令牌写自己槽位 → 200；换槽位 / 换画布 → 403。 |
| M1 | 任务令牌字段白名单 | ✅ 已修 | `server.ts:669` 白名单 `uiOutputUrl/imageUrl/videoUrl/audioUrl/text`；`:681-695` 请求体只许 `update`、每个 id 必须验签、`data` 的每个键都要在白名单里。`securityWiring.test.ts` 正反两面都钉住（含夹带 `uiScripts`、add 自己、改别人）。与 `task/runner.ts` 对齐：`ctx.save` 只发 `uiOutputUrl` + 一个产物字段（`:156-159`），能过。 |
| M2 | `port: 0` 时 Host 白名单自拒 | ✅ 已修 | `server.ts:504-516` 改成可变数组 + `fillTrustedHosts(port)`；`:978` 在 listen 回调里用真实端口原地覆盖。`securityWiring.test.ts` 用 `port: 0` 真监听，断言 `127.0.0.1:0` 不在白名单、真实端口能写。我也真跑了 `--port 0` 的服务，Host 是真实端口。 |
| M3 | 审计只有失败、没有成功写 | ⚠️ 修了一半 | 有了：`server.ts:613` 令牌通过记 attempt，`:624-628` 按 `c.res.status` 补 ok/rejected，异常分支 `:619-623` 记 `rejected/threw`。真机看到 `canvas/write` 成对、业务 400 记 `http-400`。**没有**：`PUT /api/canvases/:id` 是「不在 `isAdminPath` 里 → 直接 next()」，既不要令牌也不留任何审计（实测写完整张画布后 `audit.log` 行数不变）。 |
| M3b | 插件路由 attempt 没有结局 | ✅ 已修 | 新增 `auditPair.ts:57-92` 的 `withAudit`：正常返回补 ok、`settle()` 可给具体原因、抛异常记 rejected 再原样抛。`serverPlugins.ts` / `npmPlugins.ts` 全部改用它，热装/热卸失败也写进 `reason`。真机：`POST /api/server-plugins/uninstall`（不存在的 id）→ 404，审计里是 `attempt` + `rejected(not-found)`，外加中间件那条 `http-404` 结局。 |
| M4 | 审计末行截断发现不了 | ✅ 已修 | `audit.ts:114-124` 原子写 `.head`（count + lastHash），`:126-196` 启动时对数，`:285-304` 校验「行数少 / 末行 hash 对不上 / 缺头文件」。真机：删掉最后一行 → `审计链在第 5 行断裂：日志行数与头文件不符（少 1 行）`；空文件配旧 head(count=3) → `少 3 行`；服务运行中直接 `audit-verify` 会提示「可能比头文件多，停止服务后重跑」。 |
| M5 | 回读头对 `<img>` 的影响 / CORP | ⚠️ 未改（按设计保留） | `inlineAsset.ts` 仍是 `CSP: sandbox…` + `cross-origin-resource-policy: same-site`。真机确认上传的 SVG 回读带这三个头（CSP / nosniff / same-site），同源 `<img>` 正常。跨站嵌入会被 CORP 挡，这是当初接受的取舍，**文档里没写**，建议补一句。 |
| M6 | `/mcp` 没令牌、也没审计 | ⚠️ 审计补上了，令牌仍然没有 | `server.ts:812-841` 给 `/mcp` 挂审计：POST 读 JSON-RPC 取工具名，写成 `/mcp#canvas_list_canvases`，`token:disabled`，attempt + ok/rejected。真机：POST 调用 → attempt + ok 两条；GET 开 SSE → 同样两条（ok 在流关闭时写，长连接期间只有 attempt）。令牌仍然没有，与文档一致。 |
| M7 | `CanvasUI.api` 仍能做整画布覆盖 / 下单 / 写资产 | ⚠️ 未改（能力边界原样） | `hostFetch.ts:323-335` 的 `ALLOWED_WRITE` 还是那几组：`/api/canvases/:id`（整包 PUT）、`/api/jobs`、`/api/assets`。改的是头的处理：`:151-165` 现在会把页面传来的 `origin / host / cookie / referer / sec-fetch-site` 全部删掉，令牌在删完之后再写（页面覆盖不了）。**这条必须在威胁模型里写清楚**，别让后来的人以为沙箱页是只读的。 |

### 轻微 / 建议 15 条的状态

| # | 内容 | 状态 |
|---|---|---|
| 1 | `Origin` 比较大小写敏感 | ✅ 已修（`requestTrust.ts:106-115` 归一成 `new URL(x).origin`，Host 也小写后再比） |
| 2 | CORS 回调对 `trustedOrigins` 精确匹配、不处理尾斜杠 | ⚠️ 一半：Origin 侧已经归一（来源边界），但 CORS 回调 `server.ts:540` 仍是 `trustedOrigins.includes(origin)` 原样比；配置写 `http://x:5288/` 时实请求能过（来源边界归一了），**预检却不回 ACAO**。启动日志也没打印归一后的值。 |
| 3 | Windows 不收紧 `admin-token` 文件 ACL | ⚠️ 未改，`adminAuth.ts:134-138` 明确写了「Windows 不调用 icacls」并给了理由。建议至少文档写「同机其他账户可读」。 |
| 4 | `content-length` 解析对空串 | ✅ 已改（`uploads.ts:54-58` 现在先判 `rawLen !== undefined && rawLen !== ''`） |
| 5 | 空文件被当成 empty 拒掉 | ⚠️ 未改（行为不变） |
| 6 | `inlineAssetHeaders` 覆盖 content-type | ✅ 无问题（真机头正确） |
| 7 | `taskToken` 的 `exp` 用 `<` | ⚠️ 未改（`taskToken.ts:79` 仍是 `<`，边界一毫秒） |
| 8 | `taskToken` 没有 `iat` / `aud` | ⚠️ 未改（注释里已写明设计如此） |
| 9 | 宿主代发透传页面传的头 | ✅ 已修（`hostFetch.ts:155-165`） |
| 10 | `onBridgeMessage` 只校验 `ev.source`、不校验 `ev.origin` | ⚠️ 未改（`UiContent.vue:611-613` 仍只比 `ev.source`）。风险有限：`ev.source` 是那个 iframe 的 window 对象，被导航后仍然是它；但同源导航后消息会被当成沙箱页的。 |
| 11 | `settle` 对缺失 `ok` 当成功 | ⚠️ 未改（`uiData.ts:548-554` 仍是 `m.ok === false` 才 reject） |
| 12 | `isAdminPath` 前缀误伤兄弟路径 | ✅ 已修（`adminAuth.ts:54-58` 带尾斜杠按目录、不带的要求整段相等或后接 `/`） |
| 13 | `/api/jobs` 前缀 | ✅ 同上 |
| 14 | `audit-verify` 与 `list-tools` 同时出现 | ⚠️ 未改：实测 `node cli.js list-tools audit-verify -d X` 只跑了 `audit-verify`（后者覆盖前者），静默丢了一个子命令 |
| 15 | `docs/STATUS.md` 冲突标记 | ❌ 仍在（第 1 / 63 / 7302 行三处 `<<<<<<< ours`） |


## 新发现的问题

### N1（建议必修）调试源起不来时「静默 fail-open」，画布按钮还不显示警告

`plugin-node-ui/src/server.ts:507-514`：`debugOrigin.url` 为空时退回 `backend + /api/canvases/<id>/resources/debug/`，并往返回值里塞一条 warnings（写着「这个页面里的脚本能读到管理令牌」）。

问题是**画布按钮那条路把 warnings 丢了**：`UiContent.vue:917-925` 只读 `json.ok` / `json.urls.html` / `json.error`，`warnings` 从没被读取；打包产物里也搜不到 `warnings`。也就是说，只要调试源起不来（端口被占、系统限制），用户点「调试」拿到的就是一个**能在后台同源执行自己 HTML 的页面**，而界面上一个字都不提示。MCP 工具那条路至少会返回 warnings，但它也只是「返回给调用者」，不会阻止页面打开。

修法二选一：① 调试源起不来时直接拒绝生成调试页（返回错误让用户知道），不回退同源；② 保留降级，但把 warnings 显示在画布上（alert / 节点内提示），并且同源回读时给 HTML 加 `Content-Security-Policy: sandbox`。

### N2（建议必修）整画布覆盖既不要令牌、也不留审计

`adminAuth.ts:43` 把 `/api/canvases/` 和 `/api/canvas/` 只对 POST 保护，`PUT /api/canvases/:id` 是「靠来源边界保护」。这个取舍方案里写清楚了，但它带来一个副作用：M3 补的「成功写要留 attempt/ok」在这条路上完全空着。

实测：`PUT /api/canvases/auditprobe`（无 Origin、Host 正确）→ 200，`audit.log` 行数 **16 → 16**，一条都没写。同一次会话里 `POST /api/canvas/nodes` 是 attempt + ok 两条。也就是说，本机脚本（或将来某条绕过来源边界的路）只要用整包覆盖，就能改完整张画布而不留痕 —— 而这恰好是最彻底的一种改法。

修法：把 `PUT /api/canvases/:id`（和 `/view`）纳入令牌；最低限度也要纳入审计（`canvas/overwrite` 这个 action 早就定义了，却没有任何一处会写它）。

### N3（建议必修）独立调试页的 `CanvasUI` 缺 `task / cancel / api`

`debugDocAssets.ts:52-88` 只挂了 `setInputs / onChange / save`。节点代码里只要有 `CanvasUI.task(...)` 或 `CanvasUI.api(...)`，在画布 iframe 里正常，拷到调试页就是 `TypeError: CanvasUI.task is not a function`。这个页面的定位是「同一份代码、可断点」，缺这三个方法会让不少节点根本调不起来。

而且 `task / api` 也没法简单直连：它们要管理令牌。正确做法是让调试页把请求 `postMessage` 给 `opener`（`save` 已经是这个模式），由宿主代发；顺带复用 `isOwnResourceUrl` 那套校验。

### N4（轻微）审计里卸载插件被记成「安装」

`adminAuth.ts:78`：`if (pathname.startsWith('/api/server-plugins/')) return 'server-plugin/install'` —— 不看具体路径。实测 `POST /api/server-plugins/uninstall` 的中间件审计行是 `"action":"server-plugin/install"`。路由层那条 `server-plugin/uninstall` 是对的，所以同一次卸载会同时出现两个不同的 action 名。`npm-plugins` 同理（`:79`）。

### N5（轻微）调试源不校验 Host，DNS 重绑定可读调试产物

`debugOrigin.ts` 的 `routeOf` 只看路径，不看你用哪个 Host 头连过来。实测 `curl -H 'Host: evil.example' http://127.0.0.1:57251/c1/debug-7.html` → 200 正常返回。配合 DNS 重绑定，一个网页可以把某个域名解析到 127.0.0.1，然后读走调试产物（节点 HTML、`context-*.js` 里的上游数据与 10 分钟短令牌）。短令牌本身用不上（跨源带不上 Origin），但**内容泄露**是真的。建议和主服务一样加 Host 白名单（`127.0.0.1:<该端口>` / `localhost:<该端口>`）。

### N6（轻微）文档把审计说得比实际全

`packages/docs/cloud-server/admin-auth.md:149`：「每次尝试、成功、拒绝都会往 audit.log 追加一行」。实际有两类情况不写：整画布覆盖（N2）；带 `x-task-token` 被中间件放行、随后又被路由拒掉的请求 —— 实测 `POST /api/canvases/default/resources?slot=n1` 带伪造令牌 → 403，`audit.log` 行数 7 → 7，一条都没有（中间件那条快捷放行没记 attempt，路由拒绝也不记）。反过来，`/api/canvas/nodes` 带伪造令牌 → 403 会记一条 `auth-failed`，差别就在这个「快捷放行」。建议改成「受管理令牌保护的写入口会成对记录」，并写清这两类例外。

## 仍然留着的已知风险（与上一版一致，未新增）

| 风险 | 现状 |
|---|---|
| 装进来的插件 | 完整 fs、可起进程，没有权限沙箱 |
| `/mcp` | 只靠 Host/Origin，没有令牌（但有审计了） |
| 资产 / 项目 / 历史 / KV 写接口 | 没有令牌，靠来源边界；实测跨源（即使 Origin 是本机调试源）`PUT /api/kv/config/x` → 403，本机无 Origin 客户端仍然能做 |
| 同源 XSS | 资源回读有 CSP、调试页换了独立源；其它同源注入点没逐个排查 |
| 沙箱页借宿主的能力 | `CanvasUI.api` 仍能整画布覆盖 / 下单 / 写资产（见 M7） |
| 审计 head 文件 | 与日志同目录，整目录被替换发现不了 |
| 任务脚本 | 可随意出网、可 spawn |
| 调试源 | 没有 Host 校验（N5）；降级时会退回同源（N1） |

## 真机记录（本次实测，不是照抄单测）

起服务：`MINI_CANVAS_ADMIN_TOKEN=<64 hex> node packages/cloud-server/dist/cli.js serve --port 8899 --dir .scratch/review-r2x --no-open`（先 `pnpm -C packages/cloud-server bundle`，否则跑的是旧 dist）。插件目录里放 `plugin-node-ui/dist/server.js` 才能到调试那几条路由。

| 场景 | 结果 |
|---|---|
| 无令牌写 `/api/canvas/nodes` | 403 `需要管理令牌` |
| 带令牌写 `/api/canvas/nodes` | 200，审计 attempt + ok |
| 业务 400（body 不是 JSON） | 审计 attempt + `rejected(http-400)` |
| 伪造 `Host: evil.example` | 403 `host-not-trusted` |
| `Origin: null`（沙箱 iframe） | 403 `opaque-origin` |
| 恶意 `Origin: http://evil.example` + 正确令牌 | 403（来源边界先拦） |
| 调试源 Origin 打 `/api/kv`、`PUT /api/canvases`、`/api/assets`、`/api/task/call` | 全部 403（窄通道只放 `/api/canvases/*/resources`） |
| 调试源 Origin 预检 `POST .../resources` + `x-task-token` | 204，allow-headers 含 `x-task-token` |
| 调试短令牌写自己槽位 | 200，返回 `/api/canvases/c1/resources/slot-7.png` |
| 同一令牌换槽位 / 换画布 | 403 |
| 调试页（独立源）读 `/c1/debug-7.html` | 200 `text/html`，`nosniff`、`no-store` |
| 调试源路径穿越 `/c1/../c1/debug-7.html`、`%2e%2e`、`..%2f`、`%00`、大写扩展名 | 全部 404 / 不越界（`--path-as-is` 也试了） |
| 后台同源 `GET .../resources/debug/debug-7.html`（插件已装、调试源已起） | 404「调试页在独立源上」 |
| 80MB 分块上传到 50MB 上限 | 413，`sent=15/20`，259ms（没把 body 收完） |
| 删掉 `audit.log` 最后一行 | `audit-verify` 报「少 1 行」 |
| 空 `audit.log` + 旧 head(count=3) | `audit-verify` 报「少 3 行」 |
| `/mcp` `tools/call` | 200，审计 `mcp/call` + `/mcp#canvas_list_canvases` + `token:disabled`，attempt/ok 成对 |
| `/mcp` GET SSE | 200 `text/event-stream`，审计 attempt/ok 成对（ok 在流关闭时写） |
| 上传的 SVG 回读 | 200 `image/svg+xml` + CSP sandbox + nosniff + CORP same-site |

## 测试与类型检查（本次实跑）

| 命令 | 结果 |
|---|---|
| `pnpm -C packages/cloud-server test`（全量，跑了 5 次） | 3 次全绿 828/828；2 次各挂 1 条，挂的文件分别是 `queueScheduler` / `queuePreTurn` 的 waitFor 超时 |
| `pnpm -C packages/cloud-server exec vitest run queueScheduler`（单跑 5 次） | 13/13 全绿 |
| `pnpm -C packages/cloud-server exec vitest run queuePreTurn`（单跑 5 次） | 4/4 全绿 |
| `uploadStreamReal + events`（4 次） | 8/8 全绿 |
| `pnpm -C packages/plugins/plugin-node-ui test` | 358/358 全绿（31 个文件） |
| `pnpm -C packages/ui test` | 393/393 全绿（46 个文件） |
| `pnpm -C packages/plugins/plugin-style-library test` | 19/19 全绿 |
| `pnpm -C packages/cloud-server typecheck` | 通过（`7deb2d41` 修掉了 `uploadStreamReal.test.ts` 的 `ClientRequest 不可赋给 void`） |
| `pnpm -C packages/plugins/plugin-node-ui typecheck` | 通过 |

两个要如实说的观察：

1. 第一次全量跑 `cloud-server` 时 `uploadStreamReal.test.ts` 三条全失败，报 `TypeError: stream.getReader is not a function`；之后 4 次全量 + 多次单跑都正常。只在「全量并发」时出现过一次，没定位到根因（像是 worker 里的全局 `ReadableStream` 被替换过）。**建议把这条用例钉在固定 pool 上再观察**，别当它已经稳了。
2. `queueScheduler` / `queuePreTurn` 在全量跑里偶发 waitFor 超时，单跑 5 次全过，且这两个文件在本次范围内没有改动（`git log c31efb94..HEAD -- <file>` 为空）。判断是既有的时序脆弱，不是这次安全改造引入的。

## 一句话回答「能不能上线」

上一版的三颗钉子（S1 / S1b / S5）都拔掉了，S2 也终于有真 socket 证据；剩下的主要都是「能力边界」和「审计完整性」层面的账。**先补 N1（降级 fail-open）和 N2（整画布覆盖不记账），N3 紧随其后**；这三条补完，这一轮就可以收尾。
