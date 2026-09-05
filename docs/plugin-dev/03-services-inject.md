# 3 · 服务（Service 类 + inject 依赖）

> 目标：弄懂"服务"——一个插件向别人公开的具名能力；别的插件用 `inject` 声明硬依赖等它到齐，
> 或 `ctx.get` 探测可选依赖。建立在第 1/2 篇跑通的基础上。

## 一句话

画布里的东西大多是**服务**：`nodeStore`（节点数据）、`save`（落盘）、`command`（命令）、
`themeRegistry`…都是宿主上架的、插件能 `ctx.get('nodeStore')` 取到并消费的具名能力。
你也可以**自己上一项服务**给别人用。服务分两种依赖：

- **硬依赖**：`export const inject = ['某服务']` —— 缺提供方时你的插件停在 **PENDING**，到齐自动激活。
- **可选依赖**：不加 `inject`，用到时 `ctx.get('某服务')` 探测——缺了返回 `undefined`（不抛），插件照跑。

## 先看仓库里真实的"上服务"长啥样

`packages/plugins/plugin-node-text` 的 `apply` 里，除了注册 text 节点，还上了一项服务给 content
组件和宿主调用（`ctx.inject('text', { … })`，节点组件双点编辑时 `ctx.get('text')` 来用）：

```ts
// plugin-node-text 里 (简化)
export function apply(ctx: Context) {
  ctx.nodes.register({ type: 'text', label: '文本', … })

  // 上架一项服务：别的插件/宿主 ctx.get('text') 就能拿到 addTextNode / editText
  ctx.inject('text', {
    addTextNode: (position) => { /* 放一个文本节点，返回 id */ },
    editText(id, text) { /* 改文本并落盘 */ },
  } satisfies TextNodeService)
}
```

`plugin-node-image` 同理，上架了 `image` 服务（`addImageNode` / `removeNode`）。

> `ctx.inject(name, impl)` 和 `ctx.provide(name, impl)` 是同一个动作的两种叫法（provide 是 cordis 术语）。
> 它属于 effect（第 2 篇）：提供方插件被卸载，这项服务**自动下架**。

## 消费者：用 inject 声明硬依赖

你现在想写一个插件，它在装载后**自动往画布放一个文本节点**——它需要 text 节点插件提供的
`text` 服务。用 `inject` 声明，内核会保证：**等服务到齐了才跑你的 `apply`**。

在浏览器控制台热装（demo 已装好 text/image 插件，服务都在）：

```js
// 消费者：声明硬依赖 'text'（= node-text 插件提供的服务）
window.MiniCanvasManager.install({
  name: 'auto-text',
  inject: ['text'],                 // ← 硬依赖：text 服务不在就停 PENDING，等它
  apply(ctx) {
    // 到这儿说明 'text' 服务已在 → ctx.get('text') 一定非空
    const textSvc = ctx.get('text')
    const id = textSvc.addTextNode({ x: 300, y: 300 })   // 真往画布放了个文本节点！
    console.log('[auto-text] 已放文本节点', id)
  },
})
```

## 你会看到

- 粘贴回车后，画布上**多出一个文本节点**（300,300 附近）——这是你插件借 `text` 服务放上去的，
  节点能双击编辑、和手动点出来的完全一样。
- `window.MiniCanvasManager.list()` 里 `auto-text` 显示 **ACTIVE**。

## 缺提供方时：停在 PENDING（这就是诊断常客）

把依赖名改成仓库里**没人提供**的服务，比如 `'greeter'`，再看会发生什么：

```js
window.MiniCanvasManager.install({
  name: 'auto-text',
  inject: ['greeter'],               // 没人提供 greeter 服务
  apply(ctx) {
    console.log('[auto-text] 这条不会打印 —— 我还在等 greeter')
  },
})
```

- 这次画布**什么都没发生**，也没报错——因为 `apply` 压根没被调用。
- `manager.list()`（或左下角面板）里 `auto-text` 显示 **PENDING 缺: greeter**。
- PENDING 不是错误，是合法状态：提供方可能稍后才装。**"某插件没输出？先查它的 fiber 状态是不是 PENDING"**
  就是第 6 篇要教的诊断习惯。

## 把提供方补上：PENDING 自动激活

现在装一个提供 `greeter` 服务的插件。服务一到，内核自动唤醒等在 PENDING 的消费者并重跑它的 `apply`：

