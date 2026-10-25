# 云画布实时同步可靠性方案

> 状态：**调研完成，待实施**。本文只给方案，不包含源码改动。
> 适用：`packages/cloud-server`、`packages/plugins/plugin-cloud-client`、`packages/ui`、`packages/canvas-data`、`packages/canvas-render`。
> 起因：画布数据已经变化，但前端偶尔不更新；刷新后又恢复正常。
> 结论依据包含真实 cloud-server + 真实 SSE + 真实 MCP 写入实验，以及 2026-10-25 的代码核对。
> 2026-10-25 修订：并入三方子代理审阅意见，补齐版本发号点、两份基准同步、核对期间编辑、验收门槛与落地顺序。

## 一页结论

先分清三层，不要把“增量写”“全量存储”“版本号”混成一件事：

| 层 | 当前行为 | 方案 |
|---|---|---|
| 前端写画布 | 发 `add / delete / update` 增量 | **保持不变** |
| 后台存储 | 把增量应用到当前画布，再原子写整份 `canvas.json` | **保持不变** |
| SSE 推送 | 只喊“画布变了”，不推节点，也不推全量 | **加画布 id 与版本号** |
| 版本号 | 当前没有 | **后台唯一发号；前端只记录、绝不累加** |
| 发现落后 | 只靠事件 | **事件 + 重连/回前台/定时核对版本** |
| 落后后的修复 | 重新读取整份云端再三方合并 | **保持：直接拉最新全量，不回放缺失增量** |

一句话：

**版本号只负责发现“我落后了”；最新全量负责修复；本地三方合并负责不冲掉用户正在做的事。**

## 二、为什么不是“每次发全量”或“前后端累加版本”

### 2.1 写入与推送的真实语义

1. 网页端保存时只提交差异，由后台写锁串行应用。
2. 后台最终保存的是**整张画的完整快照**，它不是按节点拆成很多份文件。
3. SSE **不发送节点数据**，只发送“哪个画布、哪一类数据变了”。
4. 前端收到信号后，主动 `GET /api/canvases/:id` 读取最新完整画布。
5. 若 SSE 丢失，后台文件仍然是最新的；问题只是前端不知道应该去读。

所以“每次修改后发送全部发布值”既没有必要，也会把大画布反复搬运。版本号是更小的通知补充。

### 2.2 版本号如何累加

- 版本号是**每张画布一个整数**，不是每个节点一个。
- 后台每成功提交一次画布节点/边，版本号加 1。示例：`9 → 10`。
- 一次保存里即使修改了 20 个节点，也只增加 1。
- 写入失败、校验拒绝、只改画布名字或只改视口时，不增加画布图版本。
- 前端**不计算** `9 + 4 = 13`，也不维护“本地版本差”。
- 前端只保存最后确认的 `knownServerRevision = 9`；看到后台是 `13` 时，直接读取 13 这一版的完整画布，合并成功后记录 `knownServerRevision = 13`。
- 缺少 10、11、12 不需要回放，因为后台保存的是最终快照，不是事件流水账。

版本号是“书签”，不是“增量账本”。

### 2.3 不采用哈希作为主方案

每次修改后计算整张画布哈希并定时比对，可以发现问题，但不能回答“我上次确认的是哪一版”。三方合并需要稳定的云端基准；版本号能让客户端明确地保存和更新这个基准。

哈希只在需要排查磁盘外部改动或数据损坏时作为调试手段，不进入正常同步热路径。

## 三、已经确认的问题

### P0-1：断线期间的通知不会补发

`packages/cloud-server/src/routes/events.ts:63-105` 只维护当前连接的内存队列。连接断开后订阅被移除，服务端不保留事件，也没有 `Last-Event-ID` 或订阅恢复后的版本核对。

真实实验：

- 连接正常时，后台写入节点，SSE 收到事件。
- 主动断开连接，在断开期间经 MCP 新增节点，后台文件中确实有该节点。
- 重新建立 SSE 连接，等待超过 3 秒，没有收到补发事件。

因此“后台没丢数据、前端漏通知”是已证实会发生的情况。

### P0-2：浏览器隐藏页会主动断开共享 SSE，回前台不做画布核对

