# 6 · 组合与热重载（manager / manifest / PENDING 诊断）

> 目标：把一堆插件用一份**装配清单（manifest）**按序装进画布；想卸就卸、想换版本就换；
> 并学会诊断"有个插件怎么一直不起来"（卡 PENDING / FAILED）。建立在第 1–5 篇跑通的基础上。

## 一句话

到这一篇你已经有能注册节点/服务/事件/配置的插件了。问题是**怎么把它们组合成"一个能用的画布"**、
别人拿去怎么一键装上、出问题怎么排查。答案是：宿主给你一个统一安装句柄 **`manager`**
（装/卸/换版本/列清单），装配可以用一份 **manifest** 声明"装哪些、什么顺序、每插件什么 config"；
查问题看每插件的 **fiber 状态**（ACTIVE/PENDING/FAILED），卡 PENDING 十有八九是缺依赖（第 3 篇）。

## manager：装 / 卸 / 换版本 / 列清单

demo 已把 manager 挂到 `window.MiniCanvasManager`。最常用四个动作：

```js
// 1. 装一个插件（源码模块/对象都行）——已装同名会先卸旧再装新(=换版本)
window.MiniCanvasManager.install({ name: 'hello', inject: [], apply(ctx) { /* … */ } })

// 2. 卸一个插件——副作用/注册/UI 自动回收(第 2 篇的 effect 回卷)
window.MiniCanvasManager.uninstall('hello')

// 3. 换版本——卸旧装新(用新实现覆盖同名)
window.MiniCanvasManager.reload('hello', { name: 'hello', inject: [], apply(ctx) { /* 新实现 */ } })

// 4. 看装了什么 + 每插件状态
console.table(window.MiniCanvasManager.list())   // name / state / missingDeps / error
```

> 想让插件"装完能一路被操作到"？demo 画布左下角那块 **「插件管理器」** 面板就是 list() 的 UI：
> 每行列插件名 + fiber 状态徽标（ACTIVE 绿 / PENDING 黄附缺谁 / FAILED 红附报错），
> 每行带"卸"按钮，底部还有"重载 theme-default(换版本)"——跑 demo 点两下就能看到热卸/换版本的真效果。

## 装配清单 manifest：让别的画布"照单全装"

真正要分发的是**一份清单**，而不是一个个手动 install。仓库里
`packages/canvas-core-v2/demo-web/baseManifest.ts` 就是真样板——它声明装 4 个生产插件，按序装：

```ts
// baseManifest.ts (真实现)
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'
import type { PluginManifest } from '@mini-canvas/canvas-render'

export const baseManifest: PluginManifest = {
  plugins: [
    { id: 'theme-default', source: themeDefaultPlugin },   // 主题(提供 nodeShell/edge/background)
    { id: 'node-text',     source: nodeTextPlugin },        // text 节点 + text 服务
    { id: 'node-image',    source: nodeImagePlugin },       // image 节点 + image 服务
    { id: 'canvas-commands', source: canvasCommandsPlugin },// 命令(删/建/撤销/重做)
    // 想覆写某插件默认 config，就在项上加 config(经其 Config schema 校验+补默认)：
    // { id: 'theme-default', source: themeDefaultPlugin, config: { edgeColor: '#16a34a', edgeLineWidth: 3 } },
  ],
}
```

另一画布宿主拿到清单，**一行装完**：

```ts
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import { baseManifest } from './baseManifest'

const { manager } = await createMiniCanvasHost()
const installed = await manager.applyManifest(baseManifest)
console.log('已装:', installed)   // ['theme-default','node-text','node-image','canvas-commands']
```

### manifest 的 id 与"同 id 覆盖"

清单每项有个稳定的 `id`（建议 = 插件 `name`）。意义是：**同一 id 后装覆盖先装 = 换版本**，
而不必先删再加。你想"换掉 theme-default 用自己那份"时，清单里给同 id 换 source 即可——
`applyManifest` 按 id 增量装，同名后装覆盖先装（轻量分层）。

> 想只装其中几个 / 换顺序 / 覆盖成自己版本？把 `plugins` 数组改成你那份就行——这就是"分层"。

### 单文件插件 / 远程 URL 也能装

manager 不只收内存里的模块，还能从**外部来源**装：

```js
// 一段单文件插件文本(ESM，导出 name/apply 即可)
window.MiniCanvasManager.install({
  text: "export const name='ext'; export function apply(ctx){ ctx.slots.register('overlay', { id:'ext', order:9, component:{ /* … */ } }) }",
})
// 或远程 URL(浏览器会 fetch 下来再执行)
window.MiniCanvasManager.install({ url: 'https://…/my-plugin.js' })
```

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
// ① 一眼看全部：谁 ACTIVE、谁 PENDING(缺谁)、谁 FAILED(报啥错)
console.table(window.MiniCanvasManager.list())

// ② manager.diagnose() 只列"非 ACTIVE"的(卡 PENDING / FAILED)——专门找问题
console.table(window.MiniCanvasManager.diagnose())

// ③ 内核只读诊断，字段最全
console.table(window.MiniCanvas.getContext().inspectPlugins())
```

造一个"卡 PENDING"给你看（第 3 篇那个例子）：装一个 `inject:['greeter']` 的插件，但没人提供
`greeter` 服务——它不报错也不跑 `apply`，安静卡住：

```js
window.MiniCanvasManager.install({
  name: 'needs-greeter',
  inject: ['greeter'],          // 没人提供 greeter → 卡 PENDING
  apply(ctx) { console.log('[needs-greeter] 这条不会打印') },
})
// 诊断：看它到底缺谁
console.table(window.MiniCanvasManager.diagnose())
// → needs-greeter  state: pending  missingDeps: ['greeter']
```

然后把提供方补上，它会**自动从 PENDING 变 ACTIVE** 重跑 `apply`：

```js
window.MiniCanvasManager.install({
  name: 'greeter-provider',
  inject: [],
  apply(ctx) { ctx.provide('greeter', { greet: (w) => `Hi ${w}` }) },
})
// needs-greeter 立刻被唤醒 → apply 重跑
```

> **诊断纪律**：插件既不干活也不报错时，第一件事查它的 fiber 状态——
> 卡 PENDING = 缺依赖（看 missingDeps），FAILED = 看 error 报错。demo 左下角面板把这两样都标出来了。

## 这背后发生了什么（一句话）

`manager` 把"装/卸/换版本"收成一个句柄，还支持外部来源与 **manifest**（一份声明，`applyManifest`
按 id 增量装、同 id 覆盖=换版本）；换版本靠"effect 回卷 + 依赖重跑"保证旧实现清干净、新实现干净起。
排查靠 fiber 状态：`manager.list()/diagnose()`（或 `ctx.inspectPlugins()`）给每插件的
`state/missingDeps/error`——卡 PENDING 就看缺哪个依赖、补上自动活。

## 下一步

你把插件都装起来了。最后一篇把它们**落进画布 UI 真正用起来**：写一个"能点出来 + 改主题 + 加命令 +
上服务"的真画布插件，端到端在画布界面里能看到、能操作 →
[第 7 篇 · 进入画布（端到端）](./07-into-canvas.md)。