```js
// 提供方：上架 greeter 服务（ctx.provide 与 ctx.inject 同义）
window.MiniCanvasManager.install({
  name: 'greeter',
  inject: [],
  apply(ctx) {
    ctx.provide('greeter', {
      greet: (who) => `Hello, ${who}!`,
    })
    console.log('[greeter] 服务已上架')
  },
})
```

- `greeter` 装上、服务上架的那一刻，`auto-text` 自动从 PENDING 变 ACTIVE，`apply` 重跑，
  控制台打出 `[auto-text] 这条会打印了！`（把它 apply 里的打印改一下验证更直观）。
- 依赖方启动由**依赖关系**决定，不看你装配顺序：先装消费者再装提供方，结果一样。

## 服务没了怎么办：依赖方跟随回退再恢复

服务依赖是**运行期持续跟踪**的，不是一次性启动检查。把 `greeter` 卸掉：

```js
window.MiniCanvasManager.uninstall('greeter')
```

- 因为 `greeter` 提供的服务消失了，依赖它的 `auto-text` 会**回收自己的副作用并回退 PENDING**；
- 等你再装回 `greeter`，`auto-text` 又会自动重载、`apply` 重跑（用上新的提供方）。
- 这就是"配置里换提供方"的地基：卸掉一个 `shell` 提供方、装上另一个，所有 `inject:['shell']` 的
  插件都会自动重启用新实现。

## 提供方用 Service 类形态写（更干净的类）

对象 `ctx.provide('greeter', {...})` 最省事；想表达"这是一项正式能力"时，可以用 **Service 子类**。
它和对象形式等价，只是把实现收进类里（`super(ctx, name)` 构造时就把实例上架了）。
仓库里还没有这种插件，写一个给你当样板（放 `demo-web/` 或独立包都行）：

```ts
import { Service, type Context } from '@mini-canvas/canvas-base'

declare module '@mini-canvas/canvas-base' {
  interface PluginScope { greeter: GreeterService }   // 可选：给 ctx.greeter 补类型(声明合并)
}

export class GreeterService extends Service {
  constructor(ctx: Context) { super(ctx, 'greeter') } // 构造即上架为服务 'greeter'
  greet(who: string) { return `Hello, ${who}!` }
}

export const name = 'greeter'
export const inject = [] as string[]
export function apply(ctx: Context) {
  new GreeterService(ctx)        // 类形态：new 一下即把实例以 'greeter' 上架
}
```

它跟对象 `ctx.provide('greeter', …)` 唯一差别是写法：作者把 `super(ctx,'greeter')` 放构造里，
内核自动 `ctx.provide`，撤销也随提供方 scope 自动回收。消费者那边完全一样：
`export const inject=['greeter']` → `apply` 里 `ctx.get('greeter')`。

## 可选依赖：不加 inject，用 ctx.get 探测

有些能力你有就锦上添花、没有也不影响运行——别用 `inject`（它会让你停在 PENDING），
直接在使用处探测：

```ts
// 不写 inject。greeter 没人提供 → get 返回 undefined，插件照常跑
export function apply(ctx: Context) {
  const greeter = ctx.get<{ greet(w: string): string } | undefined>('greeter')
  console.log(greeter?.greet('maybe') ?? '没有 greeter 服务，跳过问候')
}
```

内核的服务是扁平命名空间（`nodeStore`/`save`/`text`/`image`/`greeter` 都平铺在一个池子里）。
给自己的服务起**有辨识度的名字**（如 `node-text` 用 `text`、`node-image` 用 `image`），避免撞名。

## 这背后发生了什么（一句话）

服务 = 挂到 ctx 上的具名能力。硬依赖用 `inject` 声明：内核让插件停在 **PENDING** 直到提供方上架，
再自动激活；服务被卸/换，依赖方自动回退 PENDING 并随恢复重载（运行期持续跟踪）。可选依赖用
`ctx.get` 探测，缺返回 `undefined` 不抛。上服务/注册本身都是 effect，随提供方卸载自动下架。

## 下一步

服务是"点对点直接调用"。下一篇讲**事件**——不需要知道对方是谁就能打招呼的通知，
以及五种分发模式（同步广播 / 并发 / 串行短路 / 瀑布环绕）分别什么时候用 →
[第 4 篇 · 事件（五种分发）](./04-events.md)。
