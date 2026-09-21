# 依赖拓扑排序：topoSort / depsOf

> 来源：`packages/kernel/src/topo.ts`（第 16 行 `topoSort`、第 85 行 `depsOf`）；调用方 `packages/kernel/src/Context.ts`。

内核编排依赖背后有两个**纯函数**。平时写插件用不到它，但"我手上有一批插件，想按依赖排个先后"时可以直接用。

---

## 1. topoSort —— 返回按依赖排好序的名字

```ts
import { topoSort } from '@mini-canvas/kernel'

const order = topoSort([
  { name: 'b', inject: ['a'] }, // b 依赖 a → a 必须排在 b 前面
  { name: 'a' },
])
console.log(order) // ['a', 'b']（依赖在前）
```

**规则**（源码 `packages/kernel/src/topo.ts:16`）：

- A 的依赖里含 B ⇒ B 必须先于 A（Kahn 算法：B 的入度先清）。
- **重名 / 自己依赖自己 / 依赖没登记的名字 / 循环依赖，四种都直接抛错**，循环还会给出可读路径。

```ts
// 下面四条都会抛错（消息前面都带 [core] 前缀，这里只摘关键部分）：
topoSort([{ name: 'a' }, { name: 'a' }])   // Duplicate plugin name: "a"
topoSort([{ name: 'a', deps: ['a'] }])     // Plugin "a" cannot depend on itself
topoSort([{ name: 'a', deps: ['ghost'] }]) // Plugin "a" depends on "ghost" which is not registered
topoSort([{ name: 'a', inject: ['b'] }, { name: 'b', inject: ['a'] }])
// 抛 Circular dependency detected: a → b → a
```

签名：

```ts
function topoSort(
  plugins: Array<Pick<PluginModule, 'name' | 'deps' | 'inject'>>,
  knownServices?: ReadonlySet<string>,
): string[]
```

第二个参 `knownServices` 是"宿主已经注入的服务名集合"。这些名字不是插件，排序时直接忽略：

```ts
const known = new Set(['doc', 'themeRegistry'])
topoSort([{ name: 'a', inject: ['doc'] }], known) // ['a']（doc 被忽略，不参与排序）
```

---

## 2. depsOf —— 取一份插件的依赖（inject 优先）

```ts
import { depsOf } from '@mini-canvas/kernel'

depsOf({ name: 'a', inject: ['x'], deps: ['y'] }) // ['x']（inject 优先）
depsOf({ name: 'a', deps: ['y'] })                // ['y']
depsOf({ name: 'a' })                             // []
```

签名：`depsOf(mod: Pick<PluginModule, 'deps' | 'inject'>): string[]`（`packages/kernel/src/topo.ts:85`）

> 新写法用 `inject`，老写法用 `deps`，**两者都有时只认 inject**。内核装插件 / 判定依赖就是在用 `depsOf`（`packages/kernel/src/Context.ts:353`、`:588`、`:627`）。

---

## 3. 和内核 start() 的关系

`start()` **不调用** `topoSort`。它用"多轮扫描、谁依赖满足了就激活谁"的 `drain()`（`packages/kernel/src/Context.ts:312`），因为真实场景里：

- 依赖可能是**服务名**，也可能是**插件名**，两种混着来；
- 插件可以在**运行中**才 provide 一个服务，之后先前卡住的插件要能自动被唤醒。

`topoSort` 更适合"我有一批已知的静态插件，想一次性拿到确定顺序"的场合（比如外部工具、装配清单预检）。

---

## 4. 坑与速记

1. `topoSort` 是全量、静态的：缺依赖、循环都直接抛错，**不接受"等一等"**（那是 `start()` / `drain()` 的活）。
2. 想让某些宿主服务依赖不参与排序，用第二参 `knownServices` 传服务名集合。
3. `depsOf` 在 `inject` 与 `deps` 同时存在时只认 `inject`。
4. 重名与自依赖在遍历开头就抛，别指望拿到"部分结果"。
