# 通用 UI 槽 ctx.slots 与命令 ctx.commands

> 来源：packages/canvas-core-v2/src/core/capabilities.ts、registry/slotRegistry.ts、services/command.ts、Context.ts

两件事：插件往"通用 UI 槽"叠东西（让宿主按序渲染），以及插件注册"命令"（菜单/快捷键/删除统一走）。

---

## 1. ctx.slots —— 往通用 UI 槽叠 occupant

`ctx.slots` 写到内核自带的 `SlotRegistry`（服务名 `'slots'`，恒在）。宿主可经 `ctx.get('slots')` 读同一实例按需渲染。每个槽可放多个 occupant，带 `{ id, order, component, meta }`，**order 小的在前**。

```ts
apply(c) {
  // 往 'canvas.dock' 槽叠一个 UI（id 给 'bar'，order 1）
  const id = c.slots.register('canvas.dock', {
    id: 'bar',
    order: 1,
    component: DockBar,          // opaque 组件句柄
    meta: { mode: 'append' },    // 可选元数据，宿主读回
  })
}
```

`ctx.slots` 提供：

```ts
register(slot: string, req: { id?: string; order?: number; component: unknown; meta?: unknown }): string
remove(slot: string, id: string): boolean
occupants(slot: string): Array<{ id: string; order: number; component: unknown; meta?: unknown }>
```

- `register` 返回 occupant id（供 remove / 去重）。id 缺省自动分配 `slot#n` 稳定 id。
- **自动回收**：插件卸载时它叠的 occupant 被抽走。
- 宿主读取用 `ctx.get('slots')` 的底层方法：

```ts
const slots = ctx.get('slots')
slots.list('canvas.dock')    // 全部 occupant，按 order 排好（SlotEntry[]：{id, order, value, meta}）
slots.first('canvas.dock')   // 单赢家（order 最小）
slots.get('canvas.dock', id) // 按 id 取
slots.remove('canvas.dock', id)
```

> `ctx.slots.occupants(slot)` 是把底层 `list(slot)` 映射成 `{id, order, component, meta}` 的便捷读法（把底层 `value` 字段叫 `component`）。

### 1.1 同槽叠多个、顺序由 order 定

```ts
// 两个插件往同一槽叠，宿主按 order 顺序渲染
c.slots.register('canvas.overlay', { id: 'a', order: 0, component: BadgeA })
// 另一个插件
c.slots.register('canvas.overlay', { id: 'b', order: 1, component: BadgeB })

ctx.get('slots').list('canvas.overlay').map(e => e.value)  // [BadgeA, BadgeB]（order 升序）
```

卸掉插件 A → 只抽走 a，b 保留。

---

## 2. ctx.commands —— 注册命令（execute 统一执行）

菜单 / 工具栏 / 快捷键 / 删除都收敛成一个"命令"。命令存 `CommandRegistry`（服务名 `'command'`，需宿主注入）。

```ts
apply(c) {
  c.commands.register({
    id: 'delete-selected',
    title: '删除选中',
    keys: ['Delete', 'Backspace'],     // 可选快捷键（宿主负责绑键）
    when: (ctx) => !!selection?.size,  // 可选使能条件（false → execute 直接 no-op）
    run(ctx, ...payload) {
      // 执行体；ctx 是宿主 setContext 的执行上下文（通常可 ctx.get 用服务）
    },
  })
}
```

`ctx.commands` 提供：

```ts
register(def: { id: string; title?: string; run(ctx, ...payload): unknown; keys?: string[]; when?(ctx): boolean }): void
has(id: string): boolean
```

**自动回收**：注册自动挂插件 Scope，卸载即注销。命令本体服务 `CommandRegistry`：

```ts
cmd.register(def)            // 返回 { dispose() } 撤销句柄；重复 id 抛错
cmd.has(id)
cmd.execute(id, ...payload)  // 执行：未注册 / when 为 false → no-op 不抛；返回 run 的返回值
cmd.setContext(ctx)          // 宿主注入执行上下文（run/when 拿它）
```

### 2.1 完整示例

```ts
// 宿主装配：注入 command + selection 服务
const ctx = new Context()
const cmd = new CommandRegistry()
const selection = new Selection()
ctx.inject('command', cmd)
ctx.inject('selection', selection)
await ctx.start()

// 插件注册命令
ctx.installPlugin({
  name: 'delete-cmd',
  apply(c) {
    c.commands.register({
      id: 'command:delete',
      when: () => selection.size > 0,
      run: () => { for (const id of selection.ids) nodeStore.removeNode(id) },
    })
  },
})

cmd.execute('command:delete')   // 触发删除选中
```

---

## 3. 槽 / 命令 / 主题 / 节点：能力段一图流

`ctx.nodes / theme / commands / slots / settings` 都由 `buildCapabilities` 收口，挂在每个插件的 ctx 上，**注册一律自动回收**（撤销经插件 scope 的 effect 登记，卸载即清，作者不手写 unregister）。这些能力段读的服务分别是：

| ctx 能力段 | 底层服务（ctx.get 名） | 说明 |
| --- | --- | --- |
| `nodes.register` | `nodeStore` + `nodeRegistry` | 存节点数据 + 存展示组件 |
| `theme.register/add/remove` | `themeRegistry` | 主题槽 occupant |
| `commands.register/has` | `command` | 命令注册表 |
| `slots.register/remove/occupants` | `slots`（恒在，内核自带） | 通用 UI 槽 |
| `settings` | `settings`（恒在，内核自带） | 装配配置单一数据源 |

> `slots` 与 `settings` 内核构造时自建，`ctx.get` 恒有；`nodeStore/nodeRegistry/themeRegistry/command/nodeFactory` 等需宿主 `ctx.inject` 注入。

---

## 4. 坑与速记

1. `ctx.slots` / `ctx.commands` 等注册自动回收；别重复手动 unregister（卸载会清）。
2. 命令**重复 id 注册抛错**；`execute` 未注册/不满足 when 则静默 no-op（不抛）。
3. `commands.register` 需要先注入 `command` 服务；没注入时 `ctx.commands.has` 返回 false（安全），`register` 会因 get 到 undefined 失败——装配前记得注入。
4. `slots` 槽名随意字符串；`ctx.slots.occupants` 读的是 `{component,...}`，底层 `list` 返回的是 `{value,...}`，别混字段名。
5. 宿主想自定义命令上下文用 `cmd.setContext(...)`；命令 `when` 为空对象/undefined 都视为恒可执行。
