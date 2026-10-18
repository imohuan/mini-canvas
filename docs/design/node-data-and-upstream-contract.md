# 节点数据与上游契约

日期：2026-10-18。状态：**契约提案 + 现行实现对照**。配套文档：`docs/插件开发规范.md`、`docs/design/plugin-contracts-proposal.md`。

## 为什么要单独定这份契约

现在的节点注册只说明“能连什么”（`inputs/outputs`），没有说明“连上之后数据是什么”。于是：

- 视频截图直接创建 `image` 节点并写 `imageUrl/imageWidth/imageHeight`；
- 3D 预览只认上游 `data.imageUrl`；
- 图片对比只认 `imageUrl/cardWidth`；
- `node-ui` 和底栏各扫一遍边、各读一套字段；
- 字段改名不会让任何测试失败，只会让界面静默空白。

这份契约把“数据形状”从实现细节提升为节点类型声明的一部分。

## 一、三个概念

| 概念 | 回答什么 | 谁声明 |
|---|---|---|
| 连接 | 两个节点能不能连、从哪个口连 | 节点类型 `inputs/outputs` |
| 产出 | 我的节点对外提供什么数据 | 节点类型 `produces` |
| 消费 | 我需要从上游读什么数据 | 节点类型 `consumes` |

`produces/consumes` 的 `kind` 与 `PortDef.contentType/acceptsTypes` 使用同一套词表；不另造第二套。

## 二、词表

首批 kind：

| kind | 含义 | 典型字段 |
|---|---|---|
| `image` | 一张图片 | `resourceId` |
| `video` | 一段视频 | `resourceId` |
| `audio` | 一段音频 | `resourceId` |
| `text` | 一段文本 | `text` |
| `pano` | 全景图 | `resourceId` |
| `file` | 任意文件 | `resourceId` |

新增 kind 的规则：

1. 先在本表登记；
2. 在提案的 `MediaKind` 类型里加字面量（该类型尚未实现）；
3. 至少有一个节点类型声明 `produces`；
4. 补一条“装提供方 / 不装提供方”的测试。

## 三、声明形状

> **状态：已实现（2026-10-18）。** `produces/consumes` 已进入 `NodeRegisterDef`，注册时校验三选一；
> 图片/视频/音频/文本已声明产出，3D/对比已声明消费。

```ts
interface DataPortDef {
  kind: string                 // 内容类型
  /** 资源持久引用字段（节点数据只存 ID）；与 valueField/externalUrlField 三选一 */
  refField?: string
  /** 非资源的普通值字段（如 text）；与 refField/externalUrlField 三选一 */
  valueField?: string
  /** 可选：没有资源实体的外部链接字段（例如用户粘贴的 https 地址） */
  externalUrlField?: string
  required?: boolean           // 消费方是否必须拿到；缺了显示空态
}

interface NodeDataTypeDef {
  produces?: Record<string, DataPortDef>   // 槽名 → 产出
  consumes?: Record<string, DataPortDef>   // 槽名 → 消费
}
```

说明：

- `produces` 的 key 是**本节点对外的槽名**，建议与 kind 同名；多个图片输出可叫 `image`/`mask`。
- `consumes` 的 key 是**本节点读取的槽名**；与上游 `produces` 的 key 对应。
- `refField` / `valueField` / `externalUrlField` 由节点类型所有者决定；**三者恰好给一个**，消费方不硬编码。
- 文本槽用 `valueField: 'text'`；媒体槽用 `refField: 'resourceId'`；外部链接槽用 `externalUrlField`。
- 只有没有资源实体的地址才用 `externalUrlField`；它不参与资源回收，也不在“加媒体”链路里使用。
- 未声明 `produces` 的类型对下游表现为空；未声明 `consumes` 的节点**不得**调用 `upstream.*`。两者是不同方向的约束。


## 四、地址准入表

