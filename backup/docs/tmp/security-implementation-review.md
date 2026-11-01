# 安全改造代码审查（2026-10-20）

审查范围：`12abbab5`…`0282ef6b` 这 12 个提交，外加审查期间落地的 `284ce2f3`（`CanvasUI.api` 收紧）、`c31efb94`（上传流式读取）、`95125986`（风格库带令牌），以及工作树里尚未提交的 `uiDebug.ts` 回包标记修复。工作树那一条按“已修、未提交”复核。只读审查，没有改业务代码。

## 结论

**这一版还不能上线。** 令牌中间件、Host 白名单、审计链的主体做得对，主要洞也确实堵住了；但有两处会让“安全改造”在真实使用中失真：独立调试页与调试副本窗口都在后台同源执行节点 HTML（两者都能直接读走令牌）、独立调试页的 `CanvasUI.save()` 仍直连后台（会 403）。前者是安全阻断，后者是明确的功能回归。审查期间已补上上传流式读取、风格库令牌、调试副本回包标记；前两条仍缺真实 socket 测试，第三条还在工作树未提交。

## 严重问题

### S1. 独立调试页把用户 HTML 放在后台同源执行，令牌可被直接读走

证据：`packages/plugins/plugin-node-ui/src/debugDocServer.ts:171-210` 明确写着“产物无 CSP（调试副本口径）”；实际写盘入口在 `packages/plugins/plugin-node-ui/src/server.ts:1466-1544`，生成 `debug-<nodeId>.html` 并让同源 `GET /api/canvases/:canvasId/resources/debug/:file` 以 `text/html` 回读（`:1528-1540`）。这条 GET 不需要令牌；页面里的脚本与画布页同源，能读 `localStorage.mc_admin_token`。

触发条件：Agent 调 `canvas_ui_build_debug_doc`（或用户打开生成出来的调试 URL），节点 `data.uiHtml` 里带 `<script>`。任何能写入 `uiHtml` 的路径（Agent、同源插件、以及已经被绕过的 `CanvasUI.api`）都能把代码送进这个页面。

为什么这次改造没兜住：方案第十九节只处理了“按扩展名回读上传资源”，调试目录是另一个白名单（`debug-*.html` / `context-*.js` / `sdk-*.js`），既不在 `inlineAsset.ts`，也不在 CSP 覆盖范围。方案第二节第 6 条已经写明“同源 XSS 是令牌解决不了的”，但实现里又新开了一条同源 HTML 通道。

建议修法（按优先级）：

1. 调试页改到独立源（方案第十六节方案 ③），或至少不走 `/api/*` 同源，改为 `data:`/`blob:` 或单独端口的静态服务；
2. 短期兜底：回读调试 HTML 时加 `Content-Security-Policy: sandbox`（会失去 DevTools 的部分能力，但先止血），并禁止 `<script src>` 之外的注入；
3. 更彻底：调试页不写“节点 HTML”，只写数据 + 一个受控 SDK 壳，HTML 由调试工具在独立源里拼装；
4. 无论选哪条，都要把 `localStorage` 令牌改成 HttpOnly cookie，或把令牌移出页面可读范围——否则同源脚本永远能拿。

### S1b. 调试副本窗口同样在后台同源执行节点 HTML，且只差一次点击

证据：`packages/plugins/plugin-node-ui/src/UiContent.vue:835-858` 的 `openDebug()` 用 `window.open('', 'mc-ui-debug-' + id)` 开一个 `about:blank` 窗口，然后 `win.document.write(buildDebugDoc(...))`。`about:blank` 继承打开者的源，所以副本与画布页同源；`buildDebugDoc`（`uiDebug.ts:84-129`）**不带 meta CSP**，文件头 `:45-49` 明确写着“副本不带 meta CSP”。节点 HTML 来自 `data.uiHtml`，Agent / 同源插件都能写。

触发条件：用户在画布上双击进入可视化节点，点“调试”。节点 HTML 里的任意脚本会以宿主同源身份执行，读 `localStorage.mc_admin_token`、调 `/api/*`、读整个画布。

为什么比 S1 更值得处理：S1 要用户打开一个生成的 URL，S1b 是产品 UI 上现成的“调试”按钮；而且 `window.opener` 也指向画布页。方案的第十六节只讨论了沙箱 iframe 的 `Origin: null`，没有把“同源调试副本”算进同源 XSS 面。

