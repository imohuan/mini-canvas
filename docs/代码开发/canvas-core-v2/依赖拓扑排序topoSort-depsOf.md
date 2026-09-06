# 依赖拓扑排序：topoSort / depsOf

> 来源：packages/canvas-core-v2/src/core/topo.ts、Context.ts

内核依赖编排背后的纯函数工具，作者有时也要用（比如拿到一堆插件想按依赖排个先后）。

---

## 1. topoSort —— 返回按依赖排好序的名字

```ts
import { topoSort } from '@mini-canvas/canvas-core-v2'

const order = topoSort([
  { name: 'b', inject: ['a'] },   // b 依赖 a → a 要在 b 前
  { name: 'a' },
])
console.log(order)   // ['a', 'b']（依赖在前的顺序）
```

**规则**（源码注释原话）：

- A 的依赖（inject/deps）含 B ⇒ B 必须先于 A（Kahn 算法，B 的入度先清）。
- **重复名 / 自依赖 / 缺失依赖 / 循环依赖都抛错**，循环给出可读路径。

```ts
// 重复名 → 抛错
topoSort([{ name: 'a' }, { name: 'a' }])   // throw Duplicate plugin name: "a"

// 自依赖 → 抛错
topoSort([{ name: 'a', deps: ['a'] }])     // throw cannot depend on itself

// 缺依赖 → 抛错
topoSort([{ name: 'a', deps: ['ghost'] }]) // throw depends on "ghost" which is not registered

// 循环 → 抛错，带可读路径
topoSort([
  { name: 'a', inject: ['b'] },
  { name: 'b', inject: ['a'] },
])  // throw Circular dependency detected: a → b → a
```

签名：

```ts
function topoSort(
  plugins: Array<Pick<PluginModule, 'name' | 'deps' | 'inject'>>,
  knownServices?: ReadonlySet<string>,   // 可选：宿主注入的服务名集合
): string[]
```

第二个参 `knownServices`：把"宿主已注入的服务名"传进去，排序时会忽略这些依赖（它们不是插件，不参与插件间排序）。

```ts
const known = new Set(['nodeStore', 'themeRegistry'])
topoSort([{ name: 'a', inject: ['nodeStore'] }], known)  // ['a']（nodeStore 被忽略）
```

---

## 2. depsOf —— 取一份插件的依赖（inject 优先）

```ts
import { depsOf } from '@mini-canvas/canvas-core-v2'

depsOf({ name: 'a', inject: ['x'], deps: ['y'] })  // ['x']（inject 优先）
depsOf({ name: 'a', deps: ['y'] })                 // ['y']
depsOf({ name: 'a' })                              // []
```

签名：`depsOf(mod: Pick<PluginModule, 'deps' | 'inject'>): string[]`

> Cordis 用 `inject`、旧式用 `deps`，**inject 优先**。内核启动时就是用 `depsOf` 拿每个插件的依赖来编排的。

---

## 3. 和内核 start() 的关系

`start()` 并不直接调 `topoSort`（它用"多轮扫描依赖满足"的 `drain()`，天然支持"服务名依赖 + 插件名依赖"混合、以及插件代码里动态 provide 服务的场景）。`topoSort` 更适合：作者自己有一批已知插件的静态列表，想一次性拿到确定性的依赖顺序时用。

---

## 4. 坑与速记

1. `topoSort` 是全量、静态的：缺依赖/循环都直接抛错，**不接受"等一等"**（那是 start()/drain 的职责）。
2. 想忽略某些宿主服务依赖，用第二参 `knownServices` 传服务名集合。
3. `depsOf` 在 inject 与 deps 同时存在时只认 inject。
4. 自依赖/重复名在遍历开头就抛，别指望拿部分结果。
