# 注册一个节点类型：ctx.nodes.register 与 registerNodeType

> 来源：packages/canvas-core-v2/src/core/capabilities.ts、registry/registerNodeType.ts、registry/nodeRegistry.ts、registry/nodeRenderer.ts、services/nodeStore.ts

插件要往画布上加一种"新节点"（比如文本块、图片块），只需注册一个**节点类型**：说清这个节点的数据形状/默认尺寸、用什么组件渲染、能不能连/怎么连。

---

## 1. 一条 API 搞定的写法（推荐）：`ctx.nodes.register`

在插件 apply 里调 `ctx.nodes.register(def)`，一次把**数据 + 展示 + 可选建节点**都给全：

```ts
apply(c) {
  c.nodes.register({
    type: 'text',                          // 唯一类型名
    label: '文本',                          // UI 上显示的名字
    size: { w: 300, h: 200 },              // 默认尺寸
    in: TextContent,                       // in 区域组件（opaque 句柄，通常是 .vue）——老字段 content 已下线
    title: TitleBar,                       // 可选：标题区域组件
    // 可选：声明式连接约束（见下）
    inputs: [{ accepts: ['image'], limit: 'single' }],
    outputs: [],
    // 可选：建一个该 type 节点的实现（挂 nodeFactory）
    create: (pos) => ctx.get('doc').createNode('text', pos),  // 返回新节点 id
  })
}
```

`NodeRegisterDef` 全字段（源码为准）：

```ts
interface NodeRegisterDef {
  type: string
  label: string
  size: { w: number; h: number }
  in?: unknown               // 卡片内部（in 区域）组件，最常见（老字段 content 已在步骤 9 下线）
  title?: unknown
  segments?: Partial<Record<NodeRegion, unknown>>   // NodeRegion = 十个区域词，见 canvas/region.ts
  inputs?: Array<{ port?: string; accepts?: string[]; limit?: 'single'|'multi' }>
  outputs?: Array<{ port?: string }>
  create?: (position: { x: number; y: number }) => string
}
```

**注册自动回收**：插件卸载 / stop 时，`doc` 类型表里的 type 与 nodeRegistry 的展示一起注销，支持同名插件重装（热重载）。

> 注意：`ctx.nodes.register` 内部会去 `ctx.get('doc')` 存数据（`doc.registerType`）、`ctx.get('nodeRegistry')` 存展示。
> 所以装配前要保证这两个服务在（现行由 `canvasBasePlugin` 装配）。
> ⚠️ **步骤 5c 起 `nodeStore` 不再是服务名**（`ctx.get('nodeStore')` 返回 `undefined`）——
> 旧写法 `ctx.inject('nodeStore', new NodeStore())` 已过时，数据侧统一走 `doc`。

---

## 2. 低层入口：registerNodeType(ctx, def)（逻辑同 ctx.nodes，可单独调用）

`ctx.nodes.register` 内部就是调 `registerNodeType`。想不走能力段、直接在插件里调也成：

```ts
import { registerNodeType } from '@mini-canvas/canvas-data'

registerNodeType(ctx, {
  type: 'audio',
  label: '音频',
  defaultSize: { w: 100, h: 60 },
  segments: { in: AudioContent },            // 展示区域（区域词 in = 卡片内部；老名 content 已下线）
  inputs: [{ port: 'target', accepts: ['source'], limit: 'multi' }],
  outputs: [{ port: 'source' }],
})
```

`NodeTypeDef`（registerNodeType 用，字段名略不同——默认尺寸叫 `defaultSize`）：

```ts
interface NodeTypeDef {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  segments?: Partial<Record<NodeSegment, unknown>>
  inputs?: Array<{ port?: string; accepts?: string[]; limit?: 'single'|'multi' }>
  outputs?: Array<{ port?: string }>
}
```

返回值 `revoke` 会自动登记进当前插件 Scope，插件卸载时注销数据+展示。

