# 只读审查：本机自动注入管理令牌（a4bcab20 / f063826c / 004c9505）

## 结论

三个提交的主线是对的：本机直连打开托管页不用再手抄令牌；「只判 Host」那条真实漏洞确实被堵住了（我改回错误实现后，真 socket 用例立刻变红）。**但还剩一个同等级的安全残余**：同机反代若把 `Host` 改写成回环地址（nginx 默认的 `$proxy_host` 就是这样），远程访客仍会拿到完整令牌。我用真实代理复现到了。另外，**「服务端真把令牌交给页面」这条接线目前没有任何测试覆盖**——我把它改成永远不传，49 条相关用例依然全绿。

## 逐条核对

### 1. 令牌注入的判定 ✅（有一个残余风险，见「新发现」S1）

- 两个条件都真的在：先取 TCP 对端并要求是回环，再要求 `Host` 是回环写法，任一不满足就返回 false（`packages/cloud-server/src/static.ts:467-484`）。
- `getConnInfo` 抛错或拿不到地址时**安全失败**（不注入）：`static.ts:469-474`。实测裸 `app.request()` 走不到真实 socket，确实不注入；`uiTokenInjection.test.ts:46-54` 把这一保守行为钉住了。
- IPv4 映射写法认：`::ffff:127.0.0.1` 会先去前缀再比（`static.ts:476`）。Node 监听 `0.0.0.0` 时本机连 `127.0.0.1`，对端实测就是 `127.0.0.1`；监听 `::` 时双栈连 `127.0.0.1` 也对（真连接探针输出：`V6 127.0.0.1 Host=127.0.0.1 inject=true`）。
- `Host` 带端口/不带端口/大写/方括号都处理了：`static.ts:480-483`。实测 `LOCALHOST:端口` 注入、`evil.example:端口` 不注入、`[::1]:端口` 注入、`127.0.0.1`（无端口）注入。
- 反代：`X-Forwarded-For` 完全没参与判断，伪造它不会让远程连接变成「本机」（远端地址仍是 TCP 对端）。**但如果反代改写 Host，两个条件会同时成立**——这是当前设计的盲区，证据见 S1。

### 2. 注入的 HTML 拼接 ⚠️

- 正常令牌（64 位 hex）下安全：`JSON.stringify` 只产出引号包起来的纯 hex，插入点是 `</head>` 前（`static.ts:444-446`、`pickInsertAt` 在 `static.ts:487-493`）。
- **但令牌不是只能来自文件**：`MINI_CANVAS_ADMIN_TOKEN` 和环境变量路径**没有 hex 校验**（`packages/cloud-server/src/adminAuth.ts:118-126`，只有读文件那条路有 `TOKEN_RE`）。我实测把固定令牌设成 `x</script><script>alert(1)</script>`，页面里出来的是
  `<script>window.__MC_ADMIN_TOKEN__="x</script><script>alert(1)</script>"</script>`
  —— 脚本标签被提前闭合，后面的内容成了真脚本。也就是说：**能设置这个环境变量的人，可以往本机打开的管理页注入任意脚本**（该脚本同源，能读走 localStorage 里那份真令牌）。
- 插入点顺序没问题：先 `injectAdminToken` 再 `injectHostFlag`（`static.ts:406`），两者都找同一个 `</head>`，先插的脚本在前、meta 在后；实测输出是「脚本 → meta → `</head>`」。没有重复也不会错位。

### 3. 注入与幂等 ✅（测试有空洞，见第 7 条）

- `index.html` 里已经有 `__MC_ADMIN_TOKEN__` 就直接原样返回（`static.ts:443`），不会插第二份。多次请求结果稳定（每次都从磁盘读同一份 index，再基于它插一次）。
- 行为本身是对的；但现有「幂等」用例在「不注入」的前提下跑（裸 request），见第 7 条，实际没测到这条分支。

### 4. `fillTrustedHosts` 的 0.0.0.0 分支 ✅（有一处多余写法）

- `127.0.0.1:端口` 与 `[::1]:端口` 的写法正确（`packages/cloud-server/src/server.ts:516-518`）。真起服务后 `trust.hosts` 实测为
  `["0.0.0.0:50064","localhost:50064","127.0.0.1:50064","[::1]:50064","::1:50064"]`。
