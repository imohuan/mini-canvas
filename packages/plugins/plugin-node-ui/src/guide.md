【可视化节点（type = "ui"）—— 给 AI 的作业手册】

可视化节点 = 画布上的一块空面板，里面显示你写的一段 HTML。
它本身什么都不会；显示什么、点了干什么，全由这段 HTML 决定。

这份手册是**稳定契约**。要问"有哪些脚本、有哪些动作"，用运行时接口
（canvas_fn_list / canvas_ui_guide 末尾的实时清单），不要翻源码、不要靠猜。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 一、先记住三句话（后面全是它们的展开）

1. **界面住在隔离的小窗口里（沙箱 iframe，不透明源）。**
   能显示图、能请求宿主代发、能调后台脚本；
   **不能读图片像素**、**不能自己 fetch 后台**、看不到外面的登录状态。

2. **"上游"和"产物"是两条不同的路，别混。**
   · 上游 = 别的节点连进来的素材，**只读**（`__CANVAS_UPSTREAM__`）。
   · 产物 = 这个节点算出来交给下游的东西，**只走 `save`**
     （界面里 `CanvasUI.save`、脚本里 `ctx.save`）。
     产物写进节点之后，下游读到的就是它 —— 见第五节那张表。

3. **不要用 shell 调后台接口。**
   `curl` / PowerShell 打 `/api/task/call` 一定被拦（它要浏览器的登录 cookie），
   返回"需要登录"。**这是设计**，不是坏了。
   要跑脚本就用 MCP 工具 `canvas_fn_call`；要看画布就用 `canvas_get`。
   你手上本来就没有那把钥匙，绕是绕不过去的。

### 几个特别容易想错的地方（2026-11-27 复盘，一整天就耗在这些上）

| 你以为 | 其实是 |
| --- | --- |
| "沙箱里用 crossOrigin 就能读像素" | 读不了。加不加都一样，画布被污染。像素活全归后台脚本。 |
| "403 是登录没配好" | 界面侧 403 通常只有两件事：脚本没声明、脚本名写错。shell 侧 403 是设计如此。 |
| "产物落盘了，节点自然就有输出" | 还要有 `uiOutputType` 才有右边那个口，否则接不出去。 |
| "我手写节点字段也能让下游读到" | 会缺类型、缺引用，下次保存还被清掉。只有 `save` 那条路是完整的。 |
| "读一下脚本源码就知道怎么调" | 源码是实现，今天对明天就错。看 `canvas_fn_info` 的说明书。 |
| "先把 base64 拼进参数传给脚本" | 几万字符必然出错。让脚本自己读上游，或先落成文件。 |
| "调不通就多试几个接口" | 每个接口的边界是固定的（见第十节），试不出来。看手册里那张"做不到"的表。 |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 二、数据是怎么流的（先看懂这张图）

    上游节点（图片 / 视频 / 音频 / 文本）
         │  用户拉的那根连线
         ▼
    ┌────────────────────────────────────────────┐
    │  可视化节点（iframe，沙箱）                  │
    │                                            │
    │  读上游：__CANVAS_UPSTREAM__  ← 只读        │
    │  读参数：__CANVAS_INPUTS__    ← 用户填的     │
    │  交参数：CanvasUI.setInputs()  → 变参数     │
    │  交产物：CanvasUI.save()       → 落盘       │
    └───────────────────────┬────────────────────┘
                            │  save
                            ▼
        槽位文件  slot-<本节点id>.<后缀>   （固定名字，覆盖）
        ＋ 节点字段：uiOutputUrl / uiOutputType / resourceId / imageUrl…
                            │
                            ▼
                    下游节点（读到的还是"上游素材"那个形状）

一句话：**上游从连线来，产物往节点里写，下游读的还是上游素材。**
同一个形状，全程只有一套。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 三、输入：上游素材

`window.__CANVAS_UPSTREAM__` 是一个数组，一条一个：

| 字段 | 有没有 | 是什么 |
| --- | --- | --- |
| `refName` | 有 | 引用名（图片1 / 文本2…），用来在界面上标注 |
| `kind` | 有 | image / video / audio / text |
| `url` | 通常有 | 能直接放进 src 的地址，形如 `/api/canvases/<画布id>/resources/<名字>` |
| `resourceId` | 通常有 | 长期引用 `<画布id>/<名字>`（保存时只留它，地址是它的投影） |
| `value` | 文本才有 | 正文内容 |
| `nodeId` | 有 | 这条素材来自哪个节点 |

