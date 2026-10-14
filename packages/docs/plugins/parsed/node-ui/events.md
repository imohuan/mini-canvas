# 事件

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：本插件发一个事件 `ui/context` —— 它是 `ui.getContext` 命令的"数据回程"。

## 发的事件

| 事件名 | 载荷 | 何时发 |
| --- | --- | --- |
| `ui/context` | 见下方 `buildNodeContext` 返回值 | 执行 `ui.getContext` 命令时 |

## 载荷形状

源码里的 `buildNodeContext(ctx, nodeId)` 返回值（**逐字**）：

```ts
{
  nodeId: string
  canvasId: string
  baseUrl: string
  /** 连进本节点的素材（Agent 据此知道有哪些数据可画） */
  upstream: Array<{ refName: string; kind: string; url?: string; value?: string; nodeId?: string }>
  /** 这个节点的参数（键 → 值；没交过就是空对象） */
  inputs: Record<string, unknown>
  /** 后台接口速查（写进提示词用；空 baseUrl 时为空串） */
  apiHint: string
}
```

## 为什么由后端算而不是让 Agent 自己拼

素材在**边**里、接口地址在**配置**里、画布 id 在 **URL** 里 —— 这三样分散在三处，
Agent 每次自己找容易漏；漏一处的表现是"生成的界面连不上后台"，而它看起来只是空白，很难查。
收在这里算一次，Agent 拿到的就是完整的一份。

## 怎么监听

```ts
// 位置：Agent / 调用方
const off = ctx.on('ui/context', (payload) => {
  console.log('该画什么：', payload.upstream, payload.apiHint)
})
// 用完记得 off.dispose()
```

## 注意事项

1. **事件名要先登记**：内核要求发之前 `registerEventName`（本插件在 `apply` 里登记了 `ui/context`），否则 dev 下会 warn。
2. **上游素材按"源节点"去重**：同一个上游节点连了多条边只算一次。

