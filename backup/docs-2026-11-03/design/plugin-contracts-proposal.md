# 插件协作契约 · 最佳方案（提案）

日期：2026-10-18。状态：**设计提案，未实现**。依据：`docs/tmp/plugin-coupling-audit/` 的 36 个插件审查与本次补充核对。

## 一句话

不新建“大而全的插件总线”。在现有 `ctx` 的三根轴（服务 / 注册场 / 作用域）上，补三样**可声明**的契约：
节点能产出什么、节点能消费什么、媒体怎么加。所有跨插件调用都走 `ctx`，插件之间不互相 import 实现。

## 目标

1. 插件作者不需要知道“图片插件叫什么、它的方法签名是什么”，也能往画布加一张图。
2. 任何节点都能按统一方式读取上游数据，不再各自扫边、猜 `data.imageUrl`。
3. 节点数据的字段名、类型、生命周期有单一来源；新增一种媒体类型不用改 N 个插件。
4. 上述能力可热卸、可诊断、可契约测试，缺提供方时有明确降级。

## 三条硬规则

1. **跨插件调用只经 `ctx`**：`ctx.get(服务名)`、`ctx.registryOf(场)`、`ctx.nodes.attach`、`useCapability`。插件源码不 import 另一个插件的实现。
2. **数据由拥有者写，消费方只读公开投影**：谁定义节点类型，谁声明字段；别人读 `upstream`/媒体能力，不直接猜字段。
3. **缺失即显式**：可选能力用 `tryGet`/能力场缺项裁决；不允许“读不到就静默当没有”，除非产品明确接受降级并写测试。

## 方案一：媒体能力（`media`）

> **状态：已实现（2026-10-18）。** `media` 已在 `createStandardCapabilities` 注册；图片插件已注册 `image` 创建器。

### 为什么

“加图片”现在没有统一入口：至少五处各自建图 —— 资产拖入/资源库添加到画布（`packages/ui/src/composables/ui.ts`）、风格库（`StyleLibraryOverlay.vue`）、文件拖入（`plugin-file-drop`）、视频截图（`plugin-node-video`）、`ImageService.addImageNode`。调用方要么知道插件名，要么自己拼字段。

### 形状

在 `registryOf('capability')` 里新增 `media` 能力（与 `node/zoom/tools` 同一套 `useCapability` 机制）：

```ts
interface MediaCapability {
  /** 把一段字节放进资源库，只返回持久引用（不返回 URL） */
  put(blob: Blob, opts: {
    kind: MediaKind
    name?: string
    /** 派生资源（缩略图/帧图）的稳定槽名；给了才可复用，不写进节点 resourceId */
    ref?: string
    derived?: boolean
  }): Promise<ResourceId>
  /** 把已有资源引用变成当前可显示的临时地址 */
  resolve(id: ResourceId): Promise<string | undefined>
  /** 放一个媒体节点；由已安装的节点类型提供，返回节点 id */
  addNode(kind: MediaKind, id: ResourceId, position: Point, opts?: {
    nodeType?: string
    /** 写入节点时一并提交的元数据（宽高、名称、来源）；由目标节点类型解释 */
    meta?: Record<string, unknown>
  }): string | undefined
  /** 把媒体写进现有节点（按该节点类型声明的媒体槽） */
  /** slot = 目标节点 produces 的槽名（持久字段由该类型声明）；不是 consumes 的槽名 */
  applyToNode(nodeId: string, slot: string, id: ResourceId, meta?: Record<string, unknown>): boolean
  /** 当前能放哪些媒体类型；用于菜单/降级 */
  available(): MediaKind[]
}
type MediaKind = 'image' | 'video' | 'audio' | 'text' | 'pano' | 'file'
type ResourceId = string
```

### 归属

- `put/resolve` 由宿主（`canvas-data` 的 `resources` 服务）提供，媒体能力只做薄转发，不自己存字节；`canvas-base` 只重导出类型。
- **`put` 只回 ID，不回 URL**；`resolve` 是唯一的“ID → 地址”出口。节点数据、注册场条目、存档里都不保存解析后的地址。
- 本地后端与云端后端只在 `resolve` 内部不同：本地按 ID 取字节并生成临时 object URL；云端把 ID 映射到受控的资源路由。调用方不区分环境。
- `addNode/applyToNode` 由**节点类型插件**注册：例如图片插件注册 `image` 的创建器，视频插件注册 `video` 的创建器。媒体能力把 `kind` 路由到已注册的创建器。
- 多个插件注册同一 `kind`：需要一个按 `kind` 的注册场（或 `media` 内部自己维护顺序），**不能直接套用能力场**——能力场现在只按能力名做键，没有“按 kind 取条目”的语义。建议在 `media` 内部维护 `kind → creator[]`，按 `order` 取最小者。