`CanvasUI.onChange(function (d) { … })` 的 `d.upstream` 是同一份东西。

**三条必须做到的事：**

1. **上游只认连线。** 线一删，数组立刻变成 `[]`，宿主会推送并触发 onChange。
   所以不要把它拷进变量后再也不看 —— 现读全局，或在 onChange 里按新值重画。
   （曾经出过"一根线都没连，界面还写着上游 图片 1"：那是旧快照，已修。
     你自己也别再造一份快照。）

2. **`url` 可以直接显示，但读不了像素。**
   `<img src="…">` 没问题；
   `canvas.drawImage` + `getImageData`，或 `toDataURL` / `toBlob` 会失败 ——
   图来自另一个源，画布被"污染"（真机报 SecurityError）。
   **加 `crossOrigin="anonymous"` 也没用**，只会换一个更难懂的错。
   要像素 → 交给后台脚本（见第六节）。

3. **没有上游是正常状态，不是错误。** 先把"无上游"画出来，别白屏。

## 四、输入：参数

`window.__CANVAS_INPUTS__` 是"这个节点的参数"的合并结果：
用户填的、以及你在界面里交上去的，都在这里。

- 交参数：`CanvasUI.setInputs({ 键: 值 })`
  什么时候交：**一次操作完成时**（一笔画完、一个配置改完），别每帧交，也别交大数组。
  它进撤销栈 —— 交一次，用户按一次撤销就退回那之前。
- 刷新恢复：页面重开时读 `__CANVAS_INPUTS__` 把界面画回去，不用另存一套。
- 参数要**小**（几 KB 级）。笔迹那种，存点、别存整张图的像素。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 五、输出：产物怎么落、下游怎么拿（最容易错的一段）

### 5.1 只有两个入口

| 谁算出来的 | 用哪个 | 长相 |
| --- | --- | --- |
| 界面里算出来的（用户画的、canvas 导出的） | `CanvasUI.save(字节或 Blob, "名字.png")` | 返回地址；宿主负责落盘 |
| 后台脚本算出来的（转码、解码、批处理） | `await ctx.save(字节, "名字.png")` | 返回 `{ ok, url, bytes }` |

`save` 的第二个参数决定**类型**（按后缀认）：`a.png` / `a.mp4` / `a.mp3` / `a.txt`。
不传后缀默认当图片。

### 5.2 落一次，会一起写这些东西（别再自己补）

| 写什么 | 变成什么 |
| --- | --- |
| 槽位文件 | `/api/canvases/<画布id>/resources/slot-<本节点id>.<后缀>`（固定名字，覆盖旧的） |
| `uiOutputUrl` | 产物地址（不带 ?v=） |
| `uiOutputType` | image / video / audio / text —— **右边有没有输出口，就看它** |
| `resourceId` | `<画布id>/slot-<本节点id>.<后缀>`（长期引用） |
| `imageUrl` / `videoUrl` / `audioUrl` | 按后缀写其中一个，带 ?v= 版本号 |
| `text` | 文本产物写**正文**，不是地址 |

这六样是**一次写的**。你手动补一半，就会出现"文件在、下游读不到"。

### 5.3 输出端口是怎么来的

`data.uiOutputType` 是**节点自己的配置**，不是按类型写死的：
image 有图片口、video 有视频口…；**空串 / 不认识的词 = 没有输出口**，
右边不画口、也不许连出。

- 产物一落地会**自动补**上（按后缀）。
- 也可以主动声明：`CanvasUI.setOutputType("image")`。
- 没端口就接不到下游 —— 这是最常见的"下游收不到东西"。

### 5.4 下游到底读到什么

下游界面看到的 `__CANVAS_UPSTREAM__` 里，那一条就是你这次产物的
`url` + `resourceId`，形状跟"连进来一张图"完全一样。
下游不需要知道它来自哪个节点。

### 5.5 产物在、下游却读不到：先按这三条查