建议修法：调试副本改到独立源（与 S1 同一条路）；短期至少给 `document.write` 的副本加 `Content-Security-Policy: sandbox`（会牺牲部分 DevTools 能力），并默认只在“用户明确确认过这是自己写的 HTML”时才允许打开。

### S2. 上传上限原先是先整包读进内存；`c31efb94` 已改为流式，但真实接线还要再验

证据（已提交基线 `d6d9acf1`）：`packages/cloud-server/src/uploads.ts:38-56` 的 `readBodyLimited` 在 `content-length` 不超限（或缺失）时直接 `await req.arrayBuffer()`，随后才检查 `buf.byteLength > limit`。文件头注释自己写着“边读边计数”“超了立刻停”，实现没有做到。调用点在 `routes/canvases.ts:120-127` 与 `routes/assets.ts:33-41`。

触发条件：分块传输（无 `content-length`）或声明一个很小的 `content-length`、实际发送 500MB。Node/Hono 会先把整个 body 收进内存，再进入 `readBodyLimited`；此时 413 已经晚了，进程可能先 OOM。`uploads.test.ts` 用的是假 `arrayBuffer()`，测的是“读完之后判断”，所以测试全绿但没覆盖真实流。

`c31efb94` 已按这个方向改：`uploads.ts:52-102` 优先用 `c.req.raw.body` 逐块读，超限 `reader.cancel()`；`canvases.ts:121` 与 `assets.ts:35` 都传了 `stream: c.req.raw.body`。**但测试仍用假流对象**：`uploads.test.ts` 的 `countedStream()` 是内存 `ReadableStream`，不能证明 Hono/Node 的真实 `c.req.raw.body` 在超限后会停止从 socket 拉数据。建议补一条真监听测试：用 `http.request` 分块发送 60MB，断言 413 在发送完成前返回、进程 RSS 不随 body 线性增长。

### S3. 风格库/特效库面板的写请求原未带管理令牌（`95125986` 已补）

证据（已提交基线）：`packages/cloud-server/src/adminAuth.ts:34-35` 把 `/api/style-library/` 与 `/api/effect-library/` 整段纳入任意写方法；但前端 `packages/plugins/plugin-style-library/src/data/api.ts:116-131` 的 `putRoot()` 与 `reload()` 仍是裸 `fetch`，没有 `x-admin-token`。调用链是 `data/store.ts:214/219` 的 `saveRoot()` / `rescan()`；界面上的“换一批 / 重扫”按钮在 `components/StyleGalleryView.vue:172`。

触发条件：用户打开风格库或特效库，点“重扫”或保存新的资源目录。请求会 403，且前端只显示“保存失败 HTTP 403”，用户不知道为什么。

`95125986` 已按这个方向改：`data/api.ts:12` 引入 `withAdminToken`，`:121`、`:132` 两处写请求都带上了；`api.test.ts` 新增两条测试，令牌存在/不存在都覆盖，`pnpm -C packages/plugins/plugin-style-library test` 19 条全绿。提交时请注意该插件是 UMD 打包，`@mini-canvas/canvas-base` 是 workspace 依赖，需要确认打包产物不把宿主模块重复打进去。

### S4. 调试副本的 `CanvasUI.task()` / `cancel()` 回包标记对不上（工作树已补，待测试）

证据（已提交基线）：`packages/plugins/plugin-node-ui/src/uiDebug.ts:182-197` 的 `hostCall()` 发出的是 `{ __canvasUiDebug: 1, type:'task', reqId }`；宿主 `UiContent.vue:916-941` 收下后，所有结果都用 `replyDebug(win, { __canvasUiDebugResult: 1, reqId, ... })` 回。页面侧的监听器 `uiDebug.ts:205-214` 只认 `d.__canvasUiDebug === 1 && d.reqId`，**不认 `__canvasUiDebugResult`**；`save` 另有一个只服务自己的 `onMsg`（`:238-245`），`hostCall` 没有。结果是 `CanvasUI.task()` / `CanvasUI.cancel()` 的 `pending` 永远不会 `settle`。

触发条件：打开“调试副本”窗口，在副本里调用 `CanvasUI.task(...)` 或 `CanvasUI.cancel(...)`。页面不会报错，只是永远停在 await；`onLog` / `onProgress` 也收不到（`task-event` 同样发成 `__canvasUiDebugResult`）。

