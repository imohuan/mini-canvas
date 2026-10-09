# 核心插件：渲染宿主 canvas-render

**一句话**：它把数据层的数据，真正画到屏幕上；同时它也是**整套插件系统的装配入口**。

前面讲过三层分工：数据层管"有什么"，渲染层管"怎么画"。`canvas-render`
就是那个渲染层。它不是 `packages/plugins` 下的插件，而是一个**包**，
但它对插件作者来说扮演"核心插件"的角色 —— 因为插件能拿到的渲染能力都从它这儿出。

## 它的两个身份

### 身份一：页面上真的出现一张画布

宿主组件 `CanvasHost` 一行渲染：

```vue
<CanvasHost :cold-plugins="APP_PLUGINS" window-key="MiniCanvasUI" />
```

或者不要 Vue，只要一张画布，用一行函数：

```ts
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'

const { host, api, exposeToWindow } = await createMiniCanvasHost({
  coldPlugins: [themeDefaultPlugin, nodeTextPlugin],
})
exposeToWindow()   // 顺手把 api 挂到 window.MiniCanvas
```

它内部做的就是：建 `ctx` → 装基础服务 → 补渲染层两件 → 装插件 → `start`。

### 身份二：插件系统暴露给画布的那一面

它负责把"插件门面"挂到 window 上，让外部（脚本、AI、调试工具）能操作画布：

```ts
window.MiniCanvasUI.getContext()            // 拿到 ctx
window.MiniCanvasUI.getContext().surface()  // 拿到自省快照
window.MiniCanvasUI.listPlugins()           // 已装插件
window.MiniCanvasUI.installPlugin(mod)      // 热装
```

## 它注入的两件服务

这是渲染层最核心的贡献。数据层给不了这两样，因为一个要量 DOM、一个要抓绘图后端：

| 服务 | 为什么必须由它提供 | 插件拿它能干什么 |
| --- | --- | --- |
| `nodeLayout` | 节点的**实际**渲染尺寸只能量 DOM | 拿节点真实宽高、绝对坐标、兄弟节点 |
| `viewport` | 视口要 attach VueFlow 后端才能动 | 缩放、定位、聚焦某节点、屏幕坐标↔画布坐标 |

```ts
const layout = ctx.get('nodeLayout')
layout.nodeSize(nodeId)            // 实测尺寸（数据层只知道声明尺寸）
layout.absolutePosition(nodeId)    // 绝对坐标

const vp = ctx.get('viewport')
vp.setViewport({ x: 0, y: 0, zoom: 1 })   // 直接控制视口
vp.fitView()
```

> **对比一下**：`doc`（数据层）里的 `size` 是"我声明我多大"；
> `nodeLayout` 里的是"我**实际**被渲染成多大"。这两个数常常不一样
> （比如图片按原图比例撑开了），所以必须分开、由不同层提供。

## 它还注册了"标准能力包"

还记得组件里的 `needs: ['node','zoom','selection']` 吗？这些能力的**默认实现**
就是由渲染宿主注册的：

```ts
// 宿主把标准能力放进 capability 注册场，order 100
for (const [name, factory] of Object.entries(createStandardCapabilities(ctx))) {
  ctx.registryOf('capability').add(name, factory, { id: 'host:standard', order: 100 })
}
```

意思是：组件的"我需要 zoom 能力"这句话，**由谁来实现是可以换的** ——
宿主给一份默认实现，插件给更小 order 就能整套替换。

| 能力名 | 给了什么 |
| --- | --- |
| `node` | 当前节点是谁、怎么读写它 |
| `selection` | 当前选中了什么 |
| `selected` | 我是不是被单独选中 |
| `zoom` | 当前缩放级别 |
| `tools` | 生成工具注册表 |

## 它还给插件作者提供了什么

插件在自己的 UI 里要用到渲染能力时，从它这里取：

| 拿什么 | 干什么 |
| --- | --- |
| `useCanvasRender()` | 渲染上下文（新代码首选） |
| `useCapabilities()` | 按声明的 `needs` 拿组件能力 |
| `useUiComponent(name)` | 按名取设计系统组件（按钮/下拉/滑块） |
| `useThemeColor(token)` | 取主题色（SVG、canvas 这类吃不到 CSS 变量的地方用） |
| `useSoleNodeSelected()` | "这个节点是不是被单独选中"（决定操作栏显不显示） |
| `resolveFeedback()` | 拖线连接过程中的反馈判定（纯函数，可测） |
| `computeSnapZones()` | 吸附带几何（纯函数） |

## 为什么把"几何纯函数"也放这儿

注意上面有些是**纯函数**（不算 DOM、不碰 Vue）：吸附带几何、反馈判定、裁剪几何。
它们放渲染层而不是数据层，是因为"吸附"和"裁剪"本来就是**显示概念**；
但它们又是纯函数，所以能被单独测试，不依赖浏览器。

这条界线也回答了常见问题："这段逻辑放哪层？"——
**只依赖框架 → kernel；只依赖数据 → canvas-data；要摸 DOM / VueFlow → canvas-render；
只服务某个具体功能 → 那个功能的插件里，不外溢。**
