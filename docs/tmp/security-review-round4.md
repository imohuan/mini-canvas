# 安全改造第四轮终审（2026-10-20）

审查范围：`c30e7f3c..HEAD`，即 `9b4d89c0`、`ca2dd1d6`、`d4f68f87`、`f6407702`、`773182cf`、`574f63c1` 六个提交。
另核了这六个提交直接依赖的三条既有修复：`d0b86662`（来源边界拒绝写审计）、`6ce5fd31`（过时注释）、
以及审查期间并行落地的 `1e8ae595`（只补了一篇文档的匹配规则说明）。只读审查，除本报告外没有改业务代码。

## 结论

**功能上可以收工，测试要补一处“假绿”。** 六个提交都修对了目标问题，没有引入行为回归：
调试写接口重新受令牌保护、来源边界拒绝只记写请求、调试页 `api`/`cancel` 超时真的释放、
抽函数后的三条分支与原实现逐条等价。

但 `574f63c1` 里那条“防止流程写回组件”的回归线挡不住回归。我临时把整段旧流程写回 `openDebug`，
`uiContentRender.test.ts` 仍然 12/12 全绿；它现在只检查组件里出现过 `openDebugWindow` 这个字符串。
这是一个**测试问题**（严重度中），不影响当前运行行为。另一个是 `f6407702` 的“真实路径”样本里有 3 条并不存在，
测试仍能挡住匹配规则失效，但注释的承诺过强。其余核对项全绿。

## 逐条核对

| # | 提交 / 要验的点 | 结论 | 证据 |
|---|---|---|---|
| 1 | `d4f68f87` 名字前缀的目录边界 | ✅ | `adminAuth.ts:54-60` 在目录判断后加 `if (prefix.endsWith('-')) return pathname.startsWith(prefix)`；`adminAuth.ts:34` 的白名单仍是 `/api/node-ui/debug-`。真跑 `isAdminPath` 得到下面这张表。`debug-accept` / `debug-result` 都命中，`debugfoo` 不命中，`/api/jobsfoo`、`/api/taskfoo` 也不命中（没有被目录边界误伤）。 |
| 2 | `f6407702` 每个前缀都有真实路径 | ⚠️ | 测试确实能挡“匹配规则改坏”：把 `'/api/node-ui/debug-'` 的样本临时改成 `/api/node-ui/debugfoo`，用例红在 `adminAuth.test.ts:192`（`/api/node-ui/debug-: expected false to be true`），恢复后 15/15 绿。但样本里有 3 条不对应任何真实路由：`/api/agent/template/x`（真实是 `/api/agent/template/restore`）、`/api/showcase/install`（真实是 `/api/showcase/echo` 等）、`/api/agent/canvases/x`（真实是 `/api/agent/canvases/:id/sessions`）。`/api/effect-library/settings` **是真实存在的**，由 `plugin-style-library/src/server.ts:80-97` 的 `LIBRARIES` 动态注册，这条样本没问题。 |
| 3 | `d0b86662` 来源边界拒绝记审计 | ✅ | `requestTrust.ts:26-37` 新增 `onReject`，`:40-41` 定义写方法，`:152-154` 只在写方法上调用；`server.ts:575-586` 写 `auth-failed / rejected / reason / origin / host`。真 Hono 链路探针（临时脚本，验完删除）：`POST` + 恶意 Origin → 1 条 `reason=origin-not-trusted`；`DELETE` → 1 条；`GET` → 0 条；`cross-site` → 1 条 `reason=cross-site`；`Origin: null` → 1 条 `reason=opaque-origin`。被拒时中间件直接返回、不进入 `next()`，因此不会再到令牌中间件记第二条；审计共 4 条，正好对应 4 个写请求。`securityWiring.test.ts:164-182` 有真监听用例。 |
| 4 | `6ce5fd31` 两处过时说明 | ✅ | `server.ts:1006-1009` 现在写“插件在拿到 url 之前**不会**生成调试页”；`:1024` 的失败日志写“这一轮没有调试页；画布本身不受影响”。`plugin-node-ui/src/server.ts:1664-1687` 明确“已永久关闭”“没有任何降级路径”，路由无条件 404。与 `server.ts:1006-1025` 的启动顺序（先 `debugOrigin.start()`，失败只 `warn`）一致。 |
| 5 | `773182cf` 调试页 sdk 的 30 秒超时 | ✅ | `debugDocAssets.ts:36-49` 建 `entry.timer`，`:57-58` 回包时 `delete hostPending[...]` 后 `clearTimeout`。`:107` 的 `api`、`:137` 的 `cancel` 传 `timeoutMs: 30000`；`:125-136` 的 `task` 调用只传 `onEvent`，没有超时。用隔离 vm 真跑生成的 sdk：发出 `api/task-cancel/task` 后创建了 2 个 30000ms 定时器（正好 api 与 cancel 各一个）；按 `reqId` 回包后两个 promise 都 fulfilled、定时器表为空、`clearTimeout` 调了 2 次；`task` 故意不回包，5ms 后仍是 waiting，说明它没有定时器。 |
| 6 | `ca2dd1d6` 阅读表补一行 | ✅ | `packages/docs/cloud-server/index.md:64` 新增 `[管理鉴权与请求边界](/cloud-server/admin-auth)`；文件存在（`Test-Path` 为 True）；`packages/docs/.vitepress/config.ts:87` 侧栏已有 `{ text: '管理鉴权', link: '/cloud-server/admin-auth' }`。链接目标与侧栏一致。 |
| 7 | `574f63c1` 抽 `openDebugWindow` | ⚠️ | 行为与原实现逐条等价，详见下面「七、逐行对照」。但 `uiContentRender.test.ts:160-171` 的回归线是假绿（详见「新发现 1」）。 |
| 8 | 文档与代码一致 | ✅ | `admin-auth.md:33-40` 的前缀表与 `adminAuth.ts:20-40` 一致；`:52-56` 的三种形态与 `matchesPrefix` 一致；`:148` 的“不会退回同源”与 `plugin-node-ui/src/server.ts:504-519` 一致；`:165-167` 的“写请求记 auth-failed、读不记”与 `requestTrust.ts:152-154` 一致；`:141-143` 的“同名同形、同一张权限表”与 `UiContent.vue:980-989` 一致；`:212` 的“api/cancel 30 秒、task 不设”与 `debugDocAssets.ts:107,125,137` 一致。整画布覆盖记 `canvas/overwrite` 在 `server.ts:655-680`，`admin-auth.md:164` 描述一致。 |

