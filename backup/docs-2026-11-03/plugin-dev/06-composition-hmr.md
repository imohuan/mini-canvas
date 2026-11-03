# 6 · 组合与热重载（manager / manifest / PENDING 诊断）

> 目标：把一堆插件用一份**装配清单（manifest）**按序装进画布；想卸就卸、想换版本就换；
> 并学会诊断"有个插件怎么一直不起来"（卡 PENDING / FAILED）。建立在第 1–5 篇跑通的基础上。

## 一句话

到这一篇你已经有能注册节点/服务/事件/配置的插件了。问题是**怎么把它们组合成"一个能用的画布"**、
别人拿去怎么一键装上、出问题怎么排查。答案是：宿主给你一个统一安装句柄 **`manager`**
（装/卸/换版本/列清单），装配可以用一份 **manifest** 声明"装哪些、什么顺序、每插件什么 config"；
查问题看每插件的 **fiber 状态**（ACTIVE/PENDING/FAILED），卡 PENDING 十有八九是缺依赖（第 3 篇）。

## manager：装 / 卸 / 换版本 / 列清单

控制台里直接用 `window.MiniCanvasUI`（`packages/ui` 挂的宿主 API）就能装卸与诊断；
更全的 `manager`（同 id 自动覆盖、外部来源、`applyManifest`）是宿主侧句柄（见下一节）：

```js
// 1. 装一个插件（对象/Service 类；同名已装会抛错，想覆盖用第 3 条）
window.MiniCanvasUI.installPlugin({ name: 'hello', inject: [], apply(ctx) { /* … */ } })

// 2. 卸一个插件——副作用/注册/UI 自动回收(第 2 篇的 effect 回卷)
window.MiniCanvasUI.uninstallPlugin('hello')

// 3. 换版本——卸旧装新(用新实现覆盖同名)
window.MiniCanvasUI.reloadPlugin('hello', { name: 'hello', inject: [], apply(ctx) { /* 新实现 */ } })

// 4. 看装了什么 + 每插件状态
console.table(window.MiniCanvasUI.inspectPlugins())   // name / state / missingDeps / error / core
```

> `manager` 是宿主侧的统一安装句柄（`PluginManager`）：比上面四个多出"同 id 后装覆盖先装"、
> 从 URL / 单文件文本装、`diagnose()` 只列非 ACTIVE、以及 `applyManifest`。装卸都会 `await`。

## 装配清单 manifest：让别的画布"照单全装"

真正要分发的是**一份清单**，而不是一个个手动 install。仓库里
`packages/ui/src/assembly.ts` 的 `APP_PLUGINS` 就是真样板——`<CanvasHost :plugins="APP_PLUGINS">`
的数组顺序即装载顺序：

```ts
// packages/ui/src/assembly.ts (真实现，节选)
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'

/** 数组顺序即装载顺序 */
export const APP_PLUGINS = [
  themeDefaultPlugin, // 画布默认皮：节点壳 / 边 / 背景 / 设置面板
  nodeTextPlugin,     // text 节点 + text 服务
  nodeImagePlugin,    // image 节点 + image 服务
  // …另有 18 个源码插件
]
```

想让"装哪些、每插件什么 config"由**数据清单**声明（而不是写在源码数组里），用 `manager` 的
`PluginManifest`——每项 `{ id, source, config?, disabled?, group? }`，`config` 经插件的
`Config` schema 校验 + 补默认后传给 `apply(ctx, config)`：

```ts
import { createMiniCanvasHost, type PluginManifest } from '@mini-canvas/canvas-render'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'

const manifest: PluginManifest = {
  plugins: [
    // 想覆写某插件默认 config，就在项上加 config(经其 Config schema 校验+补默认)
    { id: 'theme-default', source: themeDefaultPlugin, config: { edgeColor: '#16a34a' } },
  ],
}

const { manager } = await createMiniCanvasHost({ manifest })
const installed = await manager.applyManifest(manifest)
console.log('已装:', installed)   // ['theme-default', …]
```

### manifest 的 id 与"同 id 覆盖"

清单每项有个稳定的 `id`（建议 = 插件 `name`）。意义是：**同一 id 后装覆盖先装 = 换版本**，
而不必先删再加。你想"换掉 theme-default 用自己那份"时，清单里给同 id 换 source 即可——
`applyManifest` 按 id 增量装，同名后装覆盖先装（轻量分层）。

> 想只装其中几个 / 换顺序 / 覆盖成自己版本？把 `plugins` 数组改成你那份就行——这就是"分层"。

### 单文件插件 / 远程 URL 也能装（走 manager）

`manager.install(source)` 不只收内存里的模块，还能从**外部来源**装（`installPlugin` 只收模块，
所以这两条要走 `manager`）：