1. **节点字段写全了吗？**（最常见）
   槽位文件有了，但节点上只有地址、没有 `uiOutputType`；或者你手写了一个
   `imageUrl` 却没写 `uiOutputUrl` / `resourceId`。
   → **修法：再跑一次那个产出**（界面点一次生成，或 `canvas_fn_call` 再调一次，
   让脚本走 `ctx.save`）。它会按 5.2 那张表一次写全。
   **不要自己往节点里拼这些字段**：手写的没有类型、没有引用，右边没端口，
   下游照样接不上，而且下次保存会被清理掉。（2026-11-27 真机就是这么绕了一百多轮。）

2. **右边有输出口吗？** 没有 `uiOutputType` 就不画口，也就连不出线。
   有口但**类型对不上**（比如你产出的是视频，下游只收图片），连线会被自动断开。

3. **下游读的是同一个全局吗？** 下游要读 `__CANVAS_UPSTREAM__` 或 `d.upstream`，
   不能自己编一份假数据。

### 5.6 一个节点一份产物

槽位是固定的：再产一次就覆盖旧的。下游要同时留多份，就让上游多来几个节点。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 六、沙箱里做不到的事（都是真机踩出来的，别再试）

| 你可能想这么干 | 实际结果 | 正确的做法 |
| --- | --- | --- |
| `getImageData` 读上游图 | SecurityError（画布被污染） | 后台脚本：`ctx.file(url)` 拿本地路径，用 node 解码 |
| 给 img 加 `crossOrigin="anonymous"` 再读 | 后台不认 `Origin: null`，加载失败或照样污染 | 同上。**别加 crossOrigin** |
| 界面里 `fetch("/api/…")` | 被请求边界拒（不透明源） | `CanvasUI.api(path, init)` 读画布，`CanvasUI.task(...)` 跑脚本 |
| `CanvasUI.api("/api/task/call", …)` | 被拒：那个代理只放行画布类接口 | 跑脚本就用 `CanvasUI.task`，它才是那条路 |
| 界面里 `fetch` 一个外站读字节 | 大概率被 CORS 挡 | 交给后台脚本去 fetch |
| `curl` / PowerShell 调 `/api/task/call` | 403「需要登录」 | 用 MCP 的 `canvas_fn_call` |
| 把几万字符的 base64 塞进 `argsJson` | 极易截断/写错，报"长度不对" | 让脚本自己读上游算；或先存成文件再 `resource_upload` |
| 读 `task-scripts/` 里的 .mjs 源码看它怎么实现 | 白费时间，而且看到的会过期 | `canvas_fn_list` / `canvas_fn_info` 看它**能做什么** |
| 翻插件源码、仓库源码、调试产物 | 同上：那是实现，今天对了明天就错 | 本手册 + 运行时接口 |
| 自己写 Python/PowerShell 解 PNG、算像素 | 一堆环境问题，还会写错字节 | 后台脚本里用 node 现成的库 |
| 在界面上跑几秒钟的循环算大图 | 界面卡死、用户以为坏了 | 长活交给后台脚本，界面只显示结果 |

**一条判断准则：**
**"看一眼、转个样式" → 界面能做。**
**"读像素、转码、批图、读文件、算数据" → 一定是后台脚本的活。**

### 为什么界面里读不了像素（想不通时看一眼）
界面住在一个不给同源权限的 iframe 里，它的源是"不透明"的。
图是从后台取的，对界面来说就是"别的源"。浏览器规定：
别的源的图画进 canvas 之后，就不许再把它读出来（防偷图）。
这条规则在浏览器里，改不了。所以像素运算必须在后台做。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 七、动手前先问清楚（这一步别省）

1. **只是看，还是要干活？**
   · 只是看（把连进来的图/视频/文字显示出来）→ 纯前端就够，不写脚本。
   · 要干活（转码 / 抽帧 / 读像素 / 批处理 / 读文件 / 算数据）→ 需要后台脚本。
2. **要干活的话，这台机器上有没有现成的？**
   先 `canvas_fn_list`（看清单）→ `canvas_fn_info`（看参数、返回、示例）。
   有能用的就**别重写**；一模一样再写一份，是纯浪费。
3. **要不要收进资源库**？要的话最后 `canvas_ui_package`。