### 1 的路径矩阵（直接调 `isAdminPath`）

| 路径 | POST | GET | 判断 |
|---|---|---|---|
| `/api/node-ui/debug-` | true | false | 前缀本身也保护；没有同名路由，不算误伤 |
| `/api/node-ui/debug-accept` | true | false | ✅ 必须保护（调试会话回执） |
| `/api/node-ui/debug-result` | true | false | ✅ 必须保护（调试回包） |
| `/api/node-ui/debugfoo` | **false** | false | 不保护。见下面的判断 |
| `/api/jobs` | true | false | ✅ |
| `/api/jobsfoo` | false | false | ✅ 目录边界生效 |
| `/api/task/` | true | false | ✅ 前缀本身 |
| `/api/task`（去尾斜杠） | true | false | ✅ 与原语义一致 |
| `/api/task/call` | true | false | ✅ |
| `/api/taskfoo` | false | false | ✅ |
| `/API/TASK/CALL` / `/api/TASK/CALL` | false | false | 不命中。实际路由是小写；Hono 路径区分大小写，大写路径没有注册 |
| `/api/task/call/` | true | false | 仍命中 |
| `/api/jobs/` | true | false | 仍命中 |
| `/api/task/call;x` | true | false | 仍命中（`;` 被当成路径字符） |
| `/api/jobs;x` | **false** | false | 不命中，也没有同名路由 |
| `/api/task%2Fcall` | false | false | 不命中；Hono 解成 `/api/task/call` 时才会命中，见下面的实测 |
| `/api/jobs%2Ffoo` | false | false | 不命中 |
| `/api/node-ui/debug-accept%2Fx` | true | false | 仍命中（`startsWith`） |
| `/api/node-ui/debug-accept/` | true | false | 仍命中 |
| `/api/node-ui/debug-accept/extra` | true | false | 仍命中（名字前缀的本意） |

**`/api/node-ui/debugfoo` 该不该保护：不用。** 它和 `/api/node-ui/debug-` 之间少了一个连字符，不是现有的调试接口，
后台也没有注册这条路由（`plugin-node-ui/src/server.ts:1396/1427/1485/1508` 只有 `debug-accept`、`debug-events`、
`debug-result`、`debug-poll`）。把它一起保护不会增加安全性，只会在排查 403 时制造噪音；
而 `/api/node-ui/debug-` 这种“名字前缀”必须保持 `startsWith`，否则真的 `debug-accept`/`debug-result` 会被放开——
这是 `d4f68f87` 修的正是那一次回归。

**大小写 / 尾斜杠 / `;` / `%2F` 的真实行为。** 用真实 Hono 应用（与 `server.ts` 同样的 `/api/*` 中间件）打请求：

