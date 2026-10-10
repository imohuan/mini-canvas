# `command` · 命令

**一句话定位**：**`command` 是画布的"动作总目录"—— 删除、撤销、自动布局、搜索节点…… 每个能做的动作都在这里登记一条，按钮、快捷键、右键菜单全都按名字去调它。**

**它属于哪一档**：**画布基础**。服务本身由内核提供（`packages/kernel/src/command.ts` 的 `CommandRegistry`），由基础插件 `canvas-base` 注入到 ctx（`packages/canvas-data/src/canvas/canvasBasePlugin.ts`）。纯数据环境里 `ctx.get('command')` 是 `undefined`。

## 用法

### 两个注册路径，同一张目录

| 路径 | 怎么写 | 谁在用 | 自省里的 origin |
| --- | --- | --- | --- |
| **注册场**（插件首选） | `ctx.commands.register(def)` | 所有插件 | `'field'` |
| **服务直注册** | `ctx.get('command').register(def)` | 画布基础插件（`registerCanvasCommands` 注册建/删/撤销/重做） | `'service'` |

两条路进的是**同一个 CommandRegistry**（`execute` / `list` 的视图完全一样），差别只有两点：

1. **回收方式**：注册场那条会把条目登记进你的插件作用域（卸载自动摘除）；服务直注册返回一个 `Disposable`，谁注册谁负责释放。
2. **自省快照（`ctx.surface()`）里标成不同 origin**：`'field'` 与 `'service'`，方便排查"这条命令从哪来"。

**插件请用 `ctx.commands.register`**：它带自动回收，而且顺带把条目落进 `command` 注册场（别的插件、文档、诊断面板都能看见）。

### 方法逐个看

签名逐字来自 `packages/kernel/src/command.ts` 的 `CommandService`（`ctx.get('command')` 拿到的就是它）。

| 方法 | 签名 | 干什么 | 什么时候用 |
| --- | --- | --- | --- |
| `register` | `register(def: CommandDef): Disposable` | 注册一条命令；**同 id 重复注册抛错** | 插件装载时声明动作 |
| `execute` | `execute(id: string, ...payload: unknown[]): unknown` | 执行命令，返回 `run` 的返回值；**未注册 / `when` 不满足 → 静默 no-op，不抛** | 按钮点击、菜单项、程序化触发 |
| `has` | `has(id: string): boolean` | 有没有这条命令 | 调用前探测（避免静默失败） |
| `get` | `get(id: string): CommandDef \| undefined` | 取命令的完整声明（含 UI 元数据） | 想读某条命令的 keys/areas |
| `list` | `list(): CommandDef[]` | 枚举全部命令 | 右键菜单、快捷键帮助、工具栏铺命令 |
| `unregister` | `unregister(id: string): boolean` | 按 id 注销（原命令不存在返回 `false`） | 动态撤下一条命令 |
| `setContext` | `setContext(ctx: unknown): void` | 宿主注入"执行上下文"——`run`/`when` 的第一个参数就是它 | **宿主启动时调一次**（画布是 `command.setContext(ctx)`）；插件别自己调 |
| `remapKeys` | `remapKeys(id: string, keys: string[]): string[]` | 运行期改快捷键（只改 `keys`，run/元数据不动）；命令不存在抛错 | 快捷键重映射面板 |
| `resetKeys` | `resetKeys(id: string): string[] \| undefined` | 恢复到 remap 前的原始键；未 remap 过则 no-op；命令不存在返回 `undefined` | "恢复默认快捷键" |
| `originalKeys` | `originalKeys(id: string): string[] \| undefined` | 只读：这条命令**原始**（未 remap）的键 | 面板上显示"默认是什么" |
| `isRemapped` | `isRemapped(id: string): boolean` | 这条命令当前是否被 remap 过 | 面板上显示"已改过"标记 |

### 一条命令声明里有哪些字段（`CommandDef`）

```ts
interface CommandDef {
  id: string                                        // 唯一 id（如 'text.duplicate'）
  title?: string                                    // 显示名（菜单/帮助面板用）
  run(ctx: unknown, ...payload: unknown[]): unknown // 执行体；ctx 是 setContext 注入的那个
  keys?: string[]                                   // 快捷键写法，如 ['Delete','Backspace'] / ['mod+z']
  when?: (ctx: unknown) => boolean                  // 使能条件：false → execute 直接 no-op
  icon?: string                                     // 图标（字符串标识或 svg 路径，UI 插件自行解析）
  areas?: string[]                                  // 出现在哪些区域：'node' | 'edge' | 'pane' | 'toolbar'…
  group?: string                                    // 分组（菜单/工具栏分组名）
  order?: number                                    // 排序权重（越小越靠前）
}
```

