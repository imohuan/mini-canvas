# cloud-client —— 云端客户端插件（合并：存档 / 动作 / 任务 / 历史）

- 日期：2026-10-01
- 类型：架构设计
- 状态：**待评审**
- 取代：`packages/plugins/plugin-cloud-save`

## 一、要解决的问题

今天三件事各做各的，而且都跟「谁是真身」对不上：

| 事 | 今天住在哪 | 问题 |
|---|---|---|
| 画布存档 + 实时同步 | `plugin-cloud-save` | 已对接 cloud-server，没问题 |
| 生成动作 + 任务执行 | `plugin-web2api-tools` | 动作写死在前端；浏览器**直连** web2api 并自己轮询；关页面任务即断 |
| 生成历史 | `packages/ui` | 写死的假数组，没有任何来源 |

判断（用户定）：**server 是最终实现，前端是样片**。由此推出三件必须做到的事：

1. 任务由后台执行，页面只负责下单和看进度；
2. 没有页面也要能干活（MCP 直接下单）；
3. 数据落在后台，前端只是显示。

## 二、目标

- 生成任务在 cloud-server 上执行；页面关掉任务照跑，重开即见结果。
- 动作清单（有哪些模型、要什么参数）**唯一来源在后台**；加模型改后台，前端不用动。
- 生成历史由后台记账，前端只读。
- 实时变化统一走**一条 SSE**。
- 上面前两件 + 存档合并成**一个插件** `plugin-cloud-client`。

## 三、非目标

- **不改底栏的皮**（`plugin-bottom-bar` 的组件与样式）。它只认「有哪些动作」和「这单谁在做」；
  动作注册对了它就画。
  （会改它的**行为口径**两处：动作可声明「状态由外部管」以跳过本地写盘、`runCtx` 补 `canvasId`。
   这两处不声明就不用，现有动作行为不变。）
- **不搬音频节点类型**：已由 `plugin-node-audio` 承载，本插件不碰。
- 不动 v1（根 `src/`、`packages/canvas-core`）。
- 不合并 cloud-server 与 mcp-server（`mcp-server` 已确定废弃）。

## 四、为什么新插件必须是「零引用」单文件

插件是经后台清单动态装载的：`/plugin-manifest.json` → `/plugins/<pkg>/<file>` →
`manager.install({url})` → fetch 文本 → `import(data:text/javascript,…)`
（见 `packages/canvas-render/src/host/pluginManager.ts` 的 `loadPluginFromText`）。

data: URL 里**裸模块名解析不了**，所以产物里不能出现 `import 'vue'` /
`import '@mini-canvas/…'`。今天的 `plugin-cloud-save` 正是为此写成零引用。

**本插件不用引任何东西**，因为它一行界面都不画：

- 底栏的界面由 `plugin-bottom-bar` 画（读动作的 `fields` 声明自动长控件）；
- 历史弹窗由 `packages/ui` 画；
- 它自己只做「连后台 + 给数据」。

> 澄清一处曾被我搞混的地方：**注册底栏动作注册的是「要什么参数」，不是「长什么样」。**
> `plugin-web2api-tools` 注册的是 `fields: [{key,kind,type,options,…}]` 这样的**纯数据**，
> 真正的下拉是底栏用 `ToolParamGroup` 画的。所以「在新插件里注册 UI」= 注册这份声明，
> 一行 Vue 都不用写，也就不存在引入问题。

## 五、分层

| 层 | 是谁 | 负责 |
|---|---|---|
| 后台 | `packages/cloud-server` | 动作清单、任务执行、进度/结果写回、历史归档、SSE |
| 数据插件 | `plugin-cloud-client`（新，合并体） | 存档 + 实时同步、拉清单注册动作、下单、看进度、读历史 |
| UI | `packages/ui` | 底栏的皮、历史弹窗（都只读插件服务） |

## 六、接口契约

### 6.1 后台新增（cloud-server）

```
GET  /api/actions[?ifVersion=N]   → { ok, version, actions: ActionDef[] }
POST /api/jobs                    → { ok, jobId }
       body: { canvasId, nodeId, actionId, prompt?, values?, resources? }
GET  /api/jobs/:jobId             → { ok, job: Job }
POST /api/jobs/:jobId/cancel      → { ok, cancelled }
GET  /api/history?page&pageSize&kind&status&rating&order&canvasId
                                  → { ok, items, total, page, pageSize, summary }
```

**Job 的形状（定死）**：

