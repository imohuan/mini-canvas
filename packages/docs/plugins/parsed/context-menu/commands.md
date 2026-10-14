# 命令

> 插件：右键菜单 context-menu · [返回总览](/plugins/parsed/context-menu/)

**一句话**：本插件注册 2 条内置命令，它们同时也是右键菜单里的两项。

## 命令逐条

| 命令 id | 标题 | areas | group / order | payload | 干什么 |
| --- | --- | --- | --- | --- | --- |
| `context-menu:delete-node` | 删除节点 | `['node']` | 节点 / 10 | `{ nodeId: string }` | `doc.removeNodes([nodeId])`（连带清掉相连的边，可撤销） |
| `context-menu:delete-edge` | 删除连线 | `['edge']` | 连线 / 10 | `{ edgeId: string }` | `doc.removeEdges([edgeId])`（只删边，保留两端节点） |

## `areas` 是关键

菜单按"右键点在哪种东西上"收命令：

- 右键**节点** → 收 `areas` 含 `'node'` 的命令；
- 右键**空白** → 收含 `'pane'` 的；
- 右键**连线** → 收含 `'edge'` 的。

**别的插件不用认识菜单**：注册一条带 `areas` 的命令，菜单自动出现它。这是本插件最有用的一条缝。

## 注意事项

1. **payload 缺 id 时命令静默不动作**（早退），不抛。
2. **删除走 `doc`**（唯一写入口）：自动进历史、落盘、可撤销。

