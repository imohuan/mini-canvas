# 安全改造第三轮验收审查（2026-10-20）

审查范围：`0a84d40f..d0b86662`（12 个提交）。只读审查，除本报告外没有改任何文件。
服务实跑：`node packages/cloud-server/dist/cli.js serve --port 8971 --dir .scratch/review-r3 --no-open`，
调试源 `127.0.0.1:56782`（第二次起服务是 `:61950`）。

## 结论

**第二轮的三条必修（N1 / N2 / N3）和四条轻微（N4 / N5 / N6 / STATUS 标记）全部真的改好了，可以收工。**
每一条我都在真机上重放过，不是看提交信息。

这一轮我还照出一个新的、和审计有关的口子：**被来源边界（Host / Origin）拒掉的写请求，一条审计都不记**。
它在我审到一半时由并行会话以 `d0b86662` 修掉了 —— 那条提交的信息里写的正是这份报告的结论。
我重新 `bundle`、重启服务、用真请求验过它确实生效（见「新发现 1」），不是照抄提交信息。

## 逐条核对

| # | 清单项 | 结论 | 证据 |
|---|---|---|---|
| N1 | 调试源没起来时不生成调试页、同源通道永远 404、MCP 与画布按钮都要说清 | ✅ | `plugin-node-ui/src/server.ts:504-519` 直接 `return { ok:false, error: '调试源没起来…' }`，没有降级分支；同源回读路由 `:1674-1687` 无条件 404（错误文案写「已永久关闭」）。真机：MCP 工具在未注入 `debugOrigin` 时返回上面那段人话（`.scratch/r3-mcp-nodebug.mjs` 实跑输出）。画布按钮 `UiContent.vue:884` 是 `window.alert(r.error)` —— **不是** console.warn。真机 `GET /api/canvases/r3probe/resources/debug/debug-n1.html?x=1` → **404**，尽管文件确实在磁盘上。 |
| N2 | 整画布覆盖与 `/view` 记 attempt + ok/rejected | ✅ | `server.ts:635-663` 是只认 PUT 的独立中间件，`isAdminPath('PUT', …)` 为真时跳过（不会与 ①.3 重复记）。真机连发两次 PUT：`/api/canvases/r3probe` 与 `/api/canvases/r3probe/view` 各自 `attempt` + `ok`，`token:"missing"`；给一条不存在的 PUT 路由 → `attempt` + `rejected(http-404)`。 |
| N3 | 调试页的 `CanvasUI.api / task / cancel` 能用 | ✅ | sdk 三个方法在 `debugDocAssets.ts:89 / 111 / 125`，都走 `hostCall`。我用真调试页的 sdk（从 56782 拉的）在仿 DOM 里跑了一整轮：api 回了 `status 200 / headers.get / json / text / arrayBuffer`，404 时 `ok:false` 但不 reject；task 收到 `log` + `progress` 事件后 resolve（`r.ok`/`runId`/`result` 都在），失败时 reject 成 `脚本炸了`；cancel 拿到 `cancelled`；陌生 `reqId` 不抛。另外用浏览器真跑了跨 realm 场景（宿主 realm 的 `ArrayBuffer` 结构化克隆进 iframe）：`TextDecoder` 正常解出 JSON。 |
| N4 | 卸载 / 更新记对 action | ✅ | `adminAuth.ts:79-88` 按 `/uninstall`、`/update` 分流。真机 `POST /api/server-plugins/uninstall`（不存在的 id）→ 审计里是 `server-plugin/uninstall` 的 `attempt` + `rejected(not-found)`，中间件那条也是同一个 action，**没有**再出现 `install`。npm 三个 action 在 `routes/npmPlugins.ts:374 / 397 / 448`，按路由写死。 |
| N5 | 调试源校验 Host，正常访问不受影响 | ✅ | `debugOrigin.ts:107-113` 先看 Host，`allowedHosts` 在 listen 回调里填（`127.0.0.1:<port>` / `localhost:<port>` / 配置的 hostname）。真机：`127.0.0.1` → 200，`localhost` → 200，`-H 'Host: evil.example'` → **403**。主服务的正常读写没受影响（下面全部真机请求都 200/403 符合预期）。 |
| N6 | 文档的审计一节与代码一致 | ✅（修完后） | 文档写的是「受管理令牌保护的写入口成对记录；整画布覆盖也记；两类不记（短令牌快捷放行后被路由拒、资产/项目/历史/KV）」。这三条都对（真机：伪造 `x-task-token` → 403，`audit.log` 22 → 22 行，一条没多）。审查当时**还漏了一类**：被 Host / Origin 边界拒掉的写请求也不记 —— 在我写这份报告时由 `d0b86662` 补上，文档同步加了这一段（`admin-auth.md:160-162`）。修完真机复验：两条被拒的写各留一条 `auth-failed/rejected`（`reason` 分别是 `origin-not-trusted` / `host-not-trusted`），被拒的读不留痕。 |
| STATUS | 冲突标记清干净、没误删正文 | ✅ | `rg '<<<<<<<\|=======\|>>>>>>>' docs/STATUS.md` 无命中。逐行做多重集比对（`78ea515f~1` vs 当前）：共删 33 行 = 9 个标记 + 21 个空行 + 2 行工具截断残留（`Warning: truncated output (original token count: 170513)`、`Total output lines: 7252`）；新增 1 行，是把被截断的表格补全（`.aw-btn-upload` / `.aw-file` / `onPickFile` / `openPicker` → 换素材改走顶栏）。补全内容与代码一致：`AudioContent.vue` 里确实已经没有 `aw-btn-upload` / `openPicker`，入口在 `AudioTopToolbar.vue:63-84`。**没有误删正文。** |