- 第三个 `::1:端口`（去掉方括号）**是多余且无用的**：HTTP `Host` 里 IPv6 必须带方括号，浏览器不会发这种形态；它只多占一个白名单项，不会放宽成别人。`requestTrust` 是整串比较（`packages/cloud-server/src/requestTrust.ts:61-63`），所以不会误伤。
- 不会把不该信任的加进来：只加 `127.0.0.1` 和 `::1` 的**本服务端口**，局域网 IP 仍需显式 `--trusted-host`。
- 只判 `opts.hostname === '0.0.0.0' || '::'`，与 `--host` 的实际取值一致（`packages/cloud-server/src/cli.ts:213`）。

### 5. 前端消费 ⚠️

- 时机对：`main.ts:84` 在 `exposeSharedGlobals()`（88 行）和 `createApp(...).mount()`（102 行）之前执行，插件第一次发请求时 localStorage 里已经有值。
- **会覆盖用户手动填的值**：只要本机打开托管页，就会无条件 `localStorage.setItem('mc_admin_token', 注入值)`（`packages/ui/src/main.ts:71-74`），不比较旧值。如果用户手填的是另一套后端的令牌，会被静默替换。这符合「同机就是这台后台」的假设，但换端口/多实例场景会让人困惑。
- `localStorage` 被禁用：写失败被 `catch` 吞掉，应用照常启动，之后写请求 403、提示去手填（但手填也存不进去）——属于可接受的降级。
- `delete` 失败（属性不可配置）：有独立 `try/catch`，不会中断启动；但令牌会留在全局变量上（见下条）。
- XSS 面：注入脚本在 `<head>` 里、早于所有插件脚本（真产物 `packages/ui/dist/index.html` 的 module script 也在 head 后部），它执行时只写 localStorage 并立即删全局；插件脚本那时读不到全局。**但同源 XSS 本来就能直接读 localStorage 的 `mc_admin_token`**，删全局只减少了「已知全局名」这一个入口，不是安全边界。真正的风险是第 2 条：能控制注入字符串就能直接落一段同源脚本。

### 6. 403 文案 ⚠️

- 读/写在 `packages/plugins/plugin-cloud-client/src/api.ts:62-72` 分开了，并且各调用点标了 GET/WRITE：`fetchActions:118`、`getJob:155`、`fetchHistory:187`、`readCanvas:205` 是 GET；`createJob:145`、`postResource:255`、`patchNodes:286`、`patchEdges:296`、`putView:306`、`replaceCanvas:316` 是写。
- 漏掉的 403：
  - `activeJob`（`api.ts:161-169`）把任何非 2xx 都静默当成「没有在跑的任务」，403 完全不提示；
  - `cancelJob`（`api.ts:172-174`）**根本不看状态码**，403 会被当成成功；
  - `subscribeChanges` 走 `EventSource`（`api.ts:327-377`），不能带头也没有状态码，403 只会落成一句「实时通道断开，浏览器会自动重连」——会无限重连、永远连不上，且不提示来源问题。这里「SSE 订阅」确实是漏的。
- 文案本身：写路径说「去设置 → 插件 → 管理令牌」对**缺令牌**是对的；但它把**所有**写 403 都归因为缺令牌，而来源边界拒绝、任务令牌越权、业务拒绝也会是 403，仍可能误导。读路径的文案（换端口/域名、`--trusted-host`/`--trusted-origin`）与 `requestTrust.ts:60-90` 的实际拒绝原因一致，可用。
- 同一句话还说「粘贴后台启动日志**或** `<数据目录>/admin-token`」；如果后台是用 `MINI_CANVAS_ADMIN_TOKEN` 启动的，这个文件可能不存在（`adminAuth.ts:118-126` 不落文件）。属于小误导。

### 7. 测试有效性 ⚠️（两个真空洞，都已动手验证）