`packages/ui/src/composables/kvEvents.ts:79-107` 在页面隐藏 30 秒后关闭所有共享连接，回前台重新打开。但重开只恢复“以后还能收通知”，没有通知 `plugin-cloud-client` “可能漏了一段”，也没有立即拉取画布。

如果画布在隐藏期间改完且之后不再变化，这段改动会一直不显示，直到手动刷新或下一次无关事件触发同步。

### P0-3：同步失败后不会主动重试

`packages/plugins/plugin-cloud-client/src/remoteSync.ts:142-166` 在读取或合并失败时只打印警告，之后仅等待下一次 SSE 事件。注释里的“下次事件会再试”在“后台之后不再变化”时不成立。

另外 `packages/plugins/plugin-cloud-client/src/plugin.ts:419-426` 是先 `refreshBase()` 再 `start()`，存在“恢复完成到订阅建立之间”的窗口；窗口内写入也可能漏掉。

### P0-4：节点与边分两次读取，可能拼出撕裂快照

`packages/plugins/plugin-cloud-client/src/remoteSync.ts:133-139` 用两个独立的 `readCloud` 读取节点和边；`adapter.get()` 每次都请求一次完整画布（`canvasDiffAdapter.ts:69-76`）。两次请求之间如果发生写入，可能得到“节点来自版本 9、边来自版本 10”的混合快照。

这个混合快照会被当前代码直接记为下一轮的三方基准，后续可能继续产生错误判断。首版修法不是加锁，而是：**节点、边、版本一次请求取回，绝不拼接两次读取。**

### P0-5：保存返回 HTTP 200 但业务 `ok:false`，客户端当成成功

`packages/cloud-server/src/routes/canvasOps.ts` 的批量写接口在业务校验失败时仍返回 HTTP 200，响应正文是 `{ ok: false, errors: [...] }`。

`packages/plugins/plugin-cloud-client/src/api.ts` 的 `patchNodes()` / `patchEdges()` 只看 `res.ok`，没有解析正文的 `ok`；`canvasDiffAdapter.ts:139-141` 随后无条件 `remember(value)`。结果是：

1. 后台实际没有写入；
2. 前端把这个本地值记成了“服务器已经拥有”；
3. 下一轮保存不再重发；
4. 刷新后从后台读，改动消失。

这条必须优先修。只补 SSE 不能让未写成功的数据自动回来。

### P0-6：合并层会漏掉真实远端变化

1. **同 id 本地旧节点挡住远端新增。** `packages/plugins/plugin-cloud-client/src/remoteMerge.ts:193-196` 在“基准没有、云端有、本地也有同 id”时直接忽略云端节点。用户本地尚未同步的数字 id 与后台新分配的 id 撞号时，后台节点会被静默丢掉；刷新走整包恢复，所以又正常。
2. **缺失位置被伪造成 `{x:0,y:0}`。** `packages/plugins/plugin-cloud-client/src/remoteSync.ts:92-104` 把没有 `position` 的节点补成原点，导致“新增节点”的比较失真。
3. **远端删除的 data 字段无法落地。** `packages/plugins/plugin-cloud-client/src/applyMerge.ts:82-87` 用浅合并写 `data`，`remoteMerge.ts:138-153` 也明确记录了“不删 key”的限制。刷新后按整包恢复才会消失。
4. **批量挂载窗口可能延迟新节点显示。** `packages/canvas-render/src/host/CanvasHost.vue:296-308` 在分批挂载期间只更新 `stagedTarget`，新加入节点要等这一批结束或下一次同步才出现在 `nodes.value`。需要先写复现测试，再决定是否修。

## 四、版本号设计

### 4.1 存储

版本号与画布图数据放在同一个 `canvas.json` 原子写里，避免“数据写成功、版本文件写失败”的两份真相：

```json
{
  "nodes": [],
  "edges": [],
  "name": "画布 1",
  "createdAt": 1760000000000,
  "revision": 13
}
```

规则：

- 旧文件没有 `revision` 时按 `0` 读；首次图写入后变成 `1`。
- 新文件由**图提交锁**保证读-改-写串行。
- 节点/边写入成功：`revision + 1`。
- 名称修改、视口修改：保留原 `revision`。
- 整包覆盖：成功一次加 1。
- 业务校验失败：不写文件，不加版本。
- 新画布先建为空图 revision 0；复制出来的内容属于**第一次图提交**，复制完成后为 revision 1，不继承原画布版本。
- 虚拟画布首次写入占位节点同理：写入那一次成功后才从 0 变成 1；空虚拟画布保持 0。
- 名称修改、视口修改、纯读取、校验失败和空操作都不递增，也不发送图变更通知。