| 地址形态 | 能否写进 `data` | 说明 |
|---|---|---|
| `resourceId`（逻辑 ID） | ✅ 唯一推荐 | 持久身份；渲染时 `resolve` |
| `https://` 外部链接 | ⚠️ 仅声明 `externalUrlField` | 不参与资源回收；不保证跨环境可访问 |
| `data:` 且带 `resourceId` | ❌ 保存前删 | 冗余副本，字节已在资源库 |
| `data:` 且无 `resourceId` | ⚠️ 旧存档 + 占位/兜底 | 示例占位图、无资源库时的兜底仍会产生；新写入应尽量迁入资源库 |
| `<canvasId>/<hashName>`（云端逻辑 ID） | ✅ 云端写入的唯一形态 | 已有实现（迁移第 0 步完成）；`resolve` 拼路由并 HEAD 探测 |
| `/api/canvases/<id>/resources/<hash>` | ⚠️ 旧存档 / 后台产物地址 | 只作兼容输入；`resolve` 原样返回，写入时顺手拆成逻辑 ID |
| `blob:` | ❌ 永不 | 只在当前页面有效 |

## 五、连接方向（必须记对）

画布的 canonical 方向是 **source 节点是输出端，target 节点是输入端**：

```
上游图片节点 (outputs: source) ──▶ 下游 3D 节点 (inputs: target)
```

- `upstream.nodes()` 返回的是“连进当前节点的**直接**上游”，即边 `source → 当前 target`；要整条链用 `ancestors()` / `order()`（见第六章 6.1）。
- 不要按“当前节点是 source”去反查下游；需要下游请另开 `downstream` 能力，当前不做。
- 自定义端口名时，方向仍以 `source` 节点为输出端；见 `canvas-data/src/canvas/connection.ts` 的 canonical 规则。

## 六、可嵌套上游（执行插件的基础）

> **状态：upstream 能力已实现（2026-10-18）。** `nodes/ofType/media/text/subscribe/closure/order` 可用；
> 节点插件已声明数据契约，但部分消费方仍走旧扫边实现（3D/对比有 TODO）。

上游不是只有一层。每个上游节点返回的对象**也能继续读它的上游**，并且提供“整条依赖链”的查询。

```ts
interface UpstreamNode {
  id: string
  type: string
  outputs: Readonly<Record<string, unknown>>
  /** 继续向上：这个节点自己的直接上游（与当前节点同一套读取规则） */
  upstream(options?: { includeTransient?: boolean }): UpstreamNode[]
  /** 整个祖先集合（去重，按发现顺序，不含自己） */
  ancestors(options?: UpstreamTraversalOptions): UpstreamNode[]
  /** 到最远祖先的最大层数（直接上游 = 1） */
  depth(options?: UpstreamTraversalOptions): number
}

interface UpstreamTraversalOptions {
  /** 是否跨过分组节点继续向上（缺省 false：分组是容器，不是数据源） */
  includeGroups?: boolean
  /** 是否包含中间态节点（拖线占位卡；缺省 false） */
  includeTransient?: boolean
  /** 最大层数；缺省不限（图本身有环检测） */
  maxDepth?: number
  /** 环/重复节点处理：'skip' 跳过已访问（缺省），'error' 抛错 */
  cycle?: 'skip' | 'error'
}
```

为什么要这样设计：

- **按需展开**：`node.upstream()` 只取一层，适合普通节点按需读；
- **整链查询**：`node.ancestors()` 一次拿全，适合诊断/染色/依赖面板；
- **可无限向上**：实现上是迭代（显式栈），不是递归；环检测保证不会死循环。

### 6.1 从末端倒推执行顺序

执行插件需要“从最后一个节点开始，按最早依赖先执行”。统一提供：

```ts
interface UpstreamCapability {
  // ……原有 nodes()/ofType()/media()/text()/subscribe()
  /** 从当前节点倒推整个依赖闭包，返回拓扑序（最早依赖在前，当前节点最后） */
  closure(options?: UpstreamTraversalOptions): UpstreamNode[]
  /** 只拿 id 的拓扑序（执行器调度用，避免暴露 outputs） */
  order(options?: UpstreamTraversalOptions): string[]
}
```

语义：