别埋头就写。写完才发现"其实要后台、而脚本还没有"，整轮界面都得推倒。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 八、流程（照这个顺序做，别跳步）

    ┌─ ① 判要不要后台（见第七节）────────────────────────┐
    │   只展示 → 跳到 ④。要干活 → 走 ②③。                 │
    └──────────────────────────────────────────────────┘

   ② 写后台脚本（一个 .mjs = 一件事，文件名 = 脚本名）
      · 新脚本先用下划线开头：`_名字.mjs`（"还没验证"的标记，见 8.1）
      · 每个要给别人调的导出函数，都要有说明书（见 8.2）

   ③ 用 MCP 把脚本调通（不通就别写界面）

        canvas_fn_list()                     这台机器上有哪些**已验证**的脚本
        canvas_fn_info(script, fn)           它的参数 / 返回 / 示例
        canvas_fn_call(script, fn, …)        真调一次

      ★ 两种用法，按目的选：
        · **只验脚本**（还没写界面，只想确认算得对）→ canvasId / nodeId **都不给**。
          会落到一张 `fn-probe-default` 草稿画布上跑，`ctx.save` 照样能成功，
          产物在那张草稿画布名下，**碰不到用户的画布**。返回里有 `virtualCanvasId`。
        · **在用户的节点上跑**（看真实效果）→ canvasId + nodeId **都给**，
          从用户消息里的 `<ref type="node" canvasId="…" nodeId="…" />` 原样取。
          产物写进这个节点的槽位，下游读的就是它。
      ★ 只给一个 = 写错了，会直接报错，不替你猜。
      ★ 在真实节点上跑，会顺手把这个脚本补进节点声明（界面之后调它才不会被 403）。

      调通了（结果符合预期）→ 去掉文件名前的下划线，它才算"可用"。

   ④ 写界面：`canvas_ui_write`（或 `canvas_ui_update` 改一小块）
      ★ 写完系统会自动跑一遍规范检查，结论在返回值的 `lint` 里：
        `lint.ok === false` → **必须改**（直接 fetch / 调了没声明的脚本 / 没注册 onChange）
        `lint.warnings` 有内容 → 建议补（onChange 不理上游 / 有控件不交参数 / 没读 __CANVAS_UI__）
        别等用户发现；红着的界面不要交付。

   ⑤ 声明依赖：节点 data.uiScripts = { "脚本名": {} }
      不声明，界面调后台就 403。`canvas_ui_write` / `canvas_fn_call` 会顺手补，
      但自己写更稳。★ 这是**节点**的字段，不是 HTML 的一部分；
      改它用 `canvas_batch_nodes`（`canvas_ui_update` 只替换 HTML 文本）。

   ⑥ 验收：`canvas_ui_check({ canvasId, nodeId })` → `ok: true` 才算交付。
      它一次把界面规范、脚本在不在、函数说明书、节点说明书、产物落没落全查一遍。

   ⑦ 收尾三件：`canvas_ui_export` 打包到下载目录；
      `canvas_ui_describe` 写节点说明书；要复用再加 `canvas_ui_package`。

### 8.1 下划线 = 未验证

线上出过这个事：Agent 打开 canvas_fn_list，看到一堆**半成品、老 API 的脚本**，
拿起来一调就失败，白费一轮。于是加了这个标记：

1. 新建脚本，文件名前面**必须**加一个下划线 —— `_scale.mjs`。
2. 跑通（结果符合预期）之后，把下划线去掉 —— `scale.mjs`，这时才算可用。
3. `canvas_fn_list` **只列没下划线的**。带下划线的照样能调（你要测它），
   调用时会标一句"这是在建脚本"。

**清单里没有 ≠ 不存在**：你在建的那个，直接带下划线调就行。

### 8.2 脚本里的说明书

`export const docs = { 函数名: { what, args, returns, example } }`
没写的话 `canvas_ui_check` 会提醒，别人（包括以后的你）只能猜参数。

★ 这是**函数**的说明书。节点还有一份**节点**说明书（`uiNodeDoc`，用 `canvas_ui_describe` 写）。
两份东西，各写各的：节点说明书讲"这个面板是干什么的"，函数说明书讲"这个函数怎么调"。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 九、MCP 工具表

