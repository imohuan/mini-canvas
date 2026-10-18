# 数据门面 doc（节点 + 边 + 事务 + 撤销）与建节点 nodeFactory

> 来源：`packages/canvas-data/src/docService.ts`、`packages/canvas-data/src/nodeStore.ts`、
> `packages/canvas-data/src/edgeStore.ts`、`packages/canvas-data/src/graphDocument.ts`、
> `packages/canvas-data/src/canvas/nodeFactory.ts`、`packages/canvas-data/src/canvas/canvasBasePlugin.ts`

画布最核心的两份数据 —— **节点**和**边** —— 都在数据层（零 Vue、可单测）。
消费方**只需要认识一个服务名：`doc`**。渲染层只读数据 + 订阅，变更 / 历史 / 落盘全在数据层。

---

## 1. 为什么只有一个门面：`doc`

老版把画布数据拆成四个服务（节点表 / 边表 / 图写入口 / 撤销栈），消费方要同时 inject 四个，
还得记住"读走谁、写走谁"——读类型走一个、写节点走另一个、撤销走第三个，一处搞错数据就漂移。

现在四个**名字**都下线了，只留 `doc` 一个门面（`packages/canvas-data/src/docService.ts`）。
背后那四个**类**还在（`NodeStore` / `EdgeStore` / `GraphDocument` / `History`），由
`createCanvasBasePlugin` 建好、直接交给门面持有。

```ts
import { Context, createCanvasBasePlugin } from '@mini-canvas/canvas-data'

const ctx = new Context()
const base = createCanvasBasePlugin()
ctx.plugin(base.plugin)             // apply 里 ctx.inject('doc', doc)
await ctx.start()

const doc = ctx.get('doc')          // 数据只有这一个名字
```

> 门面是**纯转发视图**（读 / 写 / 事务 / 撤销 / 快照 / 订阅），零状态、零画布语义。
> 底层缺哪一件就在用到它时抛错（消息写明缺谁），不静默返回空数据。

---

## 2. `doc` 的全部 API

类型定义见 `docService.ts` 的 `DocService`（`docService.ts:80`）。

### 2.1 读

```ts
doc.getNodes()                 // CanvasNode[]（只读快照）
doc.getNode(id)                // CanvasNode | undefined
doc.childNodesOf(parentId)     // 某父节点的直属子节点（容器型节点用）
doc.types                      // ReadonlyMap<string, CanvasNodeType>（已注册类型表，只读投影）
doc.getEdges()                 // CanvasEdge[]
doc.getEdge(id)                // CanvasEdge | undefined
```

### 2.2 写（唯一写入口：自动进历史 + 调度落盘）

```ts
doc.createNode('text', { x: 10, y: 20 })                 // 建一个，返回 id（如 '1'）
doc.addNodes([{ type: 'text', position: { x: 0, y: 0 }, data: { text: '嗨' } }])  // 批量，返回插入数
doc.updateNode(id, { data: { text: '你好' } })            // 改 position/size/parentId/data
doc.updateNodes([{ id, patch: { position: { x: 1, y: 2 } } }])  // 批量（原子，一条历史）
doc.updateNodeData(id, { text: '你好' })                  // = updateNode(id, { data })
doc.removeNodes([id])                                    // 删节点，返回删除数（连带清边 / 清父引用 / 清选中）
doc.addEdge({ source: '1', target: '2' })                 // 加一条边，过守门人校验，返回边 id
doc.connectEdge({ source: '1', target: '2' })             // 全路径统一入口，返回 { edgeId, status, reason?, evictedEdgeId? }
doc.removeEdges([edgeId])                                // 删边，返回删除数
```

**没有 `addNode`（单数）**：建节点用 `createNode(type, position, data?)`（返回 id）或 `addNodes([...])`。

### 2.3 事务与撤销重做

```ts
doc.transaction('批量重命名', (tx) => {         // tx 的写方法与 doc 同形；内部合并成一条历史
  for (const n of doc.getNodes()) tx.updateNode(n.id, { data: { ...n.data, tag: 'x' } })
})
doc.undo()          // 对节点 + 边统一快照生效；恢复后自动清选中 + 触发落盘
doc.redo()
doc.canUndo()
doc.canRedo()
doc.undoDepth       // 撤销栈深度（诊断用）
```

### 2.4 快照 / 整体替换 / 落盘钩子

```ts
doc.snapshot()                                   // GraphEnvelope = { nodes, edges }（深拷贝）
doc.replaceAll(nodes, edges)                     // 整体回填（刷新恢复 / 导入 / 云端整份覆盖）；不清历史
const off = doc.onCommit((envelope) => { /* 落盘方用 */ })
off()                                            // 取消
doc.hasPendingCommit()                           // 当前是否还有待提交批次（诊断）
```

### 2.5 订阅（一次订阅覆盖两桶）

```ts
const off = doc.subscribe((change) => {
  // change.kind:   'node' | 'edge'
  // change.reason: 'add' | 'remove' | 'update' | 'replace'   （node 有四种，edge 三种）
  // change.id:     本次涉及的节点 / 边 id（整体替换时为 undefined）
})
off()
```

### 2.6 类型表写口（低层，给助手与能力层复用）

```ts
doc.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })
doc.unregisterType('text')     // 不存在则 no-op
```