## 额外盯着的地方

### scopedOrigins 的窄通道：绕不过去

只放行 `<调试源> → POST /api/canvases/*/resources`。我按各种路径形状打了一遍，**全部 403**：

| 形状 | 结果 |
|---|---|
| `/api/Canvases/r3probe/resources`（大写） | 403 |
| `/api/./canvases/r3probe/resources` | 403 |
| `/api//canvases/r3probe/resources`（`//`） | 403 |
| `/api/canvases/x/../../kv/resources` | 403 |
| `/api/canvases/r3probe%2f..%2f..%2fkv/resources`（`%2F`） | 403 |
| `/api/canvases/r3probe/resources/..%2Fnodes` | 403 |
| `/api/canvases/r3probe/resources;x=1`（`;`） | 403 |
| `/api/canvases/r3probe/resources/`（尾斜杠） | 403 |
| `DELETE .../resources?slot=n1` | 404（窄通道不认 DELETE，压根没有该路由） |
| `/api/kv/...`、`/api/canvases/:id/nodes`、`/api/task/call`、`/api/server-plugins/install` | 403 |
| `POST .../resources?slot=n1`（形状对、没令牌） | 403「需要管理令牌」—— 说明确实走到了令牌那道关 |

`matchPath`（`requestTrust.ts:87-101`）是逐段全等比，`*` 只吃一段且不吃空段，路径里的编码在 Hono 那边已经解开了。
另外 `Origin` 写成大写（`HTTP://127.0.0.1:56782`）也被拒 —— 归一之后与白名单不相等，行为正确（宁严不漏）。

### 审计中间件读 `c.res.status`

- 404：记到了，且带状态码（`rejected / http-404`），见 N2 的第三条实测。
- 重定向：没有现成的 3xx 写入口可测；按代码 `status >= 200 && status < 400` 会记 `ok`。
- 流式（`/mcp` 的 SSE）：GET 开流时 `attempt` 与 `ok` **在响应头返回那一瞬间就都写了**，不是等流关闭。
  实测：`curl -N -m 3` 收 3 秒后断开，审计里两条时间戳相差 5ms。这对「谁开了 SSE」够用，
  但它记的是「建立成功」，不是「用了多久 / 传了什么」。文档没承诺后者，不算 bug，这里只记一笔。

### 将来加 `PUT /api/canvases/:id/resources` 会不会重复记

不会。①.4 的条件是 `isAdminPath('PUT', path)` 为假才记；`/api/canvases/` 在 `ADMIN_POST_ONLY_PREFIXES` 里
只对 POST 生效，所以 `PUT .../resources` 现在会走「不要令牌 + 记 canvas/overwrite」这条。
上面真机试过：`PUT /api/canvases/r3probe/resources` → 404，审计里只有**一条** attempt + 一条 rejected，没有重复。

### 调试页 sdk 的 pending 泄漏

`hostCall` 把 promise 存进 `hostPending[reqId]`，只有收到回包才 `delete`。**宿主不回包时不会清**，
也没有超时。表现是那个 promise 永久悬挂（页面侧 `await` 永远不返回），但 `hostPending` 只是几个闭包，
不是 DOM 监听器，不会阻止页面卸载。`opener` 关掉之后 `tell()` 里 `window.opener` 变 null，
已被 `if (window.opener)` 挡住，不会抛；回包监听器里 `e.source !== window.opener` 也不抛。
结论：**没有未捕获异常，但也没有超时**。属轻微（调试页自己写的代码，卡住时用户能看到），可留。

### `UiContent.vue` 的 origin 校验会不会挡掉正常消息

不会。我在浏览器里真跑了 `sandbox="allow-scripts"` + `srcdoc`：子页 `location.origin` 是 `"null"`，
父页收到的 `ev.origin` 也是 `"null"`，`ev.source === iframe.contentWindow` 为 true。
所以 `UiContent.vue:623` 的 `if (ev.origin && ev.origin !== 'null' && ev.origin === window.location.origin) return`
对正常沙箱消息**不生效**（放行）；只有「帧被导航到同源页面」时才拒。

