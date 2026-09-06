# 主题换肤：ctx.theme + ThemeRegistry + registerThemeSlot（多 occupant / winner / order / id）

> 来源：packages/canvas-core-v2/src/core/capabilities.ts、registry/themeRegistry.ts、registry/registerThemeSlot.ts、registry/slotRegistry.ts

画布"看得见的部分"（节点外壳、连线、背景、连线条…）被内核抽成可被插件替换的**槽位**。主题插件把自写的组件填进槽，就能换一块 UI。

---

## 1. 最简换肤：ctx.theme.register 把组件塞进槽

内置主题槽名（`ThemeSlot`）：`'nodeShell' | 'edge' | 'edgeDefaultType' | 'background' | 'connectionLine'`，插件也可以发明任意字符串新槽。

```ts
apply(c) {
  // 换"连线"组件
  c.theme.register('edge', MyEdge)
  // 换"背景"组件
  c.theme.register('background', MyBackground)
  // edgeDefaultType 这种是字面值（string），不是组件
  c.theme.register('edgeDefaultType', 'custom')
}
```

签名（capabilities）：

```ts
register(slot, component, opts?: { id?: string; order?: number })
add(slot, component, opts?)        // 与 register 等价（别名）
remove(slot, id)
```

组件是 **opaque 句柄**（内核不 import Vue）。注册**自动回收**：插件卸载时该 occupant 被抽走，其它 occupant / 默认实现原位保留。

---

## 2. 低层入口：registerThemeSlot(ctx, slot, value)

`ctx.theme.register` 内部用的就是它。也可在插件里直接调：

```ts
import { registerThemeSlot } from '@mini-canvas/canvas-core-v2'

registerThemeSlot(ctx, 'edge', MyEdge)          // 换连线
registerThemeSlot(ctx, 'background', MyBg)      // 换背景
registerThemeSlot(ctx, 'nodeShell', MyShell)    // 换节点外壳(可选)
registerThemeSlot(ctx, 'edgeDefaultType', 'custom')
```

返回 revoke 自动挂进当前插件 Scope：卸载时槽位自动回退（注销）。

---

## 3. 多 occupant 槽语义：一个槽可放多个，按 order 决胜负

ThemeRegistry 基于一个更通用的 **SlotRegistry**（多 occupant 槽）。一个槽(slot)能放**多个 occupant**，每个带 `{ id, order, value }`：

- **id**：同一槽内唯一身份。同 id 已存在 → **替换**那一格；否则**追加**。
- **order**：决定顺序 / 赢家（**小在前**）。后装的可以给更小 order 顶掉当前的。
- 移除一个 occupant **不影响同槽其它 occupant**（热卸只抽走它填的那份）。

```ts
// 宿主消费：
//  - 单格换肤点(nodeShell/edge/background) = single 语义 → 取 winner（order 最小者）
//  - 可并列叠加的装饰层 → 取 occupants 按 order 全量渲染
theme.winner('edge')            // order 最小的那个 value（当前渲染项）
theme.occupants('edge')         // 全部 occupant，按 order 稳定排好
theme.occupantIds('edge')       // 已占 id 列表（诊断/热卸）
theme.hasOccupant('edge')       // 是否有任意 occupant
theme.removeOccupant('edge', id) // 移除某格
```

### 3.1 顶替演示（order 更小者获胜）

```ts
// 插件 A：默认占 edge（经 ctx.theme.register 时 id 缺省 = 当前插件名，见 §3.2）
c.theme.register('edge', DefaultEdge)
// 插件 B：后装，想顶掉 → 给更小 order
c.theme.register('edge', NeonEdge, { id: 'neon', order: -1 })

theme.winner('edge')    // NeonEdge（order -1 最小 → 获胜渲染）
theme.occupants('edge') // 两个都在（DefaultEdge 还在，随时可回退）
```

热卸 B → DefaultEdge 自动回到"赢家"位置（回退自然成立）。

### 3.2 id 缺省 = 当前插件名

`ctx.theme.register` 里 `id` 缺省 = **当前插件名**。所以同插件重复调用（重装）会替换自己那格，不会无限叠加：

```ts
// 同一个插件里调两次（如 HMR 重载）
c.theme.register('background', CompA)   // id = 插件名
c.theme.register('background', CompB)   // 同 id → 替换成 CompB
theme.occupants('background')           // 只有 1 个（CompB）
```

---

## 4. ThemeRegistry 兼容单值 API（读写 default occupant）

为了老代码零改动，ThemeRegistry 还保留一套"单格"API，它们读写 `id='default', order=0` 那一格，语义与旧版完全一致：

```ts
theme.register(slot, value)      // 槽已有 default occupant 抛错（防覆盖）
theme.get(slot)                  // 取 default（= winner）
theme.set(slot, value)           // 覆盖式重设（未注册则新建）
theme.unregister(slot)           // 注销 default
theme.has(slot)                  // 是否有 default occupant
theme.slots()                    // 已注册槽位名（任意含 occupant 的槽）
```

> 单格 API `register` 对已占 default 抛错；要多 occupant 请用 `addOccupant`（或 ctx.theme.register 带不同 id）。

---

## 5. 底层通用槽容器：SlotRegistry（theme/node 都基于它）

`SlotRegistry`（`ctx.get('slots')` 就是它）是最通用的"多 occupant UI 槽"容器，可独立使用。主题注册表内部就是持有一个它。放入语义（源码）：
- 只有 `add(slot, req)` 一个写入方法：给了 id 且槽内已存在 → 替换该 id；否则追加（order 缺省 = 当前格数）。
- `remove(slot, id)` 移除某一格。
- 没有独立的 `replace` / `single` 方法：替换靠 `add` 传已有 id，single 语义的"赢家"靠读取端 `first()` 取 order 最小者。

读取视图：`list(slot)`（按 order 排好）、`first(slot)`（single 赢家）、`get(slot, id)`。

```ts
const slotReg = new SlotRegistry()          // 或 ctx.get('slots')
const id = slotReg.add('canvas.dock', { order: 1, value: DockBar, meta: { mode: 'append' } })
slotReg.list('canvas.dock')                 // [{ id, order, value, meta }]
slotReg.remove('canvas.dock', id)
```

`SlotEntry` / `SlotAddRequest` 都带可选 `meta`（宿主读回时原样透出，例如设置面板槽的 mode）。

---

## 6. 坑与速记

1. `ctx.theme.register` 与 `ctx.theme.add` 等价（同一实现），`remove` 按 id 删。
2. **order 小者获胜**；想顶替当前就给更小 order，想被回退就等更高优先级被卸。
3. **id 缺省 = 插件名**：同插件重复注册会替换自己那格（热重载友好）；换 id 才新增。
4. 换肤前要注入 `themeRegistry`（`ctx.inject('themeRegistry', new ThemeRegistry())`）；没注入时注册被静默跳过（不抛）。
5. 组件 opaque：传 .vue / stub 均可。edgeDefaultType 这种槽是字面 string，不是组件。
6. occupant 随插件卸载自动回收；`ctx.theme.remove` 可手动抽走。
