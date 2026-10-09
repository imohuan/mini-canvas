# 自省：一次问清"这台画布装了什么"

这是整个文档系统能"读活数据"的底座。画布自己带了一套**只读的自省 API**，
随时可调、零副作用：不注册东西、不触发事件。

## 一个方法拿到全部

```ts
const s = ctx.surface()
```

在跑着的应用里，从浏览器的 console 也能拿到：

```js
const ctx = window.MiniCanvasUI.getContext()
console.table(ctx.surface().services)
```

它一次返回这些轴：

| 字段 | 回答什么问题 |
| --- | --- |
| `state` | 画布现在是什么状态（created / started） |
| `services` | **有哪些服务、各是谁注入的**（带方法名） |
| `registries` | 每个注册场里**有哪些键、各几条** |
| `registryEntries` | **每一条**的明细：kind / key / id / order / **source（谁放的）** |
| `commands` | 命令清单（含快捷键、分组、**注册路径**） |
| `tools` | 生成工具（含声明式参数） |
| `modelTools` | 给模型调用的工具 |
| `events` | 已登记的事件名 |

## 每个插件现在怎么样：`inspectPlugins()`

```ts
ctx.inspectPlugins()
// → [{ name: 'theme-default', state: 'active', core: true, missingDeps: [] }, ...]
```

它回答："哪些插件在跑、哪些卡住了、卡在缺哪个依赖、哪些是核心件"。

## `source` 这一项为什么最重要

以前排查问题最难的是一句话："**这东西到底是谁放的？**"

现在不用猜了 —— 每条注册都自带 `source`：

```ts
// 谁提供了 doc 服务
ctx.surface().services.find(s => s.name === 'doc').source
// → 'canvas-base'

// 谁往图片节点的上控制栏放了东西
ctx.surface().registryEntries
  .filter(e => e.kind === 'node/region' && e.key.includes('out:top'))
  .map(e => e.source)
```

`source` 的取值可能是：插件名、`'<host>'`（宿主放的，比如渲染层那两件服务）、
`'<builtin>'`（内核或能力层自带）、`'<anonymous>'`。

## `registryEntries` 里的 `fields` 是什么

它列出"这条条目的值有哪些**顶层字段**可读"，是给诊断用的提示，不是稳定契约。

比如一条 `node/region` 条目 `fields: ['component','needs','props']`，
意思是"这条附带了一个组件、它声明了需要哪些能力、传了哪些 props"。
只给字段名、不给值，是为了不把内部句柄泄露出去、也不让报告长得读不完。

## 把自省接进文档 / 面板

因为 `surface()` 是只读的、随时可调，所以它能被任何地方吃：

- **本文档站的[活快照](/plugins/live)页**：直接在浏览器里调它，把结果画成表格。
- **后台接口**：MCP 服务器 / 后台可以把它转成 JSON 下发，文档站 `fetch` 回来。
- **诊断面板**：应用里开一个开发者面板，实时看谁注册了什么。

下面这段伪代码就是"文档页读活数据"的完整链路：

```ts
// ① 文档页：优先读后台接口，读不到就退回同源应用
let s
try {
  s = await (await fetch('/api/plugins/surface')).json()
} catch {
  s = window.MiniCanvasUI.getContext().surface()
}

// ② 按"谁放的"归拢，画成表格
const bySource = groupBy(s.registryEntries, e => e.source)
```

## 一句话总结

**文档写的不是"代码长什么样"，而是"画布现在是什么样"。**
`ctx.surface()` 就是这两者之间的桥。