| 工具 | 干什么 |
| --- | --- |
| `canvas_ui_guide` | 读本手册（末尾附这张画布的节点 + 这台机器的脚本清单） |
| `canvas_ui_write` | 整段写界面（顺手补依赖声明 + 跑规范检查） |
| `canvas_ui_update` | 局部替换一段（old → new），不整段重写 |
| `canvas_ui_read` | 看现在写了什么 |
| `canvas_ui_check` | **验收**整个节点，`ok: true` 才算交付 |
| `canvas_ui_describe` | 写节点说明书（做什么 / 效果 / 输入 / 输出） |
| `canvas_ui_export` | 打包到本机下载目录（节点删了能恢复） |
| `canvas_ui_package` | 打包进资产库（以后能拖出来复用） |
| `canvas_fn_list` / `canvas_fn_info` / `canvas_fn_call` | 列 / 查 / 调后台函数 |

画布本身的操作不在这里造第二套，用内置的：
`canvas_get`（读一个节点或整张）、`canvas_overview`（只看规模）、
`canvas_batch_nodes`（增删改节点）、`canvas_batch_edges`（连线）、
`resource_upload`（本地上传）、`generation_*`（调模型出媒体，跟画界面是两条轨道）。

## 十、接口：界面侧（HTTP）与脚本侧（ctx）

### 10.1 界面里能用的（都经宿主代发，别自己 fetch）

    CanvasUI.setInputs(参数对象)         交参数
    CanvasUI.setOutputType("image")      声明输出类型（不调也行，产物落地会自动补）
    CanvasUI.onChange(fn)               上游/参数变了 → fn({ upstream, inputs })
    CanvasUI.save(字节或Blob, "a.png")  交产物
    CanvasUI.task(脚本名, 函数名, 参数数组, opts)   叫后台干活
    CanvasUI.cancel(runId)              取消
    CanvasUI.api(path, init)            读画布 / 改画布（path 必须以 /api/ 开头）

`CanvasUI.task` 的 opts：`{ wait: true }` 直接等结果；`{ log, progress }` 订阅过程。
只等结果、不要过程时用 `wait: true`；长任务订阅着看，并且把 `runId` 存进节点字段
（刷新后还能接上）。
**脚本名必须与 `task-scripts/` 里的文件名一字不差**（`pixelize` 和 `_pixelize` 是两个脚本）。
写错了用户一点就 403。

### 10.2 界面里能调的画布接口（走 CanvasUI.api）

    GET  {base}/api/canvases                             画布清单
    GET  {base}/api/canvases/{canvasId}                  整张画布
    POST {base}/api/canvas/nodes      { add?, delete?, update? }   改【默认画布】
    POST {base}/api/canvases/{canvasId}/nodes { add?, delete?, update? }  改【指定画布】
    POST {base}/api/canvas/edges      { add?, delete?, update? }   连线
    PUT  {base}/api/canvases/{canvasId}  { nodes, edges }          整体替换（慎用）
    GET  {base}/api/canvases/{canvasId}/resources/{名字}           取资源
    GET  {base}/api/actions  ·  POST {base}/api/jobs          下单生成（两条轨道里"出媒体"那条）

**跑脚本不要走这条路：** `CanvasUI.api` 明确拒绝 `/api/task/*`。
跑脚本只有 `CanvasUI.task(脚本名, 函数名, 参数)` 这一个入口 —— 它替你带上
画布 id、节点 id、声明校验和实时日志。别绕。

**绝对地址**：页面基地址是 `about:srcdoc`，相对路径解析不出来。
`baseUrl` 和 `canvasId` 从 `__CANVAS_UI__` 取。
（同源相对路径以 `/` 开头的那种可以直接用，比如上游的 `url`。）

### 10.3 后台那几个 HTTP 长什么样（参考；给界面用，你别用 shell 打）

界面里的 `CanvasUI.task` 背后调的就是这条。写在这里是为了你**看得懂返回**，
不是为了让你去 curl 它。

    POST {base}/api/task/call  { name, methods, args, canvasId, nodeId, wait? }
                          →    { ok, runId, state, result? }
    GET  {base}/api/task/events?runId=xxx    SSE：log / progress / done / error
    GET  {base}/api/task/status?runId=xxx    查状态（刷新回来靠它）
    POST {base}/api/task/cancel { runId }

