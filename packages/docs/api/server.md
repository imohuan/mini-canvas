# 后端 API（cloud-server）

后端插件和前端**同一套内核**：裸导出 `name` / `apply`，在 `apply(ctx)` 里往 `ctx` 上注册。
差别是后端 `ctx` 多出五个能力段：

| 能力 | 一句话 | 页面 |
| --- | --- | --- |
| `ctx.routes` | 加一个 HTTP 接口 | [routes](/api/server-routes) |
| `ctx.store` | 插件私有的持久化命名空间 | [store](/api/server-store) |
| `ctx.jobs` | 定时 / 延时任务 / 事件订阅 | [jobs](/api/server-jobs) |
| `ctx.mcp` | 给 AI 加一个可调用的 MCP 工具 | [mcp](/api/server-mcp) |
| `ctx.agent` | 拦截 / 改写一次对话轮次 | [agent](/api/server-agent) |

## 后端插件的形状

```js
// 一个文件：丢进 <数据根>/server-plugins/<名字>.js 就生效
export const name = 'my-server-plugin'

export function apply(ctx) {
  ctx.routes.get('/api/my/hello', (c) => c.json({ ok: true }))
}
```

因为是按 `data:` URL 加载的**单文件**（没有依赖解析），插件必须自包含：
import 不了别的包，只能用宿主一定有的东西（例如 `hono` 的处理函数签名）。

## 共同点

- **注册随插件卸载回收**：五个能力段都落进内核注册场（`server/route`、`server/mcp-tool`、
  `server/agent-mw` 等），条目归注册方插件 → 卸插件就摘掉它的路由 / 工具 / 中间件。
- **`ctx.store` / `ctx.jobs` 的清理也自动**（store 命名空间卸载即清，定时器随作用域回收）。
- 五个能力段的类型经声明合并补进 `PluginCapabilities`（`packages/cloud-server/src/serverFramework/capabilityTypes.ts`）。

## 生命周期约束

Hono 首次 `fetch` 后路由表冻结。所以**路由必须在 `ctx.start()` 之前注册**（装载期）。
运行期新装的插件路由靠一条 catch-all 兜底代理命中，无需重启。

