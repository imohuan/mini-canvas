# 服务 `uiNode`

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：服务名 `uiNode` —— 建可视化节点、把 Agent 生成的 HTML 写进去、读回当前内容与参数。

## 怎么拿

```ts
const uiNode = ctx.get('uiNode')     // Agent / MCP / 别的插件都用这条
```

> 根 ctx **没有**属性代理，别直访 `ctx.uiNode`（`declare module` 只给类型）。

## 类型

源码里的 `UiNodeService` 接口，与实现类 `UiNodeService_ extends Service` 一一对应：

```ts
export interface UiNodeService {
  addNode(position: { x: number; y: number }, extra?: unknown): string
  setHtml(id: string, html: string, source?: string): boolean
  htmlOf(id: string): string
  inputsOf(id: string): Record<string, unknown>
  clear(id: string): boolean
}
```

## 它依赖什么

`doc`（数据唯一写入口；方法内 `this.doc()` 惰性取）。`doc` 也在模块级 `inject` 里（硬依赖）。

## 函数逐条

### `addNode(position, extra?)`

| 项 | 内容 |
| --- | --- |
| 签名 | `addNode(position: { x: number; y: number }, extra?: unknown): string` |
| 参数 | `position`：节点左上角位置；`extra`：**建节点时一起写进去的 data**（导入节点包会带 `uiHtml` / 声明） |
| 返回 | 新节点短 id |
| 干什么 | 在一次事务（`'add-ui-node'`）里建 `ui@@ 节点；先铺默认 `uiInputs: {}`，再让 `extra` 覆盖 |
| 何时用 | 要在画布上放一个可视化节点 |

> **`extra` 必须合并进去**：不合并的话"带数据建节点"会静默丢字段（节点建出来是空的）—— 踩过。

```ts
// 位置：放一个可视化节点；带 uiHtml 时直接建出"已经画好"的节点
const id = ctx.get('uiNode').addNode({ x: 200, y: 120 })
```

### `setHtml(id, html, source?)`

| 项 | 内容 |
| --- | --- |
| 签名 | `setHtml(id: string, html: string, source?: string): boolean` |
| 参数 | `id`：节点 id；`html`：要渲染的 HTML；`source`：谁写的（`'agent'` / `'mcp'` / `'user'`，缺省 `'agent'`） |
| 返回 | 写入是否成功（**节点不存在返回 `false`**） |
| 干什么 | 经 `doc.updateNode@@ 写 `uiHtml` + `uiGeneratedAt` + `uiBy`（进历史、落盘，可撤销）；顺手 `extractHtml` 剥掉 markdown 代码块 |
| 何时用 | **Agent 写完 HTML 回写的主入口** |

> 为什么顺手剥代码块：Agent 常把 HTML 包在 markdown 里交出来（``` ```html ... ``` ```）。

```ts
// 位置：把一段 HTML 写进某个可视化节点
ctx.get('uiNode').setHtml('node-1', '<h1>你好</h1><p>我是 Agent 画的</p>', 'agent')
```

### `htmlOf(id)`

| 项 | 内容 |
| --- | --- |
| 签名 | `htmlOf(id: string): string` |
| 参数 | `id`：节点 id |
| 返回 | 该节点当前渲染的 HTML；**空串 = 还没画**；节点不存在也返回空串 |
| 干什么 | 读回内容（排查、增量改写、导出都用它） |
| 何时用 | Agent 要"先看现在长什么样，再决定怎么改" |

### `inputsOf(id)`

| 项 | 内容 |
| --- | --- |
| 签名 | `inputsOf(id: string): Record<string, unknown>` |
| 参数 | `id`：节点 id |
| 返回 | 该节点的参数（键 → 值）；不是对象时返回 `{}` |
| 干什么 | 读页面 `setInputs` 交上来的那些值 |
| 何时用 | 页面里有输入控件、要拿用户填的值 |

### `clear(id)`

| 项 | 内容 |
| --- | --- |
| 签名 | `clear(id: string): boolean` |
| 参数 | `id`：节点 id |
| 返回 | 是否清掉（节点不存在返回 `false`） |
| 干什么 | 把 `uiHtml` 与 `uiBy` 清空，回到空态（进历史，可撤销） |
| 何时用 | 想重新画一遍、或要一块干净面板 |

## 注意事项

1. **写内容一律走 `setHtml`**（它进历史、落盘、剥代码块）；别直接改 `data`。
2. **`source` 只用于排查与展示**，不参与逻辑。
3. **节点不存在时 `setHtml` / `clear` 返回 `false`**（不抛）：调用方要判返回值。

