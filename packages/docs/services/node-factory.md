# `nodeFactory` · 建节点

**一句话定位**：**`nodeFactory` 是"放一个新节点"的唯一柜台—— 谁想建节点都来这里报一个类型名，柜台去找"这个类型的建造师傅"把节点造出来。**

**它属于哪一档**：**画布基础**。由基础插件 `canvas-base` 注入（源码：`packages/canvas-data/src/canvas/nodeFactory.ts`；注入点：`packages/canvas-data/src/canvas/canvasBasePlugin.ts` 里的 `ctx.inject('nodeFactory', nodeFactory)`）。纯数据环境（只 `new Context()`）里 `ctx.get('nodeFactory')` 是 `undefined`。

## 用法

### 方法逐个看

签名逐字来自 `packages/canvas-data/src/canvas/nodeFactory.ts` 的 `NodeFactoryService`。

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `register` | `register(type: string, creator: NodeCreator): void` | 给某个 type 登记"建造师傅"；**同 type 重复注册抛错** | 节点插件装载时（通常由 `ctx.nodes.register` 的 `create` 字段代劳） |
| `unregister` | `unregister(type: string): void` | 注销某 type 的 creator（不存在则 no-op） | 手工装配/测试；插件卸载由作用域自动回收 |
| `create` | `create(type: string, position: { x: number; y: number }, extra?: unknown): string` | 按 type 造一个节点，返回新节点的短 id；**type 没登记 creator → 抛错** | 任何"放一个新节点"的场景 |
| `creatableTypes` | `creatableTypes(): string[]` | 列出当前真正能造的类型 | UI 铺"新建节点"候选、过滤菜单项 |

creator 的形状（也是从源码里逐字抄的）：

```ts
export interface NodeCreator {
  /** 在画布 pos 处建一个该 type 节点，返回短 id；creator 内部负责写默认 data */
  (position: { x: number; y: number }, extra?: unknown): string
}
```

注意 `extra`：它是**可选的附加材料**，不是随便塞东西的地方。真实的用法是"建图片节点时顺便把图片地址带上"——`packages/plugins/plugin-node-image/src/nodeImagePlugin.ts` 的 creator 会读 `extra.imageUrl`。你不处理 `extra` 也没关系，但处理了才能支持"带材料的建节点"。

> **跨插件放媒体不要走这条口**：调用方不该认识"图片插件的 creator 读哪个字段"。
> 用 `useCapability('media')` 的 `addNode(kind, resourceId, position)`，由目标节点类型自己写标准字段；
> `extra.imageUrl` 只留给"已知是图片、且手上只有地址"的宿主内部路径（迁移期）。

### 两条注册路，用哪条

| 写法 | 谁在用 | 说明 |
| --- | --- | --- |
| `ctx.nodes.register({ type, ..., create })` | **节点插件（首选）** | 一次把"数据 + 展示 + 建节点"三样都登记好；`create` 字段会自动落进 nodeFactory，并随插件卸载回收 |
| `ctx.get('nodeFactory').register(type, creator)` | 手工装配、纯逻辑测试 | 只想登记 creator、不管展示时用；回收要自己管（或随 `ctx.effect` 登记） |

仓库里节点插件全部走第一条路。例如 `packages/plugins/plugin-node-text/src/nodeTextPlugin.ts`：

```ts
ctx.nodes.register({
  type: 'text',
  label: '文本',
  size: { w: 300, h: 200 },
  in: TextContent,
  create(position) {
    return text.addTextNode(position)   // ← 建节点委托给插件自己的服务（单一实现）
  },
})
```

### 建完节点之后通常还要做两件事

1. **选中它**。菜单建出的节点，用户期望"建完就是选中状态"。真实写法（`packages/plugins/plugin-context-menu/src/contextMenuPlugin.ts`）：
   ```ts
   const nodeId = ctx.get('nodeFactory').create(nodeType, position)
   selection.clearEdges()
   selection.set([nodeId])
   ```
2. **连边**（如果是"拖线到空白建节点"的场景）。用 `doc.connectEdge(...)` 而不是自己拼边——那条路会做校验、满额挤出，失败也不炸。

## 注意事项

1. **没登记 creator 的 type，`create` 会抛错**（`[nodeFactory] no creator for node type "x". Register it first.`）。这是刻意的：静默建出一个"有 type 没内容的空节点"更难排查。写调用方时可以用 `creatableTypes()` 先筛。
2. **同 type 重复注册 creator 也抛错**。如果两个插件都注册 `'image'`，第二个会炸。原因同 `command`：静默覆盖 = 两个插件互相顶掉。热重载时旧插件先卸载（creator 随之注销），再装新的，所以这条路是通的。
3. **creator 内部一定要走 `doc`**（`doc.transaction` / `tx.createNode`，或调用你自己的服务最终也走 `doc`）。绕过它直接改 store 的后果：不进撤销栈、不触发落盘——用户按 Ctrl+Z 撤不掉、刷新后节点消失。
4. **`creatableTypes()` 与"已注册的节点类型"是两回事**。前者是"有建造师傅"的类型，后者是"有数据声明"的类型（`doc.types`）。菜单取的是**两者的交集**（`plugin-context-menu` 里写得很明确）——所以漏写 `create` 的类型不会进"新建节点"菜单，只能靠别的方式创建。
5. **`extra` 是"附加材料"，没有约定就传不动**。工厂只把它原样递给 creator；creator 不读，它就等于不存在。想支持"带内容建节点"，记得在 creator 里读（图片插件读 `extra.imageUrl`、示例里读 `extra.text`）。
6. **跨插件加媒体用 `media` 能力**：`addNode` 内部路由到目标节点类型的创建器，调用方不需要知道字段名，也不需要 `import` 别的插件。
6. **缺服务返回 `undefined`，不抛错**。纯数据环境里没有 `nodeFactory`（它由 `canvas-base` 注入）。可选的建节点场景请用 `ctx.tryGet('nodeFactory')` 探测后再用。

