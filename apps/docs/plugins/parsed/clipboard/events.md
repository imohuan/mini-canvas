# 事件

> 插件：复制粘贴 clipboard · [返回总览](/plugins/parsed/clipboard/)

**一句话**：本插件在复制 / 剪切 / 粘贴发生时各发一个事件，供别的插件（通知、统计、联动）收听。

## 发的事件

| 事件名 | 何时发 | 载荷 |
| --- | --- | --- |
| `clipboard:copy` | 复制了选中节点 | `{ nodeCount: number, edgeCount: number }` |
| `clipboard:cut` | 剪切了选中节点 | 同上 |
| `clipboard:paste` | 粘贴完成 | 同上（贴进来的数量） |

> 三个事件名在模块顶层用 `registerEventName` 登记过（内核要求"发之前先登记"，否则 dev 下会 warn）。

## 怎么订阅

```ts
// 位置：任意插件 —— 想在"粘贴后"做点什么
ctx.on('clipboard:paste', (p) => console.log('贴进来', p.nodeCount, '个节点'))
```

## 注意事项

1. **事件是"事后通知"**，不能改结果；要拦或改行为请用 `clipboard/paste` 仲裁场。
2. **载荷里只有数量**（不是节点对象）：要保持轻量，避免订阅方拿到大对象。

