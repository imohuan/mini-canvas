# 1 · 写你的第一个插件

> 目标：写一个最小插件，加进 demo，跑起来看到"插件已加载"几个字。
> 全程约 2 分钟。

## 前提

- demo 能跑起来：`cd packages/canvas-core-v2 && pnpm dev` → 开 http://localhost:5199 能看见画布。
- 你新建的插件文件先放 `packages/canvas-core-v2/demo-web/` 下（跑通后想搬哪都行）。

## 做

1. 新建文件 `packages/canvas-core-v2/demo-web/helloPlugin.ts`，**把这文件替换成**这段：

```ts
import type { Context } from '@mini-canvas/canvas-base'

export const name = 'hello'          // 插件唯一名
export const inject = []             // 没依赖服务，空着

export function apply(ctx: Context) {
  // ctx.commands.register 注册一条命令；命令注册随插件卸载自动回收
  ctx.commands.register({
    id: 'hello.say',
    title: '插件已加载',
    run() {
      console.log('[hello] 插件已加载 ✓')
      alert('插件已加载 ✓ —— 这是我（hello 插件）加的命令')
    },
  })
}

// 给 demo 装配用的模块对象（把上面三样收成一份）
export const helloPlugin = { name, inject, apply }
```

2. 打开 demo 装配文件 `packages/canvas-core-v2/demo-web/CanvasDemo.vue`，
   在顶部 import 区下面加一行，把插件加进装配数组：

```ts
import { helloPlugin } from './helloPlugin'   // ← 加这行（见第 4 步文件里的导出名）
```

   然后把你插件的模块对象塞进 `plugins` 数组开头：

```ts
const plugins: PluginModule[] = [helloPlugin, themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]
```

3. 保存，vite 热更会自动刷新页面。

## 你会看到

- 点工具栏任意按钮 / 浏览器控制台，证明一切正常。
- 打开浏览器控制台，里面没有任何报错——说明你的插件被正常装载了。

> 想让"装载"更可见？在第 1 步的 `apply` 里加一行监听装载完成事件：
> ```ts
> ctx.on('ctx:ready', () => console.log('[hello] 插件已随内核装载完成'))
> ```

## 这背后发生了什么（一句话）

宿主把每个插件都经内核的 ctx 装载：`apply(ctx)` 拿到能力台 ctx，`ctx.commands.register` 在**内核那套命令表**里落了一条命令；因为注册是"可逆效应"，以后卸载这个插件，这条命令会**自动被清掉**，你不用写清理代码。

## 下一步

插件真的"装上并跑起来"了。下一步给它加点看得见的内容 → [给画布加一种节点](./02-add-a-node.md)。
