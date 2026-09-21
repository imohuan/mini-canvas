# 主题换肤：ctx.theme + ThemeRegistry + registerThemeSlot

> 来源：`packages/canvas-data/src/canvas/capabilities.ts`、`packages/canvas-data/src/canvas/registry/themeRegistry.ts`、
> `packages/canvas-data/src/canvas/registry/registerThemeSlot.ts`、`packages/kernel/src/registry/slotRegistry.ts`、
> `packages/canvas-render/src/host/canvasHostCore.ts`（`assembleTheme`）

画布"看得见的部分"（节点外壳、连线、背景、拖线临时线、设置面板…）被抽成可被插件替换的**槽位**。
主题插件把自写的组件填进槽，就换掉一块 UI。

---

## 1. 最简换肤：`ctx.theme.register` 把组件塞进槽

内置槽名（`ThemeSlot`，`themeRegistry.ts:27`）：
`'nodeShell' | 'edge' | 'edgeDefaultType' | 'background' | 'connectionLine' | (string & {})`。

插件也可以发明任意字符串新槽（比如 `'settingsPanel'` 就是渲染层用、主题插件填的一个约定槽）。

```ts
import type { Context } from '@mini-canvas/canvas-base'
import MyEdge from './MyEdge.vue'
import MyBackground from './MyBackground.vue'

export function apply(ctx: Context) {
  ctx.theme.register('edge', MyEdge)                       // 换连线
  ctx.theme.register('background', MyBackground)           // 换背景
  ctx.theme.register('edgeDefaultType', 'custom')          // 这个槽是字面 string，不是组件
}
```

签名（`capabilities.ts`）：

```ts
register(slot: ThemeSlot, component: unknown, opts?: { id?: string; order?: number }): void
add(slot: ThemeSlot, component: unknown, opts?: { id?: string; order?: number }): void
remove(slot: ThemeSlot, id: string): void
```

- 组件是 **opaque 句柄**（数据层不 import Vue；传 `.vue` / stub / 任意对象都行）。
- `register` 与 `add` 是**同一个实现**（都走 `placeTheme`）；`remove` 按 id 抽走。
- **自动回收**：插件卸载时它那格 occupant 被抽走，同槽其它 occupant / 默认实现原位保留。

---

## 2. id 与 order：谁来定"赢家"

一个槽能放**多个** occupant，每个带 `{ id, order, value }`：

- **id**：同槽内唯一身份。**同 id 再放 = 替换那一格**；不同 id = 追加。
- **order**：决定顺序 / 赢家，**小者在前、小者赢**。后装的可以给更小的 order 顶掉当前的。
- 抽走一格**不影响同槽其它格** —— 所以"顶替后热卸自动回退"是自然成立的。

**`id` 缺省 = 当前插件名**（`capabilities.ts` 的 `placeTheme` 里 `opts.id ?? pluginName`）。
于是同一插件重复注册（比如 HMR 重载）只会**替换自己那格**，不会无限叠加：

```ts
// 同一个插件里调两次
ctx.theme.register('background', CompA)   // id = 插件名
ctx.theme.register('background', CompB)   // 同 id → 替换成 CompB
theme.occupants('background')             // 只有 1 个（CompB）
```

### 2.1 顶替演示（order 更小者获胜）

```ts
// 插件 A：默认占 edge
ctx.theme.register('edge', DefaultEdge)
// 插件 B：后装，想顶掉 → 给更小 order
ctx.theme.register('edge', NeonEdge, { id: 'neon', order: -1 })

theme.winner('edge')    // NeonEdge（order -1 最小 → 获胜）
theme.occupants('edge') // 两个都在（DefaultEdge 还在，随时可回退）
```

热卸 B → DefaultEdge 自动回到"赢家"位置。

---

## 3. ThemeRegistry —— 宿主 / 测试侧的读取接口（`ctx.get('themeRegistry')`）

`packages/canvas-data/src/canvas/registry/themeRegistry.ts` 的 `ThemeRegistry`：

```ts
// 多 occupant（开放槽语义）
winner(slot): unknown                  // order 最小的那个 value（当前渲染项）；空槽 undefined
occupants(slot): SlotEntry[]           // 全部 occupant，按 order 稳定排序
occupantIds(slot): string[]            // 已占 id 列表
hasOccupant(slot): boolean
addOccupant(slot, { id?, order?, value }): string
removeOccupant(slot, id): boolean
slots(): ThemeSlot[]                   // 任意含 occupant 的槽名
subscribe(listener): () => void        // 槽变化订阅（渲染侧重装配用）

// 兼容单值 API（读写 id='default', order=0 那一格）
register(slot, value): void            // 已有 default occupant 则抛错（防覆盖）
get(slot): unknown                     // = winner(slot)
set(slot, value): void                 // 覆盖式重设（未注册则新建）
unregister(slot): void                 // 注销 default occupant
has(slot): boolean
```

```ts
const theme = ctx.get('themeRegistry')
theme.winner('edge')          // 当前生效的连线组件
theme.occupants('edge')       // 同槽全部（按 order）
theme.occupantIds('edge')     // ['theme-default', 'neon']
```