> 这两条是**只落数据侧**的低层口。作者注册节点类型的**正式入口是 `ctx.nodes.register(def)`**，
> 它一次把数据 + 展示两处都落表（见《注册节点类型》篇）。

---

## 3. 节点 id 与边 id 的规则

节点 id 是**短数字自增**（`'1'`、`'2'`、`'3'`…），画布内唯一。
`replaceAll` 会扫一遍已有 id 重建计数器（取最大数字），避免刷新回填后新建的 id 撞上已有数字 id。

边 id 由源 / 目标（以及端口）推出，纯函数 `edgeStoreId(source, target, sourceHandle?, targetHandle?)`：

```ts
edgeStoreId('1', '2')                       // 'e-1-2'
edgeStoreId('1', '2', 'out-a', 'in-b')      // 'e-1:out-a-2:in-b'（非默认端口才进 id）
edgeStoreId('1', '2', 'source', 'in-b')     // 'e-1-2:in-b'（'source' 是默认口，不进 id）
```

默认 handle（`'source'` / `'target'`）不进 id，所以单进单出的存量数据零改动。
同一条 canonical 连接天然同 id —— 这正是"重复边去重"的实现方式。

---

## 4. 背后的四个类（对象，不是服务名）

需要窄接口或要订阅时，宿主句柄上直接挂着它们（`CanvasHostHandle`），**但 `ctx.get` 取不到**：

| 类 | 在哪 | 直接用它做什么 |
| --- | --- | --- |
| `NodeStore` | `packages/canvas-data/src/nodeStore.ts` | 类型表 + 节点集的底层实现；渲染层要 `subscribe` / 拿 `types` |
| `EdgeStore` | `packages/canvas-data/src/edgeStore.ts` | 边集底层实现；渲染层读它画边 |
| `GraphDocument` | `packages/canvas-data/src/graphDocument.ts` | 图**唯一写入口**：事务 + 历史 + 选中维护 + 提交落盘 |
| `History` | `packages/canvas-data/src/history.ts` | 快照式撤销栈（`withRecord` / `undo` / `redo`） |

```ts
// 宿主门面（createMiniCanvasHost 返回的 host）上可直接拿到实例
const { host } = await createMiniCanvasHost()
host.nodeStore.getNodes()      // 读节点（渲染层订阅它自动重灌）
host.edgeStore.getEdges()
host.doc                       // 你要写数据时用这个（走唯一写入口）
```

> 记住一句话：**类还在、实例还在，但服务名只有 `'doc'`**。
> 写数据永远走 `doc`（它才进历史、才调度落盘）；只读订阅可以直接用实例（少一层转发）。

---

## 5. nodeFactory —— 统一建节点工厂（`ctx.get('nodeFactory')`）

把"放一个 X 节点"收敛成**每 type 注册一个 creator**，宿主 / 命令 / 菜单只调 `create(type, pos)`，
别处不再各自抄一遍建节点逻辑（见 `packages/canvas-data/src/canvas/nodeFactory.ts`）。

```ts
const factory = ctx.get('nodeFactory')

// 注册 creator；type 重复注册抛错
factory.register('text', (pos, extra) => {
  return ctx.get('doc').createNode('text', pos, { text: '' })
})

const id = factory.create('text', { x: 0, y: 0 }, extra)   // 调 creator，返回新节点 id
factory.unregister('text')                                 // 注销（不存在则 no-op）
factory.creatableTypes()                                   // 可创建的 type 列表（菜单枚举用）
```

`NodeCreator` 签名 = `(position: { x: number; y: number }, extra?: unknown) => string`
（`nodeFactory.ts:8`）。type 没注册 creator 时 `create` **抛错**（不静默）。

> 能力段 `ctx.nodes.register` 的 `create` 字段会自动挂到这里，并随插件卸载一起回收 —— 见
> 《注册节点类型》篇。

---

## 6. 坑与速记

> **读上游不要自己扫边**：`doc.getEdges()` 只给连接关系。节点要读上游数据时，
> 用能力场的 `upstream` 能力（见 `docs/design/node-data-and-upstream-contract.md`），
> 不要在每个插件里重复 `filter(e => e.target === id)` 再猜 `data.imageUrl`。

1. **数据只有一个名字 `doc`**：旧的四条名字已下线，`ctx.get` 取不到；`NodeStore`/`EdgeStore`/`GraphDocument`/`History` 是**类**，对象照用、服务名不认。
2. 建节点是 `createNode`（单数没有 `addNode`）；批量是 `addNodes(AddNodeInput[])`。
3. `updateNode` 的 patch 里**显式写 `undefined` 表示清该字段**（如 `parentId: undefined` 解除父子关系）。
4. 写数据必须走 `doc`：那才是"唯一写入口"，它负责进历史、清选中、级联清边、调度落盘。绕过它直接改底层实例，历史与落盘都会漏。
5. `doc.subscribe` 的 `reason` 词表是两桶并集：节点四种（`add/remove/update/replace`），边三种（`add/remove/replace`）。
6. `replaceAll` **不清历史**（它是"整份覆盖"语义，不是一次可撤销的操作）；刷新恢复 / 导入 / 云端合并用它。
7. 删节点经 `doc.removeNodes` 会连带清掉相连的边、清掉子节点的父引用、清掉选中态 —— 不需要自己写这三步。
