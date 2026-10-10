# 依赖拓扑排序：`topoSort` / `depsOf`

**一句话定位**：**`topoSort` 是一个纯函数 —— 给它一批插件（各带依赖声明），它返回一份「依赖在前」的名字清单；依赖写错（重名 / 自依赖 / 缺依赖 / 成环）它就当场抛错，还把环的路径画给你看。**

**它属于哪一档**：**内核自带（框架层）**。源码：`packages/kernel/src/topo.ts`（`topoSort` / `depsOf`，从 v1 的 `PluginManager.resolveOrder` 吸收而来）。

## 它是什么

排课表：每门课都写了「先修课」，`topoSort` 给你排出一个「先修课一定排在前面」的顺序。

- **输入**：插件对象数组（`Pick<PluginModule, 'name' | 'deps' | 'inject'>`，也就是只要有名字和依赖字段就行），外加可选的「已知服务名集合」。
- **输出**：`string[]` —— 插件名数组，**依赖在前**。
- **出错**：抛 `Error`（四种情况，见下）。

按「数据 / 展示 / 能力 / 配置」分，它属于**工具函数**那一格：无状态、无副作用、纯计算，能单独拿去用（预检清单、外部工具、测试）。

> ⚠️ 一个容易记错的点：**`topoSort` 收的是「插件对象数组」，不是「名字数组」**。
> 名字在对象的 `name` 字段里，依赖在 `inject` / `deps` 字段里。

## 为什么需要它

插件之间有依赖，顺序不能靠人肉：

- 装配清单是**文件写的**（数组顺序固定），但依赖关系是**功能决定的**。改一个插件的依赖，就要重排整个清单 —— 迟早出错。
- 出错的代价很隐蔽：提供方还没上架服务，消费方就去 `ctx.get` —— 拿到的不是「等一会儿」，而是 `undefined`，然后在某个深夜的空指针上报错。

`topoSort` 把这件事变成一次**一次性的确定计算**：要么给你一个合法顺序，要么直接告诉你哪里错了（含环的可读路径）。

## 怎么用

### 一、签名与返回值

```ts
export function topoSort(
  plugins: Array<Pick<PluginModule, 'name' | 'deps' | 'inject'>>,
  knownServices?: ReadonlySet<string>,
): string[]
```

- 第一个参数：**插件列表**（对象数组），每个至少要有 `name`。
- 第二个参数（可选）：`knownServices` —— **「宿主注入的服务名」白名单**。
  依赖里出现这些名字时**不参与插件排序**（它们不是插件，是外部给的），直接忽略。
- 返回：按依赖顺序排好的**名字数组**，依赖在前。
- 抛错：非法依赖关系时抛 `Error`。

### 二、`depsOf`：依赖字段的归一

```ts
export function depsOf(mod: Pick<PluginModule, 'deps' | 'inject'>): string[]
```

一行实现：`return mod.inject ?? mod.deps ?? []` —— 也就是说：

> **`inject` 优先于 `deps`；两者都给时，`deps` 被完全忽略。**

`inject` 是新写法（Cordis 风格），`deps` 是老写法（向后兼容）。内核里所有读依赖的地方都走 `depsOf`（`Context.attachFiber`、`depSatisfied`、`tryActivate` 都调它），所以这个优先级是**全局一致**的。

```ts
depsOf({ name: 'a', inject: ['x'], deps: ['y'] })   // → ['x']（inject 优先）
depsOf({ name: 'a', deps: ['y'] })                   // → ['y']（只有老字段）
depsOf({ name: 'a' })                                // → []
```

### 三、四种会抛错的情况

| 情况 | 错误消息（源码逐字） |
| --- | --- |
| **重名** | `[core] Duplicate plugin name: "a"` |
| **自依赖** | `[core] Plugin "a" cannot depend on itself` |
| **依赖不存在**（且不在 `knownServices` 里） | `[core] Plugin "a" depends on "ghost" which is not registered` |
| **成环** | `[core] Circular dependency detected: a → b → a`（路径由 `buildCyclePath` 算出来） |

```ts
import { topoSort } from '@mini-canvas/kernel'

topoSort([{ name: 'a' }, { name: 'a' }])            // ✗ Duplicate plugin name: "a"
topoSort([{ name: 'a', inject: ['a'] }])            // ✗ cannot depend on itself
topoSort([{ name: 'a', deps: ['ghost'] }])          // ✗ depends on "ghost" which is not registered
topoSort([{ name: 'a', inject: ['b'] }, { name: 'b', inject: ['a'] }])  // ✗ Circular dependency detected
```