```ts
// 一段单文件插件文本(ESM，导出 name/apply 即可)
await manager.install({
  text: "export const name='ext'; export function apply(ctx){ ctx.slots.register('overlay', { id:'ext', order:9, component:{ /* … */ } }) }",
})
// 或远程 URL(浏览器会 fetch 下来再执行)
await manager.install({ url: 'https://…/my-plugin.js' })
```

`manager` 从哪来：宿主代码里 `createPluginManager(ctx)`，或在 `<CanvasHost>` 组件 ref 上取
`.manager`（`packages/ui/src/App.vue` 装外部插件就是这么用的）。

（这就是"把插件打包成可分发的东西装进任意画布"——它只要满足 `{ name, apply }` 形态就能装。）

## 热重载 / 换版本，靠的是 effect 回卷 + 依赖重跑

为什么能"卸旧装新而不出岔子"？回顾第 2 篇 + 第 3 篇：

- 卸载会**释放全部 effect**（命令/节点/服务/监听都清掉）；
- 装载则**遵循依赖关系**（第 3 篇 inject）。

所以"换版本"= 先卸（旧实例副作用全回收）再装（新 `apply` 干净起）。第 3 篇讲过提供方被卸、
依赖它的插件自动回退 PENDING 再随恢复重载——热换一个服务提供方时，所有依赖它重起的插件会
自动用上新实现。

仓库的 `plugin-node-text` 还示范了**开发期热更（HMR）**：它 `index.ts` 里监听
`import.meta.hot.accept(...)`，源码一改就调 `window.MiniCanvas.reloadPlugin('text', 新模块)`，
让改动在运行中的画布里实时生效、不用刷新。这是给"边写边看"的开发者用的进阶招，
普通分发用上面的 `manager.reload` / manifest 同 id 覆盖即可。

## 诊断：卡 PENDING 的插件到底缺谁

多插件最容易踩的坑：装了插件但**它没输出、没报错、什么都没发生**。原因往往是它卡在 **PENDING**
——`inject` 声明了没人提供的服务（第 3 篇说过 PENDING 是合法状态，提供方可能稍后才来）。

怎么查？看 fiber 状态 + `missingDeps`（告诉你缺哪个依赖）：

```js
// ① 内核只读诊断，字段最全：谁 ACTIVE、谁 PENDING(缺谁)、谁 FAILED(报啥错)
console.table(window.MiniCanvasUI.getContext().inspectPlugins())

// ② 同上（宿主 API 直出）
console.table(window.MiniCanvasUI.inspectPlugins())

// ③ manager.diagnose() 只列"非 ACTIVE"的(卡 PENDING / FAILED)——宿主代码里用（见下）
//    console.table(manager.diagnose())
```

造一个"卡 PENDING"给你看（第 3 篇那个例子）：装一个 `inject:['greeter']` 的插件，但没人提供
`greeter` 服务——它不报错也不跑 `apply`，安静卡住：

```js
window.MiniCanvasUI.installPlugin({
  name: 'needs-greeter',
  inject: ['greeter'],          // 没人提供 greeter → 卡 PENDING
  apply(ctx) { console.log('[needs-greeter] 这条不会打印') },
})
// 诊断：看它到底缺谁
console.table(window.MiniCanvasUI.inspectPlugins())
// → needs-greeter  state: pending  missingDeps: ['greeter']
```

然后把提供方补上，它会**自动从 PENDING 变 ACTIVE** 重跑 `apply`：

```js
window.MiniCanvasUI.installPlugin({
  name: 'greeter-provider',
  inject: [],
  apply(ctx) { ctx.provide('greeter', { greet: (w) => `Hi ${w}` }) },
})
// needs-greeter 立刻被唤醒 → apply 重跑
```

> **诊断纪律**：插件既不干活也不报错时，第一件事查它的 fiber 状态——
> 卡 PENDING = 缺依赖（看 missingDeps），FAILED = 看 error 报错。

## 这背后发生了什么（一句话）

`manager` 把"装/卸/换版本"收成一个句柄，还支持外部来源与 **manifest**（一份声明，`applyManifest`
按 id 增量装、同 id 覆盖=换版本）；换版本靠"effect 回卷 + 依赖重跑"保证旧实现清干净、新实现干净起。
排查靠 fiber 状态：`manager.list()/diagnose()`（或 `ctx.inspectPlugins()`）给每插件的
`state/missingDeps/error`——卡 PENDING 就看缺哪个依赖、补上自动活。

## 下一步

你把插件都装起来了。最后一篇把它们**落进画布 UI 真正用起来**：写一个"能点出来 + 改主题 + 加命令 +
上服务"的真画布插件，端到端在画布界面里能看到、能操作 →
[第 7 篇 · 进入画布（端到端）](./07-into-canvas.md)。