### 4.1.1 唯一发号点（硬约束）

revision **只在 `CanvasDocument` 的图提交方法内递增**（建议新增 `commitGraph()`）。它必须在 `runExclusive` 里读取当前 revision，确认节点/边确实发生变化，再生成 `revision + 1`，并把 `{ nodes, edges, revision }` 作为**同一次 `canvas.json` 原子写**落盘。

`CanvasStore.writeCanvas()` 只持久化调用方给出的 revision，**不自行分配**。它是通用写口，也被改名、复制等路径使用；若在这里无条件加一，会出现“改个名字也涨图版本”“空操作涨版本”“多个旁路各自发号”。

所有图写入都必须经过 `CanvasDocumentPool.for(canvasId)` 的同一个实例。当前存在会绕过图提交锁的旁路，必须在 Commit 2a 前置消除：

- `packages/cloud-server/src/routes/projects.ts:100-102`：改名前读后整包写回，可能把新图覆盖回旧快照。改成只更新 `name`，不重写 nodes/edges。
- `packages/plugins/plugin-node-ui/src/server.ts:252-257`：非默认画布的可视化内容写入是直接读改写。
- `packages/plugins/plugin-node-ui/src/server.ts:368-388`：非默认画布新增节点是直接读改写。
- `packages/plugins/plugin-node-ui/src/server.ts:418-423`：虚拟画布初始化直接写文件。
- `packages/cloud-server/src/store/canvasStore.ts:197-203`：复制画布直接整写；副本从 `0` 开始。
- `packages/cloud-server/src/store/projectStore.ts:149`：新建画布直接写 `canvas.json`；初始 revision 为 `0`。
- `packages/cloud-server/src/mcp/canvasDoc.ts:352-354`：公开的 `write()` 没有持锁；要么改成内部专用，要么加锁与发号。

这些旁路不消除，只给接口加版本号会造成“版本看起来对、数据已经被旧快照覆盖”。

### 4.2 接口

新增轻量核对接口：

```http
GET /api/canvases/:id/revision

200 { "ok": true, "canvasId": "default", "revision": 13 }
```

现有完整快照接口增加版本：

```http
GET /api/canvases/:id

200 {
  "ok": true,
  "nodes": [...],
  "edges": [...],
  "view": {...},
  "revision": 13
}
```

服务端可以在内存缓存 revision，写入时同步更新；冷启动时从 `canvas.json` 读一次。核对接口只读一个小整数，不解析整张画布；缓存缺失时才回退读文件。

补充约定：

- `GET /api/canvases/:id` 的 nodes、edges、revision 必须来自**同一次 `canvas.json` 读取**，不能一个用缓存、一个读文件。view 可以另行读取（它不参与图版本）。
- `GET /api/canvases/:id/revision` 返回 `cache-control: no-store`，防止代理或浏览器缓存旧版本号，造成“永远看起来已是最新”。
- `GET /api/canvases/:id/revision` 在画布不存在时返回 404，不能返回 `revision: 0`；后者会让客户端误以为存在一张空画布。完整快照接口暂保现有“不存在按空画布返回”的兼容行为，但升级时应补可见的 `exists` 或明确 404；客户端不得仅凭空数组判断画布存在。
- 两张接口都走现有 Host/Origin 来源边界；它们只读，不要求管理令牌。

### 4.3 SSE 事件

保留“只报信号、不报全量”的原则，只补定位信息：

```json
{
  "type": "canvas",
  "key": "graph",
  "canvasId": "default",
  "revision": 13
}
```

