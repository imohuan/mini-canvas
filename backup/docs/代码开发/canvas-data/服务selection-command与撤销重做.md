# 选择 selection、命令 command、撤销重做（doc）

> 来源：`packages/canvas-data/src/selection.ts`、`packages/kernel/src/command.ts`、
> `packages/canvas-data/src/docService.ts`、`packages/canvas-data/src/history.ts`、
> `packages/canvas-data/src/canvas/canvasCommands.ts`

三类"编辑器状态"，都是纯逻辑、可单测。

先说结论：**`selection` 和 `command` 是正常服务名；撤销重做不再是服务名**——它是 `doc` 的一部分
（`doc.undo / doc.redo / doc.canUndo / doc.canRedo / doc.undoDepth`），一次 undo 覆盖节点 + 边。

---

## 1. Selection —— 选中集合（`ctx.get('selection')`）

管"当前选中了哪些节点 / 边"。VueFlow 的选中变化由宿主同步进来；命令（如删除）读它删"选中的"。
v2 是**双集**：节点 id 集与边 id 集分开跟踪（`selection.ts:11`）。

```ts
const sel = ctx.get('selection')

sel.ids              // 只读 Set<string>（节点选中集，快照副本）
sel.edgeIds          // 只读 Set<string>（边选中集，快照副本）
sel.size             // 选中总数（节点 + 边合计）

sel.has('1')         // 是否选中节点 '1'
sel.hasEdge('e-1-2') // 是否选中边
sel.set(['1','2'])   // 整体设节点选中集
sel.setEdges(['e-1-2'])
sel.add('3')         // 追加选中一个节点
sel.addEdge('e-1-2') // 追加选中一条边
sel.remove('1')      // 取消选中一个节点
sel.removeEdge('e-1-2')
sel.clear()          // 清空两桶
sel.clearNodes()     // 只清节点桶（保留边选中）
sel.clearEdges()     // 只清边桶（保留节点选中）

const off = sel.onChange(() => { /* 任一桶变化后回调 */ })
off()
```

几个细节（源码语义）：

- `ids` / `edgeIds` 返回的是**副本**（`new Set(...)`），外部改动不会绕过通知；要改请用 `set/add/remove/clear`。
- `set / setEdges` 在内容**没变**时不触发 `onChange`（先比 Set 内容）。
- `add / remove` 对"本来就在 / 本来就不在"的 id 是 no-op，也不触发通知。

> 典型用法：命令 `when: () => sel.size > 0`，`run` 遍历 `sel.ids` / `sel.edgeIds` 删除选中的东西。

---

## 2. 撤销 / 重做 —— `doc` 的一部分（不是单独服务）

最小版"撤销 / 重做"：对**整张图的快照**做差异栈（`packages/canvas-data/src/history.ts`）。
**不依赖具体数据对象**——构造时注入一对 `snapshot()` / `restore(s)` 能力（深拷贝交给调用方），
所以可独立单测。底层类 `History` 仍在，但由 `canvas-base` 建好交给 `doc` 持有，**不是服务名**。

```ts
interface HistoryService {          // history.ts:16（底层类的接口）
  undo(): void
  redo(): void
  withRecord<TResult>(fn: () => TResult): TResult
  canUndo(): boolean
  canRedo(): boolean
  readonly undoDepth: number
}
interface HistorySnapshot<T = unknown> {   // history.ts:11（构造时注入的一对能力）
  snapshot(): T
  restore(s: T): void
}
```

消费方**只认 `doc`**：

```ts
const doc = ctx.get('doc')
doc.undo()
doc.redo()
doc.canUndo()
doc.canRedo()
doc.undoDepth        // 撤销栈深度
```

### 2.1 自动入历史：写一次 = 一条历史

**通常你不需要手写"记录"**。`doc` 上的每个写方法内部都经 `history.withRecord` 包了一层：

```ts
doc.createNode('text', { x: 0, y: 0 })   // 一次 createNode = 一条可撤销的历史
doc.undo()                                // 撤掉刚才那次
doc.redo()                                // 重做
```