> `ctx.nodes.register` 与 `registerNodeType` 的参数差异：前者把 `size` 映射成后者的 `defaultSize`，并把 `in/title` 合并进 `segments`（步骤 9 起字段名就是区域词 `in`，老名 `content` 是类型错误）。展示层(nodeRegistry)组件用 opaque 句柄，内核不 import Vue，宿主喂 .vue、测试喂 stubs。

---

## 3. 数据侧：节点类型 & 节点数据（nodeStore）

节点数据存 `NodeStore`（底层对象；步骤 5c 起**服务名下线**，消费方经 `ctx.get('doc')` 的
`types` / `registerType` 读与写）。它管两件事：**类型注册表**（type → 定义）和**节点实例集**（id → 节点数据）。

### 3.1 注册类型（registerType / unregisterType）

```ts
nodeStore.registerType({
  type: 'text', label: '文本', defaultSize: { w: 300, h: 200 },
  inputs: [...], outputs: [...],
})
nodeStore.unregisterType('text')   // 注销（热卸回收）
```

> 类型**重复注册抛错**（`node type "x" already registered`）。

### 3.2 节点实例 CRUD（底层 nodeStore 对象；消费方改走 `doc`，见下方对照）

> ⚠️ **下面这段是底层 `NodeStore` 对象的用法**（`nodeStore.addNode/getNode/...`），
> 用于说明底层实现与单测。**插件/消费方不要照抄**——`nodeStore` 已不是服务名，
> 且 `doc` 上**没有** `addNode`（单数）。现行等效写法：

```ts
const doc = ctx.get<DocService>('doc')
doc.getNodes()                                // = nodeStore.getNodes()
doc.getNode(id)                               // = nodeStore.getNode(id)
doc.childNodesOf(parentId)                    // 层级查询（容器型节点用）
doc.types                                     // = nodeStore.types（只读投影）
doc.createNode('text', { x: 10, y: 20 }, data)   // 建节点，返回 id
doc.addNodes([{ type: 'text', position, data }]) // 批量建，返回插入数
doc.updateNode(id, { data: { text: '你好' } })    // 改节点
doc.updateNodeData(id, { text: '你好' })          // = updateNode(id, { data })
doc.removeNodes([id])                         // 删节点（连带清相连边/子节点父引用/选中）
doc.replaceAll(nodes, edges)                  // 整体回填（刷新恢复；不清历史）
doc.subscribe((change) => { /* change = { kind:'node'|'edge', reason, id? } */ })
```

```ts
const id = nodeStore.addNode('text', { x: 10, y: 20 })  // 建一个，返回短数字 id，如 '1'
const n = nodeStore.getNode(id)      // { id, type, position, data }
nodeStore.updateNodeData(id, { text: '你好' })   // 改 data（合并进去）
nodeStore.removeNode(id)             // true
nodeStore.replaceAll(nodes)          // 整体回填（刷新恢复）
nodeStore.getNodes()                 // 全部节点数组
```

`CanvasNode` 最小形状：

```ts
interface CanvasNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}
```

节点 id 是**短数字累加**（'1' '2' '3'…），画布内唯一；`replaceAll` 会重建计数器避免撞已有数字 id。

### 3.3 订阅变化（subscribe）

渲染层/宿主靠它自动刷 UI：

```ts
const unsub = nodeStore.subscribe((reason, nodeId) => {
  // reason: 'add' | 'remove' | 'update' | 'replace'
  // nodeId: replace 时为 undefined
})
unsub()   // 取消
```

> `NodeStoreService` 接口在 `services/nodeStore.ts`；`CanvasNodeType` 的 `inputs/outputs` 即声明式连接约束（见连接校验篇）。

---

## 4. 展示侧：NodeRegistry（每段用什么组件）

`NodeRegistry`（`ctx.get('nodeRegistry')`）只存"**用哪个组件渲染某 type 的每个区域**"。
区域的**现行词表是十个区域词**（步骤 9）：`title` / `in` / `out:top` / `out:bottom` / `out:left` /
`out:right` / `on:top` / `on:bottom` / `over:inset` / `over:outset`。
老四段名 `content`（→ `in`）/ `top-toolbar`（→ `out:top`）/ `bottom-toolbar`（→ `out:bottom`）/
`overlay`（→ `over:inset`）**已下线**：类型上不再是 `NodeRegion`，运行时 `assertRegion` 抛错并列出十个合法词。

