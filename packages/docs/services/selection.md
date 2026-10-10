# `selection` · 选中集

**一句话定位**：**`selection` 是画布的"当前选中名单"—— 现在选中了哪些节点、哪些边，整张画布只认这一份。**

**它属于哪一档**：**画布基础**。它由基础插件 `canvas-base` 建好并注入（源码：`packages/canvas-data/src/selection.ts`；注入点：`packages/canvas-data/src/canvas/canvasBasePlugin.ts` 里的 `ctx.inject('selection', selection)`）。只 `new Context()` 而没装基础插件的话，`ctx.get('selection')` 拿到的是 `undefined`。

## 用法

### 两种拿法，同一张名单

```ts
// 写法一：按服务名取（组件、根上下文、测试都用它）
const selection = ctx.get('selection')

// 写法二：插件作用域里的属性直读（服务解析 Proxy 的糖，运行时等价于上面）
const selection = ctx.selection
```

注意：**属性直读只在插件作用域（`apply(ctx)` 里的那个 ctx）存在**。组件里拿到的通常是根 Context，请老老实实用 `ctx.get('selection')`（仓库里的组件都这么写，例如 `packages/plugins/plugin-multi-select/src/SelectionFrame.vue`）。

### 方法逐个看

下面签名逐字来自 `packages/canvas-data/src/selection.ts` 的 `SelectionService`。

**读：**

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `ids` | `readonly ids: ReadonlySet<string>` | 当前选中的**节点** id 集合（只读快照） | 批量操作前先拿一批 id（删除、复制、对齐） |
| `edgeIds` | `readonly edgeIds: ReadonlySet<string>` | 当前选中的**边** id 集合（只读快照） | 处理"被选中的连线"——它和节点是分开的两栏 |
| `has` | `has(id: string): boolean` | 某个节点 id 在不在名单里 | 单个节点的显隐判断（"操作栏要不要显示"） |
| `hasEdge` | `hasEdge(id: string): boolean` | 某条边 id 在不在名单里 | 边的高亮判断 |
| `size` | `get size(): number` | **节点 + 边合计**数量 | 只想知道"有没有选中任何东西" |

**写：**

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `set` | `set(ids: Iterable<string>): void` | 整体替换节点选中集 | 框选结束、全选、点选——一次换一整批 |
| `setEdges` | `setEdges(ids: Iterable<string>): void` | 整体替换边选中集 | 批量选边 |
| `add` | `add(id: string): void` | 追加选中一个节点 | Shift 加选 |
| `addEdge` | `addEdge(id: string): void` | 追加选中一条边 | Shift 加选连线 |
| `remove` | `remove(id: string): void` | 取消选中一个节点 | Shift 减选 |
| `removeEdge` | `removeEdge(id: string): void` | 取消选中一条边 | 同上，边那栏 |
| `clear` | `clear(): void` | 两栏一起清空 | 点空白处、撤销/重做之后 |
| `clearNodes` | `clearNodes(): void` | 只清节点那栏（边留着） | 点选一条边时（"清节点、选边"） |
| `clearEdges` | `clearEdges(): void` | 只清边那栏（节点留着） | 点选一个节点时 |

**订阅：**

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `onChange` | `onChange(cb: () => void): () => void` | 名单**任一栏有真实变化**后回调一次；返回"取消订阅"函数 | UI 要跟着选中变（高亮、计数、按钮显隐） |

写操作有几条真实语义，值得记下来：

- **内容没变就不通知**：`set` / `add` 会先比一遍，名单一样就直接返回——所以"订阅了却没收到回调"多半是因为内容本来就没变。
- **读出来的 `ids` 是副本**：每次读 `ids` 都给你一个新 `Set`，改它不会动到名单、也不会触发 `onChange`（这是刻意设计的，防止外部硬改绕过通知）。
- **一个订阅者抛错不影响别人**：回调里的异常会被吞掉，其它订阅者照常收到。

### 点选语义长什么样

"点一下会发生什么"不是 `selection` 自己定的，而是渲染层的纯函数规定的（`packages/canvas-render/src/host/selectionInteractions.ts`），四个入口各有一套：

| 动作 | 结果 |
| --- | --- |
| 普通点节点 | `clearEdges()` → `set([该节点])`（清边、单选节点） |
| Shift + 点节点 | 已选中就 `remove`，没选中就 `add`（边那栏不动） |
| 普通点边 | `clearNodes()` → `setEdges([该边])`（清节点、单选边） |
| Shift + 点边 | 切换该边（节点那栏不动） |
| 点空白 | `clear()`（两栏一起清） |
| 拖动未选中的节点 | `set([该节点])`（对齐"拖谁选谁"） |

## 注意事项

1. **`ids` / `edgeIds` 是副本，改它没用**。每次读都得到一个新的 `Set`，你往里面 `add` 不会改变画布选中，也不会触发 `onChange`——要改就调 `set` / `add` / `remove` 这些方法。为什么这么设计：防住"外部拿到内部引用直接改"，那种改法绕过了通知，界面就与名单脱节了。
2. **名单只管 id，不管 id 还在不在**。节点被删后由 `graph` 顺手清理名单；但撤销/重做是"整图回退"，`graphDocument` 的做法是**直接清空选中**——所以别在撤销之后假设"刚才选的东西还选着"。
3. **`size` 是节点 + 边合计**。只想判断"有没有选中节点"就写 `selection.ids.size`；只想判断边就写 `selection.edgeIds.size`。混用会出鬼：比如"复制"逻辑看到 `size > 0` 就开工，结果选中的其实只有一条边。
4. **内容相同不会触发 `onChange`**。`set(['1'])` 在已经只选中 `'1'` 的时候是空操作。调试"订阅没生效"时，先确认名单真的变了。
5. **缺服务返回 `undefined`，不抛错**。纯数据环境（只 `new Context()`、没装 `canvas-base`）、或者极简测试桩里都可能没有它。公开的组件请照 `useSoleNodeSelected` 的写法先判空（`packages/canvas-render/src/contracts/nodeSelection.ts`：缺服务就返回 `false`），别一上来就 `selection.onChange(...)`。