当前工作树已改成 `(d.__canvasUiDebug === 1 || d.__canvasUiDebugResult === 1)`（`uiDebug.ts:211`），并新增了真正执行桥代码的测试（`uiDebug.test.ts:169-260`）：用 `new Function` 注入假的 `window` / `parent` / `document`，模拟宿主回 `__canvasUiDebugResult`，覆盖 task resolve、失败 reject、`task-event` 转发、cancel 四个分支。方向对，**待提交**即可。

### S5. 独立调试页的 `CanvasUI.save()` 仍是旧直连，带管理令牌后必 403

证据：`packages/plugins/plugin-node-ui/src/debugDocAssets.ts:37-49` 的 `SDK_JS_TEMPLATE.save` 直接 `fetch(baseUrl + '/api/canvases/.../resources?slot=...')`，请求头只有 `content-type`，既没有 `x-admin-token`，也没有 `x-task-token`。这个 `sdk-*.js` 由 `server.ts:1503` 写入、由同源 `GET /api/canvases/:canvasId/resources/debug/:file` 提供给独立调试页。`adminAuth.ts:42` 把 `/api/canvases/` 的 POST 纳入令牌保护，所以这条上传现在会 403。

触发条件：Agent 调 `canvas_ui_build_debug_doc` 生成独立调试页，用户在页面里调用 `CanvasUI.save(...)`。

建议修法：把 `debugDocAssets.ts` 改成与 `hostFetch` 同一套代发（或直接复用 `hostFetch` 的 save），不要在调试页里拼资源地址；如果短期不修，就在 `canvas_ui_build_debug_doc` 的返回值与文档里明确写“此页 save 不可用，请用画布内节点或脚本 ctx.save”。

> 同一条链还有两个配套风险：`debugDocServer.ts` 没有测试（`rg` 在 `__tests__` 里找不到 `buildDebugHtml` / `debugMime` 的断言），`debugDocAssets.ts` 也没有测试；`server.ts:1528-1544` 的读取路由只靠 `resolveDebugFile` 的路径校验，没有校验“这个文件是不是当前节点生成的”。这意味着只要知道 `debug-<nodeId>.html` 的名字，任何同源请求都能打开它，哪怕节点后来被删。

## 中等问题

### M1. 任务令牌的中间件放行范围比注释更宽，且路由层校验只覆盖 `nodes` 一种写法

- 中间件 `server.ts:550-555` 对任意带 `x-task-token` 的 `/api/canvases/*/resources` 与 `/api/canvases/*/nodes` 直接 `next()`，把真正的校验完全交给路由。这本身可以接受，但 `endsWith('/resources')` / `endsWith('/nodes')` 不看方法：`DELETE /api/canvases/x/nodes` 也会进路由（目前没有 DELETE 路由，未来加一条就会漏）。
- `verifyTaskWrite`（`server.ts:608-624`）只收集 `add` / `delete` / `update` 三批里的 id，并要求“所有 id 都等于绑定节点”。如果请求体里既没有这三批、又带了一个别的字段（例如未来新增的 `replace` / `patch` / `move`），`ids.length === 0` 会直接 `return false`，看似安全；但反过来，**只要三批里有一个 id 等于绑定节点，其余字段就可以夹带任意内容**。
- `delete` 批允许字符串或 `{id}`，`add` 允许新节点对象；脚本可以 `add` 一个 id 等于自己的“新节点”，从而覆盖自己节点的任意字段（包括 `uiHtml` / `uiScripts`）。这是设计内还是设计外，需要明确：如果脚本只该写产物字段，应该只放行 `update` 且限制字段白名单。

建议：路由层按“方法 + 精确路径”再判一次；把 `verifyTaskWrite` 收窄成“只允许 update 本节点，且 data 只含产物字段（`uiOutputUrl` / `imageUrl` / `videoUrl` / `audioUrl` / `text`）”。补测试：伪造 `x-task-token` + `add` 别的节点、`delete` 别的节点、`update` 别的节点都必须 403。

### M2. Host 白名单用构造时端口，CLI 端口顺延时仍会自拒

证据：`server.ts:496-503` 用 `opts.hostname ?? '127.0.0.1'` 与 `port`（构造参数）生成 `trustedHosts`；`server.ts:832-856` 在 `start()` 回调里才拿到 `info.port`，但只更新了 `actualPort`、MCP 地址与 test 模型地址，**没有重算 `trustedHosts` / CORS 闭包 / requestTrust 的 opts**。`cli.ts:197-222` 在端口被占用时会 `port + i` 重试，每次新建 server，所以“新建时用的 port”恰好等于最终端口——**CLI 路径暂时没事**；但 `createCloudServer({ port: 0 })` 或直接调用 API 的宿主会得到 `127.0.0.1:0`，真实端口起来后所有请求 403。

