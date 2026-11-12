# 命令

> 插件：文本节点 text · [返回总览](/plugins/parsed/node-text/)

**一句话**：本插件注册 2 条命令 —— 它们与底栏按钮**共用同一批实现**，只是"由外部按 id 调"。

## 命令逐条

| 命令 id | 标题 | payload | 返回 | 干什么 |
| --- | --- | --- | --- | --- |
| `text.duplicate` | 复制文本节点 | `{ nodeId: string }` | `boolean` | 调 `duplicateTextNode`；缺 `nodeId` 返回 `false` |
| `text.delete` | 删除文本节点 | `{ nodeId: string }` | `boolean` | 调 `doc.removeNodes([nodeId])` |

## 怎么调

命令是"外部（快捷键、右键菜单、MCP）按 id 调"的通道：

```ts
ctx.commands.execute('text.duplicate', { nodeId: 'node-1' })
```

## 注意事项

1. **返回值只表示"成不成"，不给数据**：要拿数据请直接调 [服务](/plugins/parsed/node-text/service) 方法。
2. **id 与底栏动作同名**：`text.duplicate` 既是命令 id 也是底栏动作 id，两条路指向同一份实现 —— 刻意的，避免各写一遍。