`areas` 的语义值得单独说：**显式声明了 areas 且包含当前模式，才进对应的右键菜单**；不声明 areas = 纯快捷键命令，不进任何菜单（见 `packages/plugins/plugin-context-menu/src/menuBuilder.ts`）。

### 快捷键怎么被分发（渲染层的规则）

按键不是广播给所有插件，而是**先扫描、再执行一条**（`packages/canvas-render/src/host/CanvasHost.vue` 的 `onKeydown`）：

```ts
const hit = findCommandByKeys(h.command.list(), e, h.ctx)
if (hit) { e.preventDefault(); h.command.execute(hit.id); syncFromStore() }
```

配套的三个纯函数（也是从 `@mini-canvas/kernel` 导出的）：

| 函数 | 签名 | 干什么 |
| --- | --- | --- |
| `keyComboMatches` | `keyComboMatches(combo: string, e: CommandKeyEvent): boolean` | 单个键位串是否匹配这次按键 |
| `commandMatchesKeys` | `commandMatchesKeys(keys: string[] \| undefined, e: CommandKeyEvent): boolean` | 命令的 keys 数组里任一命中即 true |
| `findCommandByKeys` | `findCommandByKeys<T extends { id: string; keys?: string[] }>(commands: readonly T[], e: CommandKeyEvent, executeCtx?: unknown): T \| undefined` | 从命令列表里挑出这次该执行的**唯一赢家** |

键位串语法（`keyComboMatches` 实现）：用 `+` 分隔；修饰键支持 `ctrl` / `shift` / `alt` / `meta` / `cmd` / `mod`（**`mod` = ctrl 或 meta 任一，跨平台**）；主键大小写不敏感，可以用 `'Delete'` / `'Escape'` / `'ArrowUp'` 这种 `KeyboardEvent.key` 名字。仓库里真实的写法：`['Delete','Backspace']`、`['mod+z']`、`['mod+shift+z']`、`['mod+/']`、`['Escape']`。

`findCommandByKeys` 的两条仲裁规则（很重要）：

1. **`when` 不满足 = 让位，不是吃掉**。选中 3D 节点时 `f` 归节点用；没选中时同键的画布命令照常执行。所以同一个键可以有多个命令，各写各的 `when`。
2. **同键多个都可用时，`order` 小的赢**；`order` 相同就按注册先后。没写 `order` 视为最后。

不传 `executeCtx` 时不评估 `when`（老调用方行为不变）——仓库里传的是 `h.ctx`。

## 注意事项

1. **同 id 再注册一次会抛错，不是覆盖**。`CommandRegistry.register` 里写死了 `command "x" already registered`。为什么：静默覆盖会让两个插件互相顶掉，排查无门。注册前可以 `has(id)` 探一下，或者用带自己前缀的 id（如 `'selection-demo:invert'`）。
2. **`execute` 对"没注册 / `when` 不满足"都是静默 no-op（返回 `undefined`）**。拼错命令名不会报错，看起来就像"点了没反应"。写调用方时先 `has(id)` 或读 `execute` 返回值判断，别用 `try/catch` 猜。
3. **`when` 的两副面孔**：在快捷键分发里它是"让位"（别的同键命令还有机会）；在 `execute` 里它是"直接 no-op"。所以在按钮上手动调用时，要么自己也要用 `when` 判断来禁用按钮（如例子里那样），要么接受"按了没反应"。
4. **快捷键修饰键是精确匹配的**：`'ctrl+a'` **不匹配** `metaKey+a`（Mac 的 Cmd）。要跨平台写 `'mod+a'`（`mod` = ctrl 或 meta 任一）。另外 `'ctrl+a'` 也不匹配 `ctrl+shift+a`。
5. **同键多个命令靠 `order` 定优先级，越小越优先**；不写 `order` 视为最后。想让自己的命令在原键上"顶掉"别人，不是去改别人，而是写一个更小的 `order` + 合适的 `when`（真实例子：`packages/plugins/plugin-node-3d-preview/src/node3dPreviewPlugin.ts` 抢 `f`/`r`）。
6. **`setContext` 是宿主的活，插件别自己调**。它决定 `run(ctx, ...payload)` 里那个 `ctx` 是谁；插件自己调会改到全局执行上下文，影响所有命令。payload 要照约定传（例如节点级命令约定 `{ nodeId }`），因为 `execute(id, payload)` 的参数是**原样**传给 `run` 的第二参起。