建议：把 `trustedHosts` 改成 getter/闭包，在读 `host` 时用 `actualPort ?? port`；或在 `start()` 回调里重建 `trustedHosts` 并让 `createRequestTrust` 持有可变引用。补一条 `port:0` 的真监听测试。

### M3. 审计只覆盖“失败”，成功写操作没有 attempt/ok 记录

证据：`server.ts:556-571` 只在令牌失败时 `audit.append({ action:'auth-failed', result:'rejected' })`；令牌通过后直接 `next()`，没有 attempt/ok。插件安装/卸载有审计（`serverPlugins.ts` / `npmPlugins.ts`），但画布写、任务调用、Agent 会话写、`/mcp` 写都没有。`audit.ts:12-25` 定义了 `canvas/write`、`task/call`、`agent/session-write` 等 action，实际没人写。

影响：方案 4.2 说“进入写路由先记 attempt → 执行 → 成功后补 ok”，验收清单也要求 `audit.log` 记录 attempt / ok / auth-failed。现在只能看到被拒绝的尝试，看不到“谁成功改了什么”。

建议：在令牌中间件通过后按 `isAdminPath` 的 action 映射记 attempt；路由完成后再记 ok/rejected。至少要覆盖 `canvas/write`、`task/call`、`agent/session-write`。

### M3b. 插件安装/卸载的 attempt / ok 有几处“只有 attempt、没有结局”

证据：

- `serverPlugins.ts:196-197` 的 uninstall：`attempt` 之后如果 `id` 非法，直接 `return 400`，没有 `rejected` 记录；
- `npmPlugins.ts:399-407` 的 update：`attempt` 之后“包不在记录里”直接 `404`，没有 `rejected`；`latest === rec.version` 直接 `200`，没有 `ok`；
- `npmPlugins.ts:381` 的 install：`attempt` 后 `doInstall` 若抛异常，没有 catch，`attempt` 也没有结局；
- `serverPlugins.ts:196` 之后 `hotInstall` / `hotUninstall` 失败时，`ok` 已经在前面写过，但热装/热卸失败只在响应里提，没有补记录。

影响：审计链本身不会断，但“attempt 没有对应 ok/rejected”会让事后审计误判为“请求在执行中崩了”。方案 4.2 明确要求成对。

建议：把每个 `attempt` 包进 `try/finally`，在 `finally` 里根据 `result` 补一条；或者用一个小的 `withAudit()` 包装器，保证每个分支都有结局。

### M4. 审计的 `verify()` 对“末行被删”和“整文件重写”分辨不了

证据：`audit.ts:122-161` 只校验行内 hash 与 `prev` 链；删除最后一行后，剩余链仍然自洽，`verify()` 返回 `ok:true`。方案要求能发现“删中间行、首行有 prev”，但没有要求末尾截断；实际攻击者最容易做的就是删掉最后几条（尤其是刚发生的成功记录）。`ensureLoaded()` 也只读最后一行 hash，不校验整条链；如果文件被改过，后续 append 会接在一条断链上，直到有人手动 `audit-verify`。

建议：在文件头或单独的 `.audit-head` 里记 `{ lastHash, count }`，`verify()` 校验 count 与末行 hash；每次 append 后原子更新 head。或者至少把 `verify()` 的局限写进文档，并在启动时跑一次校验、发现断链就告警。

### M5. 回读头对 `<img>` 是否安全，需要真机确认；`cross-origin-resource-policy: same-site` 会影响跨源嵌入

证据：`inlineAsset.ts:22-38` 用 `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:`，并加 `cross-origin-resource-policy: same-site`。方案说“实测不影响 `<img>`”，但那是在没有 CORP 的情况下测的。`same-site` 会让**跨站**页面（例如用户把资源地址贴到别的站点）无法加载这张图；同源画布没问题。如果产品有“分享画布到别的域”场景，这会坏。

建议：确认 `<img>` 在同源、跨源两种场景下的实际表现；如果只需要防脚本，CORP 可以去掉或改成 `cross-origin`，CSP `sandbox` 已足够。补一条真机测试（不是只断言头字符串）。

