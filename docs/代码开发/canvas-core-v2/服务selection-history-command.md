# 选择 selection、历史 history、命令 command 服务

> 来源：packages/canvas-core-v2/src/services/selection.ts、history.ts、command.ts

三类"编辑器状态"服务，都纯逻辑、可单测，需宿主注入。

---

## 1. Selection —— 选中集合服务（ctx.get('selection')）

管"当前选中了哪些节点/边 id"。VueFlow 的选中变化由宿主同步进来；命令（如删除）读它删"选中的"。

```ts
const sel = ctx.get('selection')

sel.ids              // 只读 Set<string>（当前选中的 id 集合快照）
sel.has('1')         // 是否选中 id '1'
sel.set(['1','2'])   // 整体设选中集
sel.add('3')         // 追加选中一个
sel.remove('1')      // 取消选中一个
sel.clear()          // 清空
sel.size             // 选中数量

// 订阅选中集变化（set/add/remove/clear 任一触发后回调）
const off = sel.onChange(() => { /* 重绘高亮 / 刷新派生 ref */ })
off()                // 取消
```

> 典型用法：命令 `when: () => sel.size > 0`，`run` 遍历 `sel.ids` 删除对应节点。

---

## 2. History —— 撤销 / 重做服务（ctx.get('history')）

最小版"撤销/重做"：对"节点图整体快照"做差异栈。**不依赖具体 nodeStore**——构造时注入一对 `snapshot()/restore(s)` 能力（内存/深拷贝交给调用方），因此可独立单测。

```ts
interface HistorySnapshot<T = unknown> {
  snapshot(): T
  restore(s: T): void
}
```

`HistoryService`：

```ts
undo()                     // 撤销上一步（无则 no-op）
redo()                     // 重做（无则 no-op）
withRecord<T>(fn: () => T): T  // 包 fn，自动入历史
canUndo(): boolean
canRedo(): boolean
undoDepth                  // 历史长度（诊断）
```

### 2.1 用 withRecord 包一个"要能撤销"的操作

```ts
import { History } from '@mini-canvas/canvas-core-v2'

// 装配：注入 snapshot/restore 一对能力（这里演示基于 nodeStore）
const history = new History({
  snapshot: () => JSON.stringify(nodeStore.getNodes()),   // 拍当前节点图
  restore: (s) => nodeStore.replaceAll(JSON.parse(s)),    // 还原
})
ctx.inject('history', history)

// 改之前用 withRecord 包一层 → 自动入 undo 栈、清空 redo 栈
history.withRecord(() => {
  nodeStore.addNode('text', { x: 0, y: 0 })
})

history.undo()   // 撤掉刚才那次 addNode
history.redo()   // 重做
```

`withRecord` 语义（源码）：
- fn 执行前后各拍一次快照；
- 若前后**不同**（`JSON.stringify` 比较）则 push 进 undo 栈、清空 redo 栈；
- 嵌套 `withRecord` 只记最外层（内层不重复拍快照）；
- 原子操作内部多次改会合并成一条历史。

> `HistoryService` 的注入接口在 `services/history.ts`。默认内核**不自动**把 nodeStore 接进 history——宿主装配时自己搭 snapshot/restore。

---

## 3. CommandRegistry —— 命令服务（ctx.get('command')）

已在《通用 UI 槽与命令》讲主体，这里补它作为"编辑器状态服务"的完整接口：

```ts
interface CommandDef {
  id: string
  title?: string
  run(ctx: unknown, ...payload: unknown[]): unknown
  keys?: string[]            // 可选快捷键（宿主绑键用）
  when?: (ctx: unknown) => boolean  // 使能条件（false → execute no-op）
}
interface CommandService {
  register(def: CommandDef): Disposable   // 重复 id 抛错；返回撤销句柄
  execute(id, ...payload): unknown        // 执行；未注册/不满足 when → no-op
  has(id): boolean
  setContext(ctx): void                    // 宿主注入执行上下文
}
```

```ts
const cmd = ctx.get('command')
cmd.setContext({ /* 通常是当前 ctx，供 run 里 ctx.get 用服务 */ })
cmd.register({ id: 'zoom-in', run: (c) => c.get('viewport').zoom(1.2) })
cmd.execute('zoom-in')
```

> 命令是"菜单/工具栏/快捷键/删除统一走 execute"的收口：宿主负责绑 `keys`、控制菜单显隐；业务只 `register` 一次，各处 `execute`。

---

## 4. 如何注入

三者都是"内核约定名"服务，需宿主手动注入：

```ts
ctx.inject('selection', new Selection())
ctx.inject('history', new History({ snapshot, restore }))
ctx.inject('command', new CommandRegistry())
```

插件里用 `inject: ['selection','history','command']` 声明硬依赖，或 `ctx.get(...)` 可选探测。

---

## 5. 坑与速记

1. **history 不自带 nodeStore 连接**：你必须构造时传 `snapshot/restore` 一对能力，让它知道怎么拍/怎么还原。用 `JSON.stringify` 浅比较做差异即可（这是源码示例做法）。
2. `withRecord` 只在**快照不同**时才入栈；要强制记录就把前后弄出差别。
3. history `undo`/`redo` 内部也会自动把当前态 push 到反方向栈（撤销时把当前态存 redo）。
4. `Selection.ids` 返回的是内部 Set 的**引用**（`ReadonlySet`），别直接改它——用 `set/add/remove/clear`。
5. command `execute` 对不满足 when / 未注册命令静默 no-op，不抛。
6. 都要宿主注入：`selection` / `history` / `command` 不是内核恒在服务。