- 同一次画布写入产生的 `graph` 与 `graph-edges` 事件带**同一个 revision**。
- 客户端用 `lastAppliedEventRevision` 去重：只有“版本不大于已应用事件版本，且该版本快照已核对过”才忽略。不能拿 `knownServerRevision` 代替“本地是否还有未提交改动”。
- 事件乱序时不回放，按 revision 取最大；最终以完整快照返回的 revision 为准。
- SSE 服务端可合并**同一画布、同一 key** 的未发出旧事件，只保留最新 revision；`graph` 与 `graph-edges` 各至少保留一条。旧订阅方仍会收到每个 key 的最新一次，但不保证逐帧。
- 事件里的 revision 在**提交成功时捕获**，不能等发送时再查缓存；`events.ts` 当前会把 canvasId 丢掉，改造时要原样转发。
- 客户端必须按当前 `canvasId` 过滤事件；别的画布发生变化时只更新对应的书签，不拉取当前画布，也不能用别的画布 revision 推进当前书签。
- 名称、视口、纯读取不得广播 `graph` / `graph-edges`；图变更通知只在图提交成功时发出。
- 不保存事件历史，不实现 `Last-Event-ID` 回放；重连靠版本核对恢复。

### 4.4 前端核对算法

```text
knownServerRevision   = 已确认的云端图版本
lastServerSnapshot    = 该版本对应的完整节点、边
pendingLocalChanges   = 本地尚未成功提交的节点/字段
skippedRemote         = 因类型未注册等原因暂缓的远端快照

收到事件 / 重连成功 / 回前台 / 网络恢复 / 定时到点:
  如果已有核对在跑: 标记 dirty，结束后补一次
  r = GET /api/canvases/:id/revision
  如果 r.revision == knownServerRevision 且没有 skippedRemote: 结束

  snap = GET /api/canvases/:id       // 同一次读取拿 nodes + edges + revision
  如果 snap.revision <= knownServerRevision 且同一快照已应用: 结束

  mine = 重新读取本地当前节点和边      // 不能在请求前缓存 mine
  plan = 三方合并(lastServerSnapshot, mine, snap, pendingLocalChanges)
  applyPlan(plan)                     // 应用前再按字段编辑态过滤
  lastServerSnapshot = snap
  knownServerRevision = snap.revision // 只采用服务端完整快照的 revision
```

关键点：

- 核对是只读的，可以随时做。
- 采用服务端完整快照的 revision，不采用事件里的较大值直接跳版。
- 任何一次读取或应用失败都不推进 `knownServerRevision`，退避重试。
- **读取云端期间用户仍可继续编辑。** 快照返回后必须重新读取 `mine`，就地重新计算计划；不能拿请求前的旧本地快照落地。
- **核对必须绑定 canvasId。** 插件启动时的 `CID` 与适配器每次现算的画布 id 要统一；切画布、卸载时取消在途核对（AbortController 或 generation token），旧画布的结果不得写入新画布。
- **保存基准与合并基准同源推进。** 启动恢复/成功核对/本地保存成功后，`CanvasDiffAdapter` 的 `submittedNodes/submittedEdges` 与 `remoteSync` 的 `lastServerSnapshot` 必须由同一份规范化快照同时初始化、同时推进。禁止只更新其中一份，否则下一次保存会把刚合进来的远端节点当成“本地新增”重发。
- **保存成功才清待提交。** 云端合并成功只推进 `knownServerRevision`；只有保存返回业务 `ok:true` 后才清掉对应 `pendingLocalChanges`。保存失败、核对失败均不回退或伪造版本。
- **未知节点类型不能永久丢弃。** 本地未注册类型的远端节点进入 `skippedRemote`，类型注册后触发一次核对补同步；期间保留原始数据。
- 初次连接、`EventSource.onopen`、`visibilitychange → visible`、`online`、页面恢复都触发一次立即核对。
- 定时核对建议 15 秒一次，只在页面可见时运行，加少量随机抖动避免多标签同时打点；页面隐藏时暂停。
- 单次核对未变化时只有一个极小的版本响应，不传画布。

共享 SSE 目前只向外发消息，不暴露“已恢复连接”。客户端侧需要增加连接恢复/可能漏事件的通知通道（不新增第二条连接）：`onopen`、回前台重开、`online` 都要触发核对，不能等“下一条消息”。同时修正 `entryFor()` 只在 `readyState === 2` 时重开过于依赖猜测的问题。

启动顺序用明确状态机：`booting → restoring → seeding/ready → subscribing`。恢复期间缓冲触发；恢复完成后用**同一份快照**同时初始化两份基准；首次上云成功后设置合适的初始 revision；恢复失败不得假装已就绪。

### 4.5 兼容与升级