> 两种 API 的关系：**单值 API 只是"读写 id='default' 那一格"的便捷说法**。
> `register` 仅在 default 那格**已被占**时抛错（防覆盖）；要多 occupant 用 `addOccupant`
> 或能力段 `ctx.theme.register` 带不同 id。
> `ctx.theme.register` 走的是 `addOccupant` 路径 —— **同 id 是替换，不抛错**。

---

## 4. 底层通用槽容器：SlotRegistry

`ThemeRegistry` 内部持有一个 `SlotRegistry`（`packages/kernel/src/registry/slotRegistry.ts`），
它是最通用的"多 occupant 槽"容器，可以独立使用。放入语义：

- 只有一个写入方法 `add(slot, req)`：**给了 id 且槽内已存在 → 替换那一格；否则追加**。
  `order` 缺省 = 当前格数。
- `remove(slot, id)` 移除一格。
- **没有独立的 `replace` / `single` 方法**：替换靠 `add` 传已有 id；"单赢家"由读取端 `first()` 取 order 最小者。

读取视图：`list(slot)`（按 order 排好）、`first(slot)`（single 赢家）、`get(slot, id)`（按 id 精确取）。

```ts
import { SlotRegistry } from '@mini-canvas/kernel'
const slotReg = new SlotRegistry()
const id = slotReg.add('canvas.dock', { order: 1, value: DockBar, meta: { mode: 'append' } })
slotReg.list('canvas.dock')    // [{ id, order, value, meta }]
slotReg.remove('canvas.dock', id)
```

`SlotEntry` / `SlotAddRequest` 都带可选 `meta`（宿主读回时原样透出，例如设置面板槽的 `mode`）。

---

## 5. 低层入口：`registerThemeSlot(ctx, slot, value)`

`ctx.theme.register` 之外，还有函数形态的入口（`registry/registerThemeSlot.ts`），
适合"不走能力段"的场合：

```ts
import { registerThemeSlot } from '@mini-canvas/canvas-data'

const revoke = registerThemeSlot(ctx, 'edge', MyEdge)   // 换连线
registerThemeSlot(ctx, 'background', MyBg)
registerThemeSlot(ctx, 'edgeDefaultType', 'custom')
```

语义差别（**这点很重要**）：它走的是 `ThemeRegistry.register`（单值路径，写 default 那格），
所以 default 那格已被占时会抛错；返回的 `revoke` 会登记进当前插件 scope，卸载时自动注销。
`ctx.get('themeRegistry')` 取不到时它**静默跳过**（纯数据 ctx 不注入也能跑）。

> 选择建议：插件里统一用 `ctx.theme.register`（自由 id、可叠层、同 id 顶替、自动回收）；
> `registerThemeSlot` 留给"就是要占默认那格"或历史代码。

---

## 6. 宿主怎么把槽装成渲染

渲染层 `assembleTheme(theme, storeTypes)`（`packages/canvas-render/src/host/canvasHostCore.ts`）
把 `themeRegistry` 读成一份 `ThemeAssembly`：`nodeShell` / `nodeShells` / `edge` / `background` /
`connectionLine` / `edgeDefaultType` / `nodeTypes`，交给 VueFlow 的 `nodeTypes` / `edgeTypes`。

两个值得知道的约定：

- **每个 type 的专属壳**：槽名 `nodeShell:<type>`（用 `nodeShellSlot(type)` 生成）。
  解析顺序是 `node/shell` 场（精确键 → `*` 通配）→ theme 槽 `nodeShell:<type>` → theme 槽 `nodeShell`（全局默认壳）。
  于是某插件想完全自定义自己节点的外观，注册 `nodeShell:<type>` 或往 `node/shell` 场放即可，
  不改默认壳、也不让默认壳去猜节点类型。
- **`settingsPanel` 槽**：设置面板本身也是一个可替换的皮。`SettingsHost` 读
  `themeRegistry.winner('settingsPanel')` 渲染当前赢家；想换一整块设置 UI 的插件
  `ctx.theme.register('settingsPanel', 新组件, { order: -1 })` 就顶替了。

---

## 7. 坑与速记

1. `ctx.theme.register` 与 `ctx.theme.add` 是**同一个实现**；`ctx.theme.remove(slot, id)` 按 id 抽走。
2. **order 小者获胜**：想顶替当前就给更小 order；想回退就等更高优先级的 occupant 被卸。
3. **id 缺省 = 插件名**：同插件重复注册会替换自己那格（热重载友好）；换 id 才新增。
4. `ctx.theme.register` 同 id 是**替换**（不抛）；`ThemeRegistry.register`（单值 / `registerThemeSlot`）在 default 格已占时**抛错**。
5. 组件 **opaque**：`.vue` / stub 均可。`edgeDefaultType` 这种槽的值是**字面 string**，不是组件。
6. 换肤不需要自己注入 `themeRegistry`：`canvas-base` 已注入。纯数据 ctx（不装画布能力层）里
   `ctx.theme.register` 会**静默跳过**（`placeTheme` 里取不到就 return）。
7. occupant 随插件卸载自动回收；想手动抽走用 `ctx.theme.remove`。
8. 槽名不限于内置枚举，字符串即可 —— 但**要有消费端**（宿主要写 `<SlotHost slot="…" />` 或自己读
   `winner/occupants`），否则就是"注册了不生效"。

