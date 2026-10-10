# `doc` · 画布数据

**一句话定位**：`ctx.get('doc')` 是拿画布数据的**唯一入口** —— 节点、边、事务、撤销、快照、订阅，
全在这一个名字下面。

**它属于哪一档**：**画布基础**。它既不是内核自带，也不在渲染层，而是由 `canvas-base` 这一件基础插件提供的。
谁提供、怎么上架，看 `packages/canvas-data/src/canvas/canvasBasePlugin.ts`（建好实例后 `ctx.inject('doc', doc)`）；
服务形状（每个方法长什么样）定义在 `packages/canvas-data/src/docService.ts`。

## 用法

`doc` 的方法分六组。下面签名与源码一致，照着抄不会错。

### 第一组：读

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `getNodes(): CanvasNode[]` | 取当前全部节点 | 遍历/统计画布上有什么 |
| `getNode(id: string): CanvasNode \| undefined` | 取某一个节点 | 已知 id，要读它的数据 |
| `childNodesOf(parentId: string): CanvasNode[]` | 取某节点的直属子节点 | 容器型节点（分组）数自己的成员 |
| `getEdges(): CanvasEdge[]` | 取当前全部边 | 找连线、做统计 |
| `getEdge(id: string): CanvasEdge \| undefined` | 取某一条边 | 已知边 id |
| `readonly types: ReadonlyMap<string, CanvasNodeType>` | 已注册的节点类型表（只读投影） | 菜单列出"能建哪些节点" |

### 第二组：节点类型表（数据那半边）

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `registerType(def: CanvasNodeType): void` | 注册一个类型的**数据部分**（类型名/标题/默认尺寸/连接约束） | 低层入口，一般由 `ctx.nodes.register` 代劳 |
| `unregisterType(type: string): void` | 注销某类型（不存在也不报错） | 热卸插件时回收 |
| `updateTypeSize(type: string, size: { w: number; h: number }): void` | 改某类型的默认尺寸 | 设置面板调"默认尺寸"，没被拖过尺寸的节点立刻跟着变 |
| `nextTypeName(type: string): string` | 取该类型下一个默认名（"文本 3"）并推进序号 | 给存量节点补名字，避免和新建的撞号 |

> 作者侧请用 `ctx.nodes.register({...})`：它一次把**数据**和**展示**两处都落表。
> `doc.registerType` 只落数据那半边，是给 `registerNodeType` 这类助手复用的低层口。

### 第三组：写（自动进撤销 + 自动排队落盘）

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `createNode(type, position, data?): string` | 按已注册类型建一个节点，返回 id | 最常用的建节点方式 |
| `nextNodeId(): string` | 取下一个可用节点 id（短数字 `'1'` `'2'`）并占掉 | 要**先拿到 id**才能连边/选中时 |
| `nextEdgeId(): string` | 取下一个可用边 id 并占掉 | 同上，边的情况 |
| `addNodes(inputs: AddNodeInput[]): number` | 批量插入（可指定 id/data/size/parentId），返回插入数 | 粘贴、恢复、批量导入 |
| `updateNode(id, patch): void` | 改一个节点（position / size / parentId / data 任意子集） | 通用改法 |
| `updateNodes(entries: NodePatchEntry[]): void` | 批量改，算**一条**撤销 | 一次拖动一批节点 |
| `updateNodeData(id, data): void` | 只改 data | 内容组件上报改动 |
| `setNodeLabel(id, label): void` | 改标题（传空串/undefined/全空白 = 清掉标题，显示回类型名） | "改名字"的一等入口，别自己拼 `data.label` |
| `moveNode(id, position): void` | 移到绝对坐标（同父坐标系） | 只挪位置 |
| `moveNodes(entries): void` | 批量挪，算一条撤销 | 对齐、自动布局 |
| `setNodeParent(id, parentId): void` | 设/清父节点（`undefined` = 回到顶层） | 分组归属 |
| `setNodeSize(id, w, h): boolean` | 改卡片尺寸；**宽高不是正有限数就返回 false 且不写** | 图片换图后调尺寸 |
| `updateNodeRuntime(id, patch): void` | 写运行期状态：**落盘但不进撤销栈** | 进度帧这类"每几百毫秒一次、不该占撤销栈"的写 |
| `removeNodes(ids: string[]): number` | 删节点，连带清相连的边、清子节点的父引用、清选中 | 删除一律用它，别自己拆步骤 |
| `addEdge(input: AddEdgeRequest): string` | 加一条边（过守门人：自连/成环/重复/类型/容量） | 只想要边 id 时 |
| `connectEdge(input: AddEdgeRequest): ConnectEdgeResult` | 加边的**全路径统一入口**：校验 → 满额挤出 → 落边，返回 `{ edgeId, status, reason?, evictedEdgeId? }` | 想知道"到底建成了没有、没建成因为什么" |
| `removeEdges(ids: string[]): number` | 删边并清选中 | 删线 |