### M6. `/mcp` 只有 Host/Origin，没有令牌；且 `requestTrust` 的 `inScope` 对查询串的处理不完整

证据：`requestTrust.ts:28-30` 用 `pathname === '/mcp' || pathname.startsWith('/mcp?')`。Hono 的 `c.req.path` 通常不含查询串，所以 `/mcp?x=1` 实际会以 `/mcp` 进入，第一条就命中；这一条不是漏洞，但写法容易误导。真正的问题是 `/mcp` 仍然无令牌（方案有意取舍），任何本机非浏览器程序或同源 XSS 都能调它批量改画布。

建议：至少把 `/mcp` 纳入审计（记录 `tools/call` 的方法与工具名），并在文档里把“同源 XSS 可直接调 /mcp”写成已知风险；下一版加独立令牌。

### M7. `CanvasUI.api` 的“最小权限”仍允许沙箱页写画布、下单、传资产

证据：`hostFetch.ts:312-322` 允许 `POST/PUT /api/canvases/:id`（整画布覆盖）、`/api/canvas/nodes`、`/api/jobs`、`/api/assets`。这些请求都由宿主带管理令牌发出，所以沙箱页（AI 生成的任意 HTML）可以：整张覆盖当前画布、给任意节点写 `uiScripts`、消耗生成额度、往资产库塞文件。`hostProxyApi.test.ts:63-85` 把“危险接口”限定在 task/agent/plugins，刻意放行了上述几类。

这符合“视觉节点要能改画布”的产品需求，但它与“iframe 永远拿不到管理令牌”的安全叙事有冲突：令牌没有交给 iframe，**能力**却交给了 iframe。方案第十六节方案 ② 说“iframe 永远碰不到网络层”，实际是“iframe 碰不到网络层，但能借宿主的手做几乎所有的画布写”。

建议：把 `CanvasUI.api` 收窄到“读 + 本节点 update + 本节点 resources + jobs”，禁止整画布 `PUT`、禁止 `add/delete` 别的节点、禁止 `assets` 写入；或者在宿主侧对 body 做节点 id 校验（与 `verifyTaskWrite` 同一套）。这条不阻断上线，但必须写进威胁模型，别让后续开发者以为沙箱页是只读的。

## 轻微 / 建议

