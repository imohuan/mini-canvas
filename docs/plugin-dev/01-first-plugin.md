# 1 · 第一个插件

> 目标：写一个最小插件，加进画布宿主，跑起来看到效果。全程约 3 分钟。
> 建立在入口《index》"先备好环境"跑通 demo 的基础上。

## 先想清楚：插件到底是什么

一句话：**一个带 `name` 的模块（或对象），里面有个 `apply(ctx)` 函数**。宿主把它交给内核，
内核用一个叫 `ctx` 的"能力台"调用你的 `apply`；你在这个 `ctx` 上注册任何东西，宿主就照做。

不用写启动框架、不用手动 import 一堆内核函数——插件只描述"我贡献什么"，
把注册收进 `ctx`，卸载时内核自动回收。

## 做

### 第 1 步：认识一个现成的最小插件

仓库里 `packages/plugins/plugin-canvas-commands/src/canvasCommandsPlugin.ts` 就是最标准的样子
（它注册了几条命令：删除 / 建节点 / 撤销 / 重做）。它长这样，**三个散开的命名导出**：

```ts
import type { Context } from '@mini-canvas/canvas-base'

export const name = 'commands'        // 插件唯一名
export const inject = [] as string[]  // 依赖的服务/插件名，没有就空数组

export function apply(ctx: Context) {
  // ctx.commands.register 注册一条命令；注册随插件卸载自动回收
  ctx.commands.register({
    id: 'command:delete',
    title: '删除选中',
    run() {
      /* … 读选中、删节点、落盘 … */
    },
  })
}
```

### 第 2 步：你自己写一个最小插件（只加一条命令）

新建 `packages/canvas-core-v2/demo-web/helloPlugin.ts`，照抄成这段
（和上面的真实插件同一个写法，只是命令更简单）：

```ts
import type { Context } from '@mini-canvas/canvas-base'

export const name = 'hello'            // 插件唯一名
export const inject = [] as string[]   // 没依赖别的服务/插件

export function apply(ctx: Context) {
  // 注册一条命令，点它就在控制台打一行 + 弹个提示
  ctx.commands.register({
    id: 'hello.say',
    title: 'hello 插件加载了 ✓',
    run() {
      console.log('[hello] 我是 hello 插件加的命令')
      alert('hello —— 这是 hello 插件注册的命令')
    },
  })
}

/** 给宿主装配用的模块对象（把上面几样收成一份，方便一处引用） */
export const helloPlugin = { name, inject, apply }
```

### 第 3 步：把它装进宿主（两种方式任选其一）

**方式 A · 冷启动装配进 demo**（推荐，最直观）：打开 demo 装配文件
`packages/canvas-core-v2/demo-web/CanvasDemo.vue`，在顶部 import 你的插件，
并把它加进 `plugins` 数组开头：

```ts
import { helloPlugin } from './helloPlugin'          // ← 加这行
// …
const plugins: PluginModule[] = [
  helloPlugin,            // ← 加进数组开头
  themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin,
]
```

**方式 B · 运行中热装**：demo 已经把统一安装句柄挂到了 `window.MiniCanvasManager`，
不用改任何源文件，直接开浏览器控制台粘贴（源码 / 控制台都能 `ctx`，效果一样）：

```js
window.MiniCanvasManager.install({
  name: 'hello',
  inject: [],
  apply(ctx) {
    ctx.commands.register({
      id: 'hello.say',
      title: 'hello 插件加载了 ✓',
      run() { console.log('[hello] 我是 hello 插件加的命令') },
    })
  },
})
```

> 想用 `.ts` 新建文件 + 方式 A 那种"改装配数组"的正式做法，就按第 2 步写文件、第 3 步方式 A 装配。
> 想最快看到"热装"效果就方式 B。两条路结果一样：命令被注册、可被工具栏执行。

## 你会看到

- 方式 A：保存后 vite 热更自动刷新，hello 插件随宿主一起装载，控制台无报错。
- 方式 B：粘贴回车即装好，插件**没刷新页面**就生效了（热装）。
- 想验证命令真在？模仿 demo 工具栏那样执行它：控制台
  `window.MiniCanvas.getHost().command.execute('hello.say')`（demo 把宿主 API 挂到了 `window.MiniCanvas`），
  或读 `ctx.commands.has('hello.say')` 看是否已注册。

## 这背后发生了什么（一句话）

宿主把插件经内核装载：`apply(ctx)` 拿到能力台 `ctx`，`ctx.commands.register` 在**内核的命令表**
里落了一条命令。因为这条注册是"可逆 effect"，以后卸载这个插件（第 6 篇会讲怎么卸），
这条命令会**自动被清掉**——你不用写清理代码。

## 其他两种插件形态

函数形态（上面的 `apply` 导出）最常见，但内核认三种形态。第 3 篇会细讲"类形态"（Service），
这里先知道有这么回事即可：

```ts
// 1. 函数形态：直接导出 apply（你刚写的这种）
export function apply(ctx: Context) {}

// 2. 对象形态：一个带 apply 方法的对象（helloPlugin 就是这种）
export const objectPlugin = { name: 'obj-plugin', apply(ctx: Context) {} }

// 3. 类形态：一个 Service 子类（第 3 篇介绍）
export class MyService extends Service {
  constructor(ctx: Context) { super(ctx, 'myTutorialService') }
}
```

在需要公开服务之前，一直用函数形态就好。

## 下一步

你的插件"装上并跑起来"了。下一步弄懂它**什么时候被卸掉、注册为什么自动回收**，
以及怎么用 `ctx.effect` 管住没被托管的东西 → [第 2 篇 · 生命周期与 effect](./02-lifecycle-effect-fiber.md)。