```ts
interface Job {
  id: string              // jobId —— 前端 runState.taskId 存的就是它
  canvasId: string
  nodeId: string
  actionId: string
  providerId: string      // 哪个 provider 领的单（取消 / 重投路由到它）
  providerTaskId?: string // provider 自己的任务号（后台内部用，前端不关心）
  status: 'running' | 'done' | 'error'
  progress?: number       // 0-100
  message?: string
  result?: { ok: boolean; urls?: string[]; text?: string; error?: string; taskId?: string }
  createdAt: number
  finishedAt?: number
}
```

**`runState.taskId` 存 jobId（定死）**，不是 provider 的 taskId。
这样刷新续查与取消打的是后台的 job 接口，背后是哪个 provider 由后台自己路由。

**`canvasId` 的来源（定死）**：底栏的 `BarRunContext` 已声明 `canvasId?`，
但 `taskRuntime` 构造 runCtx 时**从不填它** —— 要补这一处：`NodeTaskService.run` 把
当前画布 id 透传进 runCtx（单画布阶段恒为 `default`）。**这是对底栏的一处小改。**

**资源必须先落成服务器地址**：节点里的图可能是 `data:` / `blob:`
（`resourceUpload` 的搬运门槛是 32KB，小图不会被搬）。后台拿不到这两种地址。
所以**下单前**插件把 `resources` 里凡 `data:`/`blob:` 的先 `POST /api/files` 换成
服务器 URL 再交后台。写进实现要求。

### 6.1b 两套字段名的映射（后台 → 底栏）

后台的 `ActionDef` 与底栏的 `BarAction` **字段名不同**，注册前必须映射：

| 后台 ActionDef | 底栏 BarAction | 说明 |
|---|---|---|
| `id` | `id` | 一一对应 |
| `nodeTypes` | **`types`** | **改名字**（漏了它底栏会认为所有节点类型都适用 → 图片模型出现在文本节点上） |
| `title` / `description` / `group` / `order` / `fields` / `needsPrompt` / `promptBinding` | 同名 | 直接透传 |
| `tool` / `model` / `promptMode` / `mediaMode` | —— | 后台执行用，不下发前端 |
| `constructor` / `apply` / `run` / `resume` / `onCancel` | 插件自己实现 | 后台不下发行为 |

`ActionDef`（后台为唯一来源；前端只用前半段，后半段是后台执行用的）：

```ts
{
  // —— 前端渲染用 ——
  id, title, description?, group?, order,
  nodeTypes: ('image'|'video'|'audio')[],
  needsPrompt: boolean, promptBinding?: 'none'|'text',
  fields: ParamDef[],            // 与内核 ToolParamDef 同形
  // —— 后台执行用（前端忽略） ——
  tool: string, model?: string,
  promptMode: 'chat-auto'|'plain', mediaMode?: 'image'|'video',
  pollIntervalMs?, pollTimeoutMs?
}
```

### 6.2 任务状态：后台写，**前端只读**

**后台是唯一写方。** 任务状态一变（提交 / 进度 / 终态），后台写进对应节点
（`data.runState`，字段形状与今天一致）。更新落进画布数据 → 变更事件 → SSE →
前端合并 → 画布上的进度立刻动。**这就是今天"AI 改画布前端跟得上"的同一条路**，
不用新造。

**前端不写持久化的 runState。** 底栏的轮询本来每一帧都写（`taskRuntime` 的
`writeRuntime` 在提交帧 / 中间帧 / 终态各写一次），与后台写的值**不同源**
（时钟、文案都不一样），两边交替覆盖会让进度与文案来回跳，还会形成
「本地写 → 推服务端 → SSE → 合并 → 本地再写」的回环。

**那底栏的轮询干什么**：只**读**。`run` 打一次 `POST /api/jobs` 后返回一个轮询函数，
它调 `GET /api/jobs/:jobId` **取状态用于显示**，不落盘。

**这需要底栏一处小改（改的是行为口径，不是皮）**：动作可以声明「状态由外部管」，
底栏据此**跳过 writeRuntime**，把轮询拿到的状态放进一份**只显示的运行态**
（内存里，供节点覆盖层读）。不声明该标记的动作（今天全部）行为**一个字不变**。

> 兜底的价值：SSE 断了、推送丢了，轮询这一拍仍能问出**终态**，
> 产物照样落节点、界面不会永远停在旧百分比。

**两条硬约束（必须写成测试；它们分属两侧，别混成一句）**：

1. **后台侧**：写画布必须走**增量口**（`CanvasDocument.batchNodes` / `runExclusive`），
   **不能整包写** —— 整包写会与前端保存互相覆盖（`GraphDeltaAdapter` 文件头记着的坑）。
   （cloud-server 自己**没有**历史/撤销概念，"不进历史"不是对后台的要求。）