- 服务端先发版本字段；旧客户端会忽略多出的字段，不受影响。
- 新客户端连旧服务端（无 revision）时进入兼容模式：`knownServerRevision = null`，只做较低频率的完整快照核对，**不参与版本相等判断**；否则每次都会误判落后并持续拉整包。
- SSE 事件增加字段不改 `type/key` 语义，旧订阅方继续可用。
- 版本号只解决“通知丢失”。磁盘被外部程序直接改写、没有走 `CanvasStore` 的情况不在正常同步保证内；需要时用调试接口做全量校验，不进入常规路径。
- 旧版 cloud-server 读取带 revision 的 `canvas.json` 时，需要实际验证它不会拒绝未知字段；把“旧版读新文件”作为升级前检查项，不只依赖口头兼容约定。

## 五、冲突处理

### 5.1 核对不等同于覆盖

用户正在拖动或输入时，仍然可以核对版本；真正需要谨慎的是“把远端变化写进本地”的那一步。

建议规则：

| 情况 | 处理 |
|---|---|
| 远端改了、本地没改 | 应用远端 |
| 本地改了、远端没改 | 保留本地 |
| 两边改了不同字段 | 按字段合并 |
| 两边改了同一字段、用户没有正在编辑 | 标记冲突，不静默覆盖，保留本地值并记录远端值 |
| 两边改了同一字段、用户正在编辑该字段 | 暂缓该字段，其他字段和新增节点照常应用；结束后重新核对并解决 |
| 本地有未同步新增、后台出现同 id | 首版规则：若本地节点从未成功提交，给本地节点换新 id（同时改边端点、子节点 parentId、data 中的引用），再接入后台节点并提示；若本地节点已提交过，进入可见冲突，保留双方可恢复副本 |
| 远端删除字段、本地没改该字段 | 从本地删除该字段 |
| 远端删除字段、本地也改过该字段 | 保留本地并标记冲突 |

换 id 不是只改一个字段：必须列检查表覆盖节点 id、作为 source/target 的边、以它为 parentId 的子节点、data 内引用、选中态与临时态。资源引用、分组关系不能因此断掉。

字段删除要补数据层与提交层能力：新增类似 `dataUnset?: string[]` 的显式删除语义，`applyPatch` 先合并 data 再删指定 key；服务端批量写也要能表达删除，否则本地删掉后下一次保存又写回来。

### 5.2 不暂停整张画布

不建议用“正在操作节点就停止同步”作为总方案：

- 新增节点、远端删除、其他节点内容变化可以安全地同时应用。
- 需要延迟的只是用户正在操作的那一个节点的相关字段。
- 拖拽期间主要涉及 `position`；文本编辑涉及文本字段；尺寸调整涉及 `size`。
- 其他远端变化立即应用，页面不会因为一次拖拽而整体停更。

实现上需要一层很小的“字段占用/编辑中”信号，让合并层知道哪些字段暂时不要应用；无法取得该信号时，采用“冲突标记，不覆盖”的保守规则。

## 六、实施步骤

### Commit 0：先修验收防呆（对应代码改动前）

- 修 `packages/cloud-server/e2e/realtime-e2e.ts`：去掉已不存在的 `status().realtime/appliedRounds` 探针，去掉托管模式下的重复安装假设，匹配 `/api/canvases/.../nodes` 与 `/edges`，加入断线恢复、隐藏恢复、`ok:false` 保存失败、仅 revision 核对四类断言。
- 明确构建顺序：先 `plugin-cloud-client`，再 `ui`，最后跑 e2e；否则 e2e 读的是旧 dist。
- 记录本次相关测试基线；cloud-server 全量测试当前含网络依赖与清理噪声，不以“全量自然全绿”作为单步门槛，但必须记录失败用例名与是否为既有噪声。

### Commit 1a：先修业务失败被当成保存成功

- `CloudApi.patchNodes()` / `patchEdges()` 解析响应正文；`ok:false` 抛出带 `errors` 的明确错误。
- `CanvasDiffAdapter` 只在业务成功后推进提交基准；失败保留待发状态。
- 测试：HTTP 200 + `ok:false` 时不推进基准；修复数据后下一轮重发成功；节点失败时边不会被误记为已保存。

### Commit 1b：保存失败可观测

