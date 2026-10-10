# ctx.mcp · 给 AI 加工具

**一句话定位**：`ctx.mcp.tool(def)` 给后台的 MCP 服务加一个 AI 可调用的工具；注册随插件卸载回收。

**属于哪一档**：后台框架能力段（`packages/cloud-server/src/serverFramework/mcp.ts`）。

## 用法

```js
// 文件：<数据根>/server-plugins/demo-mcp.js
export const name = 'demo-mcp'

export function apply(ctx) {
  ctx.mcp.tool({
    name: 'demo.echo',
    description: '把输入原样返回；演示给 AI 加一个工具',
    input: { text: 'string' },        // 参数简表：名 → 类型（string / number / boolean）
    required: ['text'],
    handler: async (args) => ({ echo: args.text }),
  })
}
```

## 方法

| 方法 | 签名 | 干什么 |
| --- | --- | --- |
| `tool` | `tool(def: McpToolDef): void` | 注册一个 MCP 工具 |

## 声明形状（`McpToolDef`）

```ts
interface McpToolDef {
  name: string                                  // 工具名（建议 插件名.动作，避免与内置撞名）
  description: string                           // 给 AI 看的一句话（写好这句 AI 才知道何时用）
  input?: Record<string, 'string' | 'number' | 'boolean'>   // 参数简表；缺省 = 不收参数
  required?: string[]                           // 必填参数名（缺省全可选）
  handler(args: Record<string, unknown>): unknown | Promise<unknown>   // 执行体，返回可 JSON 化的值
}
```

## 注意事项

1. **参数是"朴素简表"，不是 zod**：插件是外挂单文件（`data:` URL 加载，没有依赖解析），import 不了 zod。宿主把它翻译成 MCP SDK 认识的 schema。
2. **落点是注册场 `server/mcp-tool`**，条目归注册方插件 → **卸载即摘**。
3. **MCP server 每请求新建**：每次建时现读注册场，天然拿到最新工具集合。
4. **`ctx.agent.tool(def)` 是同一个落点**：本项目里 Agent 拿工具的通道就是 MCP，所以两个方法登记进同一张表，只是从"Agent 视角"还是"MCP 视角"称呼。