| 实验 | 结果 |
|---|---|
| 把 `isLoopbackRequest` 改回「只看 Host」 | `uiTokenRealConn.test.ts` 的「远程连接 + 伪造 Host」**变红**；`uiTokenInjection.test.ts` 的「裸 request 不注入」也变红。**能挡回归** |
| 删掉 `fillTrustedHosts` 的 0.0.0.0 分支 | `securityWiring.test.ts` 的「127.0.0.1 在白名单」**变红**。**能挡回归** |
| 把 `server.ts:945` 的 `() => (adminAuthEnabled ? adminAuth.token : undefined)` 改成 `() => undefined` | 相关 4 个文件（`uiTokenRealConn` / `uiTokenInjection` / `securityWiring` / `routes`）**49 条仍全绿**。**挡不住**：没有任何用例经过真实的 `createCloudServer` 再断言首页含令牌 |
| 只改 `uiTokenRealConn` 的 Host 列表等细节 | 见上，说明该文件是当前唯一真正覆盖「本机注入」的地方 |

- `uiTokenInjection.test.ts` 现在断言的是「**不注入**」（`uiTokenInjection.test.ts:46-54`），它只覆盖保守侧；「本机注入」完全靠 `uiTokenRealConn.test.ts:62-66` 一条撑着。这个分工本身合理，但**没有任何用例把「server.ts 传 token」和「static.ts 注入」接起来**，所以第 7 条的空洞是真实存在的。
- 「幂等」那条（`uiTokenInjection.test.ts:75-84`）在「不注入」前提下跑，它的 `hits > 0` 来自夹具里手写的那份；即使 `injectAdminToken` 的幂等分支坏了也不会红。
- `securityWiring.test.ts:59-80` 只断言 `127.0.0.1` 与 `localhost`，**没有断言 `[::1]:端口`**，所以第 4 条里那处多余写法不会被发现（也无害）。
- `uiTokenRealConn.test.ts:86-100` 在「没有非回环网卡」时用 `expect(true).toBe(true)` 静默跳过——CI 沙箱里会假装通过。本机有网卡，实测这条真跑了。

### 8. 文档一致性 ⚠️

`packages/docs/cloud-server/admin-auth.md:24-37` 与代码基本一致：两个条件、为什么、代价、远程不注都写对了；`73-78` 的 0.0.0.0 白名单也一致。

不一致/缺失：

- 文档说「两个都满足才给」，但没写「反代会改写 Host」这个前提（见 S1），会让读者以为「同机反代一定安全」。
- `admin-auth.md:25` 说「然后立刻删掉那个全局变量」——代码是 `delete`，但属性不可配置时删不掉，文档没提这个降级（影响很小）。
- 文档没提「`MINI_CANVAS_ADMIN_TOKEN` 不做 hex 校验、可含 `</script>`」这一条（见 S2），也没提「令牌会被覆盖用户手填值」。

## 新发现（按严重度）

### S1（严重）同机反代改写 Host 时，远程访客仍能拿到令牌

**触发条件**：后台绑 `127.0.0.1`，同机 nginx 反代到它，且反代把 `Host` 改写成本服务的回环地址。

nginx 默认 `proxy_set_header Host $proxy_host;` 正是这样：`$proxy_host` 是 `proxy_pass` 里的主机名，写 `proxy_pass http://127.0.0.1:8865` 时它就是 `127.0.0.1:8865`。此时：

- 第 1 条「TCP 对端是回环」成立（nginx 与服务同机）；
- 第 2 条「Host 是回环」也成立（被 nginx 改写成了回环）。

两个条件同时满足，但请求来自公网。审查里用真实 HTTP 代理复现：

```
LAN 198.18.0.1
PROXY remote=198.18.0.1 forwardedHost=127.0.0.1 leaksToken=true
PROXY remote=198.18.0.1 forwardedHost=evil.example leaksToken=false
SAME-HOST PROXY Host=public.example leaksToken=true
```

（探针是一次性脚本，用 `uiRoutes` + 真 socket；验完已删，不改业务代码。）

**影响**：只要有人这样部署，公网访客打开首页就能拿到管理令牌，等于管理面全开。这不是理论问题——这是 nginx 最常见的默认配置。

**建议**：至少二选一：

1. 反代场景要求显式声明（例如设置 `MINI_CANVAS_TRUST_PROXY=1` 时**永不注入**，或要求 `X-Forwarded-For` 为空才注入）；
2. 注入时再校验「没有转发头」（`x-forwarded-for` / `x-real-ip` / `forwarded` 任一存在就不注入），并把「本机直连」文档写清楚。

**测试建议**：在 `uiTokenRealConn.test.ts` 加一条「对端是回环 + Host 是回环 + 带 `x-forwarded-for`」应不注入（按上面的方案 2）。