- `SaveService.flush` 不再把云保存失败统一解释成“浏览器配额不足”；保留待重试状态并暴露可读错误。
- 状态可被 `cloud-client` / 设置页读取，至少能看到“保存失败、仍在重试”。
- 测试：失败的项保留在 dirty；下一次成功后清掉；用户可见状态不误报成功。

### Commit 2a：服务端 revision 与唯一提交点

- 新增 `commitGraph()`（或等价命名），只在图锁内发号；`{nodes, edges, revision}` 同一次原子写。
- 消除 4.1.1 列出的旁路：改名只改 name、插件非默认画布写入接入统一文档、虚拟画布与新建画布按初始 revision 规则、复制从 0 开始。
- `GET /api/canvases/:id` 返回同一快照的 revision；新增 `GET /api/canvases/:id/revision`（`no-store`，不存在 404）。
- SSE 事件带 canvasId 与提交时捕获的 revision；同批 graph/edges 共用版本，并明确同一画布同一 key 的合并范围。
- 测试：10 个并发图写后 revision 恰好 +10；失败批次不变；名称/视口不变；空操作不变；旧文件按 0；复制从 0；多画布事件不串；旧版能读取带 revision 的文件。

### Commit 2b：客户端只读一次完整快照

- 客户端增加 `readCanvasSnapshot()`，一次取回 nodes、edges、view、revision（未升级前先取 nodes/edges 一次）。
- 移除 `Promise.all` 两次读取节点/边的撕裂窗口。
- `refreshBase` 与 `syncOnce` 只用这一个入口；启动恢复后由同一份快照初始化保存基准与合并基准。
- 测试：读取期间发生写入时，客户端拿到同一 revision 的 nodes/edges；合入远端新增后，下一次本地保存不把该节点当新增重发。

### Commit 2c：自动恢复触发与重试

- 首次启动、连接打开、回前台、网络恢复触发核对；同步失败进入指数退避重试。
- 共享 SSE 暴露连接恢复/可能漏事件信号；启动用状态机缓冲触发，不依赖“下一条消息”。
- 测试：断开写入再连接会补一次同步；隐藏超过 30 秒后恢复会核对；失败后无新事件也能重试成功。

### Commit 3：客户端版本核对

- 实现第四节算法；事件去重、乱序保护、定时核对、隐藏暂停。
- 核对使用服务端完整快照返回的 revision；失败不推进已知版本。
- 兼容旧服务端：无 revision 时 `knownServerRevision = null`，降级为低频完整快照核对，不做版本相等判断。
- 在 `cloud-client` 状态中暴露 `knownServerRevision / serverRevision / lastCheckAt / lastError / pendingWrites`，并在设置页提供可见状态与“立即核对”。
- 核对绑定画布生命周期，切画布/卸载取消在途请求（AbortController 或 generation token）。
- 测试：漏 1 版、漏 10 版、事件乱序、重复事件、版本响应失败、完整快照失败、页面隐藏恢复、核对期间继续编辑不覆盖新改动、切画布旧结果丢弃、保存失败待提交不被远端旧值覆盖。

### Commit 4：修合并漏项

- 缺失 `position` 保持缺失，只在渲染时兜底，不写回伪造坐标。
- 处理“基准没有、云端有、本地同 id”的碰撞：不静默忽略；优先保留两边并给本地未同步节点分配新 id，或进入可见冲突。
- 给数据层补字段删除能力（如 `dataUnset`），让“远端删了、本地没改”的 key 真正消失。
- 补齐 `parentId` / `size` 的远端清除语义。
- 为 `CanvasHost` 分批挂载窗口写复现测试，先区分“只是显示延迟”还是“数据也丢了”；若只是显示延迟，最小修法是立即更新已有节点、新节点单独排队，而不是整批延后。
- 测试：资源引用只换 `resourceId` 时，本地显示地址能与刷新后的解析结果一致；同 id 碰撞不丢数据；远端字段删除刷新前后一致。

### Commit 5：正在编辑字段的冲突保护

- 增加最小“字段编辑中”信号，覆盖拖拽位置、文本编辑、尺寸调整。
- 合并层只延迟冲突字段，其他变化照常应用。
- 两边同字段都改且没有编辑信号时，标记冲突并保留可恢复的两份值，不静默覆盖。
- 界面提供可见提示和“查看/采用远端/保留本地”入口。
- 测试：拖拽中远端改内容不打断；输入中远端改同一文本不覆盖；结束后能重新核对并完成合并。