2. **前端侧**：合并落地**不能把只改 runState 的节点记进撤销栈**。
   当前合并把整批包在 `g.transaction` 里（`cloudSavePlugin.ts` 的 `applyPlan`），
   而事务本身会 `withRecord` 记一条（`history.ts` 的嵌套守卫只保证"内层不再记"）——
   所以**光在事务内部改用 updateNodeRuntime 不够**，必须把这些节点**从事务里拿出来
   单独落**（updateNodeRuntime 不进历史）。否则每轮合并都会往 Ctrl+Z 里塞一条垃圾记录。

### 6.3 历史

后台在任务落到终态时归档一笔。列表要能**分页**、能看**汇总**，所以不靠「整份读回来」，
而是给一个专用读口：

```
GET /api/history?page=1&pageSize=20&kind=image&status=done&rating=…&order=desc&canvasId=…
  → { ok, items: HistoryEntry[], total, page, pageSize, summary }

summary: { total, byKind: { image: n, video: n, audio: n, other: n } }
```

历史**就是生成出来的东西**（图 / 视频 / 音频 / 其它），所以 `kind` 是主要筛选维度。
汇总口给出「一共生成了多少个图/视频/音频」，正好喂给历史弹窗上那些计数徽章。

生成要花钱，记录量不会很大；分页是「列表别一次全拉回来」的工程习惯，
**不是为海量数据设计的**，所以不需要做复杂索引。

**与历史弹窗的筛选维度逐条对齐**（弹窗现有控件：
`全部画布/本画布`、`图片/视频/音频`、`所有评级/已通过/待审核/已拒绝`、时间正倒序）：

| 弹窗控件 | 接口参数 | 说明 |
|---|---|---|
| 全部画布 / 本画布 | `canvasId`（省略 = 全部） | 多画布后才有意义 |
| 图片 / 视频 / 音频 | `kind` | 中文标签 ↔ 英文值的映射见下 |
| 所有评级 / 已通过 / 待审核 / 已拒绝 | `rating` | `all` / `passed` / `pending` / `rejected`；**`HistoryEntry` 要补 `rating` 字段** |
| 时间正序 / 倒序 | `order` = `asc` / `desc`（默认 desc） | |

**中文标签 ↔ 英文值**：`图片→image`、`视频→video`、`音频→audio`。
映射写在 ui 侧（那本来就是显示层的事），插件给的一律是英文值。

`rating` 目前是**占位语义**（生成物还没有人工审核流程）：
后台归档时统一写 `'passed'`，"待审核/已拒绝"先留空不入库，
这样弹窗那个下拉不会是死控件，等真有审核流程再补。

`HistoryEntry`：

```ts
{
  id, jobId, canvasId, nodeId, actionId,
  title, kind: 'image'|'video'|'audio'|'other',
  status: 'done'|'error',
  rating: 'passed'|'pending'|'rejected',     // 目前恒 'passed'（占位，见上）
  urls?: string[], text?: string, prompt?: string,
  createdAt, finishedAt, error?
}
```

**存放**：后台自己的数据目录（与画布数据同一处），**不落 kv 的 `config` 域** ——
那个域默认留在浏览器本地（`cloudSaveIncludeConfig=false`），放进去前端会读到空数据。
写入端**只有后台**（任务收尾时写），所以 MCP 下的单也会被记上；前端只读。

**实时**：新增一笔时，后台写一个信号键（`config:history-rev`）→ SSE 通知 →
插件重拉当前页 → 通知订阅者（与 §八 的清单刷新同一套机制）。

**分页与实时新增强并发**：后端按 `createdAt desc` 稳定排序；前端重拉时按 `id` 去重，
不依赖 `total` 的精确性（`total` 只用于计数徽章，允许一拍之内的偏差）。

### 6.4 插件提供给前端的东西

```ts
ctx.get('cloud-save')   // 沿用今天的服务名：状态查询 + 手动同步
ctx.get('gen-history')  // 新：
  // {
  //   query({ page?, pageSize?, kind?, status?, rating?, order?, canvasId? }): Promise<HistoryPage>
  //   summary(): Promise<HistorySummary>
  //   subscribe(fn): () => void        // 后台有新纪录时通知（ui 侧用 ref 接住重拉）
  // }
```

`gen-history` **只给数据 + 订阅回调，不依赖 Vue**（插件零引用）。`packages/ui`
那边用 `ref` 包一层即可响应式（与 `mini-map` 的用法同源）。