**正常排序的例子**（依赖在前，同级保持登记序 —— 源码用 Kahn 算法 + 队列，天然稳定）：

```ts
topoSort([{ name: 'a' }, { name: 'b' }])                        // ['a', 'b']
topoSort([{ name: 'b', inject: ['a'] }, { name: 'a' }])          // ['a', 'b']  ← 登记序无关
topoSort([{ name: 'c', inject: ['b'] }, { name: 'b', inject: ['a'] }, { name: 'a' }])
// → ['a', 'b', 'c']
```

### 四、`knownServices`：把「外部服务名」排除在排序之外

插件常常依赖一些**不是插件提供**的名字 —— 宿主注入的服务（如 `nodeLayout` / `viewport`），或者内核内置的 `tools`。
这些名字不在插件列表里，如果不告诉 `topoSort`，它就会报 `depends on "xxx" which is not registered`。

```ts
const known = new Set(['tools', 'settings', 'slots', 'nodeLayout', 'viewport'])
topoSort([{ name: 'a', inject: ['nodeLayout'] }], known)   // → ['a']（nodeLayout 被忽略，不参与排序）
```

### 五、和 `start()` 多轮激活的关系（**最要紧的一段**）

`start()` **不调用 `topoSort`**。它用的是「**多轮扫描**」（`Context.drain`）：

```
反复扫所有插件 → 谁 inject 的依赖此刻满足了，就激活谁 → 直到没有插件能再激活 → 广播 ctx:ready
```

`drain` 的依赖满足判定（三条之一即算满足）：

1. 它是**内置服务名**（内核 / 能力层自带，恒满足）；
2. 它已在**服务表**里（`ctx.inject` / `provide` 上架的）；
3. 它是**已登记且 fiber `active`** 的插件名。

依赖不满足的插件会**安静停在 `pending`** —— 不抛错，等以后被 `wakePending()` 唤醒（提供方出现 / 被热装时）。

那为什么还要 `topoSort`？因为两者解决的是**不同的问题**：

| | `topoSort`（纯函数） | `ctx.start()` / `drain()`（运行时） |
| --- | --- | --- |
| 什么时候用 | 你有一批**已知的静态插件**，想先算出一份确定顺序 | 运行时按实际就绪状态逐步激活 |
| 缺依赖怎么办 | **抛错**（不接受「等一等」） | 停下等（PENDING），提供方出现后自动唤醒 |
| 成环怎么办 | **抛错**并画出环路径 | 环里每个插件都等别人 → 全都停 PENDING（不会死循环，但也不会报错指出环） |
| 典型用途 | 装配清单**预检**、外部工具/脚本、单测 | 真正的装载执行 |
| 依赖来源 | 只看静态字段 `inject` / `deps` | 还看运行时的服务表、插件 fiber 状态 |

一句话记法：**`topoSort` 是「先检查这张清单合不合法、顺带排好序」；`start()` 是「按当下的实际情况一步步跑起来（可以边跑边长）」。**
清单预检用前者，实际执行靠后者；两者都读同一份 `depsOf`，所以口径一致。

## 会在哪里用到

| 文件 | 它在干什么 |
| --- | --- |
| `packages/kernel/src/topo.ts` | `topoSort`（Kahn + 四种错误检测 + 环路径）+ `depsOf` |
| `packages/kernel/src/Context.ts` | 导入 `depsOf`：`attachFiber` 初始化 `fiber.deps`、`depSatisfied` 判依赖、`tryActivate` 判缺项 |
| `packages/kernel/src/__tests__/topo.test.ts` | 锁住排序正确性与四种抛错（含环路径 `a → b → a`） |
| `packages/kernel/src/index.ts` | 包出口：`export { topoSort, depsOf } from './topo'` |

> 说明：仓库里 **`topoSort` 目前只有测试和包出口在用**；真正的装载路径走的是 `Context.drain()`。
> 这不是「没人要」—— 它是给装配清单预检、外部工具链、单测留的**纯函数入口**。

## 完整例子

一个能在 Node 里直接跑的清单预检脚本：先算出正确顺序，再分别踩四种错误。

### 目录长这样

```
topo-demo/
├── package.json          # 清单
└── src/
    ├── manifest.ts       # 一份「装配清单」：四个插件 + 各带依赖
    └── main.ts           # 预检脚本：排序 + 四种错误的现场演示
```