1. 从当前节点出发，沿 `target ← source` 反向收集所有祖先；
2. 去重；
3. 拓扑排序（DFS 后序）：**上游先出、当前节点最后**；同层按边加入序稳定输出；
4. 有环时返回 `cycle: 'error'` 抛错（消息列出环上的 id），`'skip'` 则跳过回边并继续。

示例：

```ts
const upstream = useCapability<UpstreamCapability>('upstream')
const plan = upstream.order()          // ['1', '3', '7', '12']，12 是当前节点
for (const id of plan) await runNode(id)
```

执行器应把 `plan` 当成**调度顺序**，不要自己再 DFS 一遍；节点内部的业务数据由节点自己的 `execute` 读取。

### 6.2 执行插件的接口建议

执行插件不要直接读 `doc` 或 `CanvasDocument`，统一经“图查询”抽象：

```ts
interface ExecutionGraph {
  node(id: string): GraphNode | undefined
  /** 当前节点的直接上游（source → target） */
  upstreamOf(id: string): string[]
  /** 从 targetId 倒推的拓扑序（最早依赖在前，target 最后） */
  orderFor(targetId: string, opts?: UpstreamTraversalOptions): string[]
}
```

- 前端实现：`doc` + `upstreamGraph` 纯函数。
- 后台实现：`canvasDoc.read()` + 同一份 `upstreamGraph` 纯函数。
- 执行插件只依赖 `ExecutionGraph`，从而同一套调度能跑在浏览器（本地执行）和 cloud-server（后台执行）。
- 每个节点的 `execute` 负责“拿自己的上游输出 → 调工具/模型 → 写回自己的 `data`”；调度器只保证顺序与失败回滚。

执行插件的最小节点接口建议：

```ts
interface ExecutableNode {
  /** 只读上游（已经执行完，outputs 可信） */
  readonly inputs: Readonly<Record<string, unknown>>
  /** 写运行态进度；不写业务字段 */
  progress(pct: number, message?: string): void
  /** 执行；返回值写进自己的 produces */
  execute(): Promise<Record<string, unknown>>
}
```

失败语义：某个节点抛错 → 调度器停止后续节点，把已执行节点标 `done`、当前标 `failed`、未执行标 `pending`；重试从失败节点开始，不重跑已完成节点（除非用户显式“全部重跑”）。

### 6.3 前端与后台共用同一份遍历

遍历只依赖“节点表 + 边表”，不依赖 Vue/DOM。建议放在 `canvas-data` 的纯函数模块（例如 `upstreamGraph.ts`）：

```ts
function collectAncestors(startId, graph, options): string[]
function topoOrderFrom(startId, graph, options): string[]
```

- 前端：`graph = { nodes: doc.getNodes(), edges: doc.getEdges() }`。
- 后台：`graph = { nodes: snapshot.nodes, edges: snapshot.edges }`，`snapshot = await canvasDoc.read()`（`CanvasDocument` / `CanvasDocLike` 已有；`read()` 返回 `{ nodes, edges }`）。
- 两边调用同一函数，保证“前端看到的依赖链”和“后台执行器算出的依赖链”一致。

实现建议（纯函数，零 Vue）：

```ts
// 1) 先建索引：target → source[]（只保留非中间态边）
const parents = new Map<string, string[]>()
for (const e of edges) {
  if (!includeTransient && isTransient(e)) continue
  const list = parents.get(e.target) ?? []
  list.push(e.source)
  parents.set(e.target, list)
}

// 2) 显式栈遍历（不是递归）：收集祖先，同时检测环
const seen = new Set<string>()
const stack = [startId]
const cycleNodes: string[] = []
while (stack.length) {
  const id = stack.pop()!
  for (const p of parents.get(id) ?? []) {
    if (p === startId) { cycleNodes.push(id, p); continue }  // 回边
    if (seen.has(p)) continue
    seen.add(p)
    stack.push(p)
  }
}

// 3) 拓扑序：DFS 后序（依赖先出），只保留 startId 的闭包
const order: string[] = []
const state = new Map<string, 0 | 1 | 2>() // 0 未访问 / 1 在栈 / 2 完成
const visit = (id: string) => {
  const s = state.get(id) ?? 0
  if (s === 1) {
    if (cycle === 'error') throw new Error(`依赖环：${[...state.keys()].join(' -> ')}`)
    return
  }
  if (s === 2) return
  state.set(id, 1)
  for (const p of parents.get(id) ?? []) visit(p)
  state.set(id, 2)
  order.push(id)
}
visit(startId)
// order = [最早依赖, ..., startId]
```