动作注册照抄今天的形态（同一套 API，只是数据来自后台）。**注意字段名要映射**
（见 §6.1b：后台 `nodeTypes` → 底栏 `types`）：

```ts
ctx.get('nodeBar').register(ctx, toBarAction(def))   // 动作（字段名换算见 §6.1b）
ctx.get('nodeBar').registerApplier(ctx, 'video', fn) // 写入器：见 6.5，video/audio 必须自带
```

**清单刷新用「全量重建」**：重拉清单后，先按上一次的 id 集合 `remove` 掉**已消失**的动作，
再 `register` 新的（同 id 会被替换）。不做这一步的话，后台删掉的模型会永远留在下拉里。

### 6.5 动作的 run / resume / onCancel 怎么接

见 §6.2 —— 与现有 `plugin-web2api-tools` 同构，只换「问谁」。
**返回的必须是底栏认识的形状**（`ToolPollState`），不是裸的 HTTP 响应：

```ts
async run(input, runCtx) {
  const { jobId } = await api.post('/api/jobs', { actionId, nodeId, prompt, values, resources })
  // 轮询函数：每次问一次后台，翻译成底栏认识的 running / done
  return async () => {
    const { job } = await api.get('/api/jobs/' + jobId)
    if (job.status === 'running') {
      // ★ taskId 必须带上：底栏靠它记 serverTaskId，点「取消」才发得出去
      //   （不带的话，首次下单的取消只会 abort 本地等待，后台任务照跑、照烧额度）
      return { status: 'running', progress: job.progress, message: job.message, taskId: jobId }
    }
    return { status: 'done', result: job.result }   // done 后由底栏交写入器落节点
  }
}
resume(taskId) { /* 同上，复用同一份轮询实现 */ }
onCancel(taskId) { return api.post('/api/jobs/' + taskId + '/cancel') }
```

结果落地沿用既有的写入器（`registerApplier`，如 image 那个会顺带量尺寸、清旧字段），
**不声明 `apply:'self'`**。

⚠️ **但 video / audio 的写入器今天住在 `plugin-web2api-tools` 里**
（image / text 才各有自己的插件）。云模式下不装它 → 视频/音频任务跑到 done
却**永远不落节点**（`applierOf` 取不到，且底栏的 `writeResult` 兜底**根本没提供**）。

所以新插件**必须自带 `video` / `audio` 两个写入器**（从 web2api 插件搬过来）。
注意 `registerBarApplier` 对同 kind 重复注册会**抛错**，所以：
- `video` / `audio`：云插件注册（web2api 插件不在场）；
- `image` / `text`：由各自的节点插件提供，云插件**不要碰**。


### 6.6 实时通道

一条 SSE：`/api/kv/events`，**不带 `type` 过滤**（要同时听 `canvas` 和 `config`）。
插件按 `(type, key)` 分发：

- 画布那三个 key（graph / graph-edges / graph-viewport）→ 走今天 remoteSync 的三方合并
  （任务进度帧也走这条，见 §6.2 的硬约束）；
- `config:history-rev` → 重读历史当前页，通知 `gen-history` 订阅者；
- `config:providers-version` → 重拉动作清单（§八）。

**信号键落哪个域（定死）**：历史与清单的信号键都用 **`config`** 域
（它们是"后台的元信息"，不是画布内容）。画布本体仍在 `canvas` 域。
一条 SSE 不带过滤，所以两域都能收到。

> 为什么必须合并成一条：事件接口只支持**按域**过滤，画布变化在 `canvas` 域、任务与历史在
> 另一个域；不合并就得开两条连接，或干脆不过滤。合并后一条连接带三件事。

## 七、存储结构：一个画布 = 一个文件夹

### 今天的实际形态（无「画布」概念）

```
.mini-canvas/
  kv/canvas%3Agraph.json          ← 整份画布数据（全局唯一，没有画布 id）
  kv/canvas%3Agraph-edges.json
  kv/canvas%3Agraph-viewport.json
  uploads/<内容哈希>.png           ← 所有资源堆在一个目录，全局共享
```

`canvasId` 在 cloud-server 里**一处都没有**（`CanvasDocument` 只认一份）。资源按内容哈希
全局去重，URL 是 `/uploads/<hash>.png`。

### 改成：一个画布一个文件夹（自包含）