| 请求 | 状态 | 说明 |
|---|---|---|
| `POST /api/task/call` | 403（令牌） | 正常 |
| `POST /api/task%2Fcall` | **200**（没有令牌） | Hono 的 `getPath` 只解 `%XX`，不会把 `%2F` 变成路径分隔符；`c.req.path` 仍是 `/api/task%2Fcall`，所以 `isAdminPath` 看不到 `/api/task/call`。实际路由也不会命中它（路由按 `/api/task/call` 注册），结果是 404/SPA 兜底，不是“绕过去执行脚本”。 |
| `POST /api/task%2fcall` | 200 | 同上 |
| `POST /api/TASK/CALL` | 200 | Hono 路由区分大小写，大写路径没有注册；不是令牌绕过 |
| `POST /api/task/call/` | 403 | 目录前缀 `startsWith` 生效 |
| `POST /api/jobsfoo` | 200 | 不保护，也没有这条路由 |
| `POST /api/node-ui/debug-accept%2Fextra` | 403 | 名字前缀生效 |

结论：`%2F` 没有被解码成路径分隔符，因此不会出现“中间件看到 A、路由看到 B”的错位；
大写路径也没有对应路由。这里不需要新增保护，但值得在测试里钉一条“未注册路径不会因为编码变体变成受保护/可执行”。

## 七、`574f63c1` 的逐行对照

原实现（`574f63c1^:UiContent.vue` 的 `openDebug`）与抽出的 `debugWindow.ts` 对照：

| 行为 | 原实现 | 现在 | 判断 |
|---|---|---|---|
| 空界面直接返回 | `if (!hasHtml.value) return` | `UiContent.vue:857` 保留 | ✅ 一致 |
| 先同步开窗 | `window.open('about:blank', 'mc-ui-debug-'+id, 'width=960,height=720')` | `UiContent.vue:863-864` 作为 `openWindow` 注入，同步调用 | ✅ 一致 |
| 被拦 | `alert('调试窗口被浏览器拦住了。请允许这个站点弹窗，然后再点一次「调试」。')` | `debugWindow.ts:47-56` 同一句 `DEBUG_BLOCKED_MESSAGE`，且**不请求后台** | ✅ 文案、顺序都一致 |
| 后台失败 | `win.close()`（包 try）→ `debugWin.value = null` → `alert(r.error)` | `debugWindow.ts:60-69` 同样先 close，再 alert；组件 `:872` 在 `!r.ok` 时直接 return，`debugWin` 此时仍未赋值，等价于原来的 `null` | ✅ 等价 |
| 导航 | `win.location.href = r.url`，catch 后提示“调试页打不开（窗口可能被关掉了）。再点一次「调试」试试。” | `debugWindow.ts:72-78` 同一句，同一个 catch | ✅ 一致 |
| `debugWin.value = win` | 在 `window.open` 成功后立刻赋值 | 改为 `openDebugWindow` 成功后（`:874-875`）赋值 | ✅ 成功路径等价。失败路径原来会先赋再清，现在从未赋；两处最终都是 `null`，且失败时不会留下 `debugWin` 指向已关窗口 |
| `pagehide` 监听 | 开窗后立即挂，`setTimeout(0)` 里只认 `win.closed` | `UiContent.vue:876-885` 保留，挂载时机在导航之后（因为导航已在 helper 内完成） | ✅ 等价。`pagehide` 的两次触发（导航 / 关闭）都靠 `closed` 判断，顺序变化不影响 |
| `clearDebugWindow` 调用 | `pagehide` 回调里 | `UiContent.vue:881` 保留 | ✅ 一致 |
| 参数 / 上游重发 | `pushDebugDocs(true)` 总是在开窗后发 | `fetchDocUrl` 里 `pushDebugDocs(true)`，位置在开窗后 | ✅ 一致 |
| 失败返回值 | 无 | 新增 `{ ok:false, reason, message }` | ✅ 只加不改 |

额外确认：`UiContent.vue:1205-1210` 的卸载路径仍然是 `debugWin.value?.close(); debugWin.value = null`，`watch` 里的 `clearDebugWindow` / `debugTimer` 逻辑未动。

## 新发现（按严重度）

### 1（中）`uiContentRender.test.ts` 的回归线是假绿，挡不住“流程写回组件”

`uiContentRender.test.ts:160-171` 断言的是：组件源码里出现 `/debug-docs`、出现 `openDebugWindow`，
以及 `debugWindow.ts` 里出现 `win.location.href = made.url`。它没有断言“组件不再直接导航 / 不再自己写流程”。