要点：

- 用 `Map` 建反向索引，不每次遍历全表；节点/边上千时仍是线性。
- 环检测用“访问中”状态；`cycle:'error'` 抛出时带上环上的 id，便于界面定位。
- 分叉/菱形依赖靠 `seen` 去重；同一祖先只执行一次。
- `includeGroups:false` 时跳过 `group` 类型节点（容器不是数据源），但它的子节点仍按边关系参与。
- 拓扑序是**稳定**的：同一张图多次调用结果一致（按边加入序 + 节点 id 排序兜底）。

### 6.4 必须补的测试

| 场景 | 断言 |
|---|---|
| 三层链路 A→B→C，从 C 倒推 | `order(C) = [A,B,C]` |
| 分叉 A→C、B→C | A、B 都在 C 之前；同层顺序稳定 |
| 菱形 A→B→D、A→C→D | A 只执行一次；D 在 B、C 之后 |
| 环 A→B→A | `cycle:'error'` 抛出且消息含 A/B；`'skip'` 不死循环 |
| 中间态边/节点 | 默认被忽略；`includeTransient:true` 才参与 |
| 分组容器 | 默认不把组当数据源；跨组依赖仍能按边找到 |
| 前端 vs 后台 | 同一份 nodes/edges 调同一函数，结果逐项相同 |

### 6.5 允许（Vue 渲染函数示例，`h` 来自 `vue`）

```ts
const upstream = useCapability<UpstreamCapability>('upstream')
const image = upstream.media('image')
if (!image) return h(EmptyState, { text: '把图片节点连进来' })
```

### 6.6 禁止

- `doc.getEdges().filter(e => e.target === id)` 然后 `doc.getNode(e.source).data.imageUrl`；
- 写“兼容多个字段名”的分支（`imageUrl || url || src`）；
- 把上游 `data` 整包复制到自己的 `data`；
- 在没有声明 `consumes` 的节点里调用 `upstream.media` 或任何 `upstream.*`。

### 6.7 空态与错误

| 情况 | 行为 |
|---|---|
| 没有上游 | 返回空数组/undefined；组件显示空态文案 |
| 上游类型没声明 produces | 视为不可读；不要回退读 data |
| 上游字段有 `resourceId` 但地址失效 | 调 `media.resolve` 重建；失败显示“资源不可用” |
| 上游被删除 | `subscribe` 触发重算；旧引用不得继续持有 |

## 七、提供方行为

### 7.1 写字段

- 上传/生成媒体时，先 `resources.put` 拿 `resourceId`，节点里**只写这个 ID**；不要同时写解析后的地址。
- 不要把 `blob:` 地址写进长期字段；临时预览可以用，保存前必须清理。
- 渲染时才 `resolve(resourceId)`；解析结果不得写回 `data`。
- 资源引用与地址字段改名时，同步改 `produces` 声明与迁移函数。

> **现状提醒**：`restoreNodeMediaUrls` 目前在载入时把解析值写回 `data.xxxUrl`（`packages/canvas-data/src/resourceService.ts:178-193`）。
> 这是与目标形态相反的过渡实现；迁移时必须改成“只建内存视图”，否则“只存 ID”只是文档口号。

### 7.2 引用唯一与共享

