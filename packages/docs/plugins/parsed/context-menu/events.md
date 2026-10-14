# 事件

> 插件：右键菜单 context-menu · [返回总览](/plugins/parsed/context-menu/)

**一句话**：本插件**监听**渲染层的右键与落线事件（事件源），不自己发事件。

## 监听的事件

| 事件 | 载荷 | 干什么 |
| --- | --- | --- |
| `RenderEvents.ContextMenuPane` | `{ clientX, clientY, flowPosition }` | 空白处右键 → 弹"新建节点"菜单 |
| `RenderEvents.ContextMenuNode` | `{ clientX, clientY, flowPosition, nodeId, nodeType? }` | 节点上右键 → 弹节点菜单 |
| `RenderEvents.ContextMenuEdge` | `{ clientX, clientY, flowPosition, edgeId }` | 连线上右键 → 弹连线菜单 |
| `RenderEvents.ConnectionDropBlank` | `ConnectionDropPayload` | 拖线落到空白 → 放"连线菜单卡" |
| `CONNECTION_MENU_PICK_EVENT` | `ContextMenuItem` | 菜单卡里选了某项 → 建节点并连上 |
| `CONNECTION_MENU_CANCEL_EVENT` | 无 | 取消菜单卡 → 撤掉那张临时卡 |

> 事件源由**渲染层**发出（宿主已 `preventDefault` + `ctx.emit`），本插件只订阅。
> 这就是"插件不认识宿主、宿主也不用认识插件"的解耦方式。

## 怎么订阅

```ts
ctx.on(RenderEvents.ContextMenuNode, (p) => { /* p.nodeId 就是被右键的节点 */ })
```

## 注意事项

1. **payload 接口在本插件里本地声明了一遍**（避免依赖渲染层导出遗漏）—— 形状必须与 `canvas-render` 的 `RenderEvents.*` 契约一致。
2. **`ctx.on` 的监听随插件 scope 自动回收**：插件卸载不用手写清理。