我做的临时突变：在 `UiContent.vue` 的 `openDebug` 开头插入一整段旧流程（`window.open` → `pushDebugDocs(true)` →
失败 close → `legacyWin.location.href = legacyMade.url`），然后跑这条测试——**12/12 仍然全绿**。
这说明有人把流程改回组件、同时保留一个未被调用的 `openDebugWindow` 引用，测试也发现不了。
验完已用 `apply_patch` 原样还原，`git status --porcelain` 为空（无脏改动）。

建议（不在本次只读范围）：让这条测试变成行为断言——例如用 `debugWindow.test.ts` 的方式对组件注入依赖，
或在源码层断言 `openDebug:` 函数体内**不再出现** `location.href`、`window.open`、`pushDebugDocs`，
只允许 `openDebugWindow({...})`。

### 2（低）`f6407702` 的样本表有 3 条不是真实路径

`adminAuth.test.ts:174,185,186` 的样本 `/api/agent/template/x`、`/api/showcase/install`、`/api/agent/canvases/x`
与实际路由不符（真实形状分别是 `/api/agent/template/restore`、`/api/showcase/echo` 等、
`/api/agent/canvases/:id/sessions`）。测试仍然只调 `isAdminPath`，所以它能挡“前缀失效”，
但挡不了“前缀对应了一个根本不存在的路由”。这类样本一旦被当成“真实路径”维护，会掩盖路由改名后的保护失效。

建议：把样本换成真实注册形状（`/api/agent/template/restore`、`/api/showcase/echo`、
`/api/agent/canvases/c1/sessions`），并在注释里写清“这是路由形状，不是可执行请求”。

### 3（低）`f6407702` 的注释说“每个前缀都有真实路径”，实际只验证了 `isAdminPath`

这是上一条的同源问题，合并记一笔：测试的价值是“前缀规则不失配”，不是“路由存在”。
两者最好分开：前者用参数化表，后者从 `ctx.routes` / `app.routes` 取真实注册表比对（`taskRoute.test.ts:128-153`
已经用 `s.routes.keys()` 做过类似的事）。

## 已知残留风险

| 风险 | 现状 |
|---|---|
| 装进来的插件 | 完整 fs、可起进程，没有权限沙箱（与上一轮一致） |
| `/mcp` | 只靠 Host / Origin，没有令牌；现在有审计 |
| 资产 / 项目 / 历史 / KV 写接口 | 没有令牌，靠来源边界；被边界拒掉的写请求现在会留 `auth-failed` |
| 同源 XSS | 资源回读有 CSP、调试页已换独立源；其它同源注入点仍需逐个排查 |
| 沙箱页借宿主的能力 | `CanvasUI.api` 仍允许整画布覆盖、下单、写资产 |
| 审计 head 文件 | 与日志同目录，整目录一起被替换时发现不了 |
| 任务脚本 | 可随意出网、可 spawn |
| 调试页 `CanvasUI.task` | 没有超时；宿主整页崩掉时会一直等（文档已写清） |
| `f6407702` 样本表 | 3 条不是真实路由；不影响当前保护，但会误导维护者 |
| `uiContentRender.test.ts` | 回归线是字符串断言，挡不住“流程写回组件” |

## 测试与类型检查（本次实跑）

| 命令 | 结果 |
|---|---|
| `pnpm -C packages/cloud-server test` | **834 / 834**（124 个文件）全绿 |
| `pnpm -C packages/plugins/plugin-node-ui test` | **368 / 368**（32 个文件）全绿 |
| `pnpm -C packages/ui test` | **393 / 393**（46 个文件）全绿 |
| `pnpm -C packages/cloud-server exec tsc --noEmit` | 通过（无输出） |
| `pnpm -C packages/plugins/plugin-node-ui typecheck` | 通过（无输出） |
| `pnpm -C packages/ui typecheck` | 通过（无输出） |

单独重跑：`securityWiring.test.ts` 第一次出现 `ERR_IPC_CHANNEL_CLOSED`（worker 通道断开，不是断言失败），
紧接着单跑 12/12 通过；与 `requestTrust` / `adminAuth` / `adminGuard` 一起跑两轮均 48/48 通过。
`npmRealE2E` 这次两条都通过（真联网打 npm registry）。

## 一句话回答「能不能收工」

**能收工；但建议把 `uiContentRender.test.ts` 那条假绿的回归线补成行为断言，并把 `f6407702` 的 3 条样本换成真实路由形状。**
这两个都是测试/文档层面的问题，六个提交的运行行为本身没有回归。