要**把一批改动合并成一条**（一次撤销全退），用 `doc.transaction`：

```ts
doc.transaction('删选中的边和节点', (tx) => {
  tx.removeEdges([...ctx.get('selection').edgeIds])
  tx.removeNodes([...ctx.get('selection').ids])
})
// Ctrl+Z 一次，整批删除全恢复
```

`withRecord` 的语义（`history.ts` 的 `withRecord`）：

- `fn` 执行前后各拍一次快照；
- 前后**不同**（`JSON.stringify` 比较）才入 undo 栈、并清空 redo 栈；没变就不记；
- **嵌套 `withRecord` 只记最外层**（内层不重复拍快照）——这正是 `transaction` 能把内部多次写合并成一条的原因。

### 2.2 底层 `History` 的构造（宿主 / 单测里自己搭时看）

`canvas-base` 是这么接的（`canvasBasePlugin.ts`）：快照是 `{ nodes, edges }` 深拷贝，且**过滤掉中间态元素**
（`isTransient` —— 拖线途中的占位节点 / 占位边不进历史，也不该被 undo 恢复出来）：

> 下面代码里的 `nodeStore` / `edgeStore` 是**工厂里的局部变量**（`new NodeStore()` / `new EdgeStore()`
> 的实例），**不是 `ctx` 服务名** —— 它们由 `doc` 门面持有。

```ts
const history = new History({
  snapshot: () => ({
    nodes: JSON.parse(JSON.stringify(nodeStore.getNodes().filter((n) => !isTransient(n)))),
    edges: JSON.parse(JSON.stringify(edgeStore.getEdges().filter((e) => !isTransient(e)))),
  }),
  restore: (g) => {
    const env = g ?? { nodes: [], edges: [] }
    nodeStore.replaceAll(env.nodes ?? [])
    edgeStore.replaceAll(env.edges ?? [])
  },
})
```

> `undo` / `redo` 内部会把"当前态"推进反方向栈（撤销时把当前态存进 redo 栈），这是标准双栈语义。
> `doc.undo` 之外还多做两件事：**清选中**（选中态可能已失效）与**调度落盘**（恢复后的图也要落盘）。

---

## 3. CommandRegistry —— 命令服务（`ctx.get('command')`）

菜单 / 工具栏 / 快捷键 / 删除都收敛成一个"命令"。命令注册表在**内核**里
（`packages/kernel/src/command.ts`，与画布无关）。

```ts
interface CommandDef {                  // command.ts:16
  id: string
  title?: string
  run(ctx: unknown, ...payload: unknown[]): unknown
  keys?: string[]                       // 可选快捷键（宿主绑键用）
  when?: (ctx: unknown) => boolean      // 可选使能条件（false → execute 直接 no-op）
  icon?: string                         // v2 UI 元数据（纯声明，不影响 run）
  areas?: string[]                      // 'node' | 'edge' | 'pane' | 'toolbar'…
  group?: string                        // 菜单 / 工具栏分组
  order?: number                        // 排序权重（越小越靠前）
}

interface CommandService {
  register(def: CommandDef): Disposable         // 重复 id 抛错；返回撤销句柄
  execute(id: string, ...payload: unknown[]): unknown
  has(id: string): boolean
  get(id: string): CommandDef | undefined
  list(): CommandDef[]
  unregister(id: string): boolean
  setContext(ctx: unknown): void                // 宿主注入执行上下文（run/when 拿它 ctx.get）
  remapKeys(id: string, keys: string[]): string[]     // 运行期改键位
  resetKeys(id: string): string[] | undefined         // 恢复原始键位
  originalKeys(id: string): string[] | undefined
  isRemapped(id: string): boolean
}
```

```ts
const cmd = ctx.get('command')
cmd.setContext(ctx)                       // 宿主在 start 后注入（createMiniCanvasHost 会做）
cmd.register({ id: 'zoom-in', run: (c) => (c as Context).get('viewport').zoomIn() })
cmd.execute('zoom-in')                    // 未注册 / when 为 false → 静默 no-op，不抛
```