```
<数据根>/
  providers/                      ← 平台提供方（§八）
  canvases/
    <canvasId>/
      canvas.json                 ← 画布本体：节点 + 边 + 画布信息（名称 / 创建时间 / 设置）
      view.json                   ← 视口（视图状态，拖动 / 缩放结束后写）
      history.json                ← 任务记录 / 生成历史
      resources/<内容哈希>.png     ← 本画布的资源（图 / 视频 / 音频）
```

资源 URL 随之变成 `/api/canvases/<canvasId>/resources/<hash>.png`。

⚠️ **节点里不能存上面这种地址**。存了它，"复制文件夹 = 复制画布"就不成立：
复制成新 id 后（或把文件夹给别人）路径里还写着**原画布 id** —— 要么显示错的东西，
要么 404。

**节点里存画布内相对引用**：`res:<hash>.png`。

**展开（`res:` → 真地址）放在载入时做，不放在渲染组件里。**
渲染组件今天是**直接把原值塞进 `src`**的（`ImageContent` / `VideoContent` / `AudioContent`
全都没有解析层），所以"渲染时补全"是一条**没有住址**的方案。

**已有现成的落点**：数据层本来就有「载入时按字段重写媒体地址」这套 ——
`resourceService` 的 `RESOURCE_URL_FIELDS`（九个字段）+ `mediaUrlFieldsOf` +
`restoreNodeMediaUrls`（刷新后按 `resourceId` 重建各媒体字段）。
把「`res:` 展开」接进这条既有路径即可：**载入/恢复时**统一把 `res:<hash>` 换成
当前画布的真实地址，渲染组件照旧读原值。

**要覆盖的字段不是只有 `imageUrl`**：以 `RESOURCE_URL_FIELDS` 为准 ——
`imageUrl / videoUrl / audioUrl / posterUrl / thumbUrl / maskUrl / panoUrl /
leftImageUrl / rightImageUrl`。凡是资源类字段都走同一条展开逻辑。

**兼容读**：老数据里是 `/uploads/<hash>` 或绝对地址 —— 原样能显示，不做破坏性改写。
（所以 `/uploads/:name` 路由要**保留到迁移结束**，见 §十 步骤 1。）

**MCP 那条路也要对齐**：`canvas.add_image` 今天写的是 `/uploads/<id>`
（`cloud-server/src/mcp/server.ts`）。改成画布文件夹后，它同样要写 `res:<hash>`，
否则"AI 建的节点"与"网页建的节点"两种形态并存，迁移永远收不了尾。

### 为什么这么分

判据：**是"这张画布是什么"，还是"现在怎么看它"。**

| 文件 | 里面是什么 | 什么时候写 |
|---|---|---|
| `canvas.json` | 节点 + 边 + 画布信息（名称 / 创建时间 / 设置） | 改内容 / 改名 / 改设置 |
| `view.json` | 视口 | 拖动 / 缩放结束后一次 |
| `history.json` | 任务记录（生成历史） | 每次生成完成一次 |

- **`canvas.json`**：节点、边、以及"这张画布叫什么"，读的时候一起读、写的时候一起写，
  合成一个文件最省事。
- **`view.json`**：视口是**视图状态**不是内容 —— 单独放，改视野不必重写整份节点边。
- **`history.json`**：账本，按时间只增不减，跟画布本体互不干扰。
- **选中态不落盘**：今天就没存，刷新后回到空选中，是既有行为，这里也不引入。

> 往后照这条判据办：新加东西先问"是画布本体，还是临时视图状态"。
> 本体进 `canvas.json`，视图状态进 `view.json`，只增不减的"账本"（如历史）单独一册。

### 为什么这样（对齐用户的目标）

- **复制文件夹 = 复制画布**：节点、边、历史、资源全在里面，`cp -r` 就是"另存为/分享"；
  拿去给别的机器、给别人、进版本库都直接可用。
- **AI 能直接操作**：路径可预测、内容是纯 JSON + 裸文件 —— AI Agent 不用过 HTTP，
  直接读文件就能看懂一张画布，改文件就等于改画布。
- **删画布干净**：删一个文件夹，不会漏下资源（今天全局 uploads 做不到 —— 
  删了画布也不知道那些文件还有没有人在用）。

### 三个必须一起接受的代价

1. **资源不再跨画布去重**：同一张图出现在两张画布上就存两份。这是"文件夹自包含"
   的必然代价 —— 想要自包含就不能共享资源目录。按"生成要花钱、资源不会海量"的判断，可接受。
   （复制画布时**视口不带走**：复制是为了分享内容，不是分享"我当时看到哪儿"。
   新画布打开时居中显示即可 —— 这是复制那一步的行为，不是文件布局问题。）