### S2（中）环境变量令牌未校验，含 `</script>` 会变成页面脚本

`adminAuth.ts:118-126` 对 `fixedToken` 不校验格式；`static.ts:444` 直接 `JSON.stringify` 拼进 `<script>`。实测输出：

```
<script>window.__MC_ADMIN_TOKEN__="x</script><script>alert(1)</script>"</script>
```

能设置环境变量的人本来就能改后台配置，所以不算「越权」；但它把「部署配置」升级成了「同源脚本执行」，而且页面里还有真令牌，脚本能读走。修法很简单：注入前 escape 成 `\u003c/script>` 之类，或对固定令牌也走 `TOKEN_RE` 校验（后者会改变现有「自定义短令牌」用法，需确认）。

### S3（中）「服务端接线」无测试，且当前实现只能靠真机发现

把 `server.ts:945` 改成永远不传令牌，49 条相关用例全绿（见第 7 条）。这意味着以后有人重构 `uiRoutes` 的调用、或把 token 参数接错，测试不会报警。建议在 `routes.test.ts` 或新的真连接用例里，用 `createCloudServer({ uiDist, hostname: '0.0.0.0', adminAuth: true })` 真监听，断言首页含 `srv.adminToken`。

### S4（低）`cancelJob` 吞 403、`activeJob` 静默、SSE 无限重连

`api.ts:172-174` 完全不看 `res.ok`，403 被当成成功；`api.ts:161-169` 把 403 当成「没有活动任务」；`subscribeChanges` 没有 403 文案路径。用户看到的是「点了取消没反应 / 实时更新不生效」，而不是「令牌/来源有问题」。

### S5（低）多余的白名单项 `::1:端口`

`server.ts:517` 的第三项永远不会被浏览器发送，属无害冗余；删掉能少一处困惑，并补一条 `[::1]` 断言。

## 已知残余风险

- **反代改写 Host**（S1）：当前设计挡不住，需要部署侧配置或额外判定。
- **自定义本机域名**（如 `mycanvas.local`）：按设计不注入，需手填一次；文档已写明。
- **同源 XSS**：注入不改变这一面——同源脚本本来就能读 `localStorage` 里的令牌；全局变量删除只减少一个入口。
- **令牌覆盖用户手填值**：同机打开托管页会覆盖 `mc_admin_token`；多后端/多端口场景需人工重填。
- **`localStorage` 被禁用**：注入值存不进去，写请求 403；提示仍会引导去手填（同样存不进去）。
- **Windows ACL**：令牌文件不收紧 ACL（文档已写明）。
- **测试环境**：`uiTokenRealConn` 的「远程连接」一条在没有非回环网卡时会静默跳过；本机实测有网卡、是真跑。
- **测试超时**：`queueScheduler` / `pluginWatch` 全量并行偶发 `waitFor` 超时，单跑通过（已知）。

## 跑过的验证

| 命令 | 结果 |
|---|---|
| `pnpm -C packages/cloud-server test` | 126 文件 / **842 通过** |
| `pnpm -C packages/plugins/plugin-cloud-client test` | 13 文件 / **128 通过** |
| `pnpm -C packages/ui test` | 48 文件 / **398 通过** |
| `pnpm -C packages/cloud-server exec tsc --noEmit` | 通过（无输出） |
| `pnpm -C packages/ui typecheck` | 通过 |
| `pnpm -C packages/plugins/plugin-cloud-client typecheck` | 通过 |
| 对照实验：只判 Host | `uiTokenRealConn` / `uiTokenInjection` 共 2 条变红，恢复后 7/7 绿 |
| 对照实验：删 0.0.0.0 白名单分支 | `securityWiring` 1 条变红，恢复后 13/13 绿 |
| 对照实验：`server.ts` 不传 token | 49 条仍全绿（→ S3） |
| 真连接探针 | 本机注入 / 远程伪造 Host 不注入 / 同机反代改写 Host **泄露** / `::1:端口` 不被误认 |
| 接线探针 | 真起 `createCloudServer({hostname:'0.0.0.0'})`，首页 `INJECTED true`，白名单含回环 |

审查过程只建过一次性探针；业务代码的对照改动已全部恢复，`git status` 下 `packages/` 无改动。