同样的文件在仓库里也放了一份，可直接打开对照：`packages/docs/public/examples/kernel/topo-demo/`。

### 文件一：清单

```ts
// 文件：packages\docs\public\examples\kernel\topo-demo/src/manifest.ts
// 格式：TypeScript 模块（装配清单 + 依赖声明）
// 位置：一个静态插件清单，预检用
import type { PluginModule } from '@mini-canvas/kernel'

/** 一份清单，故意把「依赖方」写在「提供方」前面，看 topoSort 能不能排对 */
export const manifest: Array<Pick<PluginModule, 'name' | 'inject'>> = [
  { name: 'agent', inject: ['tool-registry', 'canvas-base'] },   // 依赖两个
  { name: 'canvas-base', inject: [] },                           // 谁都不依赖
  { name: 'tool-registry', inject: ['canvas-base'] },            // 依赖 canvas-base
  { name: 'theme-default', inject: ['canvas-base'] },
]

/** 宿主已经注入的外部服务名（不是插件；排序时应当忽略它们） */
export const KNOWN_SERVICES = new Set(['tools', 'settings', 'slots', 'nodeLayout', 'viewport'])
```

### 文件二：预检脚本

```ts
// 文件：packages\docs\public\examples\kernel\topo-demo/src/main.ts
// 格式：TypeScript 模块（预检脚本，`npx tsx src/main.ts` 即可跑）
// 位置：验证清单合法 + 演示四种错误的报错长什么样
import { topoSort, depsOf } from '@mini-canvas/kernel'
import { KNOWN_SERVICES, manifest } from './manifest'

// ① 正常排序：依赖在前
const order = topoSort(manifest, KNOWN_SERVICES)
console.log('[topo] 合法顺序：', order)
// ['canvas-base', 'tool-registry', 'theme-default', 'agent']（同级保持登记序）

// ② depsOf 的优先级：inject 优先于 deps
console.log('[topo] depsOf 优先级：', depsOf({ name: 'x', inject: ['a'], deps: ['b'] }))  // ['a']

// ③ 环：把 agent 也变成 tool-registry 的依赖 → 成环，报出可读路径
try {
  topoSort([
    { name: 'a', inject: ['b'] },
    { name: 'b', inject: ['c'] },
    { name: 'c', inject: ['a'] },
  ])
} catch (err) {
  console.log('[topo] 环：', (err as Error).message)
  // [core] Circular dependency detected: a → b → c → a
}

// ④ 缺依赖（记得把 knownServices 传上，否则外部服务名也会被当成「缺失」）
try {
  topoSort([{ name: 'a', inject: ['ghost'] }])
} catch (err) {
  console.log('[topo] 缺依赖：', (err as Error).message)
  // [core] Plugin "a" depends on "ghost" which is not registered
}

// ⑤ 重名
try {
  topoSort([{ name: 'a' }, { name: 'a' }])
} catch (err) {
  console.log('[topo] 重名：', (err as Error).message)
  // [core] Duplicate plugin name: "a"
}

// ⑥ 自依赖
try {
  topoSort([{ name: 'a', inject: ['a'] }])
} catch (err) {
  console.log('[topo] 自依赖：', (err as Error).message)
  // [core] Plugin "a" cannot depend on itself
}
```

## 常见坑

1. **参数是「插件对象数组」不是「名字数组」**。旧文档与直觉容易写成 `topoSort(['a','b'])` —— 实际要 `topoSort([{ name: 'a' }, { name: 'b' }])`。
2. **不传 `knownServices` 就会把外部服务名当「缺失依赖」抛错**。清单里只要出现 `nodeLayout` / `viewport` / `tools` 这类宿主或内核提供的名字，就得把白名单传上。
3. **`inject` 优先于 `deps`，两者都给时 `deps` 被忽略**（不是合并）。混写老字段时要小心这一点。
4. **`topoSort` 不接受「等一等」**：缺依赖直接抛。要「等提供方出现」是 `start()` / `drain` 的语义 —— 两者别用错场景。
5. **成环时 `start()` 不会报错指出环** —— 环里每个插件都安静停在 `pending`。想提前发现环，就用 `topoSort` 预检一遍。
6. **返回的是名字数组，不是对象**。要拿回对象请自己按名字建索引（`new Map(plugins.map(p => [p.name, p]))`）。



