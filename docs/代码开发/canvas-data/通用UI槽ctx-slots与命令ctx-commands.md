# 通用 UI 槽 ctx.slots 与命令 ctx.commands

> 来源：`packages/canvas-data/src/canvas/capabilities.ts`、`packages/kernel/src/registry/slotRegistry.ts`、
> `packages/kernel/src/command.ts`、`packages/canvas-data/src/canvas/canvasCommands.ts`、
> `packages/canvas-render/src/components/SlotHost.vue`

两件事：插件往"通用 UI 槽"里叠东西（宿主按序渲染），以及注册"命令"（菜单 / 快捷键 / 删除统一走）。

---

## 1. ctx.slots —— 往通用 UI 槽叠 occupant

`ctx.slots` 写进的是能力层内置的 `SlotRegistry`（服务名 `'slots'`，`ctx.get` 恒有）。
每个槽可放**多个** occupant，带 `{ id, order, component, meta }`，**order 小的排在前**。

```ts
export function apply(ctx: Context) {
  // 往 'overlay' 槽叠一个 UI（id 'bar'，order 1）
  const id = ctx.slots.register('overlay', {
    id: 'bar',
    order: 1,
    component: DockBar,          // opaque 组件句柄（.vue / stub 都行）
    meta: { mode: 'append' },    // 可选元数据，宿主读回
  })
  // id 是 string，供 remove / 去重
}
```

能力段 `ctx.slots` 提供三个方法（`capabilities.ts`）：

```ts
register(slot: string, req: { id?: string; order?: number; component: unknown; meta?: unknown }): string
remove(slot: string, id: string): boolean
occupants(slot: string): Array<{ id: string; order: number; component: unknown; meta?: unknown }>
```

- `register` 返回 occupant id。
- `occupants` 是把底层 `list(slot)` 映射成 `{ id, order, component, meta }` 的便捷读法
  （底层字段叫 `value`，能力段把它叫 `component`）。
- **自动回收**：插件卸载时它叠的 occupant 自动被抽走。

宿主读取用底层 `SlotRegistry`（`ctx.get('slots')`）：

```ts
const slots = ctx.get('slots')
slots.list('overlay')        // 全部 occupant，按 order 排好（SlotEntry[]：{ id, order, value, meta }）
slots.first('overlay')       // 单赢家（order 最小者）
slots.get('overlay', id)     // 按 id 取
slots.remove('overlay', id)
slots.ids('overlay')         // 已占 id 列表
slots.slots()                // 现有全部槽名
slots.subscribe(() => {})    // 槽变化订阅（渲染侧重绘用）
```

### 1.1 同槽叠多个，顺序由 order 定

```ts
// 两个插件往同一槽叠，宿主按 order 顺序渲染
c.slots.register('overlay', { id: 'a', order: 0, component: BadgeA })
// 另一个插件
c.slots.register('overlay', { id: 'b', order: 1, component: BadgeB })

ctx.get('slots').list('overlay').map((e) => e.value)  // [BadgeA, BadgeB]（order 升序）
```

卸掉插件 A → 只抽走 `a`，`b` 保留。

### 1.2 宿主怎么渲染：`<SlotHost>`

渲染层提供 `SlotHost` 组件（`packages/canvas-render/src/components/SlotHost.vue`）：给槽名就渲染该槽
全部 occupant（自动读 `ctx.slots.occupants(slot)` 并按 order 排好）：

```vue
<SlotHost slot="overlay" />
```

> 想加一个新可扩展区，宿主多写一行 `<SlotHost slot="新槽名" />` 就多一个 —— 插件侧照旧
> `ctx.slots.register('新槽名', …)`。槽名是普通字符串，不需要预先登记。

---

## 2. ctx.commands —— 注册命令

菜单 / 工具栏 / 快捷键 / 删除都收敛成"命令"。命令本体存在内核的 `CommandRegistry`
（服务名 `'command'`，由 `canvas-base` 注入）。

```ts
export function apply(ctx: Context) {
  ctx.commands.register({
    id: 'delete-selected',
    title: '删除选中',
    keys: ['Delete', 'Backspace'],      // 可选快捷键（渲染层统一分发，插件不自己绑 window）
    group: 'edit',                      // 可选：菜单分组
    order: 10,                          // 可选：越小越靠前
    when: () => ctx.get('selection').size > 0,   // 可选使能条件（false → execute 直接 no-op）
    run(_execCtx, ...payload) {
      // 执行体；第一个参数是宿主 setContext 注入的执行上下文
    },
  })

  ctx.commands.has('delete-selected')   // true
}
```

