# 数据服务：nodeStore（节点数据）、edgeStore（边数据）、nodeFactory（建节点）

> 来源：packages/canvas-core-v2/src/services/nodeStore.ts、edgeStore.ts、nodeFactory.ts、services/index.ts

画布最核心的两份数据——**节点**和**边**——都收进内核的纯逻辑服务（零 Vue、可单测）。渲染层只读数据 + 订阅，变更/历史/落盘全在内核。

---

## 1. nodeStore —— 节点数据服务（ctx.get('nodeStore')）

### 1.1 节点类型注册（registerType / unregisterType）

`CanvasNodeType`：

```ts
interface CanvasNodeType {
  type: string
  label: string
  defaultSize: { w: number; h: number }
  inputs?: Array<{ port?: string; accepts?: string[]; limit?: 'single'|'multi' }>
  outputs?: Array<{ port?: string }>
}
```

```ts
nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })
nodeStore.types.get('text')       // 读注册表（ReadonlyMap）
nodeStore.unregisterType('text')  // 注销（热卸回收；不存在 no-op）
```
类型重复注册抛错。

### 1.2 节点实例 CRUD

`CanvasNode`：`{ id, type, position: {x,y}, data: Record<string,unknown> }`。

```ts
const id = nodeStore.addNode('text', { x: 10, y: 20 })  // 建一个，返回短数字 id '1'
nodeStore.getNode(id)            // CanvasNode | undefined
nodeStore.getNodes()             // 全部节点数组
nodeStore.updateNodeData(id, { text: '你好' })  // 改 data（合并进去），无此节点抛错
nodeStore.removeNode(id)         // true/false
nodeStore.replaceAll(nodes)      // 整体回填（刷新恢复；重建 id 计数器防撞）
```

- `addNode` 前 type 必须已注册，否则抛 `unknown node type`。
- 节点 id 是**短数字自增**（'1','2','3'…），画布内唯一。

### 1.3 订阅变化（subscribe）

```ts
const off = nodeStore.subscribe((reason, nodeId) => {
  // reason: 'add' | 'remove' | 'update' | 'replace'
  // nodeId: 涉及节点；replace 时为 undefined
})
off()   // 取消
```
宿主据此把内核 nodeStore 自动重灌到渲染态。

`NodeStoreService` 完整接口见源码；`CanvasNodeType.inputs/outputs` 即声明式连接约束（见连接校验篇）。

---

## 2. edgeStore —— 边数据服务（ctx.get('edgeStore')）

把"边（连线）"的数据/增删/订阅也收进内核，与 nodeStore 同构。

`CanvasEdge` 最小可持久化形状：

```ts
interface CanvasEdge {
  id: string
  source: string
  target: string
  type?: string            // 边渲染类型键；缺省 'custom'
  sourceHandle?: string
  targetHandle?: string
}
```

### 2.1 增删查

```ts
const id = edgeStore.addEdge({ source: '1', target: '2' })   // 返回边 id
edgeStore.getEdge(id)          // CanvasEdge | undefined
edgeStore.getEdges()           // 全部边（按加入序）
edgeStore.removeEdge(id)       // true/false
```

`addEdge` 的 id 缺省 = `edgeStoreId(source, target)` = `'e-<source>-<target>'`（已有同 id 则**替换去重**）。

### 2.2 连带清边 / 清悬挂边

```ts
edgeStore.removeEdgesOfNode('1')     // 删掉所有连到节点'1'的边（删节点时调）；返回移除数
edgeStore.pruneDanglingEdges(new Set(aliveNodeIds))  // 清 source/target 不在存活节点集的悬挂边；返回移除数
```

### 2.3 整体回填 + 订阅

```ts
edgeStore.replaceAll([{ source: '1', target: '2' }])   // 无 id 自动生成；清空重建；id 冲突去重
const off = edgeStore.subscribe((reason, edgeId) => {
  // reason: 'add' | 'remove' | 'replace'；edgeId remove/replace 可能 undefined
})
```

顶层导出 `edgeStoreId(source, target)` 纯函数 = 稳定边 id。

---

## 3. nodeFactory —— 统一建节点工厂（ctx.get('nodeFactory')）

把"放一个 X 节点"收敛成**每 type 注册一个 creator**，host/命令/菜单只调 `create(type, pos)`，别处不各自抄建节点。

```ts
const factory = ctx.get('nodeFactory')

// 注册 creator（type 重复注册抛错）
factory.register('text', (pos, extra) => {
  // 内部写默认 data，返回新节点 id
  return nodeStore.addNode('text', pos)
})

const id = factory.create('text', { x: 0, y: 0 }, extra)  // 调 creator
factory.unregister('text')    // 注销
factory.creatableTypes()      // 可创建的 type 列表（菜单枚举用）
```

`NodeCreator` 签名：`(position: { x: number; y: number }, extra?: unknown) => string`。

> type 未注册 creator 时 `create` **抛错**（别静默）。能力段 `ctx.nodes.register` 的 `create` 字段会自动注册到这里（见节点注册篇）。

---

## 4. 三服务如何拿到 / 注入

这些是"内核约定名"服务，**需要宿主在 start 前 `ctx.inject` 注入**（内核不自动注）：

```ts
const ctx = new Context()
const nodeStore = new NodeStore()
const edgeStore = new EdgeStore()
const factory = new NodeFactory()
ctx.inject('nodeStore', nodeStore)
ctx.inject('edgeStore', edgeStore)
ctx.inject('nodeFactory', factory)
await ctx.start()
```

插件里 `const ns = ctx.get('nodeStore')` 即可（若声明了 `inject: ['nodeStore']`，则硬依赖，保证就绪后插件才跑）。

---

## 5. 坑与速记

1. `nodeStore`/`edgeStore`/`nodeFactory` 都要宿主手动注入；内核只自动提供 `slots`/`settings`。
2. **addNode 前必须 registerType**，否则抛错；edgeStore.addEdge 会自动生成 `e-<s>-<t>` 稳定 id 并去重。
3. 删节点后记得 `edgeStore.removeEdgesOfNode`；整体替换后想清悬挂边用 `pruneDanglingEdges`。
4. 节点 id 是短数字自增；`replaceAll` 重建计数器防撞。边 id 靠 source/target 生成。
5. 渲染层只读 `getNodes()/getEdges()` + `subscribe()`；数据变更都在内核，别自己在渲染层另存一份。
6. nodeStore 变化 reason 是 `add/remove/update/replace`（4 种）；edgeStore 是 `add/remove/replace`（3 种）。