### Commit 6：端到端验收与文档

- 每个 commit 结束时更新 `docs/STATUS.md` 的本步验证结果与数字；最终再做汇总，不要把所有 STATUS 更新堆到最后。
- 补一页同步契约：版本含义、SSE 字段、错误码、冲突处理、状态机。

## 七、验证与验收

### 必跑命令（按顺序）

```bash
pnpm -C packages/plugins/plugin-cloud-client test
pnpm -C packages/plugins/plugin-cloud-client typecheck
pnpm -C packages/canvas-data test
pnpm -C packages/cloud-server typecheck
pnpm -C packages/ui typecheck
pnpm -C packages/ui test

pnpm -C packages/plugins/plugin-cloud-client build
pnpm -C packages/ui build
pnpm -C packages/cloud-server e2e:realtime
```

cloud-server 定向测试按单文件执行，不要把“全量测试”当成单步门槛；先记录本次相关用例基线，网络依赖与清理噪声单列。

### 真实验收场景

1. 页面打开，后台新增节点：无需刷新，2 秒内出现。
2. 断开 SSE，后台新增节点，再恢复连接：无需刷新，2 秒内出现。
3. 页面隐藏超过 30 秒，后台新增节点，再回到前台：无需刷新，立即出现。
4. 后台业务校验拒绝一次保存（HTTP 200 + `ok:false`）：前端显示保存失败，不推进基准；修正后重试成功，刷新不丢。
5. 节点与边读取期间后台写入：客户端使用同一 revision 的快照，不出现半新半旧。
6. 本地未同步节点与后台新节点同 id：两边数据都不静默消失。
7. 远端只更新 `resourceId`、删除旧地址字段：刷新前后显示一致。
8. 用户拖拽或输入时后台更新其他节点：当前操作不被打断；当前节点冲突字段延迟处理。
9. 连续重复核对 100 次：不产生重复节点/边，不重复写云端。
10. 大画布且无变化时核对：只请求 revision，不传整张画布。
11. 核对进行中继续拖动：返回后不得用旧 `mine` 覆盖新位置。
12. 核对中切画布：旧画布的结果不得写入新画布。
13. 合入远端新增后触发本地保存：不会把该节点重新当新增发送。
14. 未知类型节点：类型注册后补同步，不永久消失。

## 八、风险与回滚

- **多进程部署**：当前写锁和 revision 依赖单进程。若将来多实例共享目录，需要数据库或文件锁；本文不假装 revision 能解决跨进程竞态。
- **版本号与数据不同步**：必须放在同一个 `canvas.json` 原子写里；不能拆成两个文件各写一次。
- **旧客户端/旧服务端**：新字段可忽略；新客户端对无 revision 服务端降级为低频完整核对。
- **定时请求量**：只请求 revision，且隐藏页暂停；若有大量标签页，可把间隔调到 30 秒或加入随机抖动。
- **冲突界面**：Commit 5 涉及 UI，先保证“不静默覆盖”，再逐步完善操作入口。
- **回滚**：如果版本协议需要回退，客户端可退回“事件触发 + 重连完整核对”，服务端多出的 `revision` 字段不影响旧逻辑。
- **旁路写风险**：只加 revision 而不消除插件/改名旁路，会让版本号看起来正常而数据已被旧快照覆盖；因此 Commit 2a 必须先完成统一提交点。

## 九、不在本次范围

- 不实现多人实时协同或 CRDT。
- 不把整张画布塞进每一条 SSE 事件。
- 不实现事件历史回放；版本核对和完整快照已经能恢复最终状态。
- 不把普通哈希校验放进每次修改的热路径。
- 不改变现有“后台整份存储、前端增量提交”的主架构。

## 十、最终回答用户的两个问题

**问：后台是增量更新，还是每次修改后发送全部发布值？**

答：前端写是增量；后台存整份；SSE 只发变更信号和版本号，不发全量。前端发现版本落后时，才主动读取最新完整画布。

**问：缺少某一项增加项时，版本号是前后端累加，还是直接同步？**

答：**直接同步最新全量。** 版本号只由后台递增，前端只记录最后确认值，不累加、不回放缺失项。读取最新快照后用三方合并补入缺项；冲突字段按第五节处理，绝不用“前端自己加版本号”来假装已经同步。