插件里用**能力段**注册更省事（自动回收，不用自己 dispose）：

```ts
export function apply(ctx: Context) {
  ctx.commands.register({
    id: 'my:clear',
    title: '清空画布',
    run: () => ctx.get('doc').removeNodes(ctx.get('doc').getNodes().map((n) => n.id)),
  })
  ctx.commands.has('my:clear')       // true
}
```

### 3.1 快捷键由渲染层统一分发

`keys` 只是**声明**。真正绑键的地方在渲染层 `CanvasHost`：它监听 keydown，用
`findCommandByKeys(commands, event, executeCtx)` 挑出该跑的那条，再 `execute`。
挑选用两条规则（`command.ts` 的 `findCommandByKeys`）：

1. **`when` 不满足 = 让位**：这条此刻不适用，就交给同键的其它命令（不是"命中就吃掉、再被 when 拦成空操作"）。
2. **`order` 小的赢**：同键多条都可用时按 order 定优先级；order 相同才回落到注册先后。

键位语法：`'+'` 分隔，修饰键 `ctrl/shift/alt/meta/mod`（`mod` = ctrl 或 meta 任一，跨平台）；
主键大小写不敏感，用 `KeyboardEvent.key` 语义（`'Delete'`/`'Escape'`/`'ArrowUp'`…）。
例：`['Delete','Backspace']`、`['mod+z']`、`['mod+shift+z']`。

### 3.2 画布自带的四条命令

`canvas-base` 插件在 `apply` 里注册了四条（`canvas/canvasCommands.ts`），id 常量在 `CANVAS_COMMAND`：

| id | title | keys | 做什么 |
| --- | --- | --- | --- |
| `command:delete` | 删除选中 | `Delete` / `Backspace` | 混选时包进同一事务删边 + 删节点（一次撤销全恢复） |
| `command:create-node` | 创建节点 | — | 经 `nodeFactory.create(type, position, extra)` |
| `command:undo` | 撤销 | `mod+z` | `doc.undo()` |
| `command:redo` | 重做 | `mod+shift+z` | `doc.redo()` |

> 插件**不要自己绑 window 键**。声明 `keys` 即可，分发统一在渲染层 —— 也正因如此，
> 键位冲突与优先级才有唯一裁决点。

---

## 4. 三者怎么拿到

| 名字 | 谁放的 | 怎么声明依赖 |
| --- | --- | --- |
| `selection` | `canvas-base` 插件注入 | `export const inject = ['selection']` |
| `command` | `canvas-base` 插件注入 | `export const inject = ['command']` |
| `doc`（含撤销重做） | `canvas-base` 插件注入 | `export const inject = ['doc']` |

```ts
export const inject = ['doc', 'selection', 'command']
```

> 硬依赖写模块顶层 `inject`（框架保证 `apply` 时已就绪；缺提供方则本插件停在 PENDING）；
> 可选依赖才用 `ctx.get` 探测（缺服务返回 `undefined`）。

---

## 5. 坑与速记

1. **撤销重做不是服务名**：`ctx.get('history')` 拿不到。走 `ctx.get('doc')` 的 `undo/redo/canUndo/canRedo/undoDepth`。
2. 数据写一次就自动入历史（`doc` 内部 `withRecord`）；要把一批合并成一条用 `doc.transaction`。
3. `withRecord` **只在快照真的不同**时才入栈；嵌套只记最外层。
4. `Selection.ids` / `edgeIds` 返回的是**副本**，别指望改它能生效；用 `set/add/remove/clear`。
5. `execute` 对未注册 / `when` 为 false 的命令**静默 no-op**（不抛）；想确认存在用 `has(id)`。
6. 插件注册命令用 `ctx.commands.register`（自动回收）；**重复 id 抛错**。
7. 绑定快捷键在渲染层统一做，插件只声明 `keys`；同键多命令的优先级由 `when` + `order` 决定。
8. `selection` / `command` 是普通服务，不属于"内核恒在服务"（恒在的只有 `slots` / `settings`，外加内核自带的 `tools`）。