```ts
const reg = ctx.get('nodeRegistry')
reg.register('text', { in: TextContent })            // 注册展示定义（重复抛错）
reg.get('text')?.segments.in                         // 取 in 区域组件
reg.has('text')                                      // true
reg.types()                                          // ['text', ...]
reg.unregister('text')                               // 注销
```

### 4.1 每段还能叠多个 occupant（开放叠加槽）

一段既可是"基座单值"，也能让**多个插件往同段叠加**（装饰层/徽标层）。这是多 occupant 槽语义（`NodeSegmentContribution`：`{ id?, order?, component }`）。

```ts
// 插件 A、B 都往 text 的 in 区域叠徽标
reg.registerContribution('text', 'in', { id: 'badgeA', component: BadgeA })
reg.registerContribution('text', 'in', { id: 'badgeB', order: 1, component: BadgeB })
reg.contributionOccupants('text', 'in')   // 按 order 升序：[BadgeA, BadgeB]
reg.unregisterContribution('text', 'in', 'badgeA')  // 只抽走 A
```

- 同 id 已存在 → 替换该格；否则追加。
- order 缺省 = 当前叠加层最大 order + 1（默认排在基座之后）。
- 热卸只抽走该插件贡献的 occupant，基座与其它的原位保留。

### 4.2 读展示的纯函数（NodeRenderer）

宿主 / BaseNode 用这些把 type 解析成"该渲染啥"：

```ts
import { resolveSegment, hasContent, activeSegments, nodeSegmentStack } from '@mini-canvas/canvas-core-v2'

resolveSegment(reg, 'text', 'in')      // 单值 = 该区域基座组件（没有给 undefined）
nodeSegmentStack(reg, 'text', 'in')    // 可叠加渲染：基座 + 按 order 的叠加 occupant，全量组件数组
hasContent(reg, 'text')                // in 区域是否显式注册（历史名，语义 = 有没有"内容区域"基座）
activeSegments(reg, 'text')            // 哪些区域"要渲染"（有组件或 occupant）
```

---

## 5. 建节点统一入口：nodeFactory（可选 create 会挂这里）

如果你给 `create`，内核把它注册进 `NodeFactory` 服务（`ctx.get('nodeFactory')`），让"建一个 X 节点"收敛到一处，host/命令/菜单都只调 `create(type, pos)`：

```ts
factory.register('text', (pos, extra) => ctx.get('doc').createNode('text', pos))
const id = factory.create('text', { x: 0, y: 0 }, extra)   // 调 creator
factory.unregister('text')          // 注销
factory.creatableTypes()            // 可创建的 type 列表（如菜单枚举）
```

- `NodeCreator`：`(position, extra?) => string`（返回新节点 id，creator 内部写默认 data）。
- type 未注册 creator 时 `create` **抛错**（别静默）；重复注册抛错。

---

## 6. 坑与速记

1. **装配前要注入服务**：`ctx.nodes.register` / `registerNodeType` 需要 `doc`（数据侧）和 `nodeRegistry`（展示侧）已在 ctx（`ctx.get` 能取到）。展示段注册在没有 nodeRegistry 注入时会静默跳过（只落数据）。
2. `type` 全内核唯一：`doc` 类型表、nodeRegistry、nodeFactory 三处都以 type 为键，重复注册各自抛错。
3. 组件句柄是 **opaque**：内核不 import Vue，你传 .vue / stub / 任意对象都行。
4. 节点 id 是短数字自增；`replaceAll` 回填后 id 计数器会重建防撞。
5. 想渲染"该 type 当前该用什么"，宿主侧用 NodeRenderer 的 `resolveSegment / nodeSegmentStack` 等纯函数，别自己 copy 一份注册逻辑。
6. `ctx.nodes.register` 的 `create` 返回新节点 id 并自动挂 nodeFactory + 自动回收；不写 create 就用 `ctx.get('doc').createNode(...)` 手动建（`doc` 上**没有** `addNode`）。