1. **`requestTrust` 的 `Origin` 比较是大小写敏感的**：`origin !== 'http://' + host` 直接字符串比，`HTTP://LOCALHOST:8865` 会被拒。浏览器发出的 Origin 通常是规范小写，问题不大，但反代/自定义客户端可能踩。建议 `new URL(origin).origin` 归一后再比。
2. **CORS 的 `origin` 回调对 `trustedOrigins` 只做精确匹配**，没有处理尾斜杠；文档已经提醒，但启动日志只打印 hosts，没打印 origins 的“实际生效值”。建议 CLI 把 origins 也逐行打印，并在配置带尾斜杠时警告。
3. **`adminAuth` 在 Windows 上不收紧 ACL**：`adminAuth.ts:107-113` 注释说 Windows 忽略 mode，但没调用 `icacls`。方案 4.6 要求至少同机其他账户不可读。建议在 Windows 上用 `icacls` 设置仅当前用户，失败只警告。
4. **`readBodyLimited` 的 `content-length` 解析**：`Number('')` 是 0，`Number('abc')` 是 NaN；当前 `Number.isFinite(declared)` 对空串会当成 0，不会误拒，但语义上应显式判断 `header === undefined`。
5. **`uploads.ts` 的空文件判定**：`byteLength === 0` 返回 `empty`，但某些合法上传（例如空的 `.txt`）会被拒；如果产品需要空文件，应区分“没有 body”与“body 长度 0”。
6. **`inlineAssetHeaders` 的 `content-type` 覆盖**：`c.body(bytes, 200, { ...inlineAssetHeaders(...) })` 会覆盖 Hono 默认头；目前没问题，但 `content-length` 由 Hono 计算，和自定义头混用时要确认不会被旧值覆盖。
7. **`taskToken` 的 `exp` 用 `< now()`**：过期时刻等于 `now` 时仍有效一毫秒；建议 `<=`。另外 `unb64url` 对非法 base64 不抛，`JSON.parse` 可能得到非对象（例如 `null`），已有 `!claims` 保护，OK。
8. **`taskToken` 的 claims 没有 `iat` / `aud`**：无状态令牌只要签名对就认，进程内密钥随机生成，重启即失效；这符合设计，但调试时无法区分“旧令牌”与“伪造令牌”。建议加 `iat` 并写进日志（不写原文）。
9. **`UiContent.vue` 的 `handleProxyRequest` 对 `m.type === 'api'` 直接透传 `m.headers`**：如果页面传 `host` / `origin` / `x-admin-token`，会被 `authHeaders` 合并；`withAdminToken` 在最后覆盖 `x-admin-token`，所以页面不能覆盖令牌，但可以传 `origin` 之类让后台误判。建议在宿主侧剥离 `host` / `origin` / `cookie` / `x-admin-token`。
10. **`UiContent.vue` 的 `replyProxy(win, ..., '*')`**：目标源是 `'*'`，但 `win` 是具体 iframe，消息只会到那个窗口；问题不大。更值得改的是 `onBridgeMessage` 只校验 `ev.source === win`，没有校验 `ev.origin === 'null'`；如果 iframe 被导航到同源页面，`ev.source` 仍然相等，消息会被当成沙箱页的。建议同时校验 `ev.origin === 'null'`（沙箱页）或 `'about:srcdoc'` 的实际来源。
11. **`uiData.buildUiBridge` 的 `settle()` 在 `m.ok === false` 且 `m.state === 'cancelled'` 时 resolve**，与旧语义一致；但 `m.ok` 缺失（宿主回包忘记带）会被当成成功，`p.resolve(m)`。建议要求 `typeof m.ok === 'boolean'`，否则 reject。
12. **`isAdminPath` 的前缀匹配对 `/api/agent/mcpfoo` 会命中**：`/api/agent/mcp` 没有尾斜杠，`matchesPrefix` 用 `startsWith`，所以 `/api/agent/mcpfoo` 也会要令牌。这属于“过度保护”，不会漏，但和注释“带结尾斜杠避免误伤兄弟路径”不一致。建议加尾斜杠或改成 `path === prefix || path.startsWith(prefix + '/')`。
13. **`/api/jobs` 前缀**：`/api/jobs` 同时覆盖 `/api/jobs` 与 `/api/jobs/:id/cancel`，也会覆盖未来的 `/api/jobsfoo`；同上，建议精确化。
14. **CLI `audit-verify` 的 `-d` 解析**：`1bc48005` 已修，但 `audit-verify` 与 `list-tools` 同时出现时后者覆盖前者；建议互斥报错。
15. **`docs/STATUS.md` 顶部仍有冲突标记**（`<<<<<<< ours` / `>>>>>>> theirs`）。这不属于本次安全改造，但 AGENTS.md 要求开工先读 STATUS，冲突标记会误导后续审查。建议单独清理。

## 逐条核对表