2. **资源 URL 变了** → 节点里已存的 `/uploads/xxx.png` 需要**兼容读**或一次性迁移。
   执行时必须给迁移路径（旧的 `/uploads/*` 仍能读，写到新画布时改新地址）。
3. **旧的 `kv/canvas%3A*` 要迁到新结构**：`graph` + `graph-edges` 合进 `canvas.json`；
   `graph-viewport` 进 `view.json`。执行时先探新结构，没有再从旧位置读一次并搬过去。

### 前端暂时还是"一张画布"

结构从第一天就是多画布的，但**前端界面上仍只有一张**（没有画布切换 UI）。
默认画布 id 用 `default`，行为与今天一致。等要做画布管理（列表 / 新建 / 复制 / 删除）时，
只加接口与 UI，存储层不用再动。

### 一个不能忘的细节：历史变化必须能被 SSE 送出

历史写在 `history.json`（不走 KvStore），而 SSE 的依据是 KvStore 的写事件。
所以**归档一笔历史时，必须同时写一个 KvStore 信号键**（记个版本号），否则后台记了账、
前端永远收不到通知。清单变化同理（§八）。

## 八、后台怎么加一个新平台（provider 目录）

### 问题

前端加能力 = 丢一个插件进目录，刷新即用。后台今天是**什么都焊死**的：想接一个新平台，
只能改 cloud-server 的源码再重新发布。这就是「前端能扩展、后台不能」的缺口。

### 做法：让后台也有一个「投递箱」

cloud-server 启动时扫一个目录（默认 `<数据目录>/providers/`，可用 `--providers` 指定），
里面的每个 `.js` 就是一个**平台提供方（provider）**：

```js
// .mini-canvas/providers/my-platform.js
export const id = 'my-platform'
export const actions = [
  { id: 'my-platform:txt2img', title: '我的模型',
    nodeTypes: ['image'],
    fields: [{ key: 'ratio', kind: 'ratio', type: 'select', options: [/* … */] }] }
]
export async function submit(action, input) { /* → { taskId } | { urls } | { error } */ }
export async function poll(taskId) { /* → { status: 'running' | 'done', progress?, urls?, error? } */ }
export async function cancel(taskId) { /* 尽力取消 */ }
```

- 加载方式：Node 原生 `import(pathToFileURL(file))`。
  这与前端「丢插件进目录」是**对称**的 —— cloud-server 已经在扫 `packages/plugins`
  给**前端**用，现在再扫一个目录给**后端**用。
- 一个文件、纯 JS、**不需要引任何东西**，扔进去重启即生效。
- 内置的 web2api 用**同一套接口**写成第一个 provider —— 内置与外挂走同一条路，
  不存在「内置一套、外挂另一套」。

### 为什么前端会自动跟着多一项

`GET /api/actions` 返回的是**所有 provider 声明的并集**。所以后台加一个平台，
前端的模型下拉里就自动多一项 —— **前端一行不用改、插件也不用重装**。
这才是「后台是真身」的完整形态。

### 可延后

若不急着要，这一步可以先不做（加平台就改代码）。但成本很低（一次目录扫描 + 一个合并
接口），而且正好补上「前端能加、后台不能加」这个缺口，建议一并做。

### 实时生效：改后台 → 前端立刻变

**问**：后台随时改了 provider，前端 UI 会不会跟着变？

**答**：会。分两件事看。

**① 清单变了，前端要重新注册 —— 底栏不用改，也不用给插件引 Vue。**

底栏的 `NodeBottomBar` **本来就订阅了 `node/bar` 这个注册场**
（`field.subscribe(() => reloadActions())`）。所以插件只要**用新清单重新
`register` 一遍**，场一广播，底栏自动重读、界面立刻变 —— 渲染始终是底栏自己的事。

历史同理：插件重读后**通知自己的订阅者**，ui 那边用 `ref` 接住（与 `mini-map`
的用法同源）。两处都不需要插件认识 Vue。

**② 插件怎么知道后台变了 —— 两条路，建议都留。**

- **轮询（最稳）**：每几秒带上次的版本号问一次 `GET /api/actions?ifVersion=`；
  版本没变就没有成本。任何环境都能跑，不依赖通道。
- **推送（最快）**：provider 一变，后台写一个 kv 小键（如 `config:providers-version`），
  复用**已有的 SSE**通知前端，前端收到就重拉。不为此新开通道。

建议：**先轮询兜底（「一定能变」），推送作为增强（「变得快」）**。

