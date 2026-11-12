# 命令

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：本插件注册 3 条命令 —— 它们是**给 Agent / MCP / 快捷键的外部入口**，让"该画什么"与"画好了"两条路都走得通。

## 命令逐条

| 命令 id | 标题 | payload | 返回 | 干什么 |
| --- | --- | --- | --- | --- |
| `ui.getContext` | 读取可视化节点的上下文 | `{ nodeId: string }` | `boolean` | 组装"该画什么"的全部上下文，**经事件 `ui/context` 回给调用方** |
| `ui.setHtml` | 写入可视化 HTML | `{ nodeId: string, html: string, source?: string }` | `boolean` | 调 `uiNode.setHtml` 把 HTML 写进节点 |
| `ui.clear` | 清空可视化节点 | `{ nodeId: string }` | `boolean` | 调 `uiNode.clear` |

## 为什么 `ui.getContext` 用事件回数据

命令的契约是**同步布尔**（只表示"成不成"），而 Agent 要的是**数据**（节点信息、连进来的素材、后台地址）。
所以它把结果 `emit` 成事件 `ui/context`，调用方监听事件拿数据。详见 [事件](/plugins/parsed/node-ui/events)。

## 怎么调

```ts
// 位置：Agent 侧 —— 先拿上下文，再把生成的 HTML 写回去
ctx.commands.execute('ui.getContext', { nodeId: 'node-1' })
ctx.commands.execute('ui.setHtml', { nodeId: 'node-1', html: '<h1>你好</h1>', source: 'agent' })
```

## 注意事项

1. **缺 `nodeId` 一律返回 `false`**（不抛）。
2. **`ui.setHtml` 与 `uiNode.setHtml` 是同一份实现**：命令只是"按 id 调"的通道，不必两条路各写一遍。