| # | 清单项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 令牌中间件位置 / 白名单 / GET 放行 / 预检 | ⚠️ | `server.ts:541-573` 挂在 `host.start()`（`:765`）之前，顺序对；GET/HEAD/OPTIONS 放行（`:543`）；`/api/canvases/`、`/api/canvas/` 只拦 POST（`adminAuth.ts:42,54`）；`/api/agent/canvases/` 整段拦写，GET stream 放行。预检：`cors` 在 `:511` 先挂，OPTIONS 在 `:543` 放行，`allowHeaders` 含 `x-admin-token`（`:527`），不会只看到 Failed to fetch。问题：`ADMIN_WRITE_PREFIXES` 的 `mcp` / `jobs` 无尾斜杠会误伤兄弟路径；`x-task-token` 放行范围按 `endsWith` 不看方法（`:550-555`）。 |
| 2 | 审计串行 / verify / 不写令牌 / attempt-ok 成对 | ⚠️ | `audit.ts:103-120` 用 `tail = tail.then(...)`，并发的 `prev` 确实成链，`audit.test.ts:61-69` 50 条并发验证过；`verify()` 能发现改内容、删中间行、首行有 prev（`:103-140`），但**删末行发现不了**。`buildBody` 只挑白名单字段（`:51-68`），`append` 不会写令牌原文，测试 `audit.test.ts:84-91` 也断言了。问题：`server.ts` 只在 auth-failed 记审计，成功写没有 attempt/ok；`canvas/write`、`task/call`、`agent/session-write` 定义了但没人写；插件安装/卸载有几处 attempt 没有结局（M3b）。 |
| 3 | Host 白名单 / Origin 同源 / Sec-Fetch-Site / `null` / OPTIONS / `/mcp` / 端口 / 错误响应 CORS | ⚠️ | `requestTrust.ts:32-63`：Host 必须精确在白名单；Origin 必须 `http(s)://host` 或 trustedOrigins；`null` 默认拒；`cross-site` 拒；OPTIONS 放行（`:34`）；`/mcp` 在 `inScope`（`:28-30`），且挂在 `'*'` 上（`server.ts:536`）。端口：`trustedHosts` 用构造时 `port`（`server.ts:496-503`），CLI 顺延每次新建 server 所以实际没问题，但 `port:0` / 宿主直接调用会在真实端口起来后 403。CORS 错误响应：`cors` 先挂，403 由后续中间件返回，Hono 的 `c.set res` 会合并 `cors` 已写入的 ACAO（`context.js:141-159`），同源 403 能读到文案；跨源恶意 Origin 本来就不回 ACAO，这是预期。 |
| 4 | 上传限制 / 入口覆盖 / CSP 回读 | ⚠️ | 原实现是“先 `arrayBuffer()` 再判大小”，`c31efb94` 已改成优先流式读取（`uploads.ts:52-102`），两个入口都传了 `stream`（`canvases.ts:121`、`assets.ts:35`）；但测试用的是内存流，真实 socket 背压未验（S2）。`inlineAsset.ts` 用在 `canvases.ts:152`、`assets.ts:54`、`plugin-style-library/server.ts:472-481`；`debug-*.html` 这条同源 HTML 不在覆盖内（S1）。CSP 头字符串本身正确，`<img>` 同源应该不受影响；CORP `same-site` 对跨站嵌入有影响，需真机确认（M5）。 |
| 5 | 任务脚本令牌：签名/过期/绑定/畸形；中间件过宽；verifyTaskWrite；伪造与跨画布 | ⚠️ | `taskToken.ts:54-81`：HMAC-SHA256、`exp`、`canvasId`/`slot` 精确相等、畸形输入不抛，单测覆盖（`taskToken.test.ts`）。中间件只放行 `resources`/`nodes` 且要求带 `x-task-token`（`server.ts:550-555`），但路由层 `verifyTaskWrite` 只校验 `add/delete/update` 的 id（`:608-624`），**不限制字段**，脚本可用 `add`/`update` 覆盖自己节点的 `uiHtml`/`uiScripts`。伪造 x-task-token 不能绕过：中间件放行后路由会验签，`allowTaskUpload` / `verifyTaskWrite` 都返回 false 就 403。跨画布/跨节点复用：签名绑定 `c`/`n`，测试覆盖（`taskToken.test.ts:13-17`）。 |
| 6 | 视觉节点宿主代发：残留 fetch / EventSource；`fetchApi` 只允许 `/api/`；`ev.source`；回包 | ❌ | `uiData.buildUiBridge` 已无 `fetch(` / `EventSource`（`uiBridge.test.ts:39-46,111-118`）；`hostFetch.ts:295-327` 只接 `/api/`、拒绝 `//` 与 `://`，并有最小权限正则；`UiContent.vue:612-614` 校验 `ev.source === iframe.contentWindow`，`handleProxyRequest` 所有分支 catch 后回 `save-result` / `api-result` / `task-result`（`:730-788`）。问题：`debugDocAssets.ts:43-48` 仍是旧直连 `fetch`（S5）；调试副本窗口无 CSP 且同源（S1b）；`CanvasUI.api` 仍允许整画布覆盖与 assets 写（M7）；`handleProxyRequest` 没剥离页面传的 `origin`/`host` 头（轻微 9）。S4 已在工作树修复并补真跑桥的测试，待提交。 |
| 7 | 前端带令牌：agentApi 统一出口 / cloud-client doFetch / plugin-manager 只写 / 键名统一 | ✅ | `agentApi.ts:208-213` 所有请求走 `request()`，SSE 也走同一个 `fetch`（不是 EventSource，能带自定义头），测试 `agentApi.test.ts:108-142` 覆盖；`cloud-client/api.ts:50-56` 的 `doFetch` 覆盖所有普通请求，`subscribeChanges` 的 EventSource 不加头（`:293-343`）；`plugin-manager/pluginManagerService.ts:508-538,770-818` 只在 install/uninstall/update 写入口加头，GET 不加（测试 `pluginManagerService.test.ts:667-683`）。键名：`canvas-base/src/adminToken.ts:19` 是唯一真源，`plugin-cloud-client/src/api.ts:27` 为了零 import 就地内联，但有 `constants.test.ts:90-100` 对齐；没有残留硬编码在别处。风格库已由 `95125986` 补上（S3）。 |
| 8 | 测试有效性 | ❌ | `audit.test.ts` 的并发 50 条、改内容、删中间行、首行 prev 都是真的会失败的断言；`uploads.test.ts` 新增了流式测试（`countedStream()`），能证明“超限后不再从测试流拉”，但**仍是内存流**，不能证明真实 socket 背压（S2）；`requestTrust.test.ts` 覆盖 Host/Origin/null/cross-site/OPTIONS/`/mcp`，但没有 `port:0` 的真监听；`adminGuard.test.ts` 是“最小中间件”复刻，不是 `server.ts` 的真实接线，`server.ts` 的 `x-task-token` 放行分支没有测试；`hostProxy.test.ts` / `hostProxyApi.test.ts` 用假 fetch，能钉住 URL/头/权限正则，但钉不住 `UiContent.vue` 的消息分支（`onBridgeMessage` 没有组件级测试）；`uiDebug.test.ts` 工作树已补真跑桥的测试（S4，334 条全绿）；`serverPluginsRoute.test.ts` / `npmPluginsRoute.test.ts` 没有“无令牌 403”用例（它们直接建路由，不经过 `server.ts` 的中间件）；风格库已补令牌测试（19 条全绿）。 |