**③ 后台怎么算「变了」**：provider 目录用轮询比对（目录项 + mtime）或 `fs.watch`；
新增/删除/修改都算。按**内容版本**比对，避免无意义的重复通知。

**④ 与前端对称**：单文件插件本来就是「丢进目录、刷新即用」；这套等于把它搬到后台，
两边行为一致 —— 前端丢插件，后端丢 provider，两边都是热的。

## 九、数据流

```
下单   底栏"发送" → plugin-cloud-client → POST /api/jobs
       后台建 job → 立即写节点 runState(running) → 画布变更 → SSE
       前端：合并（不记撤销栈）→ 节点上立刻出现"排队中"
       同时 run 返回轮询函数（兜底：SSE 断了也能问出状态）

推进   后台轮询 provider → 每次进度都写节点 runState → SSE → 画布实时动
       （兜底轮询同时也在问，只用于显示，不写盘）

完成   后台写节点 runState(done) + 归档一笔历史 → SSE
       产物：由【前端的写入器】落节点（不是后台写）——
             image 走 plugin-node-image（量尺寸 / 清旧字段），
             video / audio 走本插件自带的写入器。
       前端：节点出产物 + 历史弹窗多一条

MCP    AI 调 MCP 生成工具 → 后台建 job → 同上（全程无页面）
       用户回来打开页面：runState 与产物均已落画布，历史也已记好

存档   ui → plugin-cloud-client → cloud-server(/api/canvases/<id>/*)   （随存储改造一起换）
```

> **产物只由一处写**：后台写 `runState`，前端写入器写 `data.imageUrl` 这类作品字段。
> 两条各写各的字段，谁也不碰谁。

## 十、迁移步骤（每步可独立验证）

0. 建分支/工作目录，先跑通基线测试。
1. **后台**：存储改成「一个画布一个文件夹」（迁移旧 `kv/canvas%3A*` 与 `uploads/*`，
   资源引用改画布内相对引用 `res:<hash>`；展开接在**载入/恢复**那条既有路径上）。
   默认画布 `default`。

   **这一步必须保留兼容读，并且同步更新下面的测试**（否则会有一段"旧测试全红、
   新测试还没有"的空窗）：
   - 保留 `/api/kv/canvas/*` 与 `/uploads/:name` 路由 **到步骤 8**；
   - 一起改：`cloud-server/src/__tests__/routes.test.ts`、
     `e2e/cloud-e2e.ts`、`e2e/mcp-e2e.ts`（它们今天都打旧路由）。
2. **后台**：provider 目录（扫描 + 加载）+ 动作清单合并 + `GET /api/actions`；
   内置 web2api 改写成第一个 provider。
3. **后台**：任务执行器（按 `actionId` 路由到对应 provider）+ `/api/jobs` 三接口
   （提交 / 查询 / 取消）+ **状态同步写回对应节点**（走**增量口** `batchNodes`，
   避免与前端保存互相覆盖）+ 终态归档历史 + 写信号键。
   注意：后台只写 `runState`，**不写产物字段**（产物由前端写入器落，见 §九）。
4. **插件**：新建 `plugin-cloud-client`，把 `plugin-cloud-save` 的代码并进来，
   加「拉清单→注册动作（字段名换算 + 全量重建）」「下单 + 只读轮询」「历史服务」
   「自带 video/audio 写入器」，SSE 改成不过滤 + 按 (type,key) 分发。
5. **底栏小改**：`runCtx` 补 `canvasId`；**前端不再写 runState**（只读轮询）。
   实现方式：给动作加一个可选的「状态由外部管」标记，底栏据此跳过 `writeRuntime`、
   改把状态放进只显示的运行态。不写标记的动作行为不变。
6. **UI**：历史弹窗改读 `gen-history`（含分页与汇总）；装配改成「有后台装云插件、
   没后台装 `plugin-web2api-tools`」（见风险 4 的开关）；
   修 `ui.ts` 的 `entry.id.includes('cloud-save')` 判断（新包名不含该串）。
   历史弹窗的数据源从写死的假数组换成服务；筛选（评级 / 排序）接上真参数。
7. **MCP**：给 cloud-server 的 MCP 加一个生成工具（不开页面下单）。
8. **收尾**：删旧包与旧引用。改名牵连的四处必须一起改：
   `cloud-server/scripts/bundle-assets.mjs`（写死路径与校验）、
   `cloud-server/package.json` 的 `build:assets` 过滤、
   `cloud-server/e2e/*`、**`ui/src/composables/ui.ts:510`**（最易漏）、
   `ui/src/__tests__/entrypoint.test.ts`（断言 `APP_PLUGINS` 长度那条）。