### 调用方怎么写

```ts
const media = useCapability<MediaCapability>('media')   // 区域组件内
// 或 const media = ctx.get('media')（逻辑插件里，如果选择把它做成服务）
const id = await media.put(blob, { kind: 'image', name: '截图.png' })
media.addNode('image', id, pos)
```

### 迁移影响

- `plugin-node-image` / `plugin-node-video` / `plugin-node-audio` 各注册自己的创建器；服务仍保留，作为兼容层。
- `plugin-file-drop`、`packages/ui` 的资产入库/添加画布、`plugin-node-video` 的截图改调 `media`，删除重复的“建图片节点 + 写字段”代码。`plugin-agent` 只管引用标签与对话附件，不负责落画布。
- 生成工具结果写回统一走 `media.applyToNode` 或节点自己的 applier，不再由每个工具插件猜字段。

## 方案二：上游读取（`upstream`）

> **状态：已实现（2026-10-18）。** `upstream` 已在 `createStandardCapabilities` 注册；支持无限向上与倒推拓扑序。

### 为什么

现在真正扫 `doc.getEdges()` 的是 `node-ui`、图片对比和底栏的参考选择浮层；3D 从渲染上下文 `renderEdges` 读，视频不扫边。它们各自读一套字段，图片插件改 `imageUrl`，3D 就静默变空。

### 形状

在能力场新增 `upstream` 能力，按**当前节点**读取入边，不暴露“怎么扫图”：

```ts
interface UpstreamCapability {
  /** 直接上游（边 source → 本节点 target） */
  nodes(): UpstreamNode[]
  /** 按内容类型过滤（与 PortDef.acceptsTypes 同词表） */
  ofType(kind: string): UpstreamNode[]
  /** 取某媒体槽的第一项（节点类型声明了 consumes 才能用） */
  media(slot: string, ordinal?: number): UpstreamMedia | undefined
  /** 取上游文本，按边序拼接（可选分隔符） */
  text(separator?: string): string
  /** 订阅上游变化（节点/边变化时触发） */
  subscribe(fn: () => void): () => void
  /** 从当前节点倒推整个依赖闭包，返回拓扑序（最早依赖在前，当前节点最后） */
  closure(options?: UpstreamTraversalOptions): UpstreamNode[]
  /** 只拿 id 的拓扑序（执行器调度用） */
  order(options?: UpstreamTraversalOptions): string[]
}
interface UpstreamNode {
  id: string
  type: string
  /** 由上游节点类型声明的产出投影，不直接暴露原始 data */
  outputs: Readonly<Record<string, unknown>>
  /** 继续向上：这个节点自己的直接上游 */
  upstream(options?: { includeTransient?: boolean }): UpstreamNode[]
  /** 整个祖先集合（去重，不含自己） */
  ancestors(options?: UpstreamTraversalOptions): UpstreamNode[]
  /** 到最远祖先的最大层数（直接上游 = 1） */
  depth(options?: UpstreamTraversalOptions): number
}
interface UpstreamMedia { kind: string; resourceId: string; width?: number; height?: number }
interface UpstreamTraversalOptions {
  includeGroups?: boolean
  includeTransient?: boolean
  maxDepth?: number
  cycle?: 'skip' | 'error'
}
```

### 关键约束

- **不返回原始 `data`**：消费方拿 `outputs`，字段名由上游节点类型声明；这样字段改名只改一处。
- **订阅自动回收**：能力实例按节点创建，订阅挂在组件作用域；插件卸载/节点删除即断。
- **无上游时返回空数组/undefined**，不抛错；需要“必须有一个”的节点在自己的组件里显式报空态。
- **上游可嵌套、可无限向上**：每个 `UpstreamNode` 都能继续 `upstream()`；实现用迭代 + 已访问集合，环检测兜底。
- **执行顺序统一由 `order()` 提供**：执行插件不要自己 DFS；`order()` 返回“最早依赖在前、当前节点最后”的拓扑序。

### 调用方怎么写