### 10.4 脚本里能用的 ctx

    export async function 名字(你的参数..., ctx) { … }   // ctx 永远在最后一个

    信息：workspace（本次专属空目录）/ dir（脚本所在目录）/ baseUrl（后台地址）
          dataRoot / canvasId / nodeId / name
    方法：ctx.log(msg) / ctx.progress(0..1) / ctx.signal.aborted
    助手：await ctx.save(字节或字符串, "名字.ext"[, { slot, mime }])
          ctx.file(地址或文件名) → 本地磁盘路径（喂 ffmpeg 用）
          ctx.temp("名字") → 工作目录里的路径

干活就用 Node 自带的（`node:fs` / `node:child_process` / `fetch`），没有别的封装。
返回值原样作为 result 回到调用方（要能 JSON 化）。

### 10.5 你自己要"看"一个资源时

节点里存的是**同源地址**，不是磁盘路径。你要把图喂给 ffmpeg、或者想读字节，用这两个：

    resource_local_path({ url })  或 { canvasId, nodeId }  →  { localPath, exists }
    canvas_resource_fetch({ url }) 或 { canvasId, nodeId }  →  base64 + agentLocalPath

`canvas_resource_fetch` 会把字节另存到你工作目录的 `_resources/` 下 ——
因为你的文件类工具出不去工作目录，读不到兄弟目录 `resources/`。

**这是你（Agent）的工具，不是界面的。** 界面里拿不到磁盘路径，也不需要：
它直接 `<img src="上游的 url">` 就行。

### 10.6 界面本身的几条硬规矩（写之前过一遍）

1. **铺满整块**：`html, body { width:100%; height:100%; margin:0 }`。
   不铺满就是一个小白块挂在中间。
2. **样式写 `<style>`，脚本写 `<script>`，图标用内联 SVG 或字符**。
3. **字号 12–14px**，跟画布其它地方一个观感。
4. **深浅色都要能看清**：读 `__CANVAS_UI__.theme`
   （`palette.light` / `palette.dark` 给的是当前主题的一套语义色，
   用不用随你；想自己配色也行，但两条主题下都得读得出来）。

   ★ **用户切主题时你的页面不会重开**（2026-11-27 修的）。主题变化只做两件事：
   `__CANVAS_UI__.theme` 换成新值、`<html data-theme>` 换上新值，然后照常调一次
   `CanvasUI.onChange`。所以两种写法都有效，写一种就够：
   · 现读 `__CANVAS_UI__.theme` 算颜色（回调里重画）；
   · 用 CSS 写 `html[data-theme="dark"] .card { … }`（浏览器自己换，不用写 JS）。
   **不要**为了"跟着主题变"去监听 `matchMedia` 或自己加定时器 —— 宿主已经帮你换了。
5. **外部脚本 / 样式 / 字体都能引**（CDN 的组件库、图表库都行，没有来源限制）。
   但**核心结构与样式仍要写在页面里**：外部库是加成，别写成"库没加载就白屏"。
6. **不要在界面里跑几秒钟的重活**：界面卡住，用户会以为坏了。重活交给后台脚本。
7. **出错要显示出来**，别静默 `catch {}`。用户看到"跑了但什么都没变"，
   比看到一句错误更难查。

## 十一、排障：现象 → 原因 → 做法