### 第四组：事务与撤销

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `transaction<T>(reason: string, fn: (tx: GraphTransaction) => T): T` | 把 fn 里的多次写**合并成一条撤销** | 建节点 + 连边这类"要么一起成、要么一起退"的操作 |
| `undo(): void` / `redo(): void` | 撤销 / 重做（对节点 + 边统一生效） | 由命令转发，一般不直接在插件里调 |
| `canUndo(): boolean` / `canRedo(): boolean` | 现在能不能撤销 / 重做 | 灰色按钮的判据 |
| `readonly undoDepth: number` | 撤销栈深度 | 诊断用 |

`transaction` 给回来的 `tx` 上可用的写方法有：
`createNode` / `addNodes` / `updateNode` / `updateNodeRuntime` / `updateNodes` / `removeNodes` /
`addEdge` / `connectEdge` / `removeEdges`。

### 第五组：快照与整体替换

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `snapshot(): GraphEnvelope` | 深拷贝一份 `{ nodes, edges }` | 想安全只读地留一份"当时的图" |
| `replaceAll(nodes, edges?): void` | 整图回填（刷新恢复 / 导入 / 云端整份覆盖）；**不清撤销栈** | 换一整张图 |
| `onCommit(cb: (envelope: GraphEnvelope) => void): () => void` | 订阅"整图已变"，返回取消函数 | 落盘方用；宿主已经接好，插件一般不用 |
| `hasPendingCommit(): boolean` | 当前待提交批次是不是空的 | 测试/诊断 |

### 第六组：订阅

| 方法 | 一句话 | 什么时候用 |
| --- | --- | --- |
| `subscribe(listener: (change: DocChange) => void): () => void` | 订阅节点**或**边任一变化，返回取消函数 | 想跟着数据变化做点事（刷新统计、补名字、续查任务） |

`DocChange` 长这样：`{ kind: 'node' \| 'edge', reason: 'add' \| 'remove' \| 'update' \| 'replace', id?: string }`。
`kind` 告诉你哪一桶变了，`id` 是本次涉及的节点/边（整体替换时为 `undefined`）。

> **一次订阅覆盖两桶**是刻意的：以前要分别订节点表和边表，忘订一个就"只响应一半"。

**硬依赖请写在模块顶层**（少了它会停在 PENDING，而不是让 `ctx.get` 返 undefined）：

~~~ts
export const inject = ['doc'] as string[]
~~~

## 注意事项

1. **`nodeStore` / `edgeStore` / `graph` / `history` 这四个服务名已下线。**
   它们并进了 `doc`，现在 `ctx.get('nodeStore')` 拿到的是 `undefined`。
   写 `inject: ['nodeStore']` 会让插件**永远停在 PENDING**——这是最常见的"插件不工作"原因。
   四个底层实例还在（宿主 `host.nodeStore` 上），但它们不再是按名可取的服务。

2. **`ctx.get('doc')` 缺服务时返回 `undefined`，不抛。**
   这条对**所有**服务都成立（`ctx.get` 的设计就是"可选依赖"）。所以上面那件事**不会报错**，
   只会安静地给你一个 `undefined`。硬依赖请一律写成模块顶层的
   `export const inject = ['doc']` —— 少了依赖时插件停在 PENDING，比运行到一半崩掉好查得多。

3. **改已不存在的节点会抛错。**
    `updateNode` / `updateNodeData` / `updateNodeRuntime` 走的节点表在节点不存在时直接抛
   （消息里带节点 id）。异步任务里尤其要小心：任务跑着的时候用户可能把节点删了，
   写进度之前先 `if (!doc.getNode(id)) return`。`plugin-bottom-bar` 的
   `packages/plugins/plugin-bottom-bar/src/nodeBarPlugin.ts` 就是这么防的。

4. **`getNodes()` 给的是"同一批节点的数组"，不是拷贝。**
   数组本身是新的，但里面的节点对象还是 store 里那一个 —— 直接改
   `doc.getNodes()[0].data.x = 1` 会**绕过**撤销与落盘，下次刷新就"数据不见了"。
   想安全地留一份，用 `doc.snapshot()`（它做深拷贝）。

5. **尺寸写不进去不是 bug，是拒写；而整图替换不记撤销。**
   `setNodeSize` 只在宽高都是**正有限数**时才写；传 0、负数、`NaN`、字符串会返回 `false` 且一个字节都不改。
   理由是：真的写进去会让卡片塌成看不见的形状，比"没生效"难查得多。
   同一条"别想当然"的还有 `replaceAll` —— 它是"整图换掉"（刷新恢复、导入、云端整份覆盖）的入口，
   **故意不碰历史**。想让用户能撤销刚才那次替换，得自己包一层 `transaction`。