- `resourceId` 是资源库里的持久身份，**同一份字节可以被多个节点共享**（复制节点、剪贴板粘贴、同一张图连给多个下游）。
- 删除节点时只删节点，不直接 `revoke(resourceId)`；由宿主按“当前所有节点仍引用的 ID 集合”统一清理未被引用的资源。
- 剪贴板跨页粘贴时，载荷里带 `resourceId` 而不是临时地址；目标页用自己的 `resolve` 取地址。
  > **现状提醒**：当前剪贴板会深拷贝整份节点 `data`（`plugin-clipboard/src/clipboardPlugin.ts:157-158,273-315`），临时地址也会一起进载荷；
  > 迁移时要改成“载荷只保留资源 ID 与非地址字段”，或粘贴后立即丢掉地址。
- 派生资源（缩略图、视频帧）用 `derived` 标记，不参与“未被引用即回收”的扫描。

### 7.3 提供给下游

- 在节点类型里声明 `produces`；不要要求下游知道你的服务名。
- 需要主动通知下游时，更新 `data` 即可；`upstream.subscribe` 会收到节点变化。
- 不要自己 emit 一个“上游变了”的全局事件；数据订阅是唯一真相。

## 八、媒体加节点（与上游契约的分工）

| 需求 | 用哪个 |
|---|---|
| 我要放一张新图片到画布 | `media.addNode('image', resourceId, pos)` |
| 我要读连进来的图片 | `upstream.media('image')` |
| 我要把图片写进已有节点 | `media.applyToNode(nodeId, 'image', resourceId)` |
| 我要把文本写进已有节点 | 短文本走节点自己的公开方法；长文本先 `media.put` 成 ID，再 `media.applyToNode(nodeId, 'text', resourceId)` |

不要把“新建节点”和“读上游”混成一个函数；它们的方向和生命周期不同。

## 九、现行实现对照表

| 节点 | 现行字段/行为 | 是否已声明 produces/consumes | 迁移动作 |
|---|---|---|---|
| `image` | 新写入目前**双写** `imageUrl` + `resourceId`；`addImageNode` 只写 URL；`outputs.contentType=image` | 否 | 加 `produces.image`；新写入只写 `resourceId` |
| `video` | 新写入目前 `videoUrl` + `resourceId` 双写；`outputs.contentType=video` | 否 | 加 `produces.video`；帧图独立 `frameResourceId` |
| `audio` | 新写入目前 `audioUrl` + `resourceId` 双写；波形峰值在 `data.audioWaveform`；`outputs.contentType=audio` | 否 | 加 `produces.audio`；波形移出或标缓存 |
| `text` | `text`；`outputs.contentType=text` | 否 | 加 `produces.text` |
| `3d-preview` | 读上游 `data.imageUrl`；`inputs.acceptsTypes=image` | 否 | 加 `consumes.image`；改 `upstream.media` + `resolve` |
| `image-compare` | 读上游 `imageUrl/cardWidth`；`inputs.acceptsTypes=image` | 否 | 加 `consumes.image`；左右各持 `resourceId` |
| `node-ui` | 自己扫边收集 image/video/audio/text/pano | 否 | 加 `consumes.*`；改用 `upstream` |

## 十、迁移顺序

1. 在 `canvas-data` 的类型上加 `produces/consumes`，旧注册不受影响。
2. 给 `text/image/video/audio` 补 `produces`，先不接消费方。
3. 给 `3d-preview/image-compare/node-ui` 补 `consumes`，逐个把读字段改成 `upstream`。
4. 每迁一个，补“字段改名会让测试失败”的契约测试。
5. 最后删兼容函数；删除前保留一个版本的弃用注释。

## 十一、待决问题

1. `image-compare` 的左右图是两个 `consumes.image` 槽，还是一个 `images[]`？建议两个槽：`left`/`right`。
   **槽名是数据层的名字，端口名是连接层的名字**；左右槽仍可共用 `target` 端口，顺序按边数组（当前实现就是这样），不需要引入 `refOrder`。
2. 视频帧图算 `image` 还是 `frame`？建议单独 `kind: 'frame'`，避免与用户上传图片混淆。
3. 文本是否允许 `resourceId`？建议允许大文本走资源库，但 `text` 字段仍保留短文本。
4. 分组节点是否需要有 `produces`？建议不需要；它是容器，不是数据源。