```ts
const upstream = useCapability<UpstreamCapability>('upstream')
const image = upstream.media('image')       // 节点类型声明 consumes.image 后才有
const texts = upstream.ofType('text')
// 嵌套上游：继续读上游的上游
const first = upstream.nodes()[0]
const grandParents = first?.upstream()
const allAncestors = upstream.closure()
// 执行插件：从当前节点倒推的拓扑序（最早依赖在前，当前节点最后）
const plan = upstream.order()
```

### 迁移影响

- `plugin-node-3d-preview` 的 `findUpstreamImageUrl`、`plugin-node-image-compare` 的 `incomingImageEdgeIds`、`plugin-node-ui` 的 `buildNodeContext`、底栏的 `collectUpstreamMaterials` / `ReferenceSelectOverlay` 逐步改为 `upstream`。
- 保留旧函数作为兼容垫片，但加“新代码禁止使用”的注释与 lint 规则（可后续加）。

## 方案三：节点数据声明（`NodeDataTypeDef`）

> **状态：已实现（2026-10-18）。** `produces/consumes` 已进入 `NodeRegisterDef` 并带三选一校验。

### 为什么

节点注册现在有 `inputs/outputs`（连接约束）但没有“产出/接收的字段是什么”。所以消费方只能看 `data` 猜，且节点作者不知道“我应该把图片写进哪个字段”。

### 形状

给 `NodeRegisterDef` 增加可选字段（不破坏现有注册）：

```ts
interface NodeDataTypeDef {
  /** 本节点对外提供的数据，按槽名；值从 data 投影 */
  produces?: Record<string, DataPortDef>
  /** 本节点读取上游的数据，按槽名；与 produces 的 key 对应 */
  consumes?: Record<string, DataPortDef>
}
interface DataPortDef {
  /** 内容类型，与 PortDef.contentType/acceptsTypes 同词表 */
  kind: string
  /** 资源持久引用字段；与 valueField/externalUrlField 三选一 */
  refField?: string
  /** 非资源的普通值字段（如 text）；与 refField/externalUrlField 三选一 */
  valueField?: string
  /** 仅无资源实体的外部地址才声明；与 refField/valueField 互斥 */
  externalUrlField?: string
  /** 是否必需；缺值时消费方显示空态 */
  required?: boolean
}
```

示例（图片节点）：

```ts
ctx.nodes.register({
  type: 'image',
  label: '图片',
  size: { w: 320, h: 240 },
  produces: { image: { kind: 'image', refField: 'resourceId' } },
  consumes: { text: { kind: 'text', valueField: 'text' } },
  inputs: [{ port: 'target', acceptsTypes: ['text', 'image'] }],
  outputs: [{ port: 'source', contentType: 'image' }],
  in: ImageContent,
})
```

### 与现有 `inputs/outputs` 的关系

- `inputs/outputs` 继续负责**能不能连**（端口、容量、类型）。
- `produces/consumes` 负责**连上之后读什么**。两者共用 `kind` 词表，不另造一套。
- 没声明 `produces/consumes` 的类型照旧可连，只是 `upstream.outputs` 为空；这是明确的兼容边界。

### 迁移路径

1. 先在 `canvas-data` 类型上加字段与校验，旧注册不受影响。
2. 给图片、视频、音频、文本、3D、对比、分组逐个补声明；每补一个，就把对应消费方的猜测代码迁到 `upstream`。
3. 补契约测试：字段改名时 `upstream` 测试失败，而不是界面静默空白。

## 实施：把“加图片”收成一条链

目标链路：**字节 → `media.put` → 持久 ID → `media.addNode('image', id, pos)` → 图片节点只写 `resourceId` → 渲染时 `resolve(id)`**。

### 渲染侧的统一解析

节点内容组件不能再直接读 `data.imageUrl`/`data.videoUrl`。推荐在 `canvas-render` 提供一个公共 hook：

```ts
const src = useResourceUrl(() => props.data?.resourceId)
// src 是 Ref<string | undefined>；内部调 resources.resolve，卸载时取消
```

> `useResourceUrl` 是**提案 API**，当前 `canvas-render` 没有导出；迁移完成前直接用 `ctx.get('resources').resolve`。

- 本地：`resolve` 取字节、生成临时 object URL，组件卸载时回收。
- 云端：`resolve` 返回受控资源路由；调用方代码不变。
- 旧存档：`resourceId` 缺失时回退读旧 `xxxUrl`，只作迁移分支，不写回。
- 导出/截图：先 `resolve` 再交给 `html-to-image`，导出结束后不把地址写回节点。

