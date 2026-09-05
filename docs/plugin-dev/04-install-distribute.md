# 4 · 打包并装进别的画布（安装 / 卸载 / 换版本）

> 目标：把插件变成"能装进任意画布宿主"的可分发东西：写好后用一句 `manager.install` 装进去、
> 想卸就卸、想换版本就换；还能用一份**装配清单(manifest)**让别的画布应用"照单全装"。
> 建立在第 1/2/3 篇跑通的基础上。

## 前提

- 你已经有第 1/2 篇写的插件模块（`.ts` 裸导出 `name/inject/apply`）。
- 宿主统一用同一个安装句柄 `manager`（来自 `createMiniCanvasHost` 的返回，或 `CanvasHost` 实例的 `.manager`）。

## 想法（一句话）

你的插件本质上就是"一个带 `name/apply` 的对象/模块"。安装 = 把它交给 `manager.install`；
宿主已经有的 `api.install/uninstall/reload` 只管"内存里的对象"，`manager` 在此基础上再加两件事：
**能装"外部来源"**（单文件插件 js、URL），和**能照一份装配清单按序装**（同 id 覆盖=换版本）。

## 做

1. **源码 import 来的插件，直接装**（最常见）：

```ts
import { createMiniCanvasHost } from '@mini-canvas/canvas-render'
import myAudio from './audioPlugin'   // { name, inject, apply }

const { manager } = await createMiniCanvasHost()
await manager.install(myAudio)        // 装进去，返回插件名 'audio'
await manager.uninstall('audio')      // 卸掉(副作用/注册自动回收)
await manager.reload('audio', newVersion) // 换版本：卸旧装新
manager.list()                        // [{ name: 'audio' }, …] 看装了哪些
```

2. **外部来源**：一个"单文件插件 js"，只要它按 Cordis 形态导出 `name/apply` 就能装：

```js
// my-plugin.js —— 不用 import 任何库，apply 收到 ctx 直接注册即可
export const name = 'ext-plugin'
export function apply(ctx) {
  ctx.slots.register('overlay', { component: <你的组件>, order: 0 })
}
```

```ts
await manager.install({ url: 'https://…/my-plugin.js' }) // 抓下来装
// 或直接给文本：
await manager.install({ text: "export const name='x'; export function apply(ctx){…}" })
```

3. **装配清单 manifest**：别的画布想"按这份清单照单全装"，宿主只需：

```ts
import { themeDefaultPlugin, nodeTextPlugin, nodeImagePlugin } from '…'
import { canvasCommandsPlugin } from '…'

// 一份清单 = 声明"装哪些、什么顺序、每插件可选 config"；同 name 后装会覆盖先装(轻量分层/换版本)
export const baseManifest = {
  plugins: [
    { id: 'theme-default', source: themeDefaultPlugin },
    { id: 'node-text', source: nodeTextPlugin },
    { id: 'node-image', source: nodeImagePlugin },
    { id: 'canvas-commands', source: canvasCommandsPlugin },
  ],
}

// 另一个画布应用一行装完：
await manager.applyManifest(baseManifest)
```

4. 想给某插件"装配默认配置"：清单项里加 `config`——装完会把能对上该插件已 `settings.define`
   声明的 key 覆写为给定值（单一数据源仍归 settings，不做深度合并）：

```ts
{ id: 'theme-default', source: themeDefaultPlugin, config: { edgeColor: '#ff0000', edgeLineWidth: 3 } }
```

## 你会看到

- `manager.list()` 列出已装插件；卸掉某个插件后，它注册的 UI/服务/槽位立刻消失（宿主订阅
  `ctx:plugin-installed/uninstalled` 自动重渲染），界面不残留。
- 重载（`reload`/换版本）后，同 id 插件的新实现生效。

> 想直接试：跑 demo 后左下角那块「插件管理器」就是它的真身——列出已装插件、每个能"卸"，
> 还能一键"重载 theme-default"(换版本)。浏览器控制台也能用 `window.MiniCanvasManager` 操作。

## 这背后发生了什么（一句话）

`manager` 只是把宿主既有的"装/卸/换版本"收成一个入口，再加两类便利：
① 外部来源经 ESM `data:`/`url` import 加载成标准 `{name,apply}` 模块；② `manifest` 让你用一份声明
"装哪些、按什么顺序、给什么 config"，其它画布应用拿到就能 `applyManifest` 整链装齐、还能卸/换版本。

## 下一步

到这里，你已经能给画布加节点、让它可配置、并把它打包装进别的画布。剩下的例子（自定义端口/吸附等）
是演示性验证，不属于插件系统主体；你已经会用最核心的三件套：`ctx.nodes`（注册）、
`ctx.settings`（配置）、`manager`（分发安装）。