## 新发现

### 1（曾建议补，已由 `d0b86662` 修掉）来源边界拒掉的写请求不留审计

`requestTrust.ts:131` 在 Host / Origin 不对时直接返回 403，此时 ①.3（令牌）与 ①.4（整画布覆盖）都还没跑，
所以一条都不会记。实测：跨源页打 `POST /api/canvas/nodes` / `POST /api/server-plugins/install`，
两次都 403，`audit.log` 行数不变。

影响：能回答「谁成功改了什么」，答不出「谁在试」。审计的价值一半在后一半。

**现在的状态（我复验过）**：`requestTrust.ts:28-38` 新增 `onReject` 回调，`:145-156` 只在写方法上触发；
`server.ts:568-587` 接线写 `auth-failed / rejected / reason / origin / host`。真机重起服务后：

| 请求 | 结果 | 审计 |
|---|---|---|
| `POST /api/canvas/nodes` + `Origin: evil.example` | 403 | 多 1 条，`reason: origin-not-trusted` |
| `POST /api/canvas/nodes` + `Host: evil.example` | 403 | 多 1 条，`reason: host-not-trusted` |
| `GET /api/canvases` + `Origin: evil.example` | 403 | **不多**（按设计不记读） |

`securityWiring.test.ts:158-181` 有对应用例（写留痕、读不留）。

### 2（提示）`server.ts:1005` 的日志还写着「调试页退回后台同源」

调试源启动失败时打的是 `'独立调试源启动失败（调试页退回后台同源，仅本机临时用）'`。
这句话现在是**错的**：降级路径已经删了，行为是「不生成调试页、明确报错」。
`server.ts:988-989` 的注释同样还提「退回后台同源」。只改文案，不动逻辑。

### 3（提示）`plugin-node-ui/src/server.ts:1671` 的注释也还留着降级说法

「它只保留给『老宿主没注入 debugOrigin』的降级场景」—— 实际已经没有这个场景了（无条件 404）。
与上一条同类，属文档债。

## 仍然留着的已知风险（与上一版一致，未新增）

| 风险 | 现状 |
|---|---|
| 装进来的插件 | 完整 fs、可起进程，没有权限沙箱 |
| `/mcp` | 只靠 Host / Origin，没有令牌；现在有审计（attempt + 结局） |
| 资产 / 项目 / 历史 / KV 写接口 | 没有令牌，靠来源边界；被边界拒掉的写请求现在会留 `auth-failed`（`d0b86662`） |
| 同源 XSS | 资源回读有 CSP、调试页换了独立源；其它同源注入点没逐个排查 |
| 沙箱页借宿主的能力 | `CanvasUI.api` 仍允许整画布覆盖 / 下单 / 写资产 |
| 审计 head 文件 | 与日志同目录，整目录被替换发现不了 |
| 任务脚本 | 可随意出网、可 spawn |
| 调试页 sdk | `hostCall` 没有超时，宿主不回包时 promise 永久悬挂（不泄漏监听器、不抛异常） |

## 测试与类型检查（本次实跑）

| 命令 | 结果 |
|---|---|
| `pnpm -C packages/cloud-server test` | 第一次 829/832（3 挂），重跑 **832 / 832**（124 个文件）全绿 |
| `pnpm -C packages/plugins/plugin-node-ui test` | **363 / 363**（31 个文件）全绿 |
| `pnpm -C packages/ui test` | **393 / 393**（46 个文件）全绿 |
| `pnpm -C packages/cloud-server exec tsc --noEmit` | 通过 |
| `pnpm -C packages/plugins/plugin-node-ui typecheck` | 通过 |
| `pnpm -C packages/ui typecheck` | 通过 |

要如实说一件事：`cloud-server` 那次全量跑的 3 条失败都在 `npmRealE2E.test.ts`（**真联网打 npm registry**），
断言是「未发布的包 → 404」，实际拿到 502 —— 外面网络抖动/限流就会这样，与本次改动无关。
紧接着重跑全绿，另外单独跑这条文件也通过。上一版报告里提到的 `uploadStreamReal` 偶发
「`getReader` 不是函数」这次**没有再出现**。

## 一句话回答「能不能收工」

**能。** 上一轮点名的三颗钉子（调试页降级、整画布覆盖不记账、调试页缺 `task/api`）都真拔掉了，
四条轻微也修对了，`STATUS.md` 的冲突标记清得干净且没伤到正文。
这一轮新照出来的审计缺口已经在 `d0b86662` 里补上并经我真机复验；
只剩两处过时注释（`server.ts:1005` 与 `plugin-node-ui/src/server.ts:1671`）还在说「退回后台同源」——
那是文案债，不影响行为，下一次顺手改掉即可。