## 我漏掉的场景（方案文档没覆盖，但实现该考虑）

1. **调试页 / 调试副本是同源 HTML**：方案只谈了“上传资源回读”，没把 `resources/debug/` 这条独立白名单算进同源 XSS 面。这是本轮最值得补的威胁模型。
2. **`CanvasUI.api` 的能力边界**：方案说“iframe 永远碰不到网络层”，但宿主代发把“能改整张画布、能下单、能写资产”的能力交给了 iframe。需要明确“沙箱页能做什么”的正面清单，而不是只列“不能调哪些接口”。
3. **审计的“成功写入”**：方案强调 attempt/ok 成对，但实现只记失败。没有成功记录，泄露后无法回答“令牌被用来做了什么”。
4. **审计末行截断**：hash 链只能发现中间删除/修改，删末行仍然自洽。需要外部 head/count 或定期快照。
5. **`port:0` / 反代 / 多主机名**：方案提了端口顺延，但没提 `port:0` 与“Host 白名单在 start 后重算”。`--host 0.0.0.0` 时只信任 `0.0.0.0:port` 与 `localhost:port`，局域网用真实 IP 访问会 403；需要明确是否支持，或启动时枚举网卡地址。
6. **`Origin` 缺失的非浏览器客户端**：`requestTrust` 对无 Origin 的请求只校验 Host。本机 curl / 脚本可以带任意 Host（只要知道白名单）绕过来源边界，最后只靠令牌。这是设计内，但应写进“能防什么/不能防什么”。
7. **`x-task-token` 的泄露面**：令牌在子进程 `ctx.taskToken` 里，脚本可以 `console.log` 或写进产物；10 分钟有效期内可写本节点槽位与节点字段。方案说“限节点”，但没评估“脚本自己泄露令牌”的后果。建议缩短 TTL、绑定 runId、一次性使用。
8. **`readBodyLimited` 的流式读取与背压**：即使改成逐块读，也要在超限时 `reader.cancel()` 并确保连接关闭，否则客户端可以继续慢速发送占住连接。需要真实的慢速/分块测试。
9. **`inlineAsset` 的 PDF**：`.pdf` 在白名单里，`application/pdf` + `sandbox` 会让浏览器内置 PDF 查看器失效或行为异常；需要确认产品是否依赖 PDF 预览。
10. **`/mcp` 的审计与配额**：无令牌 + 无审计，同源 XSS 或本机脚本可以无限调工具；至少要有请求日志与速率限制。

---

审查方法：逐提交 `git show` 看 diff；用 `codegraph status` 确认索引；跑 `pnpm -C packages/cloud-server test`（784 条全绿）作为基线；用 `.scratch/header-probe/check-admin-paths.mjs` 核对清单与前缀（44 行全部命中）；对 `uploads.ts`、`audit.ts`、`requestTrust.ts`、`hostFetch.ts` 逐行读实现，不只看注释。