## 十一、验证

- **后台单测**：清单解析、建 job、执行到终态、**写回节点 runState**、历史归档、取消。
- **插件单测**：拉清单→注册动作（假 ctx）、SSE 按 (type,key) 分发、历史订阅通知。
- **ui 单测 / 目验**：底栏出现后台的模型；下单后节点出进度；历史弹窗有真实数据；
  **关掉页面再打开**，任务已完成且有历史；
  **断掉 SSE 再下单** —— 轮询兜底仍能问出**终态**、产物照样落节点；
  **首次下单后点取消** —— 后台确实收到 cancel（不是只停了本地等待）；
  **连推几十帧进度后 Ctrl+Z** —— 只退作品改动，不退进度条。
- **资源形态**：MCP 建图节点 → 前端能显示；复制画布文件夹 → 新画布图片完好；
  老数据（`/uploads/<hash>`）打开仍能显示。
- **MCP 目验**：不开页面下单 → 打开页面看到结果与历史。
- 回归：`pnpm -C packages/ui test`、`plugin-bottom-bar`、`canvas-data`、`canvas-render`
  既有用例不减少。

## 十二、风险与待定

1. ~~音频节点类型的住处~~ **已解决**：用户已新建 `packages/plugins/plugin-node-audio`
   承载音频节点类型，且**已在 `APP_PLUGINS` 里**（`packages/ui/src/assembly.ts:52`）。
   本插件不碰它。
2. **历史增长**：`history.json` 需要上限/裁剪策略（超出保留最近 N 条）。
3. **取消**：web2api 的取消只有 HTTP `POST /api/tasks/:id/cancel`（MCP 没暴露），
   后台要能拿到它的地址。
4. **没有后台时回落本地生成（二选一，已确认）**：`plugin-web2api-tools` 与云插件
   **不同时装载**，由装配决定装哪个：
   - 有 cloud-server → 装 `plugin-cloud-client`，**不装** `plugin-web2api-tools`；
   - 没有（纯前端 / 单开 ui）→ 装 `plugin-web2api-tools`，不装云插件。

   两者注册的都是一套完整动作，**不存在同场冲突、不用互相让路**。

   ⚠️ **开关落在哪，必须定死**：`APP_PLUGINS` 是**编译期静态数组**
   （`packages/ui/src/assembly.ts`），运行期删不掉里面的元素；而云插件走的是
   运行期清单（`ui.ts` 的 `installExternalPlugins`）。
   **定案**：`APP_PLUGINS` **只放 `plugin-web2api-tools`**（纯前端形态）；
   **托管形态**（ui 由 cloud-server 提供）下，由清单里的云插件在 `apply` 时
   **主动把本地动作撤下来**（按 id 前缀 `web2api:` 摘除）。

   这样"谁在场"只由**一个**判断决定（云插件自己知道），不依赖数组顺序、也不需要在
   运行期改静态清单。
5. **cloud-server 不能引工作区包**（它要能独立 `npx` 跑）：内置 provider 的类型声明
   只能就地写一份，防漂移靠测试盯着（`plugin-cloud-save/src/keys.ts` 已有同款先例）。
6. **runState 的写方与撤销栈（已在 §6.2 定死，这里只留验证项）**：
   后台是唯一写方，前端只读；后台写节点走**增量口**、进度帧**不进撤销栈**。
   验证项：下单 → 后台推进 → 画布实时动 → 关页面 → 重开 → 状态与产物都在；
   连推几十帧后 Ctrl+Z 只退作品改动、不退进度条。

## 十三、本次已确认的决定

- 合并成一个插件，**取代** `plugin-cloud-save`（不是并存）。
- 走**后台清单下发**（零引用单文件），不打进 ui 包。
- **本地与云二选一**（不同时装）：有后台装 `plugin-cloud-client`，没有则装
  `plugin-web2api-tools`。音频节点类型已由 `plugin-node-audio` 单独承载；
  新插件只实现动作注册等方法，不碰节点类型。
- **不另造任务轮询**：复用底栏既有的 `taskRuntime`（提交 → 轮询 → 终态 → `resume`），
  本插件与 `plugin-web2api-tools` 的唯一差别是「问的是后台，不是直连 web2api」。
- 后台要能**实时生效**：provider 一变，前端模型清单跟着变（底栏靠注册场自动重画，
  不必改底栏、不必给插件引 Vue）。轮询兜底 + SSE 推送增强。
- **历史**：后台记账，提供**分页 + 汇总**口；前端只读，实时靠 SSE 通知重拉。