| 现象 | 原因 | 做法 |
| --- | --- | --- |
| 界面一片空白 | 没铺满 / HTML 写坏了 / 页面报错 | `canvas_ui_read` 看代码；点节点上的"调试"开副本看控制台 |
| 右上角写着"无上游图片"，但线连着 | 界面自己缓存了旧数据 | 现读 `__CANVAS_UPSTREAM__`，或在 onChange 里重画 |
| 一根线都没连，却显示有上游 | 旧快照 / 写死的假数据 | 上游只认连线和 `d.upstream`，别写死 |
| 界面显示上游，但读不到像素 | 沙箱不透明源，画布被污染 | 交给后台脚本（`ctx.file` + node 解码） |
| 点按钮 403 | 脚本没声明 / 脚本名写错 / 用了 shell | 声明 `uiScripts`；名字对文件全名；走 MCP 不用 curl |
| 403 写着"需要登录" | 你在 shell 里调后台 | 用 `canvas_fn_call`；这不是登录问题 |
| 下游接不到 / 右边没输出口 | 没有 `uiOutputType` | 让产物落一次（save），或 `CanvasUI.setOutputType("image")` |
| 产物文件在，下游还是没有 | 只写了槽位，节点字段没写全 | 再跑一次产出，让它走 `save` 完整写一遍 |
| 点了没反应，也不报错 | 脚本名对不上 / 函数没导出 / 界面没接住异常 | `canvas_ui_check` 看脚本报告；界面里 catch 住并显示原因 |
| 报"长度不对：期望 X，收到 Y" | 手打 base64 传进 argsJson 被截断 | 别传大字节；让脚本自己读上游算 |
| 刷新后参数全丢 | 没 `setInputs` | 一次操作完成时交一次；开场读 `__CANVAS_INPUTS__` 恢复 |

## 十二、三个能直接抄的例子

### 12.1 只展示（读上游 + 监听变化）

```html
<style>
  html, body { margin: 0; height: 100%; }
  body { font: 13px system-ui, sans-serif; color: var(--t, #111); background: transparent; padding: 10px; }
  .item { display: inline-block; margin: 0 8px 8px 0; }
  .item img { max-width: 160px; max-height: 160px; border-radius: 6px; display: block; }
  .item span { font-size: 11px; opacity: .7; }
</style>
<h3 id="title" style="margin:0 0 8px"></h3>
<div id="list"></div>
<script>
(function () {
  var UI = window.__CANVAS_UI__ || {};
  var P = (UI.palette && UI.palette[UI.theme || "light"]) || {};
  if (P.text) document.documentElement.style.setProperty("--t", P.text);

  function upstream() {
    var list = window.__CANVAS_UPSTREAM__ || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].url) out.push(list[i]);
    }
    return out;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function draw() {
    var u = upstream();
    document.getElementById("title").textContent = u.length ? "上游素材 " + u.length + " 份" : "无上游素材";
    document.getElementById("list").innerHTML = u.map(function (x) {
      if (x.kind === "image") {
        return '<div class="item"><img src="' + esc(x.url) + '" alt=""><span>' + esc(x.refName) + '</span></div>';
      }
      if (x.kind === "video") {
        return '<div class="item"><video src="' + esc(x.url) + '" controls style="max-width:160px"></video><span>' + esc(x.refName) + '</span></div>';
      }
      if (x.kind === "audio") {
        return '<div class="item"><audio src="' + esc(x.url) + '" controls></audio><span>' + esc(x.refName) + '</span></div>';
      }
      return '<div class="item"><pre>' + esc(x.value || "") + "</pre><span>" + esc(x.refName) + "</span></div>";
    }).join("");
  }

  CanvasUI.onChange(function (d) { draw(); });
  draw();
})();
</script>
```

### 12.2 带控件 + 交参数（参数能存活到刷新）

```html
<style>
  html, body { margin: 0; height: 100%; }
  body { font: 13px system-ui, sans-serif; color: var(--t, #111); background: transparent; padding: 10px; }
  label { display: block; margin: 6px 0; }
  output { font-variant-numeric: tabular-nums; }
</style>
<div id="head" style="margin-bottom:6px"></div>
<label>尺寸 <input id="size" type="range" min="8" max="256" step="8"> <output id="sizeOut"></output></label>
<label>颜色数 <input id="colors" type="range" min="2" max="64" step="1"> <output id="colorsOut"></output></label>
<script>
(function () {
  var UI = window.__CANVAS_UI__ || {};
  var P = (UI.palette && UI.palette[UI.theme || "light"]) || {};
  if (P.text) document.documentElement.style.setProperty("--t", P.text);

  var size = document.getElementById("size");
  var colors = document.getElementById("colors");

  function upstreamCount() {
    var list = window.__CANVAS_UPSTREAM__ || [];
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].url) n++;
    return n;
  }

  function show() {
    document.getElementById("sizeOut").textContent = size.value;
    document.getElementById("colorsOut").textContent = colors.value;
    var n = upstreamCount();
    document.getElementById("head").textContent = n ? "上游素材 " + n + " 份" : "无上游素材";
  }

  function restore(inputs) {
    var v = inputs || {};
    if (v.size) size.value = v.size;
    if (v.colors) colors.value = v.colors;
  }

  function push() {
    show();
    CanvasUI.setInputs({ size: Number(size.value), colors: Number(colors.value) });
  }

  size.addEventListener("change", push);
  colors.addEventListener("change", push);

  CanvasUI.onChange(function (d) {
    if (d && d.inputs) restore(d.inputs);
    show();
  });

  restore(window.__CANVAS_INPUTS__);
  show();
})();
</script>
```