| 场景 | 现在 | 目标 |
|---|---|---|
| 文件拖入 | 自己判断图片/视频，自己建节点写字段 | `media.put` + `media.addNode` |
| 视频截图 | 直接 `doc.createNode('image', …)` 写图片字段 | `media.put` + `media.addNode('image', …)` |
| 资产导入 | 读资产 URL，直接建节点 | 先把字节 `media.put` 成 ID，再 `media.addNode` |
| AI 生成结果 | 工具插件返回 URL，节点 applier 写字段 | 先 `media.put` 成 ID，再 `media.applyToNode` |
| 3D/对比读图 | 扫边读 `imageUrl` | `upstream.media('image')` |

这条链落地的验收：删除 `plugin-node-image` 后，视频截图不崩，`media.available()` 不含 `image`，界面给出“未安装图片节点”的明确提示。

## 备选方案与取舍

| 方案 | 做法 | 取舍 |
|---|---|---|
| A. 继续用服务名 `image` | 所有插件 `ctx.get('image')` | 调用方必须知道插件名与方法；换实现要改所有调用方；不采纳为主方案 |
| B. 新造一个“插件总线”大服务 | 一个服务包办节点/媒体/上游 | 会把“按种类”的注册场又变成“按名字”的大对象；不采纳 |
| C. 现有能力场扩展（本提案） | `media`/`upstream` 作为能力，`produces/consumes` 作为节点声明 | 复用现有缺项裁决、每节点实例、热卸与诊断；推荐 |

## 实施顺序

1. **先统一资源引用形态**：持久引用只能是逻辑 ID（不是 URL）；`resolve` 负责 ID → 地址；恢复流程不再写回 `data`。见迁移清单第 0 步。
2. **再定义类型，不接线**：`NodeDataTypeDef`、`MediaCapability`、`UpstreamCapability` 的类型与测试夹具。
3. **宿主注册标准能力**：`createStandardCapabilities` 增加 `media`/`upstream` 默认实现；没有节点类型注册时 `available()` 为空。
4. **图片节点第一个接线**：注册 `produces.image` 与 `media.addNode('image')`；视频截图改为调用它。
5. **文本/音频/视频跟进**：每加一个，补一条“装 A 不装 B”的装配测试。
6. **收口重复实现**：3D、对比、node-ui、底栏逐个迁移；迁移一个删一个旧函数。
7. **最后拆包**：等契约稳定后再拆 `bottom-bar`、`node-ui` 的职责；不要反过来先拆。

## 需要你确认的产品口径

### 失败与降级

| 场景 | 行为 |
|---|---|
| `put` 失败（无后端/网络） | 抛错，调用方显示“保存资源失败”；不建空节点 |
| `resolve` 返回 `undefined` | 组件显示“资源不可用”，保留节点与元数据 |
| `media.addNode` 没有对应 kind 的创建器 | 返回 `undefined`，调用方显示“未安装对应节点插件” |
| `applyToNode` 目标类型没有声明该槽 | 返回 `false`，不静默写 `data` |
| 云端资源 404 | `resolve` 返回 `undefined`；不做自动重传（需要用户确认） |

### `refField` / `valueField` / `externalUrlField` 校验

- 三者恰好给一个；给两个或零个，注册时抛清晰错误。
- `refField` 的值必须是资源 ID，不能是 `http(s):` / `blob:` / `data:`。
- `valueField` 只用于非资源值（`text` / `json` / 小标量）。
- `externalUrlField` 只用于没有资源实体的外部地址。

1. **一个媒体类型允许多个提供者吗？** 例如两个“图片节点”插件。建议允许，按 `order` 取赢家，`available()` 只列去重后的 kind。
2. **`media.addNode` 的尺寸/元数据谁负责？** 建议由目标节点类型的创建器负责测量并写入；调用方只传 `meta`（如来源、原始文件名），不直接写 `imageWidth/imageHeight`。
3. **媒体写进现有节点时，节点类型没有声明对应槽怎么办？** 建议返回 `false` 并给明确原因，不静默写 `data`。
4. **上游数据是否允许读取原始 `data`？** 建议禁止在公开能力里返回整包 data；调试/诊断可以用 `ctx.surface()`。
5. **文本算不算媒体？** 建议算，`MediaKind` 包含 `text`，但 `put` 只接受 Blob；短文本直接写 `data.text`（`valueField`），长文本另走资源库并由节点类型声明 `refField`。