`ctx.commands` 提供（`capabilities.ts`）：

```ts
register(def: CommandDef): Disposable     // 返回可手动 dispose 的句柄（不接即"纯声明 + 自动回收"）
has(id: string): boolean
```

`CommandDef` 的完整字段见《服务 selection-command 与撤销重做》篇（也在 `packages/kernel/src/command.ts:16`）：

```ts
{ id, title?, keys?, areas?, run, group?, order?, icon?, when? }
```

命令本体服务的完整接口（`get/list/unregister/setContext/remapKeys/resetKeys/…`）同样见那篇。

### 2.1 宿主装配示例

```ts
import { Context, createCanvasBasePlugin } from '@mini-canvas/canvas-data'

const ctx = new Context()
const base = createCanvasBasePlugin()
ctx.plugin(base.plugin)
await ctx.start()
base.services.command.setContext(ctx)      // 给命令注入执行上下文（createMiniCanvasHost 会做）

// 插件注册命令（这里直接 install 演示热装）
ctx.installPlugin({
  name: 'my-cmd',
  apply(c) {
    c.commands.register({
      id: 'my:clear',
      title: '清空画布',
      run: () => c.get('doc').removeNodes(c.get('doc').getNodes().map((n) => n.id)),
    })
  },
})

base.services.command.execute('my:clear')
```

### 2.2 画布自带的四条命令

`canvas-base` 的 `apply` 里注册（`canvas/canvasCommands.ts`，id 常量在 `CANVAS_COMMAND`）：
`command:delete`（Delete / Backspace）、`command:create-node`、`command:undo`（mod+z）、
`command:redo`（mod+shift+z）。详见《服务 selection-command 与撤销重做》篇。

---

## 3. 能力段一图流

`ctx.nodes / theme / commands / slots / settings` 都由 `buildCapabilities`（`capabilities.ts:96`）收口，
挂在每个插件的 ctx 上。**注册一律自动回收**（撤销经插件 scope 的 effect 登记，卸载即清）。

| ctx 能力段 | 底层落点 | 说明 |
| --- | --- | --- |
| `ctx.nodes.register/contribute/attach` | `node/type`/`node/creator`/`node/region` 场 + `doc` 类型表 + `nodeRegistry` | 节点数据 + 展示 + 建节点 |
| `ctx.theme.register/add/remove` | `themeRegistry`（服务）+ `theme` 场 | 主题槽 occupant |
| `ctx.commands.register/has` | `command` 服务 + `command` 场 | 命令注册表 |
| `ctx.slots.register/remove/occupants` | `'slots'` 服务（能力层内置）+ `slot` 场 | 通用 UI 槽 |
| `ctx.settings.define/set/get/onChange/groups` | `'settings'` 服务（能力层内置）+ `setting` 场 | 装配配置单一数据源 |

（场的 kind 权威清单见 `docs/design/core-layers-and-registry.md` §4.5。）

---

## 4. 坑与速记

1. `ctx.slots` / `ctx.commands` 注册**自动回收**，别重复手动注销（卸载会清）。
2. 命令**重复 id 注册抛错**（同一张表里 id 唯一）；`execute` 未注册或 `when` 为 false → 静默 no-op，**不抛**。
3. 想确认"某命令在不在"用 `ctx.commands.has(id)`，它缺 `command` 服务时返回 `false`（安全）。
4. 字段名别混：`ctx.slots.occupants(slot)` 给的是 `{ id, order, component, meta }`；底层 `list(slot)` 给的是 `{ id, order, value, meta }`。
5. 槽名随意（普通字符串）；宿主想渲染某个槽，写一行 `<SlotHost slot="槽名" />`。
6. 命令的键位**由渲染层统一分发**，插件只声明 `keys`；同键多命令的优先级规则见《服务 selection-command 与撤销重做》篇 §3.1。
7. `slots` 与 `settings` 是能力层内置（`ctx.get` 恒有）；`doc` / `command` / `themeRegistry` / `nodeRegistry` / `nodeFactory` 等由 `canvas-base` 注入。