### 12.3 这个界面上多一个"调后台"的按钮

`save` 与 `task` 都在宿主那边拼好地址和令牌，你只管说名字。
（下面这段别单独当 HTML 贴，要并进上面的页面里。）

```js
// 注意：脚本名必须与 task-scripts/ 里的文件名一字不差
CanvasUI.task("pixelize", "hd", [upstreamUrl, { width: 64, colors: 24 }], { wait: true })
  .then(function (r) {
    // 脚本里用 ctx.save(...) 存过产物的话，节点字段已经自动写好了，
    // 下游马上就能读到；这里只需要把结果显示出来。
    if (r && r.result && r.result.url) showResult(r.result.url);
  })
  .catch(function (err) {
    status.textContent = "跑失败：" + err.message;
  });
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 十三、硬性禁止清单

1. ❌ 用 `curl` / PowerShell / 自己写的 node 脚本去调后台的 `/api/*`。→ 用 MCP 工具。
2. ❌ 在界面里 `fetch` 后台。→ `CanvasUI.api` / `CanvasUI.task`。
3. ❌ 界面里读像素、`toDataURL`、`toBlob` 外源图。→ 后台脚本。
4. ❌ 手写 `imageUrl` / `uiOutputUrl` / `uiOutputType` 当产物。→ 让 `save` 写。
5. ❌ 把大段 base64 塞进工具参数。→ 让脚本自己算，或先落成文件。
6. ❌ 读别人的脚本源码、翻插件源码、翻调试产物。→ `canvas_fn_info` + 本手册。
7. ❌ 写完不跑 `canvas_ui_check` 就交付。
8. ❌ 界面没铺满、没读 `__CANVAS_UI__`、没注册 `onChange` 就交付。
9. ❌ 忘了导出节点包（`canvas_ui_export`）—— 节点一删，界面就没了。
10. ❌ 静默 `catch {}` 把失败吞掉。界面要能把"为什么没反应"说出来。
11. ❌ 在 `onChange` 里重新 `canvas_ui_write` / 重挂页面来做刷新 —— 页面不会重启，
    重画靠 JS 改 DOM，不靠换 HTML。

## 十四、真卡住了怎么查（排障手段，不是流程的一步）

正常情况：`canvas_ui_write` → `canvas_ui_check` 说 `ok: true` → 结束。
只有真卡住（白屏、点了没反应、数据对不上、报错看不懂）才用下面这些。

**为什么父页面伸不进那个 iframe**：界面住在 `sandbox="allow-scripts"` 的 iframe 里，
故意不给同源权限（否则它就能读你整个画布的登录态）。所以父页面读不到它的 DOM、
变量，DevTools 也点不进那一帧。**这是安全设计，改不了。**

**做法是开副本**：鼠标停在节点上，左下角有个「调试」按钮，点它会把这份界面原样复制到
一个独立窗口 —— 那份是同源的普通页面，DevTools 能进去、能打断点、能看变量。

三条要记住：
1. 副本是副本，不是画布上那个。改完要用 `canvas_ui_update` 写回节点。
2. 副本里照样能调后台（`CanvasUI.save` / `task` 走的还是同一条链）。
3. 副本不带 CSP，沙箱那份才带。别把"只在副本里能跑"的写法当成能上线。

另一件常被误用的是 `canvas_ui_build_debug_doc`：它生成一份可独立打开的调试页。
这份页要用**浏览器**打开，别用 `curl` 去读它的地址（后台接口对 shell 一律要登录）。

**一条实际的闭环**：`canvas_ui_read` 看现状 → 改 → `canvas_ui_write` 写回
→ 开副本看控制台 → 定位 → 再改 → `canvas_ui_check` 验收。

