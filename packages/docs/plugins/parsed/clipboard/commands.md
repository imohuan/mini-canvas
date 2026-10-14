# 命令

> 插件：复制粘贴 clipboard · [返回总览](/plugins/parsed/clipboard/)

**一句话**：本插件注册 4 条命令 —— 它们与 Ctrl/Cmd+C / V / X / D 四条快捷键**同源**。

## 命令逐条

| 命令 id | 标题 | keys | areas | 返回 | 干什么 |
| --- | --- | --- | --- | --- | --- |
| `clipboard:copy` | 复制选中节点 | `['mod+c']` | `['node']` | `svc.copy()` | 复制选中节点（+ 内连边） |
| `clipboard:paste` | 粘贴 | `['mod+v']` | `['pane']` | `svc.pasteFromCommand()` | 粘贴（先贴本页快照，没有再去读系统剪贴板） |
| `clipboard:cut` | 剪切选中节点 | `['mod+x']` | —（全区域） | `svc.cut()` | 复制后删除选中节点 |
| `clipboard:duplicate` | 复制一份选中节点 | `['mod+d']` | `['node']` | `svc.duplicate()` | 就地复制一份（不走系统剪贴板） |

## `deferToNative: true` 是什么意思

复制/粘贴/剪切**声明了 `deferToNative`**：宿主键盘分发命中时**不 preventDefault、不 execute**，
把键**放行给原生的 copy / cut / paste 事件** —— 否则 keydown 里的 preventDefault 会把原生事件掐掉，
浏览器就不会把内容写进系统剪贴板了。真正的活在**仲裁场**的处理器里做。

> 从**菜单**点进来时没有原生事件，所以命令的 `run` 仍要能自己贴（`pasteFromCommand`）。

## 怎么调

```ts
// 位置：菜单项 / MCP / 脚本
ctx.commands.execute('clipboard:duplicate')
```

## 注意事项

1. **命令与服务方法一一对应**：按钮（组件自己调服务）与命令（外部按 id 调）走同一批实现，不各写一遍。
2. **`areas` 决定它会出现在哪种右键菜单里**：`'node'` = 节点上右键、`'pane'` = 空白处右键。

