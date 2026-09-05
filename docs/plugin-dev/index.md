# 开发 @mini-canvas 插件（作者教程入口）

> 这是给「想给画布加自己的东西」的人看的。不堆术语、不甩 API 表，
> 每篇都"照抄几行 → 跑起来 → 看到效果"，跑通了再进下一篇。

## 你最终会写成什么样（一句话）

一个 `.ts` 文件，**散开裸导出 3 样**，就成插件：

```ts
import type { Context } from '@mini-canvas/canvas-base'

export const name = 'node-audio'   // 插件唯一名
export const inject = []            // 依赖别的服务/插件，没有就空
export function apply(ctx: Context) {
  // ctx 就是"能力台"：在这里注册节点/主题/命令/服务/UI，卸载自动回收，不用你手写清理
  ctx.nodes.register({ type: 'audio', label: '音频', size: { w: 200, h: 80 }, content: AudioNode })
}
```

不用手写 `unregister`、不用记一堆内核函数从哪 import——注册都自动回收。

## 教程（按顺序读）

1. **《写你的第一个插件》** — 建文件 → 写最小插件 → 在 demo 里加一行装配 → 跑起来看到"插件已加载"。
2. **《给画布加一种节点》** — 把那个插件换成会注册 `text` 之类节点的代码 → 刷新后能从菜单点出新节点。
3. 《让插件可配置》 — 给插件声明一份分组配置（颜色/数字…），UI 面板自动长控件，改了实时生效。*(随设置系统就绪后补齐)*
4. 《打包并装进别的画布》 — 把插件打包成可分发形态，装进另一个画布应用、可卸载/换版本。*(随安装系统就绪后补齐)*

每篇正文只说"做什么、为什么"，主体是"把这文件替换成这段代码 → 这一步跑 → 你会看到 X → 下一步"。

## 先备好环境

- demo 跑在 `packages/canvas-core-v2`，命令：`cd packages/canvas-core-v2 && pnpm dev`，浏览器开 **http://localhost:5199**。
- 你新建的插件文件放在哪都行（演示最省事是放到 `packages/canvas-core-v2/demo-web/` 下），
  关键是把它的导出加进 demo 的装配数组（第 1 篇教）。

## 认识「能力台」ctx

作者在 `apply(ctx)` 里会用的注册面（都自动回收）：

| 想干什么 | 写法 |
|---|---|
| 加一种节点（数据+UI） | `ctx.nodes.register({ type, label, size, content })` |
| 顶替/叠加一块主题 UI | `ctx.theme.register('edge', MyEdge, { id, order })` |
| 加一条命令 | `ctx.commands.register({ id, title, run })` |
| 往某 UI 槽塞个组件 | `ctx.slots.register('canvas.dock', { id, order, component })` |
| 上一个服务给别人用 | `ctx.inject('mySvc', { ... })` |
| 取服务 | `ctx.get('nodeStore')` |

组件引用是 opaque 的（.vue 组件直接传进去），作者 import 自己的 .vue 即可，不用管内核。
